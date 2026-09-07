import test from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_VALIDITY, USAGE_VALIDITY, createStore, freshness, importSession, importUsage,
  importReachability, importFixture, deriveView, usageViews, sessionKey } from '../src/model.js';
import { BASE_TIME, at, enrollments, observation, usageRecord, reachabilityRecord, scenarios, getFixture } from '../src/fixtures.js';

const empty = () => createStore(enrollments);
const load = id => { const f = getFixture(id); return importFixture(createStore(f.enrollments), f); };
const view = (store, seconds = 0, seen = new Set()) => deriveView(store, BASE_TIME + seconds * 1000, seen);

test('session freshness is inclusive at 60 seconds and unknown at 61', () => {
  for (const seconds of [0, 59, 60, 61]) {
    const r = observation('riff', 'RUNNING', 0, { received_at: at(0) });
    const store = empty(); importSession(store, r);
    const s = view(store, seconds).sessions[0];
    assert.equal(s.freshness.status, seconds <= SESSION_VALIDITY ? 'FRESH' : 'STALE');
    assert.equal(s.state, seconds <= SESSION_VALIDITY ? 'RUNNING' : 'UNKNOWN');
    assert.equal(s.lastSeen, 'RUNNING');
    assert.equal(s.observation.observed_at, at(0));
  }
});

test('usage validity is independently inclusive at 300 seconds and supports shorter intervals', () => {
  const r = usageRecord({ observed_at: at(0), source_time: at(0), received_at: at(0) });
  assert.equal(freshness(r, BASE_TIME + 60_000, USAGE_VALIDITY).status, 'FRESH');
  assert.equal(freshness(r, BASE_TIME + 300_000, USAGE_VALIDITY).status, 'FRESH');
  assert.equal(freshness(r, BASE_TIME + 301_000, USAGE_VALIDITY).status, 'STALE');
  assert.equal(freshness({ ...r, valid_for_seconds: 15 }, BASE_TIME + 15_000, USAGE_VALIDITY).status, 'FRESH');
  assert.equal(freshness({ ...r, valid_for_seconds: 15 }, BASE_TIME + 16_000, USAGE_VALIDITY).status, 'STALE');
});

test('reload and duplicate import, including changed receipt, cannot renew evidence', () => {
  const store = load('running');
  const r = observation();
  assert.equal(importSession(store, { ...r, received_at: at(200) }).duplicate, true);
  importUsage(store, { ...usageRecord(), received_at: at(400) });
  assert.equal(view(store, 400).sessions[0].state, 'UNKNOWN');
  assert.equal(view(store, 400).usage[0].freshness.status, 'STALE');
  assert.equal(view(store, 400).sessions[0].observation.observed_at, r.observed_at);
  assert.equal(view(store, 400).usage[0].record.observed_at, at(-30));
  const reloaded = load('running');
  assert.deepEqual(view(store, 400), view(reloaded, 400));
});

test('unrelated fresh reachability heartbeat does not refresh session or allowance', () => {
  const store = load('running');
  importReachability(store, reachabilityRecord('aero', 'REACHABLE', { observed_at: at(400), received_at: at(400) }));
  const v = view(store, 400);
  assert.equal(v.machines.find(m => m.id === 'aero').connectivity.state, 'OBSERVED');
  assert.equal(v.sessions[0].freshness.status, 'STALE');
  assert.equal(v.usage[0].currentValue, null);
  assert.equal(v.usage[0].record.value, 38);
});

test('a later valid status snapshot can reaffirm execution without a lifecycle event', () => {
  const store = load('running');
  const r = observation('riff', 'RUNNING', 0, { sequence: 2, received_at: at(0) });
  importSession(store, r);
  assert.equal(view(store, 60).sessions[0].state, 'RUNNING');
  assert.equal(view(store, 61).sessions[0].state, 'UNKNOWN');
});

