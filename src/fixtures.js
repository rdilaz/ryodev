import { SCHEMA, machines } from './model.js';

export const BASE_TIME = Date.parse('2026-09-06T14:00:00Z');
export const at = seconds => new Date(BASE_TIME + seconds * 1000).toISOString();
export const enrollments = [
  ['ryomap', 'hp'], ['ryodev', 'dell'], ['station', 'mac'], ['riff', 'aero'], ['visualizer', 'dell'],
].map(([project_id, machine_id]) => ({
  project_id, machine_id, instance_id: `demo-${machine_id}-runtime-1`, session_id: `demo-session-${project_id}`,
  worktree_alias: `invented-${project_id}-workspace`, adapter_name: 'invented-fixture', adapter_version: '1',
  identity_status: 'DEMO_VERIFIED', identity_source: 'Invented fixture identity; not a real enrollment',
}));

const reasons = {
  RUNNING: 'Runtime explicitly reports active execution', WAITING: 'Choose which mix to keep',
  BLOCKED: 'Dependency access denied; your intervention required', DONE: 'Explicit successful terminal turn',
  CANCELLED: 'Attempt explicitly cancelled', FAILED: 'Attempt explicitly failed',
  IDLE: 'Source reports idle; no terminal evidence', SUBMITTED: 'Prompt receipt only; no execution evidence',
  UNKNOWN: 'No supported execution evidence',
};
const reasonCodes = {
  RUNNING: 'runtime_busy', WAITING: 'input_required', BLOCKED: 'dependency_access_denied', DONE: 'terminal_success',
  CANCELLED: 'attempt_cancelled', FAILED: 'attempt_failed', IDLE: 'source_idle', SUBMITTED: 'submission_only', UNKNOWN: 'unsupported_state',
};

export function observation(project = 'riff', state = 'RUNNING', age = 10, overrides = {}) {
  const e = enrollments.find(item => item.project_id === project);
  const evidence = value => ({ value, kind: 'observed', source: 'invented-fixture-v1', observed_at: at(-age), reason: null });
  const turn = `demo-${project}-turn-3`;
  return {
    schema_version: SCHEMA, mode: 'DEMO', observation_id: `demo-${project}-${state}-${age}`,
    source: 'invented-fixture-v1', machine_id: e.machine_id, instance_id: e.instance_id,
    session_id: e.session_id, project_id: project, sequence: 1, turn_id: turn,
    source_time: null, observed_at: at(-age), received_at: at(-age + 1), valid_for_seconds: 60,
    evidence_kind: state === 'SUBMITTED' ? 'submission_receipt' : 'runtime_status',
    execution: { state, raw_code: `demo_${state.toLowerCase()}`, reason: reasons[state], reason_code: reasonCodes[state],
      waiting_on: ['WAITING', 'BLOCKED'].includes(state) ? 'user' : null, retry_at: null },
    pending_requests_complete: false, pending_requests_current: true,
    requests: ['WAITING', 'BLOCKED'].includes(state) ? [{ request_id: `demo-${project}-request-1`, turn_id: turn,
      kind: state === 'BLOCKED' ? 'failure' : 'input', reason: reasons[state], waiting_on: 'user' }] : [],
    resolved_requests: [],
    terminal: ['DONE', 'CANCELLED', 'FAILED'].includes(state)
      ? { turn_id: turn, outcome: state === 'DONE' ? 'success' : state.toLowerCase(), completed_at: at(-age) } : null,
    tests: null,
    attribution: { model: evidence('Demo model A'), provider: evidence('invented-provider / demo-route'), account: evidence('demo-account-1') },
    supported_fields: ['execution', 'pending_requests', 'model', 'provider', 'account'], missing_fields: ['tests'],
    ...structuredClone(overrides),
  };
}

export function usageRecord(overrides = {}) {
  return {
    schema_version: SCHEMA, mode: 'DEMO', observation_id: 'demo-usage-primary-1',
    source: 'invented-authoritative-meter-fixture', source_time: at(-30), observed_at: at(-30), received_at: at(-28),
    valid_for_seconds: 300, provider_route: 'invented-provider / demo-route', account_ref: 'demo-account-1',
    account_identity: 'DEMO_VERIFIED', scope: 'demo-subscription-account', bucket_id: 'demo-primary',
    window_kind: 'fixed-window', window_id: 'demo-window-ending-1800', metric: 'remaining_allowance',
    value: 38, value_text: '38', unit: 'percent', quality: 'EXACT', reset_at: '2026-09-06T18:00:00.000Z',
    unavailable_reason: null, estimate_method: null, coverage: 'Invented account-wide allowance',
    referenced_by_machines: machines.map(m => m.id), ...structuredClone(overrides),
  };
}

export function reachabilityRecord(machine = 'aero', result = 'REACHABLE', overrides = {}) {
  return {
    schema_version: SCHEMA, mode: 'DEMO', observation_id: `demo-path-${machine}-${result}`,
    source: 'invented-reachability-fixture', machine_id: machine, instance_id: `demo-${machine}-runtime-1`, sequence: 1,
    source_time: null, observed_at: at(-15), received_at: at(-14), valid_for_seconds: 60,
    result, reviewed: true, trusted_path_working: true, endpoint_scope: 'machine_observation',
    ...structuredClone(overrides),
  };
}

