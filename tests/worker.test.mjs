import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { handle, RyoDevHub } from '../worker/index.mjs';
import {
  validateEvent, applyEvent, prune, publicState, forget, emptyState, MAX_STORED_BYTES,
} from '../worker/state.js';

const NOW = Date.parse('2026-09-24T12:00:00.000Z');
const at = seconds => new Date(NOW + seconds * 1000).toISOString();
const INGEST = 'ingest-secret-0123456789';
const VIEW = 'view-secret-9876543210';
const ORIGIN = 'https://ryodev.example.workers.dev';

// A fake Worker env: ASSETS echoes the path, HUB routes every stub call to one
// in-memory RyoDevHub whose storage is a Map (values cloned like real storage).
function makeEnv(overrides = {}) {
  const store = new Map();
  const ctx = {
    storage: {
      get: async key => structuredClone(store.get(key)),
      put: async (key, value) => { store.set(key, structuredClone(value)); },
    },
  };
  const assetRequests = [];
  const env = {
    INGEST_TOKEN: INGEST,
    VIEW_TOKEN: VIEW,
    ASSETS: { fetch: async request => { assetRequests.push(request); return new Response(`asset ${new URL(request.url).pathname}`); } },
    ...overrides,
  };
  const hub = new RyoDevHub(ctx, env);
  const ids = [];
  env.HUB = { idFromName: name => { ids.push(name); return { name }; }, get: () => hub };
  return { env, store, assetRequests, ids };
}

const event = (overrides = {}) => ({
  v: 1, machine: 'dell', tool: 'claude-code', session: 'a1b2c3d4e5f6', project: 'ryodev',
  state: 'running', ts: at(0), ...overrides,
});

const post = (path, body, token = INGEST, headers = {}) => new Request(`${ORIGIN}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const get = (path, token = VIEW) => new Request(`${ORIGIN}${path}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});

async function send(env, body, seconds = 0) {
  return handle(post('/api/events', body), env, NOW + seconds * 1000);
}
async function state(env, seconds = 0) {
  const response = await handle(get('/api/state'), env, NOW + seconds * 1000);
  assert.equal(response.status, 200);
  return response.json();
}