test('submitted and idle do not imply running or terminal success', () => {
  for (const id of ['submitted', 'idle']) {
    const v = view(load(id));
    assert.equal(v.sessions[0].state, 'UNKNOWN');
    assert.equal(v.sessions[0].history.length, 0);
    assert.equal(v.newCompletions, 0);
  }
  const r = observation('riff', 'RUNNING', 10, { evidence_kind: 'submission_receipt' });
  assert.equal(importSession(empty(), r).accepted, false);
});

test('finished turn is historical, not current inactivity, passing tests or acceptance', () => {
  const store = load('finished');
  let v = view(store);
  assert.equal(v.sessions[0].state, 'UNKNOWN');
  assert.equal(v.sessions[0].history[0].outcome, 'success');
  assert.equal(v.sessions[0].observation.tests, null);
  assert.equal(v.newCompletions, 1);
  importSession(store, observation('visualizer', 'RUNNING', 5, { sequence: 2 }));
  v = view(store);
  assert.equal(v.sessions[0].state, 'RUNNING');
  assert.equal(v.sessions[0].history[0].outcome, 'success');
  assert.equal(view(store, 3600).newCompletions, 1);
});

test('cancelled and failed attempts never become successful DONE', () => {
  for (const state of ['CANCELLED', 'FAILED']) {
    const store = empty(); importSession(store, observation('riff', state));
    assert.equal(view(store).sessions[0].state, 'UNKNOWN');
    assert.equal(view(store).newCompletions, 0);
    assert.equal(view(store).sessions[0].history[0].outcome, state.toLowerCase());
  }
  assert.equal(importSession(empty(), observation('riff', 'DONE', 10, { terminal: null })).accepted, false);
});

test('explicit current user wait takes precedence; retry is not a user request', () => {
  const store = empty();
  const waiting = observation('riff', 'WAITING');
  importSession(store, { ...waiting, execution: observation().execution });
  assert.equal(view(store).sessions[0].state, 'WAITING');
  assert.equal(view(store).currentRequests, 1);
  assert.equal(view(load('retry-wait')).currentRequests, 0);
  assert.equal(view(load('retry-wait')).sessions[0].state, 'WAITING');
  assert.equal(view(load('blocked')).sessions[0].state, 'BLOCKED');
  assert.equal(view(load('blocked')).currentRequests, 1);
});

test('attention sorts requests, actionable failures, then historical completions', () => {
  const store = empty();
  for (const r of [observation('visualizer', 'DONE'), observation('station', 'BLOCKED'), observation('riff', 'WAITING')]) importSession(store, r);
  assert.deepEqual(view(store).attention.map(n => n.kind), ['input', 'failure', 'completion']);
});

test('runtime and dependency requests never become a user wait', () => {
  for (const waitingOn of ['runtime', 'dependency']) {
    for (const kind of ['input', 'approval']) {
      const store = empty();
      const waiting = observation('riff', 'WAITING');
      waiting.execution.waiting_on = waitingOn;
      waiting.requests[0].waiting_on = waitingOn;
      waiting.requests[0].kind = kind;
      assert.equal(importSession(store, waiting).accepted, true);
      const v = view(store);
      assert.equal(v.sessions[0].state, 'WAITING');
      assert.equal(v.sessions[0].label, 'Waiting / retry');
      assert.equal(v.currentRequests, 0);
      assert.equal(v.attention.length, 0);
    }
  }
});

test('same request is idempotent and stale unresolved has a separate count', () => {
  const store = load('user-wait');
  importFixture(store, getFixture('user-wait'));
  assert.equal(view(store).currentRequests, 1);
  assert.equal(view(store, 40).currentRequests, 1);
  assert.equal(view(store, 41).currentRequests, 0);
  assert.equal(view(store, 41).staleRequests, 1);
  assert.equal(view(store, 41).attention.length, 1);
});