export const scenarios = [
  ['overview', 'At a glance', 'One current request, one historical completion and stale evidence. All assignments are invented.'],
  ['running', 'Running', 'Fresh runtime evidence, not merely a submitted prompt.'],
  ['user-wait', 'Waiting for you', 'An explicit input request needs the user; no answer or approval control exists.'],
  ['retry-wait', 'Scheduled retry', 'The runtime is waiting for its own retry, not for you.'],
  ['blocked', 'Blocked failure', 'An explicit unresolved dependency failure needs user intervention.'],
  ['finished', 'Turn finished', 'Identified success remains historical. Project, tests and release acceptance are separate.'],
  ['cancelled', 'Cancelled attempt', 'Cancellation is not successful DONE and says nothing about current execution.'],
  ['stale-running', 'Stale running', 'At 61 seconds, current execution is unknown; last-seen running is retained.'],
  ['idle', 'Source idle', 'Idle does not prove a finished turn or project.'],
  ['submitted', 'Submitted only', 'A receipt does not prove running. There is no command transport.'],
  ['offline', 'Reviewed unreachable path', 'Fresh reviewed reachability proof permits only Offline to RyoDev, not powered off.'],
  ['disconnected-phone', 'Disconnected phone', 'A disconnected phone does not establish machine offline.'],
  ['observer-failure', 'Observer failure', 'Failed capture is separate from the last valid work observation.'],
  ['missing-attribution', 'Unknown model / account', 'Model and billing account remain null, with explicit reasons.'],
  ['shared-account', 'One account / four machines', 'Four verified machine references share a single 38% meter.'],
  ['usage-windows', 'Overlapping usage windows', 'Primary, weekly, model-specific and token meters stay separate.'],
  ['missing-reset', 'Reset unavailable', 'A missing reset remains null, not a guessed deadline.'],
  ['passed-reset', 'Reset time passed', 'The last 38% is historical. Passing reset never replenishes the allowance.'],
  ['usage-conflict', 'Conflicting usage', 'Equally current 38% and 41% observations produce no current allowance.'],
  ['usage-unavailable', 'Usage collection unavailable', 'Failure preserves an older EXACT value as history, not a current balance.'],
  ['usage-estimated', 'Estimated usage', 'A manual estimate names its method and coverage, not a guaranteed allowance.'],
  ['ambiguous-account', 'Unresolved account identity', 'Similar provider labels do not prove the same billing account. No combined total.'],
  ['duplicate-completion', 'Duplicate completion', 'Repeated evidence for the same identified turn creates only one review notice.'],
  ['incomplete-coverage', 'Incomplete request snapshot', 'Omission cannot resolve an old request when pending-request coverage is incomplete.'],
  ['resolved-request', 'Explicit request resolution', 'A resolving observation closes the request; marking it seen cannot.'],
  ['complete-requests', 'Complete pending snapshot', 'A source-declared complete pending snapshot can resolve an omitted request.'],
  ['invalid-clock', 'Invalid clock evidence', 'A timestamp more than 30 seconds ahead of receipt is rejected.'],
  ['sequence-conflict', 'Conflicting sequence', 'Conflicting same-sequence evidence leaves current state unknown.'],
  ['sequence-gap', 'Lost sequence continuity', 'A sequence gap makes evidence stale, not offline.'],
  ['instance-change', 'Unverified runtime restart', 'A changed runtime instance requires re-enrollment; a reset sequence is not newer state.'],
].map(([id, name, description]) => ({ id, name, description }));