function assertApiHeaders(response) {
  assert.match(response.headers.get('content-type'), /^application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
}

// --- Validation ---------------------------------------------------------------

test('a well-formed event is accepted and normalized', () => {
  const result = validateEvent(event({ project: '  ryodev  ', detail: 'Needs\u0007 permission:\n Bash', ts: '2026-09-24T14:00:00+02:00' }), NOW);
  assert.equal(result.ok, true);
  assert.deepEqual(result.event, {
    machine: 'dell', tool: 'claude-code', session: 'a1b2c3d4e5f6', project: 'ryodev', state: 'running',
    detail: 'Needs permission: Bash', ts: at(0), clock_skew: false,
  });
  assert.equal(validateEvent(event({ detail: null }), NOW).event.detail, null);
  assert.equal(validateEvent(event({ detail: ' \u0000 ' }), NOW).event.detail, null);
});

test('every field is validated', () => {
  const bad = {
    v: [0, 2, '1', undefined],
    machine: ['', 'Dell', '-dell', 'dell_1', 'a'.repeat(25), 'dell/x', 7, undefined],
    tool: ['claude', 'Codex', '', null, undefined],
    session: ['', 'a'.repeat(65), 'a b', 'a/b', 'é', 12, undefined],
    project: ['', '   ', 'a'.repeat(49), 'a/b', 'a\\b', 'bad\u0001name', 'rtl‮override', 5, undefined],
    state: ['done', 'RUNNING', 'offline', '', undefined],
    detail: [5, {}, 'x'.repeat(121)],
    ts: ['yesterday', '2026-09-24', '2026-02-30T00:00:00Z', '2026-09-24T25:00:00Z', '2026-09-24 12:00:00Z', 1790251200000, undefined],
  };
  for (const [field, values] of Object.entries(bad)) {
    for (const value of values) {
      const body = event({ detail: 'ok' });
      if (value === undefined) delete body[field]; else body[field] = value;
      const result = validateEvent(body, NOW);
      assert.equal(result.ok, false, `${field}=${JSON.stringify(value)} should be rejected`);
    }
  }
  for (const tool of ['claude-code', 'codex', 'opencode', 'kilo', 'other']) assert.equal(validateEvent(event({ tool }), NOW).ok, true);
  for (const state of ['running', 'needs_input', 'finished', 'error', 'ended']) assert.equal(validateEvent(event({ state }), NOW).ok, true);
  assert.equal(validateEvent(event({ machine: 'a'.repeat(24), session: 'A_b-9'.repeat(12), project: 'x'.repeat(48), detail: 'y'.repeat(120) }), NOW).ok, true);
  for (const body of [null, [], 'string', 5]) assert.equal(validateEvent(body, NOW).ok, false);
});

test('unknown keys, oversize bodies and bad JSON are rejected over HTTP', async () => {
  const { env } = makeEnv();
  let response = await send(env, { ...event(), prompt: 'secret' });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /unknown key: prompt/);
  response = await send(env, '{"v":1,');
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid JSON' });
  response = await send(env, event({ detail: 'x'.repeat(2100) }));
  assert.equal(response.status, 413);
  // A streamed body without Content-Length is still capped.
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('x'.repeat(3000))); c.close(); } });
  response = await handle(new Request(`${ORIGIN}/api/events`, {
    method: 'POST', body: stream, duplex: 'half',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${INGEST}` },
  }), env, NOW);
  assert.equal(response.status, 413);
  response = await handle(post('/api/events', event(), INGEST, { 'Content-Type': 'text/plain' }), env, NOW);
  assert.equal(response.status, 415);
  assert.deepEqual((await state(env)).sessions, []);
});

// --- Auth -----------------------------------------------------------------------

test('tokens are required, separate, and missing secrets mean 503', async () => {
  const { env } = makeEnv();
  for (const token of [null, '', 'wrong', VIEW, `${INGEST}x`, INGEST.slice(0, -1)]) {
    const response = await handle(post('/api/events', event(), token), env, NOW);
    assert.equal(response.status, 401, `ingest with ${token}`);
    assertApiHeaders(response);
  }
  assert.deepEqual((await state(env)).sessions, [], 'rejected events are not stored');
  assert.equal((await handle(new Request(`${ORIGIN}/api/events`, {
    method: 'POST', headers: { Authorization: `Basic ${INGEST}`, 'Content-Type': 'application/json' }, body: '{}',
  }), env, NOW)).status, 401);
  for (const token of [null, 'wrong', INGEST]) {
    assert.equal((await handle(get('/api/state', token), env, NOW)).status, 401);
    assert.equal((await handle(post('/api/forget', { all: true }, token), env, NOW)).status, 401);
  }
  assert.equal((await handle(new Request(`${ORIGIN}/api/state`, { headers: { Authorization: `bearer ${VIEW}` } }), env, NOW)).status, 200);

  const unconfigured = makeEnv({ INGEST_TOKEN: undefined, VIEW_TOKEN: '' }).env;
  for (const request of [post('/api/events', event()), get('/api/state'), post('/api/forget', { all: true }, VIEW)]) {
    const response = await handle(request, unconfigured, NOW);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'not configured' });
  }
  assert.equal((await worker.fetch(get('/api/health', null), unconfigured)).status, 200);
});

// --- Reducer behaviour through the real handler ---------------------------------

test('accepted events become sessions, machines and events in GET /api/state', async () => {
  const { env, ids } = makeEnv();
  const response = await send(env, event({ state: 'needs_input', detail: 'Needs permission: Bash' }), 2);
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true });
  assertApiHeaders(response);
  const body = await state(env, 3);
  assert.deepEqual(body, {
    v: 1, server_time: at(3),
    sessions: [{
      key: 'dell/claude-code/a1b2c3d4e5f6', machine: 'dell', tool: 'claude-code', session: 'a1b2c3d4e5f6',
      project: 'ryodev', state: 'needs_input', detail: 'Needs permission: Bash',
      since: at(0), updated: at(0), received: at(2), clock_skew: false,
    }],
    machines: [{ machine: 'dell', last_seen: at(2) }],
    events: [{
      key: 'dell/claude-code/a1b2c3d4e5f6', machine: 'dell', tool: 'claude-code', project: 'ryodev',
      state: 'needs_input', detail: 'Needs permission: Bash', ts: at(0), received: at(2),
    }],
  });
  assert.ok(ids.every(name => name === 'hub'));
});

test('a skewed laptop clock is replaced by server time and flagged', async () => {
  const { env } = makeEnv();
  await send(env, event({ ts: at(-301) }), 0);
  let s = (await state(env)).sessions[0];
  assert.equal(s.updated, at(0));
  assert.equal(s.clock_skew, true);
  await send(env, event({ ts: at(400) }), 10);
  s = (await state(env, 10)).sessions[0];
  assert.equal(s.updated, at(10));
  assert.equal(s.clock_skew, true);
  await send(env, event({ ts: at(310) }), 20); // 4m50s ahead: tolerated
  s = (await state(env, 20)).sessions[0];
  assert.equal(s.updated, at(310));
  assert.equal(s.clock_skew, false);
});

test('late events are logged but never roll a session back', async () => {
  const { env } = makeEnv();
  await send(env, event({ state: 'finished', ts: at(10) }), 10);
  await send(env, event({ state: 'running', ts: at(5), project: 'other' }), 11);
  const body = await state(env, 12);
  assert.equal(body.sessions[0].state, 'finished');
  assert.equal(body.sessions[0].project, 'ryodev');
  assert.equal(body.sessions[0].updated, at(10));
  assert.deepEqual(body.events.map(e => [e.state, e.ts]), [['finished', at(10)], ['running', at(5)]]);
  assert.equal(body.machines[0].last_seen, at(11));
});

test('since changes only when the state value changes', async () => {
  const { env } = makeEnv();
  await send(env, event({ state: 'running', ts: at(0) }));
  await send(env, event({ state: 'running', ts: at(30) }), 30);
  let s = (await state(env, 30)).sessions[0];
  assert.deepEqual([s.since, s.updated], [at(0), at(30)]);
  await send(env, event({ state: 'needs_input', detail: 'Needs permission: Edit', ts: at(60) }), 60);
  await send(env, event({ state: 'needs_input', detail: 'Needs permission: Bash', ts: at(90) }), 90);
  s = (await state(env, 90)).sessions[0];
  assert.deepEqual([s.state, s.since, s.updated, s.detail], ['needs_input', at(60), at(90), 'Needs permission: Bash']);
  await send(env, event({ state: 'running', ts: at(120) }), 120);
  s = (await state(env, 120)).sessions[0];
  assert.deepEqual([s.state, s.since, s.detail], ['running', at(120), null]);
});

test('sessions sort newest first and events are capped at 50 returned / 100 stored', async () => {
  const { env, store } = makeEnv();
  for (let i = 0; i < 120; i++) {
    await send(env, event({ session: `s${i % 3}`, machine: ['mac', 'dell', 'hp'][i % 3], ts: at(i) }), i);
  }
  const body = await state(env, 120);
  assert.deepEqual(body.sessions.map(s => s.session), ['s2', 's1', 's0']);
  assert.equal(body.events.length, 50);
  assert.equal(body.events[0].ts, at(119));
  assert.equal(store.get('state').events.length, 100);
  assert.deepEqual(body.machines.map(m => m.machine), ['hp', 'dell', 'mac']);
});

test('pruning drops old ended sessions, week-old sessions and caps at 100', () => {
  let s = emptyState();
  const apply = (overrides, seconds) => { s = applyEvent(s, validateEvent(event(overrides), NOW + seconds * 1000).event, NOW + seconds * 1000); };
  apply({ session: 'ended', state: 'ended', ts: at(0) }, 0);
  apply({ session: 'finished', state: 'finished', ts: at(0) }, 0);
  assert.equal(prune(s, NOW + 3600_000).sessions.length, 2);
  assert.deepEqual(prune(s, NOW + 3601_000).sessions.map(x => x.session), ['finished']);
  assert.equal(prune(s, NOW + 7 * 86_400_000).sessions.length, 1);
  assert.equal(prune(s, NOW + 7 * 86_400_000 + 1000).sessions.length, 0);

  s = emptyState();
  for (let i = 0; i < 105; i++) apply({ session: `s${i}`, ts: at(i) }, i);
  const kept = prune(s, NOW + 105_000).sessions;
  assert.equal(kept.length, 100);
  assert.equal(kept.at(-1).session, 's5'); // s0..s4 (oldest) evicted
});

test('stored state stays under the byte budget even with long multi-byte details', () => {
  let s = emptyState();
  for (let i = 0; i < 100; i++) {
    const ev = validateEvent(event({ session: `s${i}`, machine: `machine-${i % 20}`, project: '界'.repeat(48), detail: '界'.repeat(120), ts: at(i) }), NOW + i * 1000).event;
    s = prune(applyEvent(s, ev, NOW + i * 1000), NOW + i * 1000);
  }
  assert.ok(new TextEncoder().encode(JSON.stringify(s)).length <= MAX_STORED_BYTES);
  assert.ok(s.sessions.length > 20, 'budget is spent on events first');
  assert.equal(s.sessions[0].session, 's99');
});

test('forget removes one session or everything', async () => {
  const { env } = makeEnv();
  await send(env, event({ session: 'one' }));
  await send(env, event({ session: 'two' }));
  let response = await handle(post('/api/forget', { key: 'dell/claude-code/one' }, VIEW), env, NOW);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, removed: 1 });
  assertApiHeaders(response);
  assert.deepEqual((await state(env)).sessions.map(s => s.session), ['two']);
  assert.deepEqual(await (await handle(post('/api/forget', { key: 'nope' }, VIEW), env, NOW)).json(), { ok: true, removed: 0 });
  for (const bad of [{}, { key: '' }, { all: false }, { all: true, key: 'x' }, { keys: ['x'] }, []]) {
    assert.equal((await handle(post('/api/forget', bad, VIEW), env, NOW)).status, 400, JSON.stringify(bad));
  }
  response = await handle(post('/api/forget', { all: true }, VIEW), env, NOW);
  assert.deepEqual(await response.json(), { ok: true, removed: 1 });
  const body = await state(env);
  assert.deepEqual([body.sessions, body.events, body.machines], [[], [], []]);
  assert.deepEqual(forget(emptyState(), true), emptyState());
});

// --- Routing and headers --------------------------------------------------------

test('health, 404, 405 and API headers', async () => {
  const { env } = makeEnv();
  let response = await worker.fetch(new Request(`${ORIGIN}/api/health`), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, v: 1, service: 'ryodev' });
  assertApiHeaders(response);
  for (const path of ['/api', '/api/', '/api/nope', '/api/events/', '/api/state/x', '/api/constructor', '/api/__proto__']) {
    response = await worker.fetch(get(path), env);
    assert.equal(response.status, 404, path);
    assertApiHeaders(response);
  }
  for (const [method, path, allow] of [['GET', '/api/events', 'POST'], ['PUT', '/api/events', 'POST'], ['OPTIONS', '/api/events', 'POST'],
    ['POST', '/api/state', 'GET'], ['GET', '/api/forget', 'POST'], ['POST', '/api/health', 'GET'], ['DELETE', '/api/state', 'GET']]) {
    response = await worker.fetch(new Request(`${ORIGIN}${path}`, { method }), env);
    assert.equal(response.status, 405, `${method} ${path}`);
    assert.equal(response.headers.get('allow'), allow);
    assertApiHeaders(response);
  }
  response = await worker.fetch(get('/api/state', 'nope'), env);
  assertApiHeaders(response);
  assert.equal(response.headers.get('www-authenticate'), 'Bearer');
});

test('non-API requests pass straight through to the static assets', async () => {
  const { env, assetRequests } = makeEnv();
  for (const path of ['/', '/index.html', '/src/app.js', '/apix', '/app/api/state']) {
    const request = new Request(`${ORIGIN}${path}`);
    const response = await worker.fetch(request, env);
    assert.equal(await response.text(), `asset ${path}`);
    assert.equal(assetRequests.at(-1), request);
  }
});

test('the default fetch export uses the real clock', async () => {
  const { env } = makeEnv();
  const response = await worker.fetch(post('/api/events', event({ ts: new Date().toISOString() })), env);
  assert.equal(response.status, 202);
  const body = await (await worker.fetch(get('/api/state'), env)).json();
  assert.equal(body.sessions[0].clock_skew, false);
  assert.ok(Math.abs(Date.parse(body.server_time) - Date.now()) < 5000);
});

test('publicState of nothing is an empty, well-formed snapshot', () => {
  assert.deepEqual(publicState(undefined, NOW), { v: 1, server_time: at(0), sessions: [], machines: [], events: [] });
});

test('a BASE_PATH secret mounts everything under a hidden path and 404s the rest', async () => {
  const BASE = '/_/k7Qm2xP9aLw3';
  const { env, assetRequests } = makeEnv({ BASE_PATH: BASE });
  env.ASSETS.fetch = async request => {
    assetRequests.push(request);
    const { pathname } = new URL(request.url);
    if (pathname === '/index.html') return new Response(null, { status: 307, headers: { Location: '/' } });
    return new Response(`asset ${pathname}`, { headers: { 'Content-Type': 'text/plain' } });
  };
  for (const path of ['/', '/index.html', '/api/health', '/_/', '/_/wrong/', '/_/k7Qm2xP9aLw3x/', `${BASE}x`, '/_/K7QM2XP9ALW3/']) {
    const response = await handle(get(path, null), env, NOW);
    assert.equal(response.status, 404, path);
    assert.equal(await response.text(), 'Not found', `${path}: bland 404`);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  }
  assert.equal(assetRequests.length, 0, 'Nothing outside the mount reaches the static files');

  const bare = await handle(get(`${BASE}?x=1`, null), env, NOW);
  assert.equal(bare.status, 308);
  assert.equal(bare.headers.get('location'), `${BASE}/?x=1`, 'Relative app URLs need the trailing slash');

  let response = await handle(get(`${BASE}/`, null), env, NOW);
  assert.equal(await response.text(), 'asset /');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  response = await handle(get(`${BASE}/src/app.js`, null), env, NOW);
  assert.equal(await response.text(), 'asset /src/app.js');
  assert.equal(new URL(assetRequests.at(-1).url).pathname, '/src/app.js', 'Prefix stripped before the asset lookup');
  response = await handle(get(`${BASE}/index.html`, null), env, NOW);
  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), `${BASE}/`, 'Asset redirects stay inside the mount');

  response = await handle(get(`${BASE}/api/health`, null), env, NOW);
  assert.deepEqual(await response.json(), { ok: true, v: 1, service: 'ryodev' });
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal((await handle(post(`${BASE}/api/events`, event()), env, NOW)).status, 202);
  assert.equal((await handle(get(`${BASE}/api/state`, 'nope'), env, NOW)).status, 401, 'The path hides the app; tokens still guard the data');
  const body = await (await handle(get(`${BASE}/api/state`), env, NOW)).json();
  assert.equal(body.sessions[0].project, 'ryodev');
  assert.equal((await handle(post('/api/events', event()), env, NOW)).status, 404, 'The unmounted API is gone');
});

test('a malformed BASE_PATH fails closed instead of exposing the root', async () => {
  for (const bad of ['_/code', '/_/code/', '/_/../x', '/_/co de', '/']) {
    const { env, assetRequests } = makeEnv({ BASE_PATH: bad });
    const response = await handle(get('/', null), env, NOW);
    assert.equal(response.status, 503, JSON.stringify(bad));
    assert.equal(assetRequests.length, 0);
  }
});