test('incomplete omission cannot resolve or refresh a pending request', () => {
  const store = load('incomplete-coverage');
  const v = view(store);
  assert.equal(v.sessions[0].state, 'RUNNING');
  assert.equal(v.staleRequests, 1);
  assert.equal(v.currentRequests, 0);
  assert.equal(v.attention[0].observed_at, at(-120));
  assert.equal(v.attention[0].resolved, false);
});

test('complete noncurrent omission preserves pending requests without refreshing them', () => {
  for (const age of [20, 120]) {
    const store = empty();
    assert.equal(importSession(store, observation('riff', 'WAITING', age)).accepted, true);
    const pending = [...store.notices.values()];
    const next = observation('riff', 'RUNNING', 5, { sequence: 2,
      pending_requests_complete: true, pending_requests_current: false });
    assert.equal(importSession(store, next).accepted, true);
    assert.deepEqual([...store.notices.values()], pending);
    const v = view(store);
    assert.equal(v.sessions[0].state, 'RUNNING');
    assert.equal(v.attention.length, 1);
    assert.equal(v.attention[0].observed_at, at(-age));
    assert.equal(v.currentRequests, age <= SESSION_VALIDITY ? 1 : 0);
    assert.equal(v.staleRequests, age <= SESSION_VALIDITY ? 0 : 1);
    const current = observation('riff', 'RUNNING', 1, { sequence: 3, pending_requests_complete: true });
    assert.equal(importSession(store, current).accepted, true);
    assert.equal(view(store).attention.length, 0);
    assert.equal(store.notices.get(pending[0].id).resolution, current.observation_id);
  }
});

test('noncurrent snapshots still resolve explicitly identified requests, not other omissions', () => {
  for (const complete of [false, true]) {
    const store = empty();
    const waiting = observation('riff', 'WAITING', 20);
    waiting.requests.push({ ...waiting.requests[0], request_id: 'demo-other-request' });
    assert.equal(importSession(store, waiting).accepted, true);
    const [resolved, omitted] = [...store.notices.values()];
    const { request_id, turn_id, reason } = waiting.requests[0];
    const next = observation('riff', 'RUNNING', 5, { sequence: 2,
      pending_requests_complete: complete, pending_requests_current: false,
      resolved_requests: [{ request_id, turn_id, reason }] });
    assert.equal(importSession(store, next).accepted, true);
    assert.equal(store.notices.get(resolved.id).resolved, true);
    assert.equal(store.notices.get(resolved.id).resolution, next.observation_id);
    assert.deepEqual(store.notices.get(omitted.id), omitted);
    assert.deepEqual(view(store).attention.map(n => n.id), [omitted.id]);
  }
});

test('explicit resolution or complete pending snapshot can resolve, but seen cannot', () => {
  assert.equal(view(load('resolved-request')).attention.length, 0);
  assert.equal(view(load('complete-requests')).attention.length, 0);
  const store = load('user-wait');
  const key = view(store).attention[0].id;
  const marked = view(store, 0, new Set([key]));
  assert.equal(marked.currentRequests, 1);
  assert.equal(marked.attention[0].seen, true);
  assert.equal(marked.attention[0].resolved, false);
});

test('duplicate completion retains original turn time and local seen is not acceptance', () => {
  const store = load('duplicate-completion');
  const v = view(store);
  assert.equal(v.attention.length, 1);
  assert.equal(v.attention[0].observed_at, at(-240));
  assert.equal(v.sessions[0].history.length, 1);
  const marked = view(store, 0, new Set([v.attention[0].id]));
  assert.equal(marked.newCompletions, 0);
  assert.equal(marked.attention[0].reason, 'Turn finished; review pending');
  assert.equal(marked.attention[0].resolved, false);
});

