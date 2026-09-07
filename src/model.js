export const SCHEMA = 'ryodev.observation.v0.1';
export const SESSION_VALIDITY = 60;
export const USAGE_VALIDITY = 300;

export const projects = [
  { id: 'ryomap', name: 'RyoMap', acceptance: 'Release not accepted - user-reported (invented)' },
  { id: 'ryodev', name: 'RyoDev', acceptance: 'Release acceptance unavailable' },
  { id: 'station', name: 'Agent Station', acceptance: 'Release acceptance unavailable' },
  { id: 'riff', name: 'Riff', acceptance: 'Release acceptance unavailable' },
  { id: 'visualizer', name: 'Audio visualizer', acceptance: 'Release acceptance unavailable' },
];
export const machines = [
  { id: 'mac', name: 'Mac' }, { id: 'dell', name: 'Dell' },
  { id: 'hp', name: 'HP' }, { id: 'aero', name: 'Gigabyte Aero' },
];
export const accounts = [{ id: 'demo-account-1', name: 'Demo account 1' }];

export const sessionKey = r => JSON.stringify([r.machine_id, r.instance_id, r.session_id]);
const instanceKey = r => JSON.stringify([r.machine_id, r.instance_id]);
const noticeKey = (r, turn, request, reason) => JSON.stringify([sessionKey(r), turn, request, reason]);
const instant = value => typeof value === 'string' && /Z$/.test(value) && Number.isFinite(Date.parse(value));
const same = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const fingerprint = ({ received_at, fault, identity_conflict, ...r }) => same(r);
const validText = value => typeof value === 'string' && value.length > 0 && value.length <= 300;

function timeError(r, limit) {
  if (!instant(r.observed_at) || !instant(r.received_at) || (r.source_time !== null && !instant(r.source_time))) return 'Invalid UTC timestamp';
  if (!Number.isFinite(r.valid_for_seconds) || r.valid_for_seconds <= 0 || r.valid_for_seconds > limit) return 'Invalid validity interval';
  if (Date.parse(r.observed_at) > Date.parse(r.received_at) + 30_000 ||
      (r.source_time && Date.parse(r.source_time) > Date.parse(r.received_at) + 30_000)) return 'Timestamp more than 30s ahead of receipt';
  return null;
}

export function freshness(r, now, limit = SESSION_VALIDITY) {
  const invalid = timeError(r, limit);
  if (invalid) return { status: 'UNKNOWN', age: null, reason: invalid };
  const age = (now - Date.parse(r.observed_at)) / 1000;
  if (!Number.isFinite(now) || age < 0 || now < Date.parse(r.received_at) || (r.source_time && now < Date.parse(r.source_time))) {
    return { status: 'UNKNOWN', age: null, reason: 'Clock anomaly; current evidence untrusted' };
  }
  return age <= r.valid_for_seconds
    ? { status: 'FRESH', age, reason: 'Within observation validity' }
    : { status: 'STALE', age, reason: 'Observation validity expired' };
}

function commonError(r, limit) {
  if (!r || typeof r !== 'object' || r.schema_version !== SCHEMA || r.mode !== 'DEMO') return 'Unsupported schema or non-demo record';
  if (!validText(r.observation_id) || !validText(r.source)) return 'Missing observation identity or source';
  return timeError(r, limit);
}

export function createStore(enrollments = []) {
  return {
    enrollments: structuredClone(enrollments), sessions: new Map(), ordering: new Map(), notices: new Map(),
    usage: new Map(), reachability: new Map(), fingerprints: new Map(), issues: [],
    captureFailures: [], coverageComplete: false,
  };
}

function issue(store, kind, r, reason) {
  const item = { kind, id: r?.observation_id ?? 'missing-id', reason };
  if (!store.issues.some(i => same(i) === same(item))) store.issues.push(item);
  return { accepted: false, reason };
}

function sessionError(r, store) {
  const common = commonError(r, SESSION_VALIDITY);
  if (common) return common;
  const enrollment = store.enrollments.find(e => sessionKey(e) === sessionKey(r));
  if (!enrollment || enrollment.identity_status !== 'DEMO_VERIFIED') return 'Unverified instance or session; re-enrollment required';
  if (enrollment.project_id !== r.project_id) return 'Project binding mismatch';
  if (!Number.isSafeInteger(r.sequence) || r.sequence < 1) return 'Invalid sequence';
  if (!['RUNNING', 'WAITING', 'BLOCKED', 'DONE', 'IDLE', 'CANCELLED', 'FAILED', 'SUBMITTED', 'UNKNOWN'].includes(r.execution?.state)) return 'Unsupported execution state';
  if (!validText(r.execution.raw_code) || !validText(r.execution.reason)) return 'Missing execution evidence';
  if (!['runtime_busy', 'input_required', 'retry_scheduled', 'dependency_access_denied', 'terminal_success',
    'attempt_cancelled', 'attempt_failed', 'source_idle', 'submission_only', 'unsupported_state'].includes(r.execution.reason_code)) return 'Unsupported bounded reason code';
  if (!['runtime_status', 'submission_receipt'].includes(r.evidence_kind)) return 'Unsupported evidence kind';
  if (r.execution.state === 'RUNNING' && r.evidence_kind !== 'runtime_status') return 'Submission cannot prove running';
  if (r.execution.state === 'WAITING' && !['user', 'runtime', 'dependency'].includes(r.execution.waiting_on)) return 'Wait must name waiting_on';
  if (r.execution.retry_at !== null && !instant(r.execution.retry_at)) return 'Invalid retry timestamp';
  if (typeof r.pending_requests_complete !== 'boolean' || typeof r.pending_requests_current !== 'boolean' ||
      !Array.isArray(r.requests) || !Array.isArray(r.resolved_requests)) return 'Missing request coverage declaration';
  for (const request of [...r.requests, ...r.resolved_requests]) {
    if (![request.request_id, request.turn_id, request.reason].every(validText)) return 'Invalid request identity';
  }
  for (const request of r.requests) {
    if (!['input', 'approval', 'failure'].includes(request.kind) || !['user', 'runtime', 'dependency'].includes(request.waiting_on)) return 'Invalid pending request';
  }
  if (r.terminal !== null && (!validText(r.terminal?.turn_id) || !['success', 'cancelled', 'failed'].includes(r.terminal?.outcome) || !instant(r.terminal?.completed_at) || Date.parse(r.terminal.completed_at) > Date.parse(r.observed_at))) return 'Invalid identified terminal outcome';
  if (r.execution.state === 'DONE' && (r.terminal?.outcome !== 'success' || r.turn_id !== r.terminal.turn_id)) return 'Done requires explicit successful identified turn';
  if (['CANCELLED', 'FAILED'].includes(r.execution.state) && r.terminal?.outcome !== r.execution.state.toLowerCase()) return 'Terminal outcome mismatch';
  if (!Array.isArray(r.supported_fields) || !Array.isArray(r.missing_fields)) return 'Missing field coverage';
  for (const field of ['model', 'provider', 'account']) {
    const a = r.attribution?.[field];
    if (!a || (a.value === null ? !validText(a.reason) : !validText(a.value) || !instant(a.observed_at) || !validText(a.source) || !['observed', 'configured-default'].includes(a.kind))) return `Invalid ${field} attribution`;
    if (a.observed_at && Date.parse(a.observed_at) > Date.parse(r.received_at) + 30_000) return `Invalid ${field} evidence time`;
  }
  return null;
}

