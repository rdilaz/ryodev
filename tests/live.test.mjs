import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveLiveView, seenKey, KNOWN_MACHINES, QUIET_AFTER_MS, MAYBE_OUTDATED_AFTER_MS, ACTIVE_WITHIN_MS,
} from '../src/live.js';

const NOW = Date.parse('2026-09-24T12:00:00.000Z');
const ago = ms => new Date(NOW - ms).toISOString();
const MIN = 60_000;

function session(id, state, updatedAgo, extra = {}) {
  const [machine, tool, project] = [extra.machine ?? 'workstation-2', extra.tool ?? 'claude-code', extra.project ?? 'sample-dashboard'];
  return {
    key: `${machine}/${tool}/${id}`, machine, tool, session: id, project, state, detail: extra.detail ?? null,
    since: ago(updatedAgo), updated: ago(updatedAgo), received: ago(updatedAgo), clock_skew: false,
  };
}

const snapshot = (sessions, machines = [], serverAgo = 0) => ({ v: 1, server_time: ago(serverAgo), sessions, machines, events: [] });

test('attention lists waiting, then error, then unseen finished, newest first within each kind', () => {
  const view = deriveLiveView(snapshot([
    session('f-old', 'finished', 30 * MIN),
    session('w-old', 'needs_input', 20 * MIN, { detail: 'Needs permission: Bash' }),
    session('e1', 'error', 5 * MIN),
    session('f-new', 'finished', 1 * MIN),
    session('w-new', 'needs_input', 2 * MIN),
    session('r1', 'running', 1 * MIN),
    session('x1', 'ended', 1 * MIN),
  ]), NOW);
  assert.deepEqual(view.attention.map(a => [a.kind, a.key.split('/')[2]]), [
    ['waiting', 'w-new'], ['waiting', 'w-old'], ['error', 'e1'], ['finished', 'f-new'], ['finished', 'f-old'],
  ]);
  const item = view.attention[1];
  assert.deepEqual(item, {
    key: 'workstation-2/claude-code/w-old', kind: 'waiting', project: 'sample-dashboard', machine: 'workstation-2', tool: 'claude-code',
    detail: 'Needs permission: Bash', since: ago(20 * MIN), updated: ago(20 * MIN), ageMs: 20 * MIN,
    seen: false, maybeOutdated: false,
  });
});

test('a waiting session older than two hours is flagged maybeOutdated but still shown', () => {
  const view = deriveLiveView(snapshot([
    session('edge', 'needs_input', MAYBE_OUTDATED_AFTER_MS),
    session('old', 'needs_input', MAYBE_OUTDATED_AFTER_MS + 1),
    session('fin', 'finished', 5 * MAYBE_OUTDATED_AFTER_MS),
  ]), NOW);
  assert.deepEqual(view.attention.map(a => [a.key.split('/')[2], a.maybeOutdated]), [['edge', false], ['old', true], ['fin', false]]);
});

test('running goes Quiet after 20 minutes without an update, never offline or done', () => {
  const view = deriveLiveView(snapshot([
    session('edge', 'running', QUIET_AFTER_MS),
    session('quiet', 'running', QUIET_AFTER_MS + 1),
    session('old', 'running', 3 * 86_400_000),
  ]), NOW);
  assert.deepEqual(view.sessions.map(s => [s.session, s.quiet, s.displayState]), [
    ['edge', false, 'Running'], ['quiet', true, 'Quiet'], ['old', true, 'Quiet'],
  ]);
  assert.deepEqual(view.counts, { waiting: 0, running: 1, finished: 0, error: 0, quiet: 2 });
  assert.deepEqual(view.attention, []);
  for (const s of view.sessions) assert.doesNotMatch(s.displayState, /offline|done/i);
});

test('a seen finish disappears, and a new finish of the same session comes back', () => {
  const first = session('s1', 'finished', 10 * MIN);
  const seen = new Set([seenKey(first)]);
  assert.equal(seenKey(first), `workstation-2/claude-code/s1@${first.updated}`);
  assert.deepEqual(deriveLiveView(snapshot([first]), NOW, seen).attention, []);
  const again = session('s1', 'finished', 1 * MIN);
  const view = deriveLiveView(snapshot([again]), NOW, seen);
  assert.deepEqual(view.attention.map(a => [a.kind, a.seen]), [['finished', false]]);
  // Waiting and error stay visible even when seen; `seen` just tells the UI.
  const waiting = session('s2', 'needs_input', 1 * MIN);
  const w = deriveLiveView(snapshot([waiting]), NOW, [seenKey(waiting)]);
  assert.deepEqual(w.attention.map(a => [a.kind, a.seen]), [['waiting', true]]);
});