test('stale, not connected, offline and observer failure are distinct', () => {
  const stale = view(load('stale-running'));
  assert.equal(stale.sessions[0].state, 'UNKNOWN');
  assert.equal(stale.machines.find(m => m.id === 'aero').connectivity.state, 'UNKNOWN');
  assert.equal(stale.machines.find(m => m.id === 'mac').connectivity.state, 'NOT_CONNECTED');
  const offline = load('offline');
  assert.equal(view(offline).machines.find(m => m.id === 'aero').connectivity.state, 'OFFLINE');
  assert.equal(view(offline, 45).machines.find(m => m.id === 'aero').connectivity.state, 'OFFLINE');
  assert.equal(view(offline, 46).machines.find(m => m.id === 'aero').connectivity.state, 'UNKNOWN');
  for (const id of ['disconnected-phone', 'observer-failure']) {
    const v = view(load(id));
    assert.equal(v.machines.find(m => m.id === 'aero').connectivity.state, 'UNKNOWN');
    assert.notEqual(v.sessions[0].state, 'BLOCKED');
  }
});

test('offline requires every reviewed reachability proof, and duplicate checks are idempotent', () => {
  for (const patch of [{ reviewed: false }, { trusted_path_working: false }, { endpoint_scope: 'runtime_only' }]) {
    const store = empty();
    const r = reachabilityRecord('aero', 'UNREACHABLE', patch);
    importReachability(store, r);
    assert.equal(importReachability(store, { ...r, received_at: at(30) }).duplicate, true);
    assert.equal(view(store).machines.find(m => m.id === 'aero').connectivity.state, 'UNKNOWN');
  }
});

test('missing coverage never becomes all clear and unknown fields remain null', () => {
  const v = view(empty());
  assert.equal(v.coverageMissing, true);
  assert.equal(v.needsChecking, true);
  assert.equal(v.currentRequests, 0);
  assert.equal(v.missingMachines, 4);
  const missing = view(load('missing-attribution'));
  assert.equal(missing.sessions[0].observation.attribution.model.value, null);
  assert.equal(missing.sessions[0].observation.attribution.account.value, null);
  assert.equal(missing.usage.length, 0);
});

test('model, provider and account evidence times are independently retained', () => {
  const store = load('running');
  const prior = observation();
  const next = observation('riff', 'RUNNING', 0, { sequence: 2, received_at: at(0), attribution: prior.attribution });
  next.attribution.model.kind = 'configured-default';
  importSession(store, next);
  const r = view(store).sessions[0].observation;
  assert.equal(r.observed_at, at(0));
  assert.equal(r.attribution.model.observed_at, at(-10));
  assert.equal(r.attribution.model.kind, 'configured-default');
});

test('future timestamps over 30s fail validation; smaller future and backwards clock expire conservatively', () => {
  const store = load('invalid-clock');
  assert.equal(store.sessions.size, 0);
  assert.match(store.issues[0].reason, /30s/);
  const r = observation('riff', 'RUNNING', 0, { observed_at: at(30), received_at: at(0) });
  assert.equal(importSession(empty(), r).accepted, true);
  assert.equal(freshness(r, BASE_TIME).status, 'UNKNOWN');
  assert.equal(freshness(observation(), BASE_TIME - 11_000).status, 'UNKNOWN');
  assert.equal(importSession(empty(), { ...observation(), source_time: at(31), received_at: at(0) }).accepted, false);
});

test('older and replayed sequence cannot overwrite newer state or clear a conflict', () => {
  const store = load('running');
  importSession(store, observation('riff', 'WAITING', 5, { sequence: 2 }));
  const older = observation('riff', 'IDLE', 8);
  assert.equal(importSession(store, older).accepted, false);
  assert.equal(view(store).sessions[0].state, 'WAITING');
  const conflict = observation('riff', 'RUNNING', 5, { sequence: 2 });
  assert.equal(importSession(store, conflict).accepted, false);
  assert.equal(view(store).sessions[0].state, 'UNKNOWN');
  importSession(store, observation('riff', 'WAITING', 5, { sequence: 2 }));
  assert.equal(view(store).sessions[0].state, 'UNKNOWN');
  importSession(store, observation('riff', 'RUNNING', 2, { sequence: 3, pending_requests_complete: true }));
  assert.equal(view(store).sessions[0].state, 'RUNNING');
});

