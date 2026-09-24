# RyoDev V0 — phone status first

Planning specification • 6 September 2026 • Proposed, not implemented or release-accepted
**Recommendation:** build one responsive, read-only phone screen using invented fixtures. Then prove one deliberately captured status snapshot from one existing session on one laptop. Keep continuous observation and all session control outside V0. RyoMap’s pending repair is not a dependency of the prototype or this first snapshot.
**Your next step:** use the copy-ready prompt at the end in a separate implementation task. No infrastructure decision is needed to start the fixture prototype. The real connection has its own explicit acceptance gate.

## 1. Grounding and reuse

I read the connected `rdilaz/ryomap` boundary and interface documentation, plus the public service and MCP definitions. The inspected `main` was **`d1a7b81805ad36092c3737d5927c9070c66f84a7`**. This is an observation of committed source, **not acceptance of the pending ranked-evidence consumption-contract repair** or proof of any laptop’s current checkout.

| Evidence inspectedConsequence for RyoDev                                                                                                                                                                                                                                                                                                                                                                                                                                                               |                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [RyoDev extension boundary](https://github.com/rdilaz/ryomap/blob/d1a7b81805ad36092c3737d5927c9070c66f84a7/docs/ryodev-extension-boundary.md)                                                                                                                                                                                                                                                                                                                                                          | RyoDev is not implemented in that repository/milestone. RyoMap is repository memory; execution tools and Agent Station retain separate authority. No local model or generic plugin system is required.                            |
| [How it works](https://github.com/rdilaz/ryomap/blob/d1a7b81805ad36092c3737d5927c9070c66f84a7/docs/how-it-works.md), [service](https://github.com/rdilaz/ryomap/blob/d1a7b81805ad36092c3737d5927c9070c66f84a7/src/ryomap/service.py), [MCP interface](https://github.com/rdilaz/ryomap/blob/d1a7b81805ad36092c3737d5927c9070c66f84a7/src/ryomap/mcp/server.py)                                                                                                                                         | Future repository enrichment uses `ryomap.service.RyoMapService.context`, `.impact`, `.status`, or the corresponding `repo_context`, `repo_impact`, `repo_status` tools. Do not access its storage, ranking, or parser internals. |
| [Accepted foundation ADR](https://github.com/rdilaz/ryomap/blob/d1a7b81805ad36092c3737d5927c9070c66f84a7/docs/architecture/ADR-001-foundation-selection.md)                                                                                                                                                                                                                                                                                                                                            | Its ACCEPTED status applies to that foundation decision; it does not establish release acceptance.                                                                                                                                |
| [Integrations](https://github.com/rdilaz/ryomap/blob/d1a7b81805ad36092c3737d5927c9070c66f84a7/docs/integrations.md), [security](https://github.com/rdilaz/ryomap/blob/d1a7b81805ad36092c3737d5927c9070c66f84a7/docs/security-model.md), [cross-laptop setup](https://github.com/rdilaz/ryomap/blob/d1a7b81805ad36092c3737d5927c9070c66f84a7/docs/cross-laptop-setup.md), [remote boundary](https://github.com/rdilaz/ryomap/blob/d1a7b81805ad36092c3737d5927c9070c66f84a7/docs/chatgpt-integration.md) | Existing client setup provides repository tools, not session telemetry. Indexes and absolute checkout paths stay machine-local. A phone bridge is separately scoped and reviewed.                                                 |

Connected repository inventory returned 16 `rdilaz` repositories, with no repository named RyoDev. A RyoDev repository-name search and owner-scoped content search produced no additional implementation candidate. Search absence does not establish absence of unpushed or differently named local work. No laptop filesystem or raw session store was inspected.
**Placement rule:** reuse an existing RyoDev workspace if the implementation task identifies one. Otherwise use an isolated prototype directory outside RyoMap and the product repositories. Creating a remote repository, service, or hosting account is not a prerequisite. Do not modify RyoMap’s branch, configuration, dependencies, tests, or release work.
When RyoMap is eventually connected, pin a separately accepted version and revalidate its final consumer contract. Preserve its evidence order, provenance, gaps, and freshness; do not recreate or reinterpret its ranking. The current `status` path may refresh RyoMap’s own index, so “repository read-only” must not be mistaken for “no local cache writes.” No RyoMap invocation belongs in the initial session snapshot.

## 2. The single phone screen

Use a responsive web page that can later become installable. V0 does not require an install prompt, native app, service worker, backend, or cloud sync. At **390 × 844**, show the mode, Needs me, and the first project without scrolling. Machines and usage follow on the same page. Support 320px width without horizontal scrolling.

| Screen region, in orderContent and behavior |                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RyoDev / mode**                           | Persistent `DEMO — invented data` or `IMPORTED SNAPSHOT — observed 14:00:00 UTC`. Display age and coverage: e.g. `1 session observed · 3 machines not connected`. Never show a generic Live badge.                                                                                                          |
| **Needs me**                                | Compact rows with project, machine, explicit reason, age, and `View details`. Order confirmed input/approval requests first, actionable failures second, newly finished turns needing review third. A separate “Status needs checking” row covers stale observations without inventing an approval request. |
| **Projects**                                | RyoMap, RyoDev, Agent Station, Riff, Audio visualizer. Each row shows known sessions by machine, state with age, and model/account where evidenced. Keep unknown fields visible. A tap expands details in place.                                                                                            |
| **Machines**                                | Mac, Dell, HP, Gigabyte Aero. Show last verified observation, connectivity qualification, and observed session count. `Not connected` is distinct from offline. One successful session read proves only that observation path worked at that time, not that every process is healthy.                       |
| **Usage**                                   | One row per verified shared account and meter/window, with remaining amount or `Unavailable`, source quality, observation age, and reset where supplied. Session rows reference these records. No sum across incompatible meters.                                                                           |

**Illustrative screen content — every operational value below is invented:**

| RegionExample copy    |                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Needs me              | `Riff · Aero — waiting for your answer · observed 20s ago`                                         |
| Finished              | `Audio visualizer · Dell — turn finished; review pending · 4m ago`                                 |
| Project               | `Agent Station · Mac — running · Demo model A · Demo account 1`                                    |
| Status needs checking | `HP — last observed running 12m ago; current state unknown`                                        |
| Usage                 | `Demo account 1 · shared across 4 machines · 38% remaining · EXACT at 14:00 UTC · reset 18:00 UTC` |

These examples are fixture scenarios, not claims about current work. In a real snapshot, unobserved project rows say `No session observation`. RyoMap may separately show `Release not accepted — user-reported`; a finished coding turn cannot change that label.
Keep the main screen readable in five seconds: project, machine, reason, and age take priority over charts or token totals. Use text plus icons, at least 44px touch targets, visible keyboard focus, adequate contrast, reduced-motion support, and screen-reader labels. Expanded details show source and exact timestamps. Do not rely on color for meaning.
**Attention rules:** key attention items by session instance + turn/request + reason. Fresh unresolved requests contribute to the current count; stale requests remain visible as “last seen unresolved” with a separate count. Imported evidence cannot silently resolve an old request merely because it omits that request. A provider adapter must declare whether its snapshot is complete for pending requests; otherwise resolution requires an explicit resolving observation. Marking a notice “seen” affects only the viewer and grants no approval. Deduplicate the same completion across imports.
Project and machine summaries report observed coverage, such as `1 running · 1 unknown`, never an unjustified whole-project “healthy.” Zero observations means unknown coverage, not zero activity. No “All clear” while monitored coverage is missing or stale.

## 3. Exact state meanings

Keep **execution**, **observation freshness**, **connectivity**, and **human acceptance** separate. They are not one interchangeable status enum.

| LabelRequired evidence and exact meaningDoes not establish |                                                                                                                                                                                                             |                                                                                                                                                                                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RUNNING**                                                | A fresh observation from the enrolled owning runtime says the identified session/turn is actively executing. An explicit outstanding wait takes precedence when the source guarantees it is current.        | A submitted prompt, accepted command, open terminal, process existence, recent log, or healthy machine is insufficient. It does not prove useful progress.                                              |
| **WAITING**                                                | The runtime explicitly reports a pause for input, approval, or a scheduled retry. Include `reason`, `waiting_on` and any supplied retry time. Only waits requiring Ryo enter the current Needs me count.    | Silence or generic idle does not prove a wait. RyoDev never supplies the answer or approves the request.                                                                                                |
| **BLOCKED**                                                | An explicit unresolved failure or dependency prevents the identified work from continuing. Include a bounded reason code and who can resolve it, if known.                                                  | A failed observer request is not evidence that development is blocked. Automatic retry reported by the runtime is WAITING/retry, not a permanent blocker.                                               |
| **DONE**                                                   | An explicit successful terminal result for an identified turn/task. Display scope, such as `Turn finished`; attach tests only when separately evidenced.                                                    | It does not mean the project is complete, tests passed, changes merged/deployed, or release accepted. Idle, disappearing sessions, submission acknowledgments, and process exit alone are insufficient. |
| **OFFLINE**                                                | A fresh, reviewed reachability result establishes that this enrolled machine’s observation endpoint is unreachable over an otherwise working trusted path. UI says `Offline to RyoDev`; include check time. | It does not prove powered off. A local agent endpoint failure alone cannot establish machine offline. A disconnected phone, failed relay, or old heartbeat cannot establish it either.                  |
| **STALE**                                                  | Previously valid observation is older than its declared validity interval, or continuity/ordering was lost. It describes evidence age, not execution.                                                       | It never means idle, stopped, done, or offline.                                                                                                                                                         |
| **UNKNOWN**                                                | No sufficient evidence, unsupported field/state, incomplete coverage, ambiguous identity, invalid time, conflicting observation, or continuity gap. Include a concise reason.                               | Never substitute a likely state or fill a missing allowance with zero.                                                                                                                                  |

Cancelled/failed terminal attempts retain their explicit outcome and are never successful DONE. An unresolved failure can appear BLOCKED. A cancelled attempt can appear `Cancelled` in details while the session’s current execution remains unknown.
**Freshness policy v0.1:** session and reachability observations are fresh for **60 seconds inclusive**; usage observations for **300 seconds inclusive**, unless the source supplies a shorter validity. These are product defaults, not provider promises. UI age updates locally; it does not poll a laptop. After expiry, show `Current state unknown · last seen running at … · stale`. Historical DONE for a specific turn remains a historical completion; it must not become a claim about the session’s present activity.
Record source time when supplied, adapter observation time, and receipt/import time separately. Re-importing or reloading the same record never advances observation time. A newly received heartbeat never refreshes old session state or quota. A later successful status snapshot may reaffirm the state without a new lifecycle event.
Store timestamps as UTC instants and render local time with a timezone in details. First real connection requires verified machine clock accuracy; a timestamp more than 30 seconds ahead of receipt fails freshness validation. Expire conservatively on clock anomalies. Order by enrolled instance and sequence; reject older or conflicting sequence values, accept identical duplicates idempotently, and require re-enrollment after an unverified instance change. Sequence resets never masquerade as newer state. Identity keys include machine and runtime instance, so identical session IDs on different laptops cannot collide.
**Submission rule:** future command receipts need their own ledger. `Submitted` or `accepted` cannot alter execution state; RUNNING requires a matching runtime observation. Timeout or lost acknowledgment means outcome unknown and never triggers automatic resend. V0 implements no command ledger or command transport; it can demonstrate this rule with fixtures.

## 4. Data and usage contract

Keep a small normalized view model: project references, enrolled machine/session identities, observations, attention items, and account usage records. No transcript archive or generic event platform is needed.

| RecordMinimum contract    |                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enrollment                | Stable machine ID; user-visible label; adapter name/version; verified runtime-instance ID; source session ID; machine-local project/worktree binding; source of that identity proof. Phone receives opaque IDs and safe aliases, not absolute home paths.                                                       |
| Session observation       | Schema version; DEMO or IMPORTED\_SNAPSHOT mode; unique observation ID; instance and sequence; project/machine/session refs; raw status code and normalized state/reason; turn ID if available; source time if supplied; observed/received times; validity interval; evidence source; supported/missing fields. |
| Model/account attribution | Report actual observed session model, provider route, billing-account reference and their evidence times independently. Distinguish active from last-observed/configured-default. Missing identity stays null with a reason; do not infer account from provider name or default configuration.                  |
| Outcome/attention         | Identified turn/request, terminal outcome or unresolved request reason, observation time, resolution evidence, and local seen state. Test evidence needs command/check identity, result, relevant commit/worktree identity and time; otherwise say unavailable.                                                 |
| Usage                     | Provider/route, billing account/workspace reference, identity verification status, product scope, meter/bucket, window identity, metric/unit, value, source, observed/received time, supplied reset time or null, quality, unavailable reason, and estimate method when applicable.                             |

**Usage quality is independent of freshness:**

| QualityMeaning  |                                                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EXACT**       | Value faithfully supplied by an authoritative meter at the recorded time, at that source’s precision. It is not a promise of current availability or a number of future prompts. |
| **ESTIMATED**   | A value produced by an explicit permissible method or unverified manual transcription. Show method and coverage; do not present it as an account’s guaranteed balance.           |
| **UNAVAILABLE** | Supported access, value, account attribution, or meter scope is absent. Value is null and explanation is required. Reset may independently be unavailable.                       |

Tokens/cost, monetary credit balance, subscription allowance, and organization budget caps are different metrics. Never infer remaining subscription allowance from token counts or convert a credit balance to prompts. A complement of an authoritative percent-used observation may display percent remaining, labeled as derived from that reported percentage; never manufacture absolute requests remaining.
Use one canonical account key only after same-account/workspace identity is established. Key the current meter by **provider route + account/workspace + product scope + bucket + window kind**, retaining each observed reset/window instance. Four laptops reference the same record. Do not add primary and weekly windows together or count a legacy mirror as another allowance. Keep model-specific quotas separate. If identity is ambiguous, show unresolved account observations with no combined total.
Same-meter imports use the newest valid source observation, not the newest arrival. Equally current conflicting values produce an explicit conflict and no current allowance until resolved; never sum them. Retain an older value as historical when collection fails. On reaching a supplied reset, show `Reset time passed; refresh needed`; never replenish the allowance locally. Display fractional/rounded precision exactly as supplied. A last-known EXACT value can also be STALE.
**Small example record — every identifier, time, model, amount, and operational state below is invented demo data.** This illustrates one session referencing a shared meter; it is not an API response or evidence that an integration exists.

```
{
  "schema_version": "ryodev.observation.v0.1",
  "mode": "DEMO",
  "observation_id": "demo-observation-17",
  "source": "invented-fixture-v1",
  "instance_id": "demo-runtime-1",
  "sequence": 17,
  "source_time": null,
  "observed_at": "2026-09-06T14:00:00Z",
  "received_at": "2026-09-06T14:00:02Z",
  "valid_for_seconds": 60,
  "project_id": "demo-riff",
  "machine_id": "demo-aero",
  "session_id": "demo-session-1",
  "turn_id": "demo-turn-3",
  "execution": {
    "state": "WAITING",
    "raw_code": "demo_input_required",
    "reason": "input_required",
    "waiting_on": "user"
  },
  "connectivity": "UNKNOWN",
  "attribution": {
    "model": "invented-model-a",
    "provider": "invented-provider",
    "account_ref": "demo-shared-account-1",
    "source": "invented-fixture-v1",
    "observed_at": "2026-09-06T14:00:00Z"
  },
  "usage": {
    "account_ref": "demo-shared-account-1",
    "account_identity": "DEMO_VERIFIED",
    "provider": "invented-provider",
    "scope": "demo-subscription-account",
    "bucket_id": "demo-primary",
    "window_kind": "demo-fixed-window",
    "window_id": "demo-window-ending-1800",
    "metric": "remaining_allowance",
    "value": 38,
    "unit": "percent",
    "status": "EXACT",
    "source": "invented-authoritative-meter-fixture",
    "observed_at": "2026-09-06T14:00:00Z",
    "received_at": "2026-09-06T14:00:02Z",
    "reset_at": "2026-09-06T18:00:00Z",
    "valid_for_seconds": 300,
    "referenced_by_machines": ["demo-mac", "demo-dell", "demo-hp", "demo-aero"]
  }
}
```

The importer splits usage into its canonical shared record. The demo’s EXACT label exercises rendering only; DEMO remains visible at all times. Actual imported records cannot use a demo identity as verification evidence.

## 5. Current official integration evidence

Documentation checked **6 September 2026**. “Documented” means a published capability. **No Kilo, Codex, or OpenCode connection is locally proven by this planning task.** Installed versions, existing owner instances, safe attachment and real account coverage remain unknown.

| ToolDocumentedProposed use and unknowns |                                                                                                                                                                                                                                                                                    |                                                                                                                                                                                                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **OpenCode**                            | Existing TUI server; health, session metadata, and status reads. Status query covers all sessions. A separately started `serve` process is a new server. Authentication is optional and control endpoints share the API. [Server](https://opencode.ai/docs/server/)                | First candidate only if its existing owner interface is identified. Local filtering is required; never expose that API to the phone. No documented read-only role was established.                                                         |
| **OpenCode state/identity**             | SDK schema lists `busy`, `idle`, `retry`; session metadata lacks current model/account attribution. [Official SDK types](https://github.com/anomalyco/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts)                                                                      | Validate installed-version semantics. Proposed mapping: busy → RUNNING; retry → WAITING/retry; idle or missing → UNKNOWN unless separate explicit evidence supports more. Do not fetch message history for missing model/account.          |
| **Codex**                               | `thread/read` with `includeTurns:false` returns summary/status without resume or subscription. Runtime states include `notLoaded`, `idle`, `systemError`, and active flags. [Thread reads](https://learn.chatgpt.com/docs/app-server#read-a-stored-thread-without-resuming)        | Candidate only after proving access to the existing owning instance. Cross-process passive observation is unproven. Neither notLoaded nor idle proves done. Do not resume to make observation work; discard previews/titles.               |
| **Codex usage**                         | `account/rateLimits/read` reports percent used, window duration, reset timestamps and meter IDs; `rateLimitsByLimitId` supplies multiple buckets when present. [Rate limits](https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt)                                      | Account scope/availability must be proven. These reads require separate service-access review and are excluded from this V0 connection. Do not mirror the legacy bucket into a second allowance or treat Codex quota as all ChatGPT quota. |
| **Kilo**                                | Runtime can be daemon-attached, RPC-worker based, or editor-owned; directory context matters and can initialize runtime state. [Runtime architecture](https://kilo.ai/docs/contributing/architecture/cli-runtime)                                                                  | Do not assume every session has HTTP or that OpenCode contracts apply unchanged. Passive reads and initialization side effects require version-specific review.                                                                            |
| **Kilo usage**                          | CLI documents JSON session listing/profile and token/cost statistics. Billing distinguishes personal balances, organization pools, and BYOK. [CLI reference](https://kilo.ai/docs/code-with-ai/platforms/cli-reference), [billing](https://kilo.ai/docs/gateway/usage-and-billing) | A listing is not execution proof; statistics are not subscription allowance. No general remaining-allowance/reset schema was established. Do not invoke profile/billing calls under the current boundary.                                  |

Official documentation reviewed did not establish a universal subscription-allowance API across these tools. V0 must work with UNAVAILABLE usage and unknown account attribution. Future rich event adapters must separately establish pending-request snapshots, event completeness/replay, reconnect behavior, and metadata filtering before claiming waiting/done detection. Documentation alone is insufficient proof of those semantics on Ryo’s laptops.

## 6. Smallest first real connection

**Target:** one already-running **OpenCode** session on whichever laptop is first verified eligible, for a project other than the active RyoMap repair. The exact machine and session are not known yet. Do not assume the Mac is eligible or move/restart work to satisfy the plan.
**Delivery mode:** a manually refreshed, timestamped **imported snapshot**. This proves a real data path, not a continuous connection. Automatic multi-machine updates are a later milestone.

1. **Establish eligibility without touching active work.** In the later connection task, record the user-selected laptop, exact existing runtime/version/session, and project/worktree binding from supported metadata. No raw stores, process-wide scraping, port scanning, or secret discovery. If the address/identity cannot be established through a supported existing surface, the gate fails.
2. **Review the concrete connection contract in section 8.** Choose an already-approved user-controlled transfer route, if one exists. No route is assumed to be installed. If no such route exists, the phone delivery milestone waits; do not create infrastructure implicitly.
3. **Capture on deliberate user action.** A bounded foreground adapter reads only the enrolled owner’s reviewed `GET /global/health`, `GET /session/:id`, and `GET /session/status` subset. It extracts the selected status locally and emits one allowlisted record. The status map’s broader upstream scope requires explicit review; if unacceptable, this candidate cannot prove running state. [Endpoint definitions](https://opencode.ai/docs/server/)
4. **Minimize payload.** Export safe aliases, opaque identities, state/code, provenance, times, version and sequence. Drop titles, previews, prompt/message bodies, raw errors, filesystem paths, other sessions, environment/configuration, credentials and account secrets. Missing model, account, tests or usage stays unavailable. Stop after one snapshot; no watcher, timer, daemon, event stream or provider request.
5. **Import on the phone.** User deliberately transfers the bounded snapshot and selects it in the viewer. Validate enrollment, schema, size, timestamps, identity and ordering before replacement. Render with a permanent IMPORTED SNAPSHOT label. Reload does not refresh evidence. Demo and real observations use separate stores/views and never combine into attention counts, machine coverage or usage totals. If browser hosting/access is required for this route, it remains separately reviewed and is not presumed available.

This route adds no agent runtime server and never forwards agent-protocol requests from the phone. It can initially prove RUNNING or UNKNOWN; it need not pretend to support the demo’s richer waiting/done/account fields.
**Real-connection acceptance — all required:**

- User-visible identity matches the same already-existing session, laptop and project/worktree. Prove instance ownership; a historical session ID alone is insufficient. Read identity metadata before and after the bounded status capture; an instance/session mismatch invalidates it. Timestamp the state read itself, not the later export. If the source cannot bind a status to a specific turn, omit the turn ID and make no turn-level claim.
- Compare two deliberately captured snapshots with the owning tool’s visible state as it changes through normal work. The adapter causes no prompt, resume, restart, retry, approval or model activity. Use existing metadata evidence and reviewed operation behavior; do not open raw transcripts or inspect secrets to prove this. If zero provider traffic attributable to observation cannot be established, the gate remains unmet.
- Phone receives only the enrolled session’s permitted metadata. Reject an incorrect machine/session, additional records, unknown schema, oversized payload and unexpected fields. Proposed cap: 32 KiB and one session per import.
- Fresh RUNNING becomes stale/current UNKNOWN after 60 seconds; the observed time survives reload/import. Source idle alone never becomes DONE. Missing account/usage displays UNAVAILABLE.
- Source failure preserves the last observation and exposes the failed capture separately. No fabricated OFFLINE label. The initial manual route normally has UNKNOWN current connectivity.
- Same-source older/replayed imports cannot overwrite newer state. A runtime restart or identity conflict requires re-verification. Disconnect/forget disables that enrollment; no background work remains.

If an eligible owner interface, safe read path, or approved transfer route is missing, deliver the completed demo and mark **real connection not accepted**, with the exact unmet condition. Do not call a manually typed status or synthetic record a proven connection.

## 7. Prototype now, independent of RyoMap

The next implementation task can build the entire phone layout, expandable detail views, pure state/freshness derivation, canonical usage records, deterministic fixtures, and a **demo-only** import interaction. Use existing project conventions if found; otherwise a small static web frontend is sufficient. The first prompt excludes actual file ingestion of real telemetry until its contract is reviewed.
Fixture set: explicit running, input wait, retry wait, blocked failure, successful terminal turn, cancelled attempt, stale running, source idle, unreachable observation endpoint with appropriate proof, disconnected phone, unknown model/account, shared account across four machines, overlapping usage windows, missing reset, passed reset, conflicting observations, duplicate completion, and incomplete coverage. No runtime integrations, SDK clients, credentials, endpoint configuration, model calls or service workers belong in this prototype.
Necessary validation concentrates on state honesty, attention counts, shared-meter arithmetic and phone usability. No large generic testing framework is required. Acceptance: the screen answers “what needs me, where, and how fresh is that claim?” without opening a terminal; all labels can be traced to the fixture; a missing field cannot silently become positive evidence.

## 8. Reviewed contracts and deferred work

Before any real capture or import, review a short **Connection Contract v0.1** containing the actual selected values, not unresolved placeholders:

| Contract areaMust be settled |                                                                                                                                                                                                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ownership and enrollment     | Exact machine, runtime owner, version, project/worktree and session binding; supported proof mechanism; instance restart handling; revocation.                                                                                                                                         |
| Read boundary                | Exact methods, response schemas and field allowlist; bounded time/size; all-session upstream scope where relevant; no bootstrapping, writes, provider requests or transcript reads. The word GET alone is not proof of no side effects.                                                |
| Identity and integrity       | How a snapshot is tied to the selected enrollment and trusted transfer. Manual-file provenance is user-attested, not cryptographically authenticated unless the existing route proves it. The UI must preserve that distinction. A checksum alone does not establish the sender.       |
| Delivery and access          | Concrete already-approved private file/access route; who can read it; phone viewer origin and cache policy; no direct agent API exposure. No new credential storage or access grant is implied. If the route requires these, stop for a separate proposal.                             |
| Data lifecycle               | Latest sanitized observation only by default, short identified completion notices if needed; no raw response logging/analytics; explicit clear/forget; bounded retention and safe error codes. Proposed real import retention: memory only until deliberate replacement or page close. |
| Semantic verification        | Freshness/clock and sequence policy, supported status mapping, scope completeness, failure behavior, and observable non-interference checks. Unsupported evidence stays unknown.                                                                                                       |

**Wait beyond V0:** continuous/background observation; automatic discovery; provider/account allowance collection; event subscriptions; push notifications; remote authentication/storage; a new service, endpoint, tunnel or deployment; and any richer RyoMap connection. These require concrete reviewed contracts and separately authorized implementation.
**Session control is a separate later capability:** messaging/start/stop must identify machine + runtime instance + project/worktree + session + turn, show the intended action, require current identity/freshness, carry an idempotency key, and distinguish submitted, acknowledged, executing, terminal and unknown outcomes. Never resend an uncertain command automatically. Agent Station’s business decisions and approval authority remain with Agent Station. No automatic merge, deployment, release acceptance, arbitrary shell or architecture approval belongs in RyoDev V0.

## 9. Seven-day delivery plan

These are seven focused working days starting with a separately authorized implementation task. They are not a calendar commitment or permission to perform connection work. Days 1–4 proceed without RyoMap release acceptance. Days 5–7 depend on explicit connection review; unresolved gates remain visibly incomplete.

| DayConcrete deliverableDependencyAcceptance check |                                                                                                                                                                             |                                                                     |                                                                                                                                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1 — scope and fixtures**                        | Confirm existing RyoDev workspace or choose an isolated prototype directory; document reuse decision; implement normalized fixture model and semantic rules.                | This plan; existing workspace conventions if present.               | No RyoMap/product repository changes or remote repository creation. All requested states, unknown fields, and four-machine shared usage are represented with DEMO labels.                                    |
| **2 — useful phone screen**                       | Needs me → projects → machines → usage; inline detail expansion.                                                                                                            | Day 1 fixtures.                                                     | At 390 × 844, mode, attention and first project are visible; at 320px no horizontal scroll. Tapping a row identifies machine, reason, source and age. No operational controls.                               |
| **3 — truth and accounting**                      | Freshness clocks, conservative status mappings, attention deduplication, coverage and account/window deduplication.                                                         | Days 1–2.                                                           | At 61s running is stale/current unknown; importing identical data cannot refresh it. Submitted/idle cannot become running/done. Four laptops still show one shared 38% meter; passed reset never refills it. |
| **4 — demo acceptance and connection packet**     | Finish usable fixture prototype; record capability gaps; prepare concrete proposed Connection Contract for one eligible session if identifiable.                            | Day 3; read-only documentation and supported metadata availability. | Keyboard/touch/contrast checks pass. “All clear” never appears with missing coverage. Review packet names exact unresolved eligibility/transport facts; no real endpoint call occurs.                        |
| **5 — gate, then one local snapshot**             | Obtain separate connection authorization after concrete contract review. If granted, implement only the selected foreground capture subset.                                 | Accepted connection contract and eligible existing owner interface. | Same session and runtime; no lifecycle change, credential/transcript capture, other-session export or provider traffic attributable to capture. If any is unproven, keep connection gate incomplete.         |
| **6 — phone import**                              | Deliver one real sanitized snapshot through the approved route; validate and show in the same viewer.                                                                       | Day 5 pass; reviewed access/import contract.                        | Phone labels actual capture time and IMPORTED SNAPSHOT; known metadata matches source; unsupported identity/usage remains unavailable; no runtime API access from phone.                                     |
| **7 — trustworthy connection acceptance**         | Repeat one manual capture during naturally changed source state; exercise stale/error/replay/forget cases; produce concise acceptance record and remaining capability gaps. | Day 6 pass.                                                         | Every section 6 check passes; no RyoMap changes; prototype and real-connection acceptance are recorded separately. If blocked, report the exact failed gate and keep the working demo usable.                |

The successful V0 outcome is one useful screen plus one proven, deliberately refreshed observation path. Four-laptop continuous management, comprehensive allowance tracking, and session control are explicitly later outcomes.

## 10. Copy-ready first implementation prompt

Copy this into a new implementation task, with this plan attached:

```
Implement RyoDev V0's FAKE-DATA PHONE PROTOTYPE ONLY, using the attached
RyoDev-V0-Implementation-Plan.md, especially sections 2–4 and 7.

First inspect the selected workspace's instructions and existing RyoDev work,
if present. Reuse its conventions. If none exists, use a small isolated local
prototype directory outside RyoMap and the product repositories; report the
chosen path. Do not create a remote repository, backend, deployment, or account.

RyoMap's ranked-evidence consumption-contract repair is still unaccepted.
Do not modify, invoke, upgrade, merge, test, or otherwise interfere with it.
The inspected boundary reference is rdilaz/ryomap commit
d1a7b81805ad36092c3737d5927c9070c66f84a7, docs/ryodev-extension-boundary.md.
That reference is documentation grounding, not release acceptance.

Build one responsive screen: Needs me, projects, machines, shared usage.
Show a permanent DEMO — invented data label. At 390×844, show the mode,
Needs me and first project without scrolling; support 320px without horizontal
scroll. Use accessible touch targets, text status labels and inline details.

Implement separate execution, freshness, connectivity and acceptance facts.
Submitted is not running; idle is not done; stale is not offline. At 61 seconds
an active observation becomes stale/current unknown, retaining last-seen state.
Never refresh source time on reload or duplicate import. Keep identified
historical completion separate from current session state and release acceptance.

Usage requires account/provider, scope, meter/window, source, observed time,
reset when supplied, and EXACT/ESTIMATED/UNAVAILABLE. Null is not zero.
Four machines referencing one account must not multiply its allowance.
Never derive subscription allowance from tokens or refill on reset locally.

Include the fixture cases from section 7 and a deterministic time control for
review. Keep demo imports fixture-only: no real telemetry or arbitrary file
ingestion yet. No session discovery, runtime adapter/SDK, provider calls,
credentials, configuration changes, event streams, observers, remote shell,
public endpoint, tunnel, service worker, messages, starts/stops, approvals,
merges, or deployments. Agent Station retains its own authority.

Verify meaningful semantic cases and phone layout, using the existing project's
test tools where available. Do not add a generic plugin platform or local model.
Deliver the inspectable prototype, concise checks/results, exact files changed,
and remaining connection gates. Stop before any real connection. Say explicitly
that data is invented and no real session is connected. Do not mark the full
RyoDev V0 accepted merely because the prototype passes.
```

Only this plan was produced in the planning task. No development, deployment, runtime connection, model/billing API request, account change, or release acceptance was performed.