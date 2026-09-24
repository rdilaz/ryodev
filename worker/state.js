// Pure core of the RyoDev live hub: validators and a tiny reducer.
//
// Nothing here touches the network, storage or the real clock. Every function
// takes the time it should use as an explicit millisecond argument, so the
// Worker, the Durable Object and the tests all see exactly the same behaviour.
//
// Stored state (kept well under 64 KB, see MAX_STORED_BYTES):
//   { v: 1, sessions: [Session], events: [Event], machines: [{ machine, last_seen }] }
// Session and Event objects already have the public field names, so
// publicState() is little more than sorting, pruning and capping.

export const TOOLS = ['claude-code', 'codex', 'opencode', 'kilo', 'other'];
export const STATES = ['running', 'needs_input', 'finished', 'error', 'ended'];

export const MAX_BODY_BYTES = 2048;          // POST bodies larger than this get 413
export const MAX_SKEW_MS = 5 * 60_000;       // laptop clock tolerance before we use server time
export const ENDED_TTL_MS = 60 * 60_000;     // "ended" sessions disappear after 1 hour
export const SESSION_TTL_MS = 7 * 24 * 60 * 60_000; // anything silent for 7 days disappears
export const MACHINE_TTL_MS = 30 * 24 * 60 * 60_000;
export const MAX_SESSIONS = 100;
export const MAX_EVENTS = 100;               // stored
export const RETURNED_EVENTS = 50;           // returned by GET /api/state
export const MAX_MACHINES = 20;
export const MAX_STORED_BYTES = 60_000;      // hard budget for the serialized state

const EVENT_KEYS = new Set(['v', 'machine', 'tool', 'session', 'project', 'state', 'detail', 'ts']);
const MACHINE_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
const SESSION_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
// C0/C1 controls, zero-width characters, line/paragraph separators and bidi
// overrides. None of them belong in a one-line status label.
const UNPRINTABLE = '\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2060-\\u2069\\ufeff';
const HAS_UNPRINTABLE = new RegExp(`[${UNPRINTABLE}]`);
const UNPRINTABLE_RUNS = new RegExp(`[${UNPRINTABLE}]+`, 'g');

const iso = ms => new Date(ms).toISOString();
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;

export const sessionKey = e => `${e.machine}/${e.tool}/${e.session}`;

// Newest first; ties broken so the order never depends on insertion order.
const newestSessionFirst = (a, b) => Date.parse(b.updated) - Date.parse(a.updated) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const newestEventFirst = (a, b) => Date.parse(b.ts) - Date.parse(a.ts) || Date.parse(b.received) - Date.parse(a.received);
const newestMachineFirst = (a, b) => Date.parse(b.last_seen) - Date.parse(a.last_seen) || (a.machine < b.machine ? -1 : 1);

export function emptyState() {
  return { v: 1, sessions: [], events: [], machines: [] };
}

// Turns control characters into single spaces and trims. Used for `detail`.
export function cleanText(value) {
  return String(value).replace(UNPRINTABLE_RUNS, ' ').replace(/\s+/g, ' ').trim();
}

function validTimestamp(value) {
  if (typeof value !== 'string' || value.length > 40) return null;
  const m = ISO_RE.exec(value);
  const ms = Date.parse(value);
  if (!m || !Number.isFinite(ms)) return null;
  // V8 silently rolls 2026-02-30 over to March; reject impossible calendar days.
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return ms;
}

// Validates one POST /api/events body (already JSON-parsed).
// Returns { ok: true, event } with normalized fields, or { ok: false, error }.
// `nowMs` is the server clock: a ts more than 5 minutes away from it is
// replaced by server time and flagged with clock_skew.
export function validateEvent(body, nowMs) {
  const fail = error => ({ ok: false, error });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('body must be a JSON object');
  for (const key of Object.keys(body)) if (!EVENT_KEYS.has(key)) return fail(`unknown key: ${key.slice(0, 32)}`);
  if (body.v !== 1) return fail('v must be 1');
  if (typeof body.machine !== 'string' || !MACHINE_RE.test(body.machine)) return fail('invalid machine');
  if (!TOOLS.includes(body.tool)) return fail('invalid tool');
  if (typeof body.session !== 'string' || !SESSION_RE.test(body.session)) return fail('invalid session');
  if (typeof body.project !== 'string') return fail('invalid project');
  const project = body.project.trim();
  if (project.length < 1 || project.length > 48 || HAS_UNPRINTABLE.test(project) || /[\\/]/.test(project)) {
    return fail('invalid project');
  }
  if (!STATES.includes(body.state)) return fail('invalid state');
  let detail = null;
  if (body.detail !== undefined && body.detail !== null) {
    if (typeof body.detail !== 'string') return fail('invalid detail');
    detail = cleanText(body.detail) || null;
    if (detail && detail.length > 120) return fail('detail longer than 120 characters');
  }
  const tsMs = validTimestamp(body.ts);
  if (tsMs === null) return fail('invalid ts');
  const clock_skew = Math.abs(tsMs - nowMs) > MAX_SKEW_MS;
  return {
    ok: true,
    event: {
      machine: body.machine, tool: body.tool, session: body.session, project, state: body.state, detail,
      ts: iso(clock_skew ? nowMs : tsMs), clock_skew,
    },
  };
}