test('sequence gap preserves unresolved notices and runtime change requires re-enrollment', () => {
  const store = load('user-wait');
  importSession(store, observation('riff', 'RUNNING', 5, { sequence: 3, pending_requests_complete: true }));
  assert.equal(view(store).sessions[0].state, 'UNKNOWN');
  assert.equal(view(store).staleRequests, 1);
  assert.equal(view(load('instance-change')).sessions[0].state, 'UNKNOWN');
  assert.match(load('instance-change').issues[0].reason, /re-enrollment/);
  const restarted = load('instance-change');
  assert.equal(importSession(restarted, observation('riff', 'RUNNING', 2, { sequence: 2 })).accepted, false);
  assert.equal(view(restarted).sessions[0].state, 'UNKNOWN');
});

test('sequence ordering is scoped to owning machine/runtime, including sibling sessions', () => {
  const store = empty();
  importSession(store, observation('visualizer', 'RUNNING', 15));
  importSession(store, observation('ryodev', 'RUNNING', 10, { sequence: 2 }));
  assert.ok(view(store).sessions.every(s => s.state === 'RUNNING'));
  assert.equal(importSession(store, observation('visualizer', 'IDLE', 5, { sequence: 2 })).accepted, false);
  assert.ok(view(store).sessions.every(s => s.state === 'UNKNOWN'));
  importSession(store, observation('visualizer', 'RUNNING', 2, { sequence: 3 }));
  assert.equal(view(store).sessions.find(s => s.observation.project_id === 'visualizer').state, 'RUNNING');
  assert.equal(view(store).sessions.find(s => s.observation.project_id === 'ryodev').state, 'UNKNOWN');
});

test('reachability identity and clock faults do not leave a current offline claim', () => {
  const store = load('offline');
  importReachability(store, reachabilityRecord('aero', 'UNREACHABLE', { instance_id: 'unverified-restart', sequence: 2 }));
  assert.equal(view(store).machines.find(m => m.id === 'aero').connectivity.state, 'UNKNOWN');
  assert.equal(importReachability(store, reachabilityRecord('aero', 'UNREACHABLE', { sequence: 2 })).accepted, false);
  const clock = load('offline');
  importReachability(clock, reachabilityRecord('aero', 'UNREACHABLE', { sequence: 2, observed_at: at(40), received_at: at(0) }));
  assert.equal(view(clock).machines.find(m => m.id === 'aero').connectivity.state, 'UNKNOWN');
});

test('identical session IDs on different machines do not collide; wrong project rejected', () => {
  const a = observation('riff'); const b = observation('station');
  a.session_id = b.session_id = 'same-demo-session-id';
  const enrollment = [a, b].map(r => ({ ...r, identity_status: 'DEMO_VERIFIED' }));
  const store = createStore(enrollment);
  assert.equal(importSession(store, a).accepted, true);
  assert.equal(importSession(store, b).accepted, true);
  assert.notEqual(sessionKey(a), sessionKey(b));
  assert.equal(store.sessions.size, 2);
  assert.equal(importSession(empty(), observation('riff', 'RUNNING', 10, { project_id: 'ryomap' })).accepted, false);
});

test('four verified machine references produce one shared allowance, not four', () => {
  const store = load('shared-account');
  const u = usageViews(store, BASE_TIME);
  assert.equal(u.length, 1);
  assert.equal(u[0].currentValue, 38);
  assert.equal(u[0].machineRefs.length, 4);
  importFixture(store, getFixture('shared-account'));
  assert.equal(usageViews(store, BASE_TIME).length, 1);
  assert.equal(usageViews(store, BASE_TIME)[0].currentValue, 38);
});

