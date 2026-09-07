import { projects, accounts, createStore, importFixture, deriveView } from './model.js';
import { BASE_TIME, scenarios, getFixture } from './fixtures.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const projectName = id => projects.find(p => p.id === id)?.name ?? 'Unknown project';
const machineName = id => ({ mac: 'Mac', dell: 'Dell', hp: 'HP', aero: 'Gigabyte Aero' })[id] ?? 'Unknown machine';
const accountName = id => accounts.find(a => a.id === id)?.name ?? 'Unknown account';
const localTime = value => value ? new Date(value).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }) : 'Unavailable';
const ageText = (value, now) => {
  const seconds = Math.floor((now - Date.parse(value)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return 'Time untrusted';
  return seconds < 120 ? `${seconds}s ago` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ago`;
};
const badge = (text, tone = 'neutral') => `<span class="badge ${esc(tone.toLowerCase())}">${esc(text)}</span>`;
const facts = rows => `<dl class="facts">${rows.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>`;
const sourceFacts = r => [
  ['Source', r.source], ['Observed locally', localTime(r.observed_at)], ['Observed UTC', r.observed_at],
  ['Source time', r.source_time ? localTime(r.source_time) : 'Not supplied'], ['Received / imported', localTime(r.received_at)],
  ['Validity', `${r.valid_for_seconds}s inclusive; receipt never renews it`],
];
const STORE_KEY = 'ryodev-invented-demo-v1';
let saved;
let storageUnavailable = false;
try { saved = JSON.parse(localStorage.getItem(STORE_KEY)); } catch { storageUnavailable = true; }
let scenario = scenarios.some(s => s.id === saved?.scenario) ? saved.scenario : 'overview';
let now = Number.isSafeInteger(saved?.now) && saved.now >= BASE_TIME && saved.now <= BASE_TIME + 31_536_000_000 ? saved.now : BASE_TIME;
let seen = new Set(Array.isArray(saved?.seen) ? saved.seen.filter(s => typeof s === 'string').slice(0, 100) : []);
let fixture;
let store;
let openDetails = new Set();

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

function detail(id, summary, body, className = '') {
  return `<details class="${className}" data-detail="${esc(id)}" ${openDetails.has(id) ? 'open' : ''}>
    <summary>${summary}<span class="chevron" aria-hidden="true"></span></summary><div class="detail-body">${body}</div></details>`;
}

function renderAttention(view) {
  const counts = [`${view.currentRequests} current`, `${view.newCompletions} new ${view.newCompletions === 1 ? 'result' : 'results'}`];
  if (view.staleRequests) counts.push(`${view.staleRequests} last seen`);
  $('#attention-count').textContent = counts.join(' \u00b7 ');
  $('#attention').innerHTML = view.attention.length ? view.attention.map(n => {
    const completion = n.kind === 'completion';
    const qualifier = completion ? 'Turn finished \u00b7 review pending' : n.current ? (n.kind === 'failure' ? 'Blocked \u00b7 your help needed' : n.kind === 'approval' ? 'Approval needed' : 'Answer needed') : 'Earlier request \u00b7 current status unknown';
    const summary = `<span class="attention-copy"><span class="identity">${esc(projectName(n.project_id))}</span>
      <span class="attention-reason">${esc(qualifier)}</span><span class="row-meta attention-meta"><span>${esc(machineName(n.machine_id))} &middot;</span><span class="attention-age">${completion ? 'Finished' : 'Observed'} ${esc(ageText(n.observed_at, now))}</span>${completion ? '<span>&middot; Historical</span>' : !n.current ? `<span>&middot; ${n.freshness.status === 'STALE' ? 'Stale' : 'Unverified'}</span>` : ''}</span></span>`;
    return detail(`notice-${n.id}`, summary,
      `<p class="detail-lead">${esc(n.reason)}</p>${facts([
        ['Scope', completion ? `One identified turn: ${n.turn_id}` : `Request ${n.request_id} / turn ${n.turn_id}`],
        ['Meaning', completion ? 'Successful terminal turn only. Current session activity remains separately evaluated.' : n.current ? 'Explicit, fresh unresolved request for the user' : 'Previously unresolved; newer incomplete data cannot resolve this request'],
        ['Viewer state', n.seen ? 'Seen here only; not answered, approved or accepted' : 'Not yet marked seen here'],
        ['Tests / release', 'Unavailable / no acceptance evidence'], ...sourceFacts(n.observation),
      ])}<button type="button" class="seen-button" data-seen="${esc(n.id)}" aria-pressed="${n.seen}">${n.seen ? 'Seen here (not approved)' : 'Mark seen here'}</button><p class="muted">This only changes your local seen marker. It cannot resolve or approve work.</p>`,
      `attention-card ${completion ? 'review' : n.current ? 'request' : 'last-seen'}`);
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
    `<span><strong>Status needs checking</strong><span class="row-meta">${esc(flags.join(' \u00b7 '))}</span></span>`, body, 'status-check')
    : '<p class="muted">Supplied coverage is current. This is not project or release acceptance.</p>';
}

function attributionSummary(r) {
  const model = r.attribution.model;
  const account = r.attribution.account;
  if (model.kind === 'configured-default' || account.kind === 'configured-default') {
    return `${model.value ?? 'Unknown model'} (${model.kind === 'configured-default' ? 'configured default, not active' : 'last observed'}) / ${account.value ? accountName(account.value) : 'Unknown account'} (${account.kind === 'configured-default' ? 'configured default, not active' : 'last observed'})`;
  }
  return `Last observed: ${model.value ?? 'Unknown model'} \u00b7 ${account.value ? accountName(account.value) : 'Unknown account'}`;
}

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
  $('#projects').innerHTML = projects.map(project => {
    const sessions = view.sessions.filter(s => s.observation.project_id === project.id);
    const tally = sessions.length > 1 ? [...new Set(sessions.map(s => s.state))].map(state => `${sessions.filter(s => s.state === state).length} ${state.toLowerCase()}`).join(' / ') : '';
    const summary = `<span class="project-copy"><span class="project-title"><strong>${esc(project.name)}</strong>${tally ? `<span class="project-tally">${esc(tally)}</span>` : ''}</span>
      ${sessions.length ? sessions.map(s => `<span class="session-preview"><span class="machine-state">${esc(machineName(s.observation.machine_id))}<span class="identity-divider">&middot;</span>${esc(s.state === 'UNKNOWN' ? 'Status unknown' : s.label)}</span>
        <span class="row-meta">${s.freshness.status === 'FRESH' && s.state !== 'UNKNOWN' ? 'Observed' : `Last seen ${esc(s.lastSeen === 'DONE' ? 'turn finished' : s.lastSeen.toLowerCase())}`} ${esc(ageText(s.observation.observed_at, now))}${s.freshness.status === 'FRESH' ? '' : ` &middot; ${s.freshness.status === 'STALE' ? 'Stale' : 'Unverified'}`}</span>
        <span class="attribution-preview">${esc(attributionSummary(s.observation))}</span></span>`).join('') : '<span class="row-meta no-observation">No observations &middot; status unknown</span>'}
      ${project.id === 'ryomap' ? '<span class="acceptance-note">Release not accepted &middot; user-reported</span>' : ''}</span>`;
    return detail(`project-${project.id}`, summary, `<p class="acceptance-detail">${esc(project.acceptance)}. Execution cannot grant human acceptance.</p>${sessions.length ? sessions.map(sessionDetails).join('') : '<p>No session observation. Model, account, work activity and tests are unavailable.</p>'}`, 'project-card');
  }).join('');
}

function renderMachines(view) {
  $('#machines').innerHTML = view.machines.map(machine => {
    const c = machine.connectivity;
    const observed = machine.sessions.map(s => s.observation).sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))[0];
    const label = c.state === 'OBSERVED' ? 'Status link reached' : c.label;
    const summary = `<span><strong>${esc(machine.name)}</strong><span class="machine-state">${esc(label)}</span>
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
  $('#usage').innerHTML = view.usage.length ? view.usage.map((u, index) => {
    const r = u.record;
    const hasCurrent = u.currentValue !== null;
    const value = hasCurrent ? usageAmount(r) : r.metric === 'remaining_allowance' ? 'Allowance unavailable' : 'Usage unavailable';
    const history = !hasCurrent && !u.conflict && u.verified ? u.historical : null;
    const scope = ({ 'demo-primary': 'Primary allowance', 'demo-weekly': 'Subscription allowance', 'demo-model-B': 'Model B allowance', 'demo-tokens': 'Session token usage' })[r.bucket_id] ?? r.scope;
    const window = ({ 'fixed-window': 'fixed window', weekly: 'weekly window' })[r.window_kind] ?? r.window_kind;
    const provider = r.provider_route === 'invented-provider / demo-route' ? 'Invented provider' : r.provider_route;
    const reset = u.conflict && new Set(u.current.map(item => item.reset_at)).size > 1 ? 'Reset unverified'
      : u.resetPassed ? 'Reset passed \u00b7 refresh needed' : r.reset_at ? `Reset ${new Date(r.reset_at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}` : 'Reset unavailable';
    const reason = u.conflict ? 'Conflicting reports' : !u.verified ? 'Account identity unverified' : r.quality === 'UNAVAILABLE' ? 'Meter capture unavailable'
      : u.resetPassed ? '' : !hasCurrent ? (u.freshness.status === 'STALE' ? 'Observation expired' : 'Evidence unverified') : '';
    const summary = `<span class="usage-copy"><span class="project-title"><strong>${esc(u.verified ? accountName(r.account_ref) : 'Unresolved account')}</strong>${hasCurrent ? badge(r.quality, r.quality) : ''}</span>
      <span class="usage-provider">${esc(provider)} &middot; ${u.machineRefs.length} ${u.machineRefs.length === 1 ? 'machine' : 'machines'} ${u.verified ? 'sharing' : 'referenced'}</span>
      <span class="usage-result"><span class="usage-value">${esc(value)}</span>${reason ? `<span class="usage-reason">${esc(reason)}</span>` : ''}</span>
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
}

function render() {
  openDetails = new Set([...document.querySelectorAll('#screen details[open]')].map(d => d.dataset.detail));
  const focusedSeen = document.activeElement?.dataset?.seen;
  const view = deriveView(store, now, seen);
  $('#coverage').textContent = `${view.sessions.length} observed ${view.sessions.length === 1 ? 'session' : 'sessions'} \u00b7 ${view.coverageMissing ? 'Coverage incomplete' : 'Supplied coverage only'}`;
  const clock = new Date(now);
  $('#demo-clock').textContent = `${clock.toISOString().slice(11, 19)} UTC, ${clock.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
  $('#demo-clock').dateTime = new Date(now).toISOString();
  $('#storage-warning').hidden = !storageUnavailable;
  $('#scenario').value = scenario;
  $('#scenario-description').textContent = scenarios.find(s => s.id === scenario).description;
  renderAttention(view); renderProjects(view); renderMachines(view); renderUsage(view);
  if (focusedSeen) [...document.querySelectorAll('[data-seen]')].find(b => b.dataset.seen === focusedSeen)?.focus({ preventScroll: true });
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
const artwork = $('.workstation-art');
function hideUnavailableArtwork() {
  artwork.hidden = true;
  artwork.parentElement.classList.add('artwork-unavailable');
}
artwork.addEventListener('error', hideUnavailableArtwork);
if (artwork.complete && !artwork.naturalWidth) hideUnavailableArtwork();
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
$('#screen').addEventListener('click', event => {
  const button = event.target.closest('button[data-seen]');
  if (!button) return;
  const key = button.dataset.seen;
  if (seen.has(key)) seen.delete(key); else seen.add(key);
  persist(); render();
});
loadScenario();
render();
