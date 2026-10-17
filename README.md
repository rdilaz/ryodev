# RyoDev

RyoDev is a phone-oriented web dashboard for hook-reported AI coding-session
status. It includes an always-invented demo and an opt-in live mode for a
Cloudflare Worker that you deploy yourself. It is a status viewer, not a
remote-control surface, transcript collector, or live provider-backed usage
meter.

- [Public demo (invented data)](https://rdilaz.github.io/ryodev/)
- [Live-mode setup](docs/LIVE-SETUP.md)

## What it does

The demo makes its boundary explicit: every project, machine, account,
timestamp, and status is invented. It is useful for reviewing the display and
the dashboard's evidence rules without connecting to a machine.

Live mode accepts small hook events and shows their latest state:

```text
Claude Code / Codex hook -- POST /api/events --> Cloudflare Worker + Durable Object
                                                     |
phone-oriented web view <-- GET /api/state -----------+
```

- Claude Code maps supported lifecycle events to status updates. Codex currently
  reports `agent-turn-complete` as a finished turn; it is not full real-time
  Codex telemetry.
- The Worker uses separate bearer capabilities: `INGEST_TOKEN` for event POSTs
  and `VIEW_TOKEN` for reading or clearing the view. These are separate
  credentials, not user accounts or RBAC.
- Events are size-bounded and schema-validated. A late event is retained in the
  event log but cannot roll a newer session state backward.
- The hook sends a machine label, project-folder basename, state, time, and a
  12-hex-character SHA-256-derived session fingerprint. Its automatic Claude
  Code and Codex inputs do not send raw session IDs, prompts, code,
  transcripts, commands, or replies. Optional detail, including manual
  `--detail`, is compacted and recognizable absolute, home-relative, drive,
  and UNC paths are redacted; do not use manual detail for sensitive text.
- Hooks report events, not heartbeats. In live mode, a running session becomes
  **Quiet** after 20 minutes without an update; Quiet is never presented as
  offline or finished.

The Android directory is an offline demo wrapper, not the live application.

## Run locally

Requires Node.js 22 or newer.

```sh
npm ci
npm start          # static demo at http://127.0.0.1:4173
npm test           # model, live-view, Worker, and hook tests
npm run test:browser
npm run test:deployment
npm run check      # all of the above
npm run build      # writes the allowlisted static demo to dist/
```

Browser tests use Microsoft Edge in CI. On another Chromium-based browser, set
`RYODEV_BROWSER_PATH=/path/to/browser` before running the browser or full
check command.

`npm run verify:live -- https://your-pages-host/ryodev/` verifies a deployed
static demo against the checked-out public files. It does not deploy anything.

## Live-mode limits and setup

The public GitHub Pages site serves invented data only. Live mode requires a
separate Worker deployment, its own tokens, and a browser opened at that
Worker's origin. See [the setup guide](docs/LIVE-SETUP.md) before installing a
hook: the installer writes a local configuration file and can update Claude
Code or Codex settings after making backups.

The repository intentionally ships without a configured custom-domain route or
deployed live instance. A custom domain and optional `BASE_PATH` mount are
per-deployment choices; a non-obvious path is not access control, so protect
the API with the two tokens.

## Test scope

The tests cover malformed and oversized events, separate ingest/view tokens,
late-event ordering, session fingerprinting and redaction, quiet live sessions,
and safe behavior when a hook cannot reach the hub. The demo's 30 scenarios
exercise additional evidence semantics such as stale observations and
conflicting usage readings. These are fixture and mock tests; they are not a
claim that a deployed Durable Object or a provider backend has been tested in
every failure mode. The checked-in screenshots are generated from invented
fixture data; `connected-390.png` uses a mocked Worker response.

## Layout

| Path | Purpose |
| --- | --- |
| `src/` | Demo model, fixtures, UI, and live-view derivation |
| `worker/` | Cloudflare Worker, Durable Object, validation, and retention logic |
| `hooks/` | Dependency-free machine hook and opt-in installer |
| `tests/` | Node and browser checks, including fixture boundaries |
| `docs/LIVE-SETUP.md` | Live deployment and removal instructions |
| `android/` | Offline demo wrapper and packaging notes |
| `docs/history/` | Archived planning and review material, kept as provenance |

## Release note

No license file is currently included. Choose and add an appropriate license
before distributing derivative work or inviting external reuse.