test('overlapping windows, model scopes and units stay separate; legacy mirror is not additive', () => {
  const u = view(load('usage-windows')).usage;
  assert.equal(u.length, 4);
  assert.deepEqual(u.map(item => item.record.value_text), ['38', '72.50', '12', '12450']);
  assert.equal(u.find(item => item.record.unit === 'tokens').record.metric, 'tokens_used');
  assert.equal(u.filter(item => item.record.metric === 'remaining_allowance').length, 3);
  const store = load('running');
  importUsage(store, usageRecord({ observation_id: 'next-window', window_id: 'demo-next-window', reset_at: at(20_000) }));
  assert.equal(usageViews(store, BASE_TIME).length, 2);
});

test('unresolved identities never group into a shared account or current allowance', () => {
  const u = view(load('ambiguous-account')).usage;
  assert.equal(u.length, 2);
  assert.ok(u.every(item => item.currentValue === null && !item.verified));
});

test('same meter selects newest source observation, not newest receipt', () => {
  const store = load('running');
  importUsage(store, usageRecord({ observation_id: 'late-old-arrival', source_time: at(-100), observed_at: at(-5), received_at: at(-1), value: 90, value_text: '90' }));
  assert.equal(view(store).usage[0].currentValue, 38);
  importUsage(store, usageRecord({ observation_id: 'new-source', source_time: at(-10), observed_at: at(-10), received_at: at(-8), value: 35, value_text: '35' }));
  assert.equal(view(store).usage[0].currentValue, 35);
});

test('equal-source corroboration uses newest observation in either arrival order, never receipt', () => {
  const old = usageRecord({ observation_id: 'demo-corroborating-old', source_time: at(-301),
    observed_at: at(-301), received_at: at(0) });
  const fresh = usageRecord({ observation_id: 'demo-corroborating-fresh', source_time: old.source_time,
    observed_at: at(-1), received_at: at(-1) });
  for (const records of [[old, fresh], [fresh, old]]) {
    const store = empty();
    for (const r of records) assert.equal(importUsage(store, r).accepted, true);
    const u = view(store).usage[0];
    assert.equal(u.record.observation_id, fresh.observation_id);
    assert.equal(u.freshness.status, 'FRESH');
    assert.equal(u.freshness.age, 1);
    assert.equal(u.currentValue, 38);
    assert.equal(u.conflict, false);
    assert.equal(u.current.length, 2);
    assert.equal(view(store, 299).usage[0].currentValue, 38);
    const expired = view(store, 300);
    assert.equal(expired.usage[0].freshness.status, 'STALE');
    assert.equal(expired.usage[0].currentValue, null);
    for (const r of records) assert.equal(importUsage(store, { ...r, received_at: at(300) }).duplicate, true);
    assert.equal(store.usage.size, 2);
    assert.deepEqual(view(store, 300), expired);
  }
});

test('equal observation instants use the shorter usage validity in either arrival order', () => {
  for (const source_time of [at(-30), null]) {
    const long = usageRecord({ observation_id: 'demo-long-validity', source_time,
      observed_at: at(-20), received_at: at(-18) });
    const short = usageRecord({ ...long, observation_id: 'demo-short-validity',
      observed_at: at(-20).replace('.000Z', 'Z'), received_at: at(-19), valid_for_seconds: 15 });
    for (const records of [[long, short], [short, long]]) {
      const store = empty();
      for (const r of records) assert.equal(importUsage(store, r).accepted, true);
      const u = view(store, -5).usage[0];
      assert.equal(u.record.valid_for_seconds, 15);
      assert.equal(u.conflict, false);
      assert.equal(u.current.length, 2);
      assert.equal(u.freshness.age, 15);
      assert.equal(u.freshness.status, 'FRESH');
      assert.equal(u.currentValue, 38);
      assert.equal(view(store, -4).usage[0].freshness.status, 'STALE');
      assert.equal(view(store, -4).usage[0].currentValue, null);
    }
  }
});