export function importSession(store, input) {
  const r = structuredClone(input);
  const error = sessionError(r, store);
  if (error) {
    // Identity or clock faults cannot silently leave an apparently current session.
    for (const [key, entry] of store.sessions) {
      if (entry.observation.machine_id === r?.machine_id && entry.observation.session_id === r?.session_id) {
        store.sessions.set(key, { ...entry, fault: error,
          identityFault: entry.identityFault || error.includes('re-enrollment') || error === 'Project binding mismatch' });
      }
    }
    return issue(store, 'Session', r, error);
  }
  const key = sessionKey(r);
  const runtime = instanceKey(r);
  const priorSequence = store.ordering.get(runtime);
  if ([...store.sessions.values()].some(e => instanceKey(e.observation) === runtime && e.identityFault)) {
    return issue(store, 'Session', r, 'Identity must be re-enrolled before accepting further evidence');
  }
  const identity = `session:${key}:${r.observation_id}`;
  const signature = fingerprint(r);
  const existing = store.fingerprints.get(identity);
  if (existing === signature) return { accepted: true, duplicate: true };
  if (existing || (priorSequence && r.sequence === priorSequence.sequence)) {
    for (const [id, entry] of store.sessions) {
      if (instanceKey(entry.observation) === runtime) store.sessions.set(id, { ...entry, fault: 'Conflicting observation identity or sequence' });
    }
    return issue(store, 'Session', r, 'Conflicting observation identity or sequence');
  }
  if (priorSequence && r.sequence < priorSequence.sequence) return issue(store, 'Session', r, 'Older sequence rejected');
  if (priorSequence && Date.parse(r.observed_at) < Date.parse(priorSequence.observed_at)) {
    for (const [id, entry] of store.sessions) {
      if (instanceKey(entry.observation) === runtime) store.sessions.set(id, { ...entry, fault: 'Observation clock moved backwards' });
    }
    return issue(store, 'Session', r, 'Observation clock moved backwards');
  }
  const gap = priorSequence && r.sequence > priorSequence.sequence + 1;
  if (gap) {
    for (const [id, entry] of store.sessions) {
      if (instanceKey(entry.observation) === runtime) store.sessions.set(id, { ...entry, fault: 'Sequence gap; continuity lost' });
    }
  }
  store.sessions.set(key, { observation: r, fault: gap ? 'Sequence gap; continuity lost' : null });
  store.ordering.set(runtime, { sequence: r.sequence, observed_at: r.observed_at });
  store.fingerprints.set(identity, signature);
  // A gapped snapshot cannot resolve old requests or introduce trusted new notices.
  if (gap) return { accepted: true, reason: 'Sequence gap; continuity lost' };
  const pending = new Set(r.requests.map(q => noticeKey(r, q.turn_id, q.request_id, q.reason)));
  if (r.pending_requests_complete) {
    for (const [id, item] of store.notices) {
      if (item.sessionKey === key && item.kind !== 'completion' && !pending.has(id)) {
        store.notices.set(id, { ...item, resolved: true, resolution: r.observation_id });
      }
    }
  }
  for (const q of r.resolved_requests) {
    const id = noticeKey(r, q.turn_id, q.request_id, q.reason);
    const item = store.notices.get(id);
    if (item) store.notices.set(id, { ...item, resolved: true, resolution: r.observation_id });
  }
  for (const q of r.requests) {
    if (!r.pending_requests_current) continue;
    const id = noticeKey(r, q.turn_id, q.request_id, q.reason);
    store.notices.set(id, { ...q, id, sessionKey: key, project_id: r.project_id, machine_id: r.machine_id,
      observation: r, observed_at: r.observed_at, resolved: false, resolution: null });
  }
  if (r.terminal) {
    const id = noticeKey(r, r.terminal.turn_id, null, `terminal:${r.terminal.outcome}`);
    if (!store.notices.has(id)) store.notices.set(id, {
      id, kind: 'completion', outcome: r.terminal.outcome, turn_id: r.terminal.turn_id,
      sessionKey: key, project_id: r.project_id, machine_id: r.machine_id,
      observation: r, observed_at: r.terminal.completed_at, reason: 'Turn finished; review pending', resolved: false,
    });
  }
  return { accepted: true };
}

function usageError(r) {
  const common = commonError(r, USAGE_VALIDITY);
  if (common) return common;
  if (![r.provider_route, r.scope, r.bucket_id, r.window_kind, r.window_id, r.metric, r.unit].every(validText)) return 'Missing meter identity or unit';
  if (!['DEMO_VERIFIED', 'UNRESOLVED'].includes(r.account_identity) ||
      (r.account_identity === 'DEMO_VERIFIED' && !accounts.some(a => a.id === r.account_ref))) return 'Unverified canonical account';
  if (!Array.isArray(r.referenced_by_machines) || r.referenced_by_machines.some(id => !machines.some(m => m.id === id))) return 'Invalid machine references';
  if (r.reset_at !== null && !instant(r.reset_at)) return 'Invalid reset timestamp';
  if (!['EXACT', 'ESTIMATED', 'UNAVAILABLE'].includes(r.quality)) return 'Invalid usage quality';
  if (r.quality === 'UNAVAILABLE') {
    if (r.value !== null || r.value_text !== null || !validText(r.unavailable_reason)) return 'Unavailable usage requires null value and reason';
  } else {
    if (!Number.isFinite(r.value) || r.value < 0 || (r.unit === 'percent' && r.value > 100) ||
        typeof r.value_text !== 'string' || !/^\d+(\.\d+)?$/.test(r.value_text) || Number(r.value_text) !== r.value) return 'Invalid usage value or supplied precision';
    if (r.quality === 'ESTIMATED' && (!validText(r.estimate_method) || !validText(r.coverage))) return 'Estimate needs method and coverage';
  }
  return null;
}

export function importUsage(store, input) {
  const r = structuredClone(input);
  const error = usageError(r);
  if (error) return issue(store, 'Usage', r, error);
  const prior = store.usage.get(r.observation_id);
  if (prior && fingerprint(prior) === fingerprint(r)) return { accepted: true, duplicate: true };
  if (prior) {
    store.usage.set(r.observation_id, { ...prior, identity_conflict: true });
    return issue(store, 'Usage', r, 'Conflicting usage observation identity');
  }
  store.usage.set(r.observation_id, r);
  return { accepted: true };
}