test('only reported machines are listed, in a deterministic order', () => {
  const view = deriveLiveView(snapshot(
    [session('a', 'running', 1 * MIN, { machine: 'workstation-2' }), session('b', 'ended', 1 * MIN, { machine: 'workstation-2' }), session('c', 'running', 1 * MIN, { machine: 'zbox' })],
    [{ machine: 'workstation-2', last_seen: ago(ACTIVE_WITHIN_MS) }, { machine: 'workstation-1', last_seen: ago(ACTIVE_WITHIN_MS + 1) }, { machine: 'buildbox', last_seen: ago(MIN) }],
  ), NOW);
  assert.deepEqual(view.machines.map(m => [m.machine, m.label, m.activity, m.sessionCount]), [
    ['buildbox', 'buildbox', 'active', 0], ['workstation-1', 'workstation-1', 'quiet', 0],
    ['workstation-2', 'workstation-2', 'active', 1], ['zbox', 'zbox', 'unknown', 1],
  ]);
  assert.equal(view.machines[2].ageMs, ACTIVE_WITHIN_MS);
  assert.deepEqual(KNOWN_MACHINES, []);
});

test('counts, project grouping and project order', () => {
  const view = deriveLiveView(snapshot([
    session('a', 'running', 1 * MIN, { project: 'review-queue' }),
    session('b', 'running', 2 * MIN, { project: 'review-queue' }),
    session('c', 'finished', 30 * MIN, { project: 'sample-api' }),
    session('d', 'needs_input', 50 * MIN, { project: 'sample-dashboard', machine: 'workstation-1' }),
    session('e', 'running', 45 * MIN, { project: 'sample-dashboard' }),
    session('f', 'error', 3 * MIN, { project: 'automation-lab' }),
    session('g', 'ended', 0, { project: 'media-tool' }),
  ]), NOW, [seenKey(session('c', 'finished', 30 * MIN, { project: 'sample-api' }))]);
  assert.deepEqual(view.counts, { waiting: 1, running: 2, finished: 1, error: 1, quiet: 1 });
  // Projects needing attention appear first, then the rest by latest update.
  assert.deepEqual(view.projects.map(p => p.name), ['automation-lab', 'sample-dashboard', 'media-tool', 'review-queue', 'sample-api']);
  const dashboard = view.projects.find(p => p.name === 'sample-dashboard');
  assert.deepEqual(dashboard.tally, { running: 1, needs_input: 1 });
  assert.deepEqual(dashboard.sessions.map(s => s.session), ['e', 'd']);
  assert.deepEqual(view.sessions.map(s => s.session), ['g', 'a', 'b', 'f', 'c', 'e', 'd']);
  assert.equal(view.sessions.find(s => s.session === 'g').displayState, 'Ended');
});

test('sync time, server skew and phone-clock ages', () => {
  const view = deriveLiveView(snapshot([session('a', 'running', 5 * MIN)], [], -90_000), NOW);
  assert.equal(view.syncedAt, ago(-90_000));
  assert.equal(view.serverSkewMs, 90_000);
  assert.equal(view.sessions[0].ageMs, 5 * MIN);
  // A timestamp slightly in the phone's future never produces a negative age.
  assert.equal(deriveLiveView(snapshot([session('b', 'running', -30_000)]), NOW).sessions[0].ageMs, 0);
});

test('malformed or empty input degrades to an empty view instead of throwing', () => {
  for (const input of [null, undefined, {}, { sessions: 'x', machines: 5 }, { sessions: [null, { key: 1 }, { key: 'k', updated: 'nope' }] }]) {
    const view = deriveLiveView(input, NOW);
    assert.deepEqual(view.sessions, []);
    assert.deepEqual(view.attention, []);
    assert.equal(view.machines.length, 0);
    assert.equal(view.syncedAt, null);
    assert.equal(view.serverSkewMs, null);
  }
});