test('newer source time still outranks fresher observation and receipt in either arrival order', () => {
  const newestSource = usageRecord({ observation_id: 'demo-newest-source', source_time: at(-301),
    observed_at: at(-301), received_at: at(-300) });
  const fresherObservation = usageRecord({ observation_id: 'demo-older-source', source_time: at(-400),
    observed_at: at(-1), received_at: at(0), value: 90, value_text: '90' });
  for (const records of [[newestSource, fresherObservation], [fresherObservation, newestSource]]) {
    const store = empty();
    for (const r of records) assert.equal(importUsage(store, r).accepted, true);
    const u = view(store).usage[0];
    assert.deepEqual(u.record, newestSource);
    assert.deepEqual(u.current, [newestSource]);
    assert.equal(u.conflict, false);
    assert.equal(u.freshness.status, 'STALE');
    assert.equal(u.currentValue, null);
  }
});

test('equal-source conflicts survive unequal observation ages in either arrival order', () => {
  for (const patch of [{ value: 41, value_text: '41' }, { value_text: '38.00' },
    { quality: 'ESTIMATED', estimate_method: 'Invented bounded estimate' }, { reset_at: null }]) {
    const old = usageRecord({ observation_id: 'demo-conflicting-old', source_time: at(-301),
      observed_at: at(-301), received_at: at(0) });
    const fresh = usageRecord({ observation_id: 'demo-conflicting-fresh', source_time: old.source_time,
      observed_at: at(-1), received_at: at(-1), ...patch });
    for (const records of [[old, fresh], [fresh, old]]) {
      const store = empty();
      for (const r of records) assert.equal(importUsage(store, r).accepted, true);
      const u = view(store).usage[0];
      assert.equal(u.current.length, 2);
      assert.equal(u.conflict, true);
      assert.equal(u.currentValue, null);
      assert.match(u.reason, /Conflicting equally current observations/);
    }
  }
});

test('equally current conflicting values produce no current value and are never summed', () => {
  const store = load('usage-conflict');
  const u = view(store).usage[0];
  assert.equal(u.conflict, true);
  assert.equal(u.currentValue, null);
  assert.deepEqual(u.current.map(r => r.value), [38, 41]);
  importUsage(store, usageRecord({ observation_id: 'resolved-meter', source_time: at(-5), observed_at: at(-5), received_at: at(-4), value: 36, value_text: '36' }));
  assert.equal(view(store).usage[0].conflict, false);
  assert.equal(view(store).usage[0].currentValue, 36);
});

test('conflicting observation identity is rejected rather than silently replacing usage', () => {
  const store = load('running');
  assert.equal(importUsage(store, usageRecord({ value: 12, value_text: '12' })).accepted, false);
  assert.equal(view(store).usage[0].currentValue, null);
  assert.equal(view(store).usage[0].conflict, true);
});

test('missing usage is null, true zero is retained, and failed collection preserves history', () => {
  const u = view(load('usage-unavailable')).usage[0];
  assert.equal(u.currentValue, null);
  assert.equal(u.record.value, null);
  assert.equal(u.record.quality, 'UNAVAILABLE');
  assert.equal(u.historical.value, 38);
  const store = empty(); importUsage(store, usageRecord({ value: 0, value_text: '0' }));
  assert.equal(view(store).usage[0].currentValue, 0);
  assert.equal(importUsage(empty(), usageRecord({ value: null, value_text: null })).accepted, false);
});

test('reset stays missing or passed, never locally refills; exact history can also be stale', () => {
  assert.equal(view(load('missing-reset')).usage[0].record.reset_at, null);
  assert.equal(view(load('passed-reset')).usage[0].currentValue, null);
  assert.equal(view(load('passed-reset'), 10_000).usage[0].record.value, 38);
  const store = empty(); importUsage(store, usageRecord({ reset_at: at(0) }));
  assert.equal(view(store).usage[0].resetPassed, true);
  assert.equal(view(store).usage[0].currentValue, null);
  const stale = view(load('running'), 271).usage[0];
  assert.equal(stale.freshness.status, 'STALE');
  assert.equal(stale.record.quality, 'EXACT');
  assert.equal(stale.historical.value, 38);
  assert.equal(stale.currentValue, null);
});

