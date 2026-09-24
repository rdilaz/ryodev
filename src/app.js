import { projects, accounts, createStore, importFixture, deriveView } from './model.js';
import { BASE_TIME, scenarios, getFixture } from './fixtures.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const projectName = id => projects.find(p => p.id === id)?.name ?? 'Unknown project';
const machineName = id => ({ mac: 'Mac', dell: 'Dell', hp: 'HP', aero: 'Gigabyte Aero' })[id] ?? id ?? 'Unknown machine';
const accountName = id => accounts.find(a => a.id === id)?.name ?? 'Unknown account';
const toolName = id => ({ 'claude-code': 'Claude Code', codex: 'Codex', opencode: 'OpenCode', kilo: 'Kilo', other: 'Other agent' })[id] ?? id;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const localTime = value => value ? new Date(value).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }) : 'Unavailable';
const ageText = (value, now) => {
  const seconds = Math.floor((now - Date.parse(value)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return 'Time untrusted';
  return seconds < 120 ? `${seconds}s ago` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ago`;
};
const shortAge = ms => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 172800 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};
const badge = (text, tone = 'neutral') => `<span class="badge ${esc(tone.toLowerCase())}">${esc(text)}</span>`;
const facts = rows => `<dl class="facts">${rows.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>`;
const sourceFacts = r => [
  ['Source', r.source], ['Observed locally', localTime(r.observed_at)], ['Observed UTC', r.observed_at],
  ['Source time', r.source_time ? localTime(r.source_time) : 'Not supplied'], ['Received / imported', localTime(r.received_at)],
  ['Validity', `${r.valid_for_seconds}s inclusive; receipt never renews it`],
];

// Browser storage is a per-device convenience only; every access tolerates failure.
const STORE_KEY = 'ryodev-invented-demo-v1';
const LIVE_KEY = 'ryodev-live-v1';
const readJson = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return undefined; } };
let saved;
let storageUnavailable = false;
try { saved = JSON.parse(localStorage.getItem(STORE_KEY)); } catch { storageUnavailable = true; }
let scenario = scenarios.some(s => s.id === saved?.scenario) ? saved.scenario : 'overview';
let now = Number.isSafeInteger(saved?.now) && saved.now >= BASE_TIME && saved.now <= BASE_TIME + 31_536_000_000 ? saved.now : BASE_TIME;
let seen = new Set(Array.isArray(saved?.seen) ? saved.seen.filter(s => typeof s === 'string').slice(0, 100) : []);
let fixture;
let store;
let openDetails = new Set();

// Live mode: only after an explicit connect on an origin that serves the RyoDev Worker API.
const liveSaved = readJson(LIVE_KEY);
let viewKey = typeof liveSaved?.key === 'string' ? liveSaved.key : null;
let liveSeen = new Set(Array.isArray(liveSaved?.seen) ? liveSaved.seen.filter(s => typeof s === 'string').slice(-200) : []);
let mode = 'demo';
let liveCapable = false;
let liveState = null;
let lastSync = 0;
let syncError = null;
let syncing = false;
let pollTimer = null;
let deriveLiveView = null; // loaded on first connect, so the demo never fetches live code

function loadScenario() {
  fixture = getFixture(scenario);
  store = importFixture(createStore(fixture.enrollments), fixture);
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ scenario, now, seen: [...seen] }));
    storageUnavailable = false;
  } catch { storageUnavailable = true; }
}

function persistLive() {
  try {
    localStorage.setItem(LIVE_KEY, JSON.stringify({ key: viewKey, seen: [...liveSeen].slice(-200) }));
    storageUnavailable = false;
  } catch { storageUnavailable = true; }
}

function detail(id, summary, body, className = '') {
  return `<details class="${className}" data-detail="${esc(id)}" ${openDetails.has(id) ? 'open' : ''}>
    <summary>${summary}<span class="chevron" aria-hidden="true"></span></summary><div class="detail-body">${body}</div></details>`;
}

// CSP forbids inline style attributes, so bar widths are applied through the CSSOM after rendering.
function applyWidths(root = document) {
  root.querySelectorAll('[data-w]').forEach(el => el.style.setProperty('--w', el.dataset.w));
}

function renderHero({ eyebrow, title, segments, legend, coverage }) {
  $('#hero-eyebrow').textContent = eyebrow;
  $('#hero-title').innerHTML = title;
  const total = segments.reduce((sum, s) => sum + s.count, 0);
  $('#state-bar').innerHTML = total ? segments.filter(s => s.count).map(s => `<span class="tone-${s.tone}" data-w="${s.count}"></span>`).join('') : '<span class="tone-idle"></span>';
  $('#state-legend').innerHTML = legend.filter(l => l.count).map(l => `<li><span class="dot tone-${l.tone}" aria-hidden="true"></span><span><strong>${l.count}</strong> ${esc(l.label)}</span></li>`).join('');
  $('#coverage').textContent = coverage;
  applyWidths($('#state-bar'));
}

/* ---------- Demo mode (invented fixtures, semantics from model.js) ---------- */

function renderDemoHero(view) {
  const clock = new Date(now);
  const count = n => `<span class="count">${n}</span>`;
  const title = view.currentRequests ? `${count(view.currentRequests)} ${view.currentRequests === 1 ? 'request' : 'requests'} <em>${view.currentRequests === 1 ? 'needs' : 'need'} you</em>`
    : view.staleRequests ? `Nothing current. <em>${view.staleRequests} to recheck</em>`
    : view.newCompletions ? `${count(view.newCompletions)} new ${view.newCompletions === 1 ? 'result' : 'results'} <em>to review</em>`
    : 'Nothing confirmed <em>needs you</em>';
  const by = state => view.sessions.filter(s => s.state === state).length;
  const segments = [
    { tone: 'wait', count: by('WAITING') }, { tone: 'block', count: by('BLOCKED') },
    { tone: 'live', count: by('RUNNING') }, { tone: 'idle', count: by('UNKNOWN') },
  ];
  renderHero({
    eyebrow: `Demo clock · ${clock.toISOString().slice(11, 19)} UTC`,
    title, segments,
    legend: [
      { tone: 'wait', count: by('WAITING'), label: 'waiting' }, { tone: 'block', count: by('BLOCKED'), label: 'blocked' },
      { tone: 'live', count: by('RUNNING'), label: 'running' }, { tone: 'info', count: view.newCompletions, label: 'new result' + (view.newCompletions === 1 ? '' : 's') },
      { tone: 'idle', count: by('UNKNOWN'), label: 'unknown or stale' },
    ],
    coverage: `${view.sessions.length} observed ${view.sessions.length === 1 ? 'session' : 'sessions'} · ${view.coverageMissing ? 'Coverage incomplete' : 'Supplied coverage only'}`,
  });
}

function renderAttention(view) {
  const counts = [`${view.currentRequests} current`, `${view.newCompletions} new ${view.newCompletions === 1 ? 'result' : 'results'}`];
  if (view.staleRequests) counts.push(`${view.staleRequests} last seen`);
  $('#attention-count').textContent = counts.join(' · ');
  $('#attention').innerHTML = view.attention.length ? view.attention.map(n => {
    const completion = n.kind === 'completion';
    const qualifier = completion ? 'Turn finished · review pending' : n.current ? (n.kind === 'failure' ? 'Blocked · your help needed' : n.kind === 'approval' ? 'Approval needed' : 'Answer needed') : 'Earlier request · current status unknown';
    const tone = completion ? 'review' : !n.current ? 'last-seen' : n.kind === 'failure' ? 'request tone-block' : 'request';
    const summary = `<span class="attention-copy"><span class="identity">${esc(projectName(n.project_id))}</span>
      <span class="attention-reason">${esc(qualifier)}</span><span class="row-meta attention-meta"><span>${esc(machineName(n.machine_id))} &middot;</span><span class="attention-age">${completion ? 'Finished' : 'Observed'} ${esc(ageText(n.observed_at, now))}</span>${completion ? '<span>&middot; Historical</span>' : !n.current ? `<span>&middot; ${n.freshness.status === 'STALE' ? 'Stale' : 'Unverified'}</span>` : ''}</span></span>`;
    return detail(`notice-${n.id}`, summary,
      `<p class="detail-lead">${esc(n.reason)}</p>${facts([
        ['Scope', completion ? `One identified turn: ${n.turn_id}` : `Request ${n.request_id} / turn ${n.turn_id}`],
        ['Meaning', completion ? 'Successful terminal turn only. Current session activity remains separately evaluated.' : n.current ? 'Explicit, fresh unresolved request for the user' : 'Previously unresolved; newer incomplete data cannot resolve this request'],
        ['Viewer state', n.seen ? 'Seen here only; not answered, approved or accepted' : 'Not yet marked seen here'],
        ['Tests / release', 'Unavailable / no acceptance evidence'], ...sourceFacts(n.observation),
      ])}<button type="button" class="seen-button" data-seen="${esc(n.id)}" aria-pressed="${n.seen}">${n.seen ? 'Seen here (not approved)' : 'Mark seen here'}</button><p class="muted">This only changes your local seen marker. It cannot resolve or approve work.</p>`,
      `attention-card ${tone}`);
  }).join('') : `<p class="empty-state">No confirmed requests.<br>${view.coverageMissing ? 'Coverage is incomplete, not an all-clear.' : 'Supplied observations only; no project acceptance claim.'}</p>`;

  const flags = [view.stale ? `${view.stale} stale` : null, view.unknown ? `${view.unknown} unknown` : null,
    store.issues.length ? `${store.issues.length} rejected / conflicting` : null,
    store.captureFailures.length ? 'capture failed' : null].filter(Boolean);
  if (!flags.length && view.coverageMissing) flags.push('Coverage incomplete');
  const body = `<p>No whole-project health claim. Zero observations means unknown coverage, not zero activity.</p>
    <ul>${view.sessions.filter(s => s.state === 'UNKNOWN' || s.freshness.status !== 'FRESH').map(s => `<li><strong>${esc(projectName(s.observation.project_id))} / ${esc(machineName(s.observation.machine_id))}</strong>: ${esc(s.reason)}. Last seen ${esc(s.lastSeen.toLowerCase())}, ${esc(ageText(s.observation.observed_at, now))}.</li>`).join('')}
    ${view.machines.filter(m => !m.sessions.length).map(m => `<li>${esc(m.name)}: no session observation.</li>`).join('')}</ul>
    ${store.captureFailures.map(f => `<p><strong>${esc(machineName(f.machine_id))} capture failure:</strong> ${esc(f.reason)} / ${esc(localTime(f.observed_at))}. This is not evidence that work failed.</p>`).join('')}
    ${store.issues.length ? '<h3>Fixture validation diagnostics</h3>' + facts(store.issues.map(i => [`${i.kind}: ${i.id}`, i.reason])) : ''}`;
  $('#status-check').innerHTML = view.needsChecking ? detail('status-check',
    `<span><strong>Status needs checking</strong><span class="row-meta">${esc(flags.join(' · '))}</span></span>`, body, 'status-check')
    : '<p class="all-set">Supplied coverage is current. This is not project or release acceptance.</p>';
}

function attributionSummary(r) {
  const model = r.attribution.model;
  const account = r.attribution.account;
  if (model.kind === 'configured-default' || account.kind === 'configured-default') {
    return `${model.value ?? 'Unknown model'} (${model.kind === 'configured-default' ? 'configured default, not active' : 'last observed'}) / ${account.value ? accountName(account.value) : 'Unknown account'} (${account.kind === 'configured-default' ? 'configured default, not active' : 'last observed'})`;
  }
  return `Last observed: ${model.value ?? 'Unknown model'} · ${account.value ? accountName(account.value) : 'Unknown account'}`;
}

const stateTone = s => s.freshness.status !== 'FRESH' ? 'idle' : ({ RUNNING: 'live', WAITING: 'wait', BLOCKED: 'block' })[s.state] ?? 'idle';

function sessionDetails(s) {
  const r = s.observation;
  const enrollment = fixture.enrollments.find(e => e.machine_id === r.machine_id && e.instance_id === r.instance_id && e.session_id === r.session_id);
  const attribution = ['model', 'provider', 'account'].flatMap(field => {
    const a = r.attribution[field];
    return [[`Observed ${field}`, a.value === null ? `Unavailable: ${a.reason}` : `${field === 'account' ? accountName(a.value) : a.value} / ${a.kind === 'configured-default' ? 'configured default, not active' : 'last observed, not assumed active'}`],
      [`${field} evidence`, a.observed_at ? `${localTime(a.observed_at)} / ${a.source}` : 'Not supplied']];
  });
  return `<div class="session-detail"><h3>${esc(machineName(r.machine_id))} / ${esc(s.label)}</h3>${facts([
    ['Execution', `${s.label}: ${s.reason}`], ['Evidence freshness', `${s.freshness.status}: ${s.freshness.reason}`],
    ['Last seen', `${r.execution.state} / ${localTime(r.observed_at)}`], ['Raw evidence', `${r.execution.raw_code} / ${r.evidence_kind}`], ['Reason code', r.execution.reason_code],
    ['Waiting on', r.execution.waiting_on ?? 'Not evidenced'], ['Retry time', r.execution.retry_at ? localTime(r.execution.retry_at) : 'Not supplied'],
    ['Session identity', `${r.machine_id} / ${r.instance_id} / ${r.session_id}`], ['Project binding', enrollment?.worktree_alias ?? 'Unavailable'],
    ['Identity source', enrollment?.identity_source ?? 'Unavailable'], ['Fixture adapter', `${enrollment?.adapter_name} / v${enrollment?.adapter_version}`],
    ['Observation / sequence', `${r.observation_id} / ${r.sequence}`],
    ['Pending coverage', r.pending_requests_complete ? 'Source declares complete pending-request snapshot' : 'Incomplete; omission cannot resolve requests'],
    ['Terminal history', s.history.length ? s.history.map(h => `${h.turn_id}: ${h.outcome} at ${localTime(h.observed_at)}; no current-activity claim`).join('; ') : 'No explicit terminal result'],
    ['Tests', 'Unavailable; no check/commit evidence supplied'],
    ...attribution, ['Missing fields', r.missing_fields.join(', ') || 'None declared'], ...sourceFacts(r),
  ])}</div>`;
}

function renderProjects(view) {
  $('#projects-count').innerHTML = `${plural(projects.length, 'project')}<span class="sr-only">, observed sessions only</span>`;
  $('#projects').innerHTML = projects.map(project => {
    const sessions = view.sessions.filter(s => s.observation.project_id === project.id);
    const tally = sessions.length > 1 ? [...new Set(sessions.map(s => s.state))].map(state => `${sessions.filter(s => s.state === state).length} ${state.toLowerCase()}`).join(' / ') : '';
    const summary = `<span class="project-copy"><span class="project-title"><strong>${esc(project.name)}</strong>${tally ? `<span class="project-tally">${esc(tally)}</span>` : ''}</span>
      ${sessions.length ? sessions.map(s => `<span class="session-preview"><span class="machine-state"><span class="dot tone-${stateTone(s)}" aria-hidden="true"></span><span>${esc(machineName(s.observation.machine_id))}<span class="identity-divider">&middot;</span>${esc(s.state === 'UNKNOWN' ? 'Status unknown' : s.label)}</span></span>
        <span class="row-meta">${s.freshness.status === 'FRESH' && s.state !== 'UNKNOWN' ? 'Observed' : `Last seen ${esc(s.lastSeen === 'DONE' ? 'turn finished' : s.lastSeen.toLowerCase())}`} ${esc(ageText(s.observation.observed_at, now))}${s.freshness.status === 'FRESH' ? '' : ` &middot; ${s.freshness.status === 'STALE' ? 'Stale' : 'Unverified'}`}</span>
        <span class="attribution-preview">${esc(attributionSummary(s.observation))}</span></span>`).join('') : '<span class="row-meta no-observation">No observations &middot; status unknown</span>'}
      ${project.id === 'ryomap' ? '<span class="acceptance-note">Release not accepted &middot; user-reported</span>' : ''}</span>`;
    return detail(`project-${project.id}`, summary, `<p class="acceptance-detail">${esc(project.acceptance)}. Execution cannot grant human acceptance.</p>${sessions.length ? sessions.map(sessionDetails).join('') : '<p>No session observation. Model, account, work activity and tests are unavailable.</p>'}`, 'project-card');
  }).join('');
}

function renderMachines(view) {
  $('#machines-count').textContent = 'Status links only';
  $('#machines').innerHTML = view.machines.map(machine => {
    const c = machine.connectivity;
    const observed = machine.sessions.map(s => s.observation).sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))[0];
    const label = c.state === 'OBSERVED' ? 'Status link reached' : c.label;
    const summary = `<span><span class="machine-glyph" aria-hidden="true"></span><strong>${esc(machine.name)}</strong><span class="machine-state">${esc(label)}</span>
      <span class="row-meta">${c.observation ? `${c.freshness?.status === 'FRESH' ? 'Check' : 'Last check'} ${esc(ageText(c.observation.observed_at, now))}` : 'No link check'}</span>
      <span class="row-meta">${machine.sessions.length ? `${machine.sessions.length} observed ${machine.sessions.length === 1 ? 'session' : 'sessions'}` : 'Coverage unknown'}</span></span>`;
    return detail(`machine-${machine.id}`, summary, `<p>${esc(c.reason)}</p>${facts([
      ['Connectivity', c.label], ['Last verified session observation', observed ? localTime(observed.observed_at) : 'Unavailable'],
      ['Coverage', machine.sessions.length ? `${machine.sessions.filter(s => s.state === 'RUNNING').length} running / ${machine.sessions.filter(s => s.state === 'UNKNOWN').length} unknown; observed sessions only` : 'No observations; activity unknown'],
      ...(c.observation ? [['Reachability check', `${localTime(c.observation.observed_at)} / ${c.freshness?.status ?? 'UNKNOWN'}`], ...sourceFacts(c.observation)] : [['Reachability check', 'Not supplied']]),
    ])}`, 'machine-card');
  }).join('');
}

function usageAmount(r) {
  if (!r || r.value === null) return 'Unavailable';
  const value = r.unit === 'percent' ? `${r.value_text}%` : `${r.value_text} ${r.unit}`;
  return `${value}${r.metric === 'remaining_allowance' ? ' remaining' : r.metric === 'tokens_used' ? ' used' : ` / ${r.metric.replaceAll('_', ' ')}`}`;
}

function renderUsage(view) {
  $('#usage-count').textContent = 'Separate account meters';
  $('#usage').innerHTML = view.usage.length ? view.usage.map((u, index) => {
    const r = u.record;
    const hasCurrent = u.currentValue !== null;
    const value = hasCurrent ? usageAmount(r) : r.metric === 'remaining_allowance' ? 'Allowance unavailable' : 'Usage unavailable';
    const history = !hasCurrent && !u.conflict && u.verified ? u.historical : null;
    const scope = ({ 'demo-primary': 'Primary allowance', 'demo-weekly': 'Subscription allowance', 'demo-model-B': 'Model B allowance', 'demo-tokens': 'Session token usage' })[r.bucket_id] ?? r.scope;
    const window = ({ 'fixed-window': 'fixed window', weekly: 'weekly window' })[r.window_kind] ?? r.window_kind;
    const provider = r.provider_route === 'invented-provider / demo-route' ? 'Invented provider' : r.provider_route;
    const reset = u.conflict && new Set(u.current.map(item => item.reset_at)).size > 1 ? 'Reset unverified'
      : u.resetPassed ? 'Reset passed · refresh needed' : r.reset_at ? `Reset ${new Date(r.reset_at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}` : 'Reset unavailable';
    const reason = u.conflict ? 'Conflicting reports' : !u.verified ? 'Account identity unverified' : r.quality === 'UNAVAILABLE' ? 'Meter capture unavailable'
      : u.resetPassed ? '' : !hasCurrent ? (u.freshness.status === 'STALE' ? 'Observation expired' : 'Evidence unverified') : '';
    const meter = hasCurrent && r.unit === 'percent' && r.metric === 'remaining_allowance' && Number.isFinite(Number(r.value))
      ? `<span class="meter" aria-hidden="true"><span data-w="${Math.max(0, Math.min(100, Number(r.value)))}"></span></span>` : '';
    const summary = `<span class="usage-copy"><span class="project-title"><strong>${esc(u.verified ? accountName(r.account_ref) : 'Unresolved account')}</strong>${hasCurrent ? badge(r.quality, r.quality) : ''}</span>
      <span class="usage-provider">${esc(provider)} &middot; ${u.machineRefs.length} ${u.machineRefs.length === 1 ? 'machine' : 'machines'} ${u.verified ? 'sharing' : 'referenced'}</span>
      <span class="usage-result"><span class="usage-value">${esc(value)}</span>${meter}${reason ? `<span class="usage-reason">${esc(reason)}</span>` : ''}</span>
      ${history ? `<span class="historical-value">Last known: ${esc(usageAmount(history))} &middot; ${esc(history.quality)}<br>Observed ${esc(ageText(history.observed_at, now))} &middot; historical</span>` : ''}
      <span class="row-meta">${esc(scope)} &middot; ${esc(window)}</span>
      <span class="usage-evidence">${u.freshness.status === 'FRESH' ? '' : badge(u.freshness.status === 'STALE' ? 'Stale' : 'Unverified', u.freshness.status)}<span>Observed ${esc(ageText(r.observed_at, now))}</span></span>
      <span class="row-meta ${u.resetPassed ? 'warning-copy' : ''}">${esc(reset)}</span></span>`;
    return detail(`usage-${index}`, summary, `<p>No sum across accounts, windows, model scopes or units. Tokens never imply subscription allowance. EXACT describes the historical source value, not a promise of availability.</p>${facts([
      ['Attribution', `${u.verified ? accountName(r.account_ref) : 'Unresolved'} / ${r.provider_route} / ${r.account_identity} (invented)`],
      ['Product scope', r.scope], ['Meter / window', `${r.bucket_id} / ${r.window_kind} / ${r.window_id}`],
      ['Metric / unit', `${r.metric} / ${r.unit}`], ['Current value', u.currentValue === null ? 'Unavailable' : usageAmount(r)],
      ['Source quality', r.quality], ['Evidence freshness', `${u.freshness.status} / ${u.freshness.reason}`],
      ['Historical value', u.conflict ? 'Conflicting observations; no selected value' : u.historical ? `${usageAmount(u.historical)} at ${localTime(u.historical.observed_at)} / ${u.historical.quality}` : 'Unavailable (null, not zero)'],
      ['Conflicts', u.conflict ? u.current.map(item => `${item.observation_id}: ${usageAmount(item)} / ${item.quality}`).join('; ') : 'None'],
      ['Reset', r.reset_at ? `${localTime(r.reset_at)}${u.resetPassed ? '; passed, never replenished locally' : ''}` : 'Unavailable (null)'],
      ['Estimate method', r.estimate_method ?? 'Not applicable'], ['Coverage', r.coverage], ['Unavailable reason', u.reason ?? 'Not unavailable at this demo time'],
      ['Machine references', u.machineRefs.map(machineName).join(', ')], ...sourceFacts(r),
    ])}`, 'usage-card');
  }).join('') : '<div class="empty-state"><strong>Usage unavailable</strong><p>No verified account or meter.<br>Missing values are null, not zero.</p></div>';
  applyWidths($('#usage'));
}

function renderDemo() {
  const view = deriveView(store, now, seen);
  const clock = new Date(now);
  $('#demo-clock').textContent = `${clock.toISOString().slice(11, 19)} UTC, ${clock.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
  $('#demo-clock').dateTime = new Date(now).toISOString();
  $('#scenario').value = scenario;
  $('#scenario-description').textContent = scenarios.find(s => s.id === scenario).description;
  renderDemoHero(view); renderAttention(view); renderProjects(view); renderMachines(view); renderUsage(view);
}

/* ---------- Live mode (hook events via the RyoDev Worker; see docs/LIVE-SETUP.md) ---------- */

const liveStateLabel = s => s.quiet ? 'Quiet' : ({ running: 'Running', needs_input: 'Waiting for you', finished: 'Turn finished', error: 'Hit an error', ended: 'Session ended' })[s.state] ?? 'Status unknown';
const liveTone = s => s.quiet ? 'idle' : ({ running: 'live', needs_input: 'wait', finished: 'info', error: 'block' })[s.state] ?? 'idle';
const seenMark = item => `${item.key}@${item.updated}`;

function liveSessionFacts(s) {
  return facts([
    ['State', `${liveStateLabel(s)}${s.quiet ? ' · no event for a while; may be thinking, idle or closed' : ''}`],
    ['Detail', s.detail ?? 'None supplied'], ['Machine', machineName(s.machine)], ['Agent', toolName(s.tool)],
    ['Session', s.session], ['In this state since', localTime(s.since)], ['Last event', localTime(s.updated)],
    ['Received by Worker', localTime(s.received)],
    ['Clock', s.clock_skew ? 'Laptop clock was off by more than 5 minutes; Worker time used' : 'Laptop time accepted'],
  ]);
}

function renderLive() {
  const clockNow = Date.now();
  const view = deriveLiveView(liveState, clockNow, liveSeen);
  const syncAge = lastSync ? clockNow - lastSync : Infinity;
  const c = view.counts;
  const toReview = view.attention.filter(a => a.kind === 'finished').length;
  const title = c.waiting ? `<span class="count">${c.waiting}</span> ${c.waiting === 1 ? 'session' : 'sessions'} <em>${c.waiting === 1 ? 'needs' : 'need'} you</em>`
    : c.error ? `${plural(c.error, 'error')} <em>to look at</em>`
    : toReview ? `<span class="count">${toReview}</span> finished <em>to review</em>`
    : 'Nothing waiting <em>on you</em>';
  const activeMachines = view.machines.filter(m => m.activity === 'active').length;
  renderHero({
    eyebrow: `Live · ${activeMachines} of ${plural(view.machines.length, 'machine')} active`,
    title,
    segments: [{ tone: 'wait', count: c.waiting }, { tone: 'block', count: c.error }, { tone: 'live', count: c.running }, { tone: 'info', count: c.finished }, { tone: 'idle', count: c.quiet }],
    legend: [{ tone: 'wait', count: c.waiting, label: 'waiting' }, { tone: 'block', count: c.error, label: 'error' + (c.error === 1 ? '' : 's') },
      { tone: 'live', count: c.running, label: 'running' }, { tone: 'info', count: c.finished, label: 'finished' }, { tone: 'idle', count: c.quiet, label: 'quiet' }],
    coverage: `${plural(view.sessions.length, 'session')} · hooks report on events, not heartbeats`,
  });

  $('#attention-count').textContent = [`${c.waiting} waiting`, `${toReview} to review`, c.error ? `${c.error} error` : null].filter(Boolean).join(' · ');
  $('#attention').innerHTML = view.attention.length ? view.attention.map(a => {
    const tone = a.kind === 'waiting' ? 'tone-wait' : a.kind === 'error' ? 'tone-block' : 'tone-info';
    const reason = a.kind === 'waiting' ? (a.detail || 'Waiting for your answer') : a.kind === 'error' ? (a.detail || 'Hit an error') : 'Turn finished · review';
    const summary = `<span class="attention-copy"><span class="identity">${esc(a.project)}</span><span class="attention-reason">${esc(reason)}</span>
      <span class="row-meta attention-meta"><span>${esc(machineName(a.machine))} &middot;</span><span>${esc(toolName(a.tool))} &middot;</span><span class="attention-age">${esc(shortAge(a.ageMs))} ago</span>${a.maybeOutdated ? '<span>&middot; may be outdated</span>' : ''}</span></span>`;
    const session = view.sessions.find(s => s.key === a.key) ?? a;
    const actions = `${a.kind === 'finished' ? `<button type="button" class="seen-button" data-live-seen="${esc(seenMark(a))}">Mark reviewed</button>` : ''}<button type="button" class="forget-button ghost-button" data-forget="${esc(a.key)}">Clear this row</button>
      <p class="muted">Reviewed is stored on this phone only. Clear removes the row from your Worker until the next event.</p>`;
    return detail(`live-${a.key}`, summary, `${liveSessionFacts(session)}${actions}`, `attention-card ${tone}`);
  }).join('') : `<p class="empty-state">Nothing is waiting on you.<br>${c.running ? `${plural(c.running, 'session')} running.` : 'No running sessions reported.'} Hooks only report what they see.</p>`;

  const quiet = view.sessions.filter(s => s.quiet);
  $('#status-check').innerHTML = quiet.length ? detail('live-quiet', `<span><strong>${plural(quiet.length, 'quiet session')}</strong><span class="row-meta">No event for 20+ minutes</span></span>`,
    `<p>Hooks send events when something happens, not heartbeats. A quiet session may be thinking, idle, asleep or closed. Quiet is never shown as offline or done.</p><ul>${quiet.map(s => `<li><strong>${esc(s.project)} / ${esc(machineName(s.machine))}</strong>: last ${esc(liveStateLabel({ ...s, quiet: false }).toLowerCase())} ${esc(shortAge(s.ageMs))} ago</li>`).join('')}</ul>`, 'status-check') : '';

  $('#projects-count').textContent = plural(view.projects.length, 'project');
  $('#projects').innerHTML = view.projects.length ? view.projects.map(p => {
    const summary = `<span class="project-copy"><span class="project-title"><strong>${esc(p.name)}</strong><span class="project-tally">${esc(Object.entries(p.tally).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(' / '))}</span></span>
      ${p.sessions.map(s => `<span class="session-preview"><span class="machine-state"><span class="dot tone-${liveTone(s)}" aria-hidden="true"></span><span>${esc(machineName(s.machine))}<span class="identity-divider">&middot;</span>${esc(liveStateLabel(s))}</span></span>
        <span class="row-meta">${esc(toolName(s.tool))} &middot; ${esc(shortAge(s.ageMs))} ago</span></span>`).join('')}</span>`;
    return detail(`live-project-${p.name}`, summary, p.sessions.map(s => `<div class="session-detail"><h3>${esc(machineName(s.machine))} / ${esc(toolName(s.tool))}</h3>${liveSessionFacts(s)}</div>`).join(''), 'project-card');
  }).join('') : '<p class="empty-state">No sessions reported yet.<br>Start a Claude Code or Codex turn on a laptop with the hook installed.</p>';

  $('#machines-count').textContent = `${activeMachines} of ${view.machines.length} active`;
  $('#machines').innerHTML = view.machines.map(m => {
    const label = m.activity === 'active' ? 'Reporting' : m.activity === 'quiet' ? 'Quiet' : 'Never reported';
    const summary = `<span><span class="machine-glyph" aria-hidden="true"></span><strong>${esc(m.label)}</strong><span class="machine-state"><span class="dot tone-${m.activity === 'active' ? 'live' : 'idle'}" aria-hidden="true"></span>${esc(label)}</span>
      <span class="row-meta">${m.lastSeen ? `Last event ${esc(shortAge(m.ageMs))} ago` : 'No events yet'}</span>
      <span class="row-meta">${plural(m.sessionCount, 'session')}</span></span>`;
    return detail(`live-machine-${m.machine}`, summary, `<p>${m.activity === 'unknown' ? 'No hook has reported from this machine. Install it with hooks/install.mjs.' : 'Activity reflects the last hook event only. Quiet is not offline.'}</p>${facts([
      ['Last event', m.lastSeen ? localTime(m.lastSeen) : 'Never'], ['Sessions', String(m.sessionCount)]])}`, 'machine-card');
  }).join('');

  $('#usage-count').textContent = 'Not collected in live mode';
  $('#usage').innerHTML = '<div class="empty-state"><strong>Usage not collected yet</strong><p>Provider allowance needs its own reviewed read. Missing values stay unavailable, never zero.</p></div>';

  const pill = $('#mode-pill');
  pill.classList.toggle('sync-stale', syncAge > 120_000);
  pill.classList.toggle('sync-failed', Boolean(syncError));
  $('#live-label').textContent = syncError ? `Sync failed · last ${lastSync ? shortAge(syncAge) + ' ago' : 'never'}` : lastSync ? `Synced ${shortAge(syncAge)} ago` : 'Connecting';
  $('#sync-warning').hidden = !syncError;
  $('#sync-warning').textContent = syncError ? `${syncError} Showing the last good sync; nothing here was refreshed.` : '';
}

/* ---------- Shell ---------- */

function renderModeChrome() {
  const live = mode === 'live';
  document.body.classList.toggle('is-live', live);
  $('#mode-pill').classList.toggle('is-live', live);
  $('.demo-label').hidden = live;
  $('#live-label').hidden = !live;
  $('#demo-controls').hidden = live;
  $('#refresh').hidden = !live;
  $('#connect-form').hidden = live;
  $('#connected-panel').hidden = !live;
  $('#golive-lead').textContent = live ? 'Live status from your laptops. Hooks send only machine, project, state and time — never prompts, code or paths.'
    : 'Your laptops can report here in about ten minutes. Hooks send only machine, project, state and time — never prompts, code or paths.';
  $('#footer-mode').textContent = live ? 'Live mode. Status comes from your laptops’ hook events.' : 'Invented data. No real sessions connected.';
  document.title = live ? 'RyoDev · Live' : 'RyoDev';
}

function render() {
  openDetails = new Set([...document.querySelectorAll('#screen details[open]')].map(d => d.dataset.detail));
  const focused = document.activeElement?.dataset;
  $('#storage-warning').hidden = !storageUnavailable;
  renderModeChrome();
  if (mode === 'live') renderLive(); else renderDemo();
  if (focused?.seen) [...document.querySelectorAll('[data-seen]')].find(b => b.dataset.seen === focused.seen)?.focus({ preventScroll: true });
}

async function syncLive() {
  if (!viewKey || syncing) return;
  syncing = true;
  try {
    const response = await fetch('./api/state', { headers: { Authorization: `Bearer ${viewKey}` }, cache: 'no-store', credentials: 'same-origin' });
    if (response.status === 401) { disconnect('That viewer key was rejected. Paste the current VIEW_TOKEN.'); return; }
    if (!response.ok) throw new Error(`Worker answered ${response.status}.`);
    const body = await response.json();
    if (body?.v !== 1 || !Array.isArray(body.sessions)) throw new Error('Unexpected response shape.');
    liveState = body; lastSync = Date.now(); syncError = null;
  } catch (error) {
    syncError = error instanceof TypeError ? 'Could not reach your Worker.' : error.message;
  } finally { syncing = false; }
  if (mode === 'live') render();
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (document.visibilityState === 'visible') syncLive(); }, 20_000);
}

async function connect(key) {
  viewKey = key.trim();
  if (!deriveLiveView) ({ deriveLiveView } = await import('./live.js'));
  $('#connect-message').textContent = 'Connecting…';
  await syncLive();
  if (!viewKey) return;
  if (!liveState) { $('#connect-message').textContent = syncError ?? 'Could not connect.'; return; }
  mode = 'live'; persistLive(); startPolling();
  $('#connect-message').textContent = '';
  render();
}

function disconnect(message = '') {
  viewKey = null; liveState = null; lastSync = 0; syncError = null; mode = 'demo';
  clearInterval(pollTimer);
  persistLive();
  render();
  $('#connect-message').textContent = message;
}

// Probe only on explicit connect or a saved key, so the public demo never makes an API request.
async function probeWorker() {
  try {
    const response = await fetch('./api/health', { cache: 'no-store', credentials: 'same-origin' });
    const body = response.ok ? await response.json() : null;
    liveCapable = body?.service === 'ryodev';
  } catch { liveCapable = false; }
  renderModeChrome();
  return liveCapable;
}

$('#scenario').innerHTML = scenarios.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
$('#demo-controls').addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    $('#demo-controls').open = false;
    $('#demo-controls > summary').focus();
  }
});
$('#demo-controls').addEventListener('focusout', event => {
  if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
});
$('#scenario').addEventListener('change', event => {
  scenario = event.target.value; now = BASE_TIME; seen = new Set();
  loadScenario(); persist(); render();
  $('#demo-message').textContent = 'Built-in scenario loaded. Demo clock explicitly reset; no real data imported.';
});
for (const [id, seconds] of [['advance-61', 61], ['advance-300', 300]]) {
  $(`#${id}`).addEventListener('click', () => {
    now += seconds * 1000; persist(); render();
    $('#demo-message').textContent = `Demo clock advanced ${seconds} seconds. Observation timestamps unchanged.`;
  });
}
$('#reimport').addEventListener('click', () => {
  importFixture(store, fixture); persist(); render();
  $('#demo-message').textContent = 'Same built-in fixture reimported. No observation time renewed; no duplicate notice or allowance.';
});
$('#reset').addEventListener('click', () => {
  now = BASE_TIME; seen = new Set(); loadScenario(); persist(); render();
  $('#demo-message').textContent = 'Demo reset to its original invented clock. This is not a status refresh.';
});
$('#screen').addEventListener('click', async event => {
  const button = event.target.closest('button[data-seen], button[data-live-seen], button[data-forget]');
  if (!button) return;
  if (button.dataset.seen) {
    const key = button.dataset.seen;
    if (seen.has(key)) seen.delete(key); else seen.add(key);
    persist(); render();
  } else if (button.dataset.liveSeen) {
    liveSeen.add(button.dataset.liveSeen); persistLive(); render();
  } else if (button.dataset.forget && viewKey) {
    button.disabled = true;
    try {
      const response = await fetch('./api/forget', { method: 'POST', headers: { Authorization: `Bearer ${viewKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ key: button.dataset.forget }) });
      if (!response.ok) throw new Error();
    } catch { syncError = 'Could not clear that row.'; }
    await syncLive();
  }
});
$('#connect').addEventListener('click', async () => {
  const key = $('#view-key').value;
  if (!key.trim()) { $('#connect-message').textContent = 'Paste your viewer key first.'; return; }
  $('#connect-message').textContent = 'Looking for your Worker\u2026';
  if (!liveCapable && !(await probeWorker())) { $('#connect-message').textContent = 'No RyoDev Worker answers at this address. This is the public demo; open your own Worker URL on this phone to connect.'; return; }
  $('#view-key').value = '';
  connect(key);
});
$('#view-key').addEventListener('keydown', event => { if (event.key === 'Enter') $('#connect').click(); });
$('#disconnect').addEventListener('click', () => disconnect('Disconnected. Back to the invented demo.'));
$('#refresh').addEventListener('click', () => syncLive());
document.addEventListener('visibilitychange', () => { if (mode === 'live' && document.visibilityState === 'visible') syncLive(); });
setInterval(() => { if (mode === 'live' && document.visibilityState === 'visible') render(); }, 10_000);

loadScenario();
document.body.classList.add('is-entering');
render();
setTimeout(() => document.body.classList.remove('is-entering'), 900);
if (viewKey) probeWorker().then(ok => { if (ok) connect(viewKey); });
