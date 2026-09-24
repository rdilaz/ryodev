// RyoDev live hub: one Cloudflare Worker plus one Durable Object.
//
//   laptops --POST /api/events (INGEST_TOKEN)--> Worker --> RyoDevHub (single DO)
//   phone   --GET  /api/state  (VIEW_TOKEN)----> Worker --> RyoDevHub
//   phone   --POST /api/forget (VIEW_TOKEN)----> Worker --> RyoDevHub
//   anything outside /api                     --> static app (env.ASSETS)
//
// The Worker does routing, auth, size limits and validation. The Durable
// Object only reads, reduces and writes one small JSON value, so every state
// change goes through the pure functions in ./state.js. There are no CORS
// headers on purpose: the phone app is served from this same origin.

import {
  MAX_BODY_BYTES, applyEvent, emptyState, forget, prune, publicState, validateEvent, validateForget,
} from './state.js';

const API_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...API_HEADERS, ...extra } });

// Each route names its method and which secret (if any) authorizes it.
const ROUTES = {
  '/api/health': { method: 'GET', run: () => json(200, { ok: true, v: 1, service: 'ryodev' }) },
  '/api/events': { method: 'POST', secret: 'INGEST_TOKEN', run: ingest },
  '/api/state': { method: 'GET', secret: 'VIEW_TOKEN', run: readState },
  '/api/forget': { method: 'POST', secret: 'VIEW_TOKEN', run: forgetSessions },
};

export default {
  fetch: (request, env) => handle(request, env, Date.now()),
};

// Exported with an explicit clock so tests can drive time deterministically.
export async function handle(request, env, nowMs) {
  const { pathname } = new URL(request.url);
  if (pathname !== '/api' && !pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

  const route = Object.hasOwn(ROUTES, pathname) ? ROUTES[pathname] : null;
  if (!route) return json(404, { error: 'not found' });
  if (request.method !== route.method) return json(405, { error: 'method not allowed' }, { Allow: route.method });
  if (route.secret) {
    const expected = env[route.secret];
    if (typeof expected !== 'string' || expected.length === 0) return json(503, { error: 'not configured' });
    if (!(await sameSecret(bearerToken(request), expected))) {
      return json(401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
    }
  }
  try {
    return await route.run(request, env, nowMs);
  } catch (error) {
    console.error('ryodev api error', error?.message);
    return json(500, { error: 'internal error' });
  }
}

async function ingest(request, env, nowMs) {
  const body = await readJsonBody(request);
  if (body.response) return body.response;
  const result = validateEvent(body.value, nowMs);
  if (!result.ok) return json(400, { error: result.error });
  await callHub(env, 'ingest', { now: nowMs, event: result.event });
  return json(202, { ok: true });
}

async function readState(request, env, nowMs) {
  return json(200, await callHub(env, 'state', { now: nowMs }));
}

async function forgetSessions(request, env, nowMs) {
  const body = await readJsonBody(request);
  if (body.response) return body.response;
  const result = validateForget(body.value);
  if (!result.ok) return json(400, { error: result.error });
  const { removed } = await callHub(env, 'forget', { now: nowMs, target: result.target });
  return json(200, { ok: true, removed });
}

// --- Request helpers --------------------------------------------------------

function bearerToken(request) {
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(request.headers.get('Authorization') || '');
  return match ? match[1] : '';
}

// Constant-time comparison: hash both sides to fixed-length digests, then XOR
// every byte. Neither the token length nor the first differing byte leaks
// through timing.
async function sameSecret(given, expected) {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([given, expected].map(s => crypto.subtle.digest('SHA-256', encoder.encode(s))));
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0 && given.length > 0;
}

// Reads at most MAX_BODY_BYTES without buffering anything larger, then parses
// JSON. Returns { value } on success or { response } with the error to send.
async function readJsonBody(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!/^application\/json\s*(;|$)/i.test(type)) {
    return { response: json(415, { error: 'Content-Type must be application/json' }) };
  }
  const tooLarge = { response: json(413, { error: `body larger than ${MAX_BODY_BYTES} bytes` }) };
  if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES) return tooLarge;
  const chunks = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return tooLarge;
      }
      chunks.push(value);
    }
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)) };
  } catch {
    return { response: json(400, { error: 'invalid JSON' }) };
  }
}

// All state lives in one Durable Object instance named "hub".
async function callHub(env, action, payload) {
  const hub = env.HUB.get(env.HUB.idFromName('hub'));
  const response = await hub.fetch(new Request(`https://hub/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
  if (!response.ok) throw new Error(`hub ${action} failed with ${response.status}`);
  return response.json();
}

// --- Durable Object -----------------------------------------------------------

// Holds the whole live state as one JSON-compatible value under the key
// "state". Durable Objects process one request at a time around storage
// calls (input gates), so each read-modify-write below is atomic.
export class RyoDevHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async load() {
    const stored = await this.ctx.storage.get('state');
    return stored && stored.v === 1 ? stored : emptyState();
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);
    const { now, event, target } = await request.json();
    if (pathname === '/state') return Response.json(publicState(await this.load(), now));
    if (pathname === '/ingest') {
      await this.ctx.storage.put('state', prune(applyEvent(await this.load(), event, now), now));
      return Response.json({ ok: true });
    }
    if (pathname === '/forget') {
      const before = await this.load();
      const after = forget(before, target);
      await this.ctx.storage.put('state', prune(after, now));
      return Response.json({ ok: true, removed: before.sessions.length - after.sessions.length });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  }
}