export function getFixture(id) {
  if (!scenarios.some(s => s.id === id)) throw new Error('Only known built-in demo fixtures are allowed');
  const fixture = { id, mode: 'DEMO', enrollments: structuredClone(enrollments), observations: [],
    reachability: [], usage: [usageRecord()], capture_failures: [], coverage_complete: false };
  const single = (state = 'RUNNING', age = 10, overrides = {}) => { fixture.observations = [observation('riff', state, age, overrides)]; };
  single();
  switch (id) {
    case 'overview':
      fixture.observations = [observation('ryomap', 'RUNNING', 720), observation('visualizer', 'DONE', 240),
        observation('ryodev', 'IDLE', 25, { sequence: 2 }), observation('station', 'RUNNING', 10), observation('riff', 'WAITING', 20)];
      fixture.reachability = [reachabilityRecord('mac'), reachabilityRecord('dell'), reachabilityRecord('aero'),
        reachabilityRecord('hp', 'REACHABLE', { observed_at: at(-720), received_at: at(-719) })];
      break;
    case 'user-wait': single('WAITING', 20); break;
    case 'retry-wait':
      single('WAITING', 10, { requests: [], execution: { state: 'WAITING', raw_code: 'demo_retry',
        reason: 'Automatic retry scheduled by runtime', reason_code: 'retry_scheduled', waiting_on: 'runtime', retry_at: at(45) } }); break;
    case 'blocked': single('BLOCKED'); break;
    case 'finished': fixture.observations = [observation('visualizer', 'DONE', 240)]; break;
    case 'cancelled': single('CANCELLED'); break;
    case 'stale-running': single('RUNNING', 61); break;
    case 'idle': single('IDLE'); break;
    case 'submitted': single('SUBMITTED'); break;
    case 'offline': fixture.reachability = [reachabilityRecord('aero', 'UNREACHABLE')]; break;
    case 'disconnected-phone': fixture.reachability = [reachabilityRecord('aero', 'PHONE_DISCONNECTED', { trusted_path_working: false })]; break;
    case 'observer-failure':
      single('RUNNING', 75);
      fixture.reachability = [reachabilityRecord('aero', 'OBSERVER_FAILURE', { endpoint_scope: 'runtime_only' })];
      fixture.capture_failures = [{ machine_id: 'aero', observed_at: at(-5), reason: 'Invented capture failed: observer_timeout. Last observation retained.' }]; break;
    case 'missing-attribution': {
      const r = observation();
      r.attribution.model = { value: null, kind: null, source: null, observed_at: null, reason: 'Source did not supply model identity' };
      r.attribution.account = { value: null, kind: null, source: null, observed_at: null, reason: 'No billing account identity proof' };
      r.missing_fields = ['model', 'account', 'tests'];
      fixture.observations = [r]; fixture.usage = []; break;
    }
    case 'shared-account':
      fixture.observations = ['ryomap', 'station', 'riff', 'visualizer'].map(p => observation(p));
      fixture.usage = machines.map(m => usageRecord({ observation_id: `demo-shared-${m.id}`, referenced_by_machines: [m.id] })); break;
    case 'usage-windows':
      fixture.usage.push(
        usageRecord({ observation_id: 'demo-weekly', bucket_id: 'demo-weekly', window_kind: 'weekly', window_id: 'demo-week-ending-0913', value: 72.5, value_text: '72.50', reset_at: '2026-09-13T14:00:00.000Z' }),
        usageRecord({ observation_id: 'demo-model-quota', scope: 'demo-model-B', bucket_id: 'demo-model-B', value: 12, value_text: '12' }),
        usageRecord({ observation_id: 'demo-token-meter', scope: 'demo-session-tokens', bucket_id: 'demo-tokens', metric: 'tokens_used', unit: 'tokens', value: 12450, value_text: '12450', reset_at: null }),
        usageRecord({ observation_id: 'demo-legacy-mirror' }),
      ); break;
    case 'missing-reset': fixture.usage = [usageRecord({ reset_at: null })]; break;
    case 'passed-reset': fixture.usage = [usageRecord({ reset_at: at(-1) })]; break;
    case 'usage-conflict': fixture.usage.push(usageRecord({ observation_id: 'demo-conflicting-usage', value: 41, value_text: '41' })); break;
    case 'usage-unavailable': fixture.usage.push(usageRecord({ observation_id: 'demo-meter-failure', source_time: at(-5), observed_at: at(-5), received_at: at(-4),
      value: null, value_text: null, quality: 'UNAVAILABLE', unavailable_reason: 'Invented meter capture failed; prior value is historical', reset_at: null })); break;
    case 'usage-estimated': fixture.usage = [usageRecord({ quality: 'ESTIMATED', source: 'invented-manual-transcription', estimate_method: 'Unverified manual transcription of an invented meter', coverage: 'Demo primary window only' })]; break;
    case 'ambiguous-account': fixture.usage = ['a', 'b'].map(suffix => usageRecord({ observation_id: `demo-unresolved-${suffix}`, account_ref: null, account_identity: 'UNRESOLVED' })); break;
    case 'duplicate-completion': {
      const done = observation('visualizer', 'DONE', 240);
      fixture.observations = [done, structuredClone(done), { ...structuredClone(done), observation_id: 'demo-completion-repeat', sequence: 2, observed_at: at(-10), received_at: at(-9) }]; break;
    }
    case 'incomplete-coverage':
    case 'resolved-request':
    case 'complete-requests': {
      const wait = observation('riff', 'WAITING', 120);
      const next = observation('riff', 'RUNNING', 10, { sequence: 2, pending_requests_complete: id === 'complete-requests',
        resolved_requests: id === 'resolved-request' ? wait.requests.map(({ request_id, turn_id, reason }) => ({ request_id, turn_id, reason })) : [] });
      fixture.observations = [wait, next]; break;
    }
    case 'invalid-clock': single('RUNNING', 10, { observed_at: at(31), received_at: at(0) }); break;
    case 'sequence-conflict': fixture.observations.push(observation('riff', 'WAITING', 10)); break;
    case 'sequence-gap': fixture.observations.push(observation('riff', 'RUNNING', 5, { sequence: 3 })); break;
    case 'instance-change': fixture.observations.push(observation('riff', 'RUNNING', 5, { instance_id: 'demo-aero-runtime-2' })); break;
  }
  return fixture;
}