export function importReachability(store, input) {
  const r = structuredClone(input);
  const old = store.reachability.get(r?.machine_id);
  const error = commonError(r, SESSION_VALIDITY);
  if (error) {
    if (old) store.reachability.set(r.machine_id, { ...old, fault: error });
    return issue(store, 'Connectivity', r, error);
  }
  if (!machines.some(m => m.id === r.machine_id) || !Number.isSafeInteger(r.sequence) || r.sequence < 1 ||
      !['REACHABLE', 'UNREACHABLE', 'PHONE_DISCONNECTED', 'OBSERVER_FAILURE'].includes(r.result)) return issue(store, 'Connectivity', r, 'Invalid reachability record');
  if (old?.identityFault || !store.enrollments.some(e => e.machine_id === r.machine_id && e.instance_id === r.instance_id)) {
    if (old) store.reachability.set(r.machine_id, { ...old, identityFault: true, fault: 'Unverified reachability instance; re-enrollment required' });
    return issue(store, 'Connectivity', r, 'Unverified reachability instance; re-enrollment required');
  }
  if (old && fingerprint(old) === fingerprint(r)) return { accepted: true, duplicate: true };
  if (old && r.sequence < old.sequence) return issue(store, 'Connectivity', r, 'Older reachability sequence rejected');
  if (old && (r.sequence === old.sequence || r.instance_id !== old.instance_id || Date.parse(r.observed_at) < Date.parse(old.observed_at))) {
    store.reachability.set(r.machine_id, { ...old, fault: 'Conflicting reachability evidence' });
    return issue(store, 'Connectivity', r, 'Conflicting reachability evidence');
  }
  store.reachability.set(r.machine_id, { ...r, fault: old && r.sequence > old.sequence + 1 ? 'Reachability continuity lost' : null });
  return { accepted: true };
}

export function importFixture(store, fixture) {
  for (const r of fixture.observations) importSession(store, r);
  for (const r of fixture.reachability) importReachability(store, r);
  for (const r of fixture.usage) importUsage(store, r);
  store.coverageComplete = fixture.coverage_complete;
  store.captureFailures = structuredClone(fixture.capture_failures);
  return store;
}

export function sessionView(entry, now, store) {
  const r = entry.observation;
  const age = freshness(r, now);
  if (entry.fault) Object.assign(age, { status: 'STALE', reason: entry.fault });
  let state = 'UNKNOWN';
  let label = 'Current state unknown';
  let reason = age.reason;
  const pending = [...store.notices.values()].filter(n => n.sessionKey === sessionKey(r) && n.kind !== 'completion' && !n.resolved && freshness(n.observation, now).status === 'FRESH');
  const userRequest = pending.find(n => n.waiting_on === 'user' && ['input', 'approval'].includes(n.kind));
  if (age.status === 'FRESH') {
    if (userRequest && r.pending_requests_current) {
      state = 'WAITING'; label = 'Waiting for you'; reason = userRequest.reason;
    } else if (r.execution.state === 'RUNNING' && r.evidence_kind === 'runtime_status') {
      state = 'RUNNING'; label = 'Running'; reason = r.execution.reason;
    } else if (r.execution.state === 'WAITING') {
      state = 'WAITING'; label = r.execution.waiting_on === 'user' ? 'Waiting for you' : 'Waiting / retry'; reason = r.execution.reason;
    } else if (r.execution.state === 'BLOCKED') {
      state = 'BLOCKED'; label = 'Blocked'; reason = r.execution.reason;
    } else {
      reason = ({ IDLE: 'Source idle is not completion', SUBMITTED: 'Submitted is not running', DONE: 'Successful turn is historical, not current session activity', CANCELLED: 'Cancelled attempt is not successful completion', FAILED: 'Failed attempt is not current execution' })[r.execution.state] ?? r.execution.reason;
    }
  }
  return { key: sessionKey(r), observation: r, state, label, reason, freshness: age,
    lastSeen: r.execution.state, history: [...store.notices.values()].filter(n => n.sessionKey === sessionKey(r) && n.kind === 'completion') };
}

