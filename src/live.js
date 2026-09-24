// Pure view derivation for live mode: turns one GET /api/state response into
// what the phone shows. No DOM, no network, no storage, no hidden clock.
//
// Clock choice: every age (ageMs) is computed from `nowMs`, the phone's own
// clock, so ages keep ticking between polls. The server's `server_time` is
// used only to report `serverSkewMs` (server minus phone at derive time; derive
// right after each poll of ./api/state for an accurate value). Timestamps in
// the state come from laptops that the hub already clamps to ±5 minutes of
// server time, and phones are normally network-synced, so ages stay honest to
// within minutes.

export const KNOWN_MACHINES = [
  { machine: 'mac', label: 'Mac' },
  { machine: 'dell', label: 'Dell' },
  { machine: 'hp', label: 'HP' },
  { machine: 'aero', label: 'Gigabyte Aero' },
];
export const QUIET_AFTER_MS = 20 * 60_000;          // running but silent this long -> "Quiet"
export const MAYBE_OUTDATED_AFTER_MS = 2 * 60 * 60_000; // waiting this long -> may be outdated
export const ACTIVE_WITHIN_MS = 10 * 60_000;        // machine heard from this recently -> active

const DISPLAY = { running: 'Running', needs_input: 'Needs you', finished: 'Finished', error: 'Error', ended: 'Ended' };
const KIND = { needs_input: 'waiting', error: 'error', finished: 'finished' };
const KIND_ORDER = { waiting: 0, error: 1, finished: 2 };

// The key the UI stores when Ryo has looked at a finished session. Including
// `updated` means a later, new finish of the same session shows up again.
export const seenKey = session => `${session.key}@${session.updated}`;

const ageOf = (iso, nowMs) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) && Number.isFinite(nowMs) ? Math.max(0, nowMs - t) : null;
};
const newestFirst = (a, b) => Date.parse(b.updated) - Date.parse(a.updated) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export function deriveLiveView(state, nowMs, seenKeys = new Set()) {
  const seen = seenKeys instanceof Set ? seenKeys : new Set(seenKeys ?? []);
  const serverMs = Date.parse(state?.server_time);

  const sessions = (Array.isArray(state?.sessions) ? state.sessions : [])
    .filter(s => s && typeof s.key === 'string' && Number.isFinite(Date.parse(s.updated)))
    .map(s => {
      const ageMs = ageOf(s.updated, nowMs);
      const quiet = s.state === 'running' && ageMs > QUIET_AFTER_MS;
      return { ...s, ageMs, quiet, displayState: quiet ? 'Quiet' : DISPLAY[s.state] ?? String(s.state) };
    })
    .sort(newestFirst);

  const counts = { waiting: 0, running: 0, finished: 0, error: 0, quiet: 0 };
  for (const s of sessions) {
    if (s.state === 'needs_input') counts.waiting++;
    else if (s.state === 'running') counts[s.quiet ? 'quiet' : 'running']++;
    else if (s.state === 'finished') counts.finished++;
    else if (s.state === 'error') counts.error++;
  }

  // Waiting and error are always shown; a finish only until it has been seen.
  const attention = sessions
    .filter(s => KIND[s.state] && !(s.state === 'finished' && seen.has(seenKey(s))))
    .map(s => ({
      key: s.key, kind: KIND[s.state], project: s.project, machine: s.machine, tool: s.tool,
      detail: s.detail ?? null, since: s.since, updated: s.updated, ageMs: s.ageMs,
      seen: seen.has(seenKey(s)),
      maybeOutdated: s.state === 'needs_input' && s.ageMs > MAYBE_OUTDATED_AFTER_MS,
    }))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]); // stable: newest first within a kind

  const byProject = new Map();
  for (const s of sessions) {
    const name = s.project ?? 'unknown';
    if (!byProject.has(name)) byProject.set(name, { name, sessions: [], tally: {} });
    const project = byProject.get(name);
    project.sessions.push(s);
    project.tally[s.state] = (project.tally[s.state] ?? 0) + 1;
  }
  const needsMe = new Set(attention.map(a => a.project));
  const latest = p => Date.parse(p.sessions[0].updated); // sessions are already newest first
  const projects = [...byProject.values()].sort((a, b) =>
    needsMe.has(b.name) - needsMe.has(a.name) || latest(b) - latest(a) || (a.name < b.name ? -1 : 1));

  const lastSeen = new Map((Array.isArray(state?.machines) ? state.machines : [])
    .filter(m => m && typeof m.machine === 'string')
    .map(m => [m.machine, m.last_seen]));
  const extra = [...new Set([...lastSeen.keys(), ...sessions.map(s => s.machine)])]
    .filter(id => typeof id === 'string' && !KNOWN_MACHINES.some(k => k.machine === id))
    .sort()
    .map(machine => ({ machine, label: machine }));
  const machines = [...KNOWN_MACHINES, ...extra].map(({ machine, label }) => {
    const seenAt = lastSeen.get(machine) ?? null;
    const ageMs = seenAt ? ageOf(seenAt, nowMs) : null;
    return {
      machine, label, lastSeen: seenAt, ageMs,
      activity: ageMs === null ? 'unknown' : ageMs <= ACTIVE_WITHIN_MS ? 'active' : 'quiet',
      sessionCount: sessions.filter(s => s.machine === machine && s.state !== 'ended').length,
    };
  });

  return {
    syncedAt: Number.isFinite(serverMs) ? state.server_time : null,
    serverSkewMs: Number.isFinite(serverMs) && Number.isFinite(nowMs) ? serverMs - nowMs : null,
    counts, attention, projects, machines, sessions,
  };
}