// Validates a POST /api/forget body: exactly { key: "…" } or { all: true }.
export function validateForget(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'body must be a JSON object' };
  const keys = Object.keys(body);
  if (keys.length === 1 && body.all === true) return { ok: true, target: true };
  if (keys.length === 1 && typeof body.key === 'string' && body.key.length > 0 && body.key.length <= 160) {
    return { ok: true, target: body.key };
  }
  return { ok: false, error: 'expected { "key": "…" } or { "all": true }' };
}

// Records one validated event. Returns a new state; the input is not modified.
// - Every event lands in the events log and refreshes the machine's last_seen.
// - An event older than the session's current `updated` is logged only
//   (late delivery must never roll a session back to an earlier state).
// - `since` moves only when the state value actually changes.
export function applyEvent(state, event, receivedMs) {
  const next = structuredClone(state);
  const received = iso(receivedMs);
  const key = sessionKey(event);
  const { machine, tool, session, project, detail, ts, clock_skew } = event;

  next.events.push({ key, machine, tool, project, state: event.state, detail, ts, received });
  next.events.sort(newestEventFirst);
  next.events.splice(MAX_EVENTS);

  const known = next.machines.find(m => m.machine === machine);
  if (!known) next.machines.push({ machine, last_seen: received });
  else if (receivedMs > Date.parse(known.last_seen)) known.last_seen = received;

  const current = next.sessions.find(s => s.key === key);
  if (!current) {
    next.sessions.push({ key, machine, tool, session, project, state: event.state, detail, since: ts, updated: ts, received, clock_skew });
  } else if (Date.parse(ts) >= Date.parse(current.updated)) {
    if (current.state !== event.state) current.since = ts;
    Object.assign(current, { project, state: event.state, detail, updated: ts, received, clock_skew });
  }
  return next;
}

// Enforces every retention rule. Called after each write and before each read.
export function prune(state, nowMs) {
  const next = structuredClone(state);
  const age = value => nowMs - Date.parse(value); // NaN for garbage, which fails every `<=` below
  next.sessions = next.sessions
    .filter(s => age(s.updated) <= SESSION_TTL_MS && !(s.state === 'ended' && age(s.updated) > ENDED_TTL_MS))
    .sort(newestSessionFirst)
    .slice(0, MAX_SESSIONS);
  next.events = next.events.filter(e => age(e.ts) <= SESSION_TTL_MS).sort(newestEventFirst).slice(0, MAX_EVENTS);
  next.machines = next.machines.filter(m => age(m.last_seen) <= MACHINE_TTL_MS).sort(newestMachineFirst).slice(0, MAX_MACHINES);

  // Byte budget: the caps above normally keep us near 50 KB, but long
  // multi-byte details could exceed it. Drop the oldest events, then the oldest
  // sessions, until the serialized state fits.
  let size = bytes(next);
  while (size > MAX_STORED_BYTES && (next.events.length || next.sessions.length)) {
    const dropped = next.events.length ? next.events.pop() : next.sessions.pop();
    size -= bytes(dropped) + 1;
  }
  return next;
}

// Removes one session by key, or everything when `keyOrAll === true`.
export function forget(state, keyOrAll) {
  if (keyOrAll === true) return emptyState();
  const next = structuredClone(state);
  next.sessions = next.sessions.filter(s => s.key !== keyOrAll);
  return next;
}

// The exact GET /api/state response body.
export function publicState(state, nowMs) {
  const current = prune(state ?? emptyState(), nowMs);
  return {
    v: 1,
    server_time: iso(nowMs),
    sessions: current.sessions,
    machines: current.machines,
    events: current.events.slice(0, RETURNED_EVENTS),
  };
}