export function connectivityView(store, machine, now) {
  const r = store.reachability.get(machine.id);
  if (!r) {
    const hasSession = [...store.sessions.values()].some(e => e.observation.machine_id === machine.id);
    return { state: hasSession ? 'UNKNOWN' : 'NOT_CONNECTED', label: hasSession ? 'Connectivity unknown' : 'Not connected',
      reason: hasSession ? 'Session evidence exists; no current reachability proof' : 'No observation path established', observation: null };
  }
  const age = freshness(r, now);
  if (r.fault || age.status !== 'FRESH') return { state: 'UNKNOWN', label: 'Connectivity unknown', reason: r.fault ?? age.reason, observation: r, freshness: age };
  if (r.result === 'UNREACHABLE' && r.reviewed === true && r.trusted_path_working === true && r.endpoint_scope === 'machine_observation') {
    return { state: 'OFFLINE', label: 'Offline to RyoDev', reason: 'Reviewed endpoint unreachable over a working trusted path; not proof of power-off', observation: r, freshness: age };
  }
  if (r.result === 'REACHABLE') return { state: 'OBSERVED', label: 'Path observed', reason: 'Only this observation path worked at the recorded time', observation: r, freshness: age };
  return { state: 'UNKNOWN', label: 'Connectivity unknown', reason: r.result === 'PHONE_DISCONNECTED' ? 'Phone disconnected; machine reachability unproven' : 'Observer failure is not machine offline or work failure', observation: r, freshness: age };
}

export function usageViews(store, now) {
  const groups = new Map();
  for (const r of store.usage.values()) {
    const key = JSON.stringify([r.provider_route, r.account_identity === 'DEMO_VERIFIED' ? r.account_ref : `unresolved:${r.observation_id}`,
      r.scope, r.bucket_id, r.window_kind, r.window_id, r.metric, r.unit]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups].map(([key, records]) => {
    const sourceInstant = r => Date.parse(r.source_time ?? r.observed_at);
    records.sort((a, b) => sourceInstant(b) - sourceInstant(a));
    const r = records[0];
    const current = records.filter(item => sourceInstant(item) === sourceInstant(r));
    const conflict = current.some(item => item.identity_conflict) || new Set(current.map(item => same([item.value, item.value_text, item.quality, item.reset_at]))).size > 1;
    const age = freshness(r, now, USAGE_VALIDITY);
    const resetPassed = r.reset_at !== null && now >= Date.parse(r.reset_at);
    const verified = r.account_identity === 'DEMO_VERIFIED';
    const historical = records.find(item => item.value !== null && !item.identity_conflict) ?? null;
    const reason = conflict ? 'Conflicting equally current observations; no current allowance'
      : !verified ? 'Account identity unresolved; no combined allowance'
      : r.quality === 'UNAVAILABLE' ? r.unavailable_reason
      : resetPassed ? 'Reset time passed; refresh needed'
      : age.status !== 'FRESH' ? age.reason : null;
    return { key, record: r, records, current, conflict, freshness: age, resetPassed, verified, historical,
      currentValue: reason ? null : r.value, reason,
      machineRefs: [...new Set(records.flatMap(item => item.referenced_by_machines))] };
  });
}

export function deriveView(store, now, seen = new Set()) {
  const sessions = [...store.sessions.values()].map(entry => sessionView(entry, now, store));
  const attention = [...store.notices.values()].filter(n => !n.resolved &&
    (n.kind === 'completion' ? n.outcome === 'success' : n.waiting_on === 'user')).map(n => {
    const entry = store.sessions.get(n.sessionKey);
    const age = freshness(n.observation, now);
    const current = !entry?.fault && age.status === 'FRESH';
    return { ...n, current, freshness: age, seen: seen.has(n.id),
      rank: n.kind === 'completion' ? 2 : n.kind === 'failure' ? 1 : 0 };
  }).sort((a, b) => a.rank - b.rank || Number(b.current) - Number(a.current) || a.observed_at.localeCompare(b.observed_at));
  const machineViews = machines.map(m => ({ ...m, connectivity: connectivityView(store, m, now), sessions: sessions.filter(s => s.observation.machine_id === m.id) }));
  const stale = sessions.filter(s => s.freshness.status === 'STALE').length;
  const unknown = sessions.filter(s => s.state === 'UNKNOWN' && s.freshness.status !== 'STALE').length;
  const missingMachines = machineViews.filter(m => !m.sessions.length).length;
  const coverageMissing = !store.coverageComplete || missingMachines > 0 || sessions.length < store.enrollments.length;
  return { sessions, machines: machineViews, attention, usage: usageViews(store, now), stale, unknown, missingMachines, coverageMissing,
    currentRequests: attention.filter(n => n.kind !== 'completion' && n.current).length,
    staleRequests: attention.filter(n => n.kind !== 'completion' && !n.current).length,
    newCompletions: attention.filter(n => n.kind === 'completion' && !n.seen).length,
    needsChecking: coverageMissing || stale > 0 || unknown > 0 || store.issues.length > 0 || store.captureFailures.length > 0,
  };
}