test('estimates require an explicit method and coverage; supplied decimal precision survives', () => {
  assert.equal(view(load('usage-estimated')).usage[0].record.quality, 'ESTIMATED');
  assert.equal(importUsage(empty(), usageRecord({ quality: 'ESTIMATED', estimate_method: null })).accepted, false);
  const store = empty(); importUsage(store, usageRecord({ value: 38, value_text: '38.00' }));
  assert.equal(view(store).usage[0].record.value_text, '38.00');
});

for (const field of ['requests', 'resolved_requests']) {
  test(`null ${field} entries reject the observation without throwing`, () => {
    for (const hasPrior of [false, true]) {
      const store = empty();
      const prior = observation('riff', 'WAITING', 20);
      if (hasPrior) assert.equal(importSession(store, prior).accepted, true);
      const r = observation('riff', 'RUNNING', 5, { sequence: hasPrior ? 2 : 1, [field]: [null] });
      assert.deepEqual(importSession(store, r), { accepted: false, reason: 'Invalid request identity' });
      assert.deepEqual(store.issues, [{ kind: 'Session', id: r.observation_id, reason: 'Invalid request identity' }]);
      assert.equal(store.sessions.size, Number(hasPrior));
      assert.equal(store.ordering.size, Number(hasPrior));
      assert.equal(store.fingerprints.size, Number(hasPrior));
      assert.equal(store.notices.size, Number(hasPrior));
      if (hasPrior) {
        const v = view(store);
        assert.deepEqual(v.sessions[0].observation, prior);
        assert.equal(v.sessions[0].state, 'UNKNOWN');
        assert.equal(v.staleRequests, 1);
        assert.equal(v.attention[0].resolved, false);
      }
    }
  });
}

test('malformed fixture schemas, timestamps, identity, values and required evidence are rejected', () => {
  const invalidSessions = [
    { schema_version: 'future-schema' }, { mode: 'IMPORTED_SNAPSHOT' }, { observed_at: 'yesterday' },
    { sequence: -1 }, { valid_for_seconds: 61 }, { instance_id: 'wrong-instance' },
    { execution: { ...observation().execution, state: 'MAYBE' } }, { pending_requests_complete: undefined },
    { attribution: { ...observation().attribution, model: { value: null } } },
  ];
  for (const patch of invalidSessions) assert.equal(importSession(empty(), observation('riff', 'RUNNING', 10, patch)).accepted, false, JSON.stringify(patch));
  const invalidUsage = [
    { mode: 'IMPORTED_SNAPSHOT' }, { account_ref: 'not-verified' }, { scope: null }, { unit: null },
    { quality: 'UNAVAILABLE', value: 0 }, { value: NaN }, { value: 101, value_text: '101' },
    { reset_at: 'invalid' }, { valid_for_seconds: 301 }, { source_time: at(40) },
  ];
  for (const patch of invalidUsage) assert.equal(importUsage(empty(), usageRecord(patch)).accepted, false, JSON.stringify(patch));
});

test('every selectable fixture derives deterministically, with only deliberate diagnostics', () => {
  const expectedIssues = new Set(['invalid-clock', 'sequence-conflict', 'instance-change']);
  assert.equal(scenarios.length, 30);
  for (const scenario of scenarios) {
    const store = load(scenario.id);
    assert.equal(store.issues.length > 0, expectedIssues.has(scenario.id), scenario.id);
    assert.deepEqual(view(store), view(load(scenario.id)), scenario.id);
    assert.ok(view(store).needsChecking, 'Partial fixture coverage cannot become All clear');
  }
  assert.throws(() => getFixture('file:///real-telemetry.json'), /known built-in/);
});
