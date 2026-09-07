# RyoDev Demo

Read [FINALIZATION.md](FINALIZATION.md) for the current publication scope. The
complete corrected source was restored in `C:\dev\ryodev`; **do not apply
RyoDev-Finalization.patch**. Its original 36 model tests and 17 browser groups
passed in installed Microsoft Edge before publication changes. Eight additional
model regressions cover reproduced import edge cases. No original test was removed.

**Invented data only. No real sessions connected.** The visual fixture prototype
uses an original dimensional workstation, compact status rows and inline evidence.
This is not full RyoDev V0 acceptance or completed phone management. The original
plan and [real-connection gate](CONNECTION-GATE.md) are unchanged.

## iPhone Web App

Publication URL: **https://rdilaz.github.io/ryodev/**.

1. Open that exact HTTPS URL in Safari on the iPhone.
2. Use Safari's Share menu, then **Add to Home Screen**.
3. Keep **Open as Web App** enabled if Safari offers it, retain the name
   **RyoDev Demo**, and tap **Add**.
4. Launch the new navy/pearl icon and confirm the permanent invented-data label.

The app has a relative-scope manifest, original 180px Apple touch icon and 192/512px
app icons. Portrait and landscape are supported, with safe-area padding around
the status bar, display cutouts and home indicator. Device Safari installation and
rendering require this physical iPhone check; desktop Edge emulation is not Safari.
The manifest deliberately omits `id` so its identity defaults to the resolved
project-relative `start_url`, not the shared `github.io` origin root.

No service worker or offline cache is installed. Opening/reloading requires access
to the static website. Scenario, paused clock and seen markers stay in that browser's
local storage only; Safari and a Home Screen app may use separate storage. There
are no cookies, analytics, telemetry, accounts, external fonts or application API
requests. Storage failure remains visible, and seen results remain review-pending.

## Static Publication

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run build
npm run verify:live
```

On Windows with blocked PowerShell npm scripts, use `cmd.exe /d /c "npm run check"`
(and the same launcher for the other commands), without changing execution policy.

`npm run build` recreates `dist/` from the explicit 12-file list in
`scripts/static-files.mjs`, with unchanged bytes and normalized timestamps/modes.
It rejects linked source files and never copies entire directories. The artifact
contains only `index.html`, four `src/` JS/CSS files, workstation artwork, manifest,
four icon files and `.nojekyll`. No documents, tests, screenshots, Android files,
plans, patches, Git history, credentials, caches, logs or source maps are published.
`npm run icons` is a maintainer-only local Edge rasterization command; deployment
copies the reviewed PNGs and does not regenerate them.

`.github/workflows/pages.yml` runs the entire gate in installed Edge on Windows,
then stages the artifact. Only `main` can upload/deploy it. Official Pages actions
are pinned to current release commits. Build has only `contents: read`; deployment
has only `pages: write` and `id-token: write`. Production deployments are serialized.
Configure the repository's Pages source as **GitHub Actions**, not a source branch.

The static meta CSP blocks connections, objects, frames, workers, forms and inline
scripts/styles. GitHub Pages cannot supply arbitrary response headers: unsupported
`frame-ancestors` is intentionally absent from meta, but remains a preview header.
All app references are relative, so `/ryodev/`, the local preview and the Android
wrapper's existing six application resources keep working. Optional web manifest
and favicon metadata do not expand Android's separate native asset allowlist;
no Android rebuild, new APK or physical Android acceptance is claimed here.

GitHub Pages is only the public invented-data demo host. It must not become a
transport for private machine/session status. That requires a separately reviewed
private connection and viewer contract. RyoMap's unaccepted release state and
Agent Station's separate authority are unchanged.

## Run And Stop

Workspace: `C:\dev\ryodev`. Run commands in that directory. Tested here with Node
24.19.0, npm 11.17.0 and installed Microsoft Edge 152.0.4191.66. No frontend
compilation is needed; `npm run build` only stages public files.

```powershell
npm start
```

Open **http://127.0.0.1:4173/** on this laptop. The static preview binds only
`127.0.0.1`, exposes only the public allowlist and document aliases, disables caching and
blocks application network connections/workers with CSP. No backend serves data.
This laptop-local address is **not reachable from a physical phone**.

For a terminal launch, Ctrl+C stops the preview; run `npm start` to reopen it.
Do not start a second copy on the same port. No persistent service is installed.

The handoff preview uses only these named, session-lifetime background entries:

| Entry | Sidebar Label | Stop / Reopen |
| --- | --- | --- |
| `node scripts/preview.mjs` | RyoDev polished demo preview | Stop / Restart this entry only |
| `node scripts/open-browser.mjs` | RyoDev polished demo, isolated Edge | Stop / Restart this entry after the server is ready |

Session closure/group changes can remove these temporary entries. Reopen with
the commands above/below if no entry remains; do not reuse an old PID, kill an
unknown listener or start a second server. The automated browser suite verifies
that its owned loopback server stops, refuses connections, releases its port and
reopens at that same address. Only RyoDev-owned processes are managed.

The embedded Browser panel returned `Browser session does not belong to the
requested project or directory`. An isolated visible Edge window was opened
instead, at a 390x844 page viewport, without using an existing browser profile or
account. After installing the test dependency, this fallback can be reopened with:

```powershell
npm run preview:browser
```

Close that isolated window to end its browser process. The static preview remains
separately owned. Opening the address in a regular browser also permits normal
window resizing for desktop inspection.

## Demo Review

- The sticky demo label remains visible after scroll and while Demo lab is open.
- Expand **Demo lab** for 30 known scenarios, `+61 seconds`, `+5 minutes`, fixture
  reimport and explicit demo reset. These are not session controls.
- The clock is deliberately paused at an invented UTC instant. Advancing it
  recalculates ages locally; no timer observes or polls anything.
- Reload preserves the scenario, demo clock and local seen markers. These are
  the only localStorage values; fixture observations are reconstructed unchanged.
  Explicit reset/scenario selection restarts the invented clock. Storage-disabled
  browsers cannot retain viewer choices, but never redate fixture evidence.
- Expand attention, projects, machines or meters in place for evidence and exact
  UTC/local timestamps with timezone. Seen is local only, never approval/resolution.
- Request coverage, execution, evidence age, connectivity, terminal history and
  release acceptance are separate. Unknown coverage is never an all-clear.
- Session/reachability validity is 60 seconds inclusive; usage is 300 inclusive
  or shorter. Replay never renews evidence. Shared meters require verified
  identity and matching scope/window. Missing stays null, conflicts have no
  current allowance, and reset expiry never replenishes anything locally.

## Checks

The application and state tests have no runtime dependencies. `playwright-core`
1.63.0 is the only dev dependency, pinned in the lockfile; it uses installed Edge
and does not download a browser or upgrade shared tools.

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run test:browser
npm run check
```

`npm run check` runs **44 deterministic model tests, all 17 original browser-check
groups, and 15 deployment groups**. Node counts enclosing browser tests as additional
tests. No skipped tests. State tests use an explicit clock, not wall-clock sleeps.
Browser tests create/close their own isolated browser and temporary loopback
static server on an OS-assigned port, so the handoff preview is not disturbed.

Coverage includes exact freshness boundaries, reload/replay/heartbeat behavior,
ordering and clock faults, explicit outcomes vs idle/submission, attention
deduplication/resolution, shared-meter identity, overlapping windows, decimals,
null/zero/conflicts, failed collection and reset expiry. Browser checks cover all
30 scenarios at 320px with details expanded, persistent demo labels, keyboard
operation, native disclosure accessibility, visible focus, 44px targets, 200%
text enlargement, reduced motion, forced colors, no-blur and failed-art fallbacks.
They also verify the resource allowlist, SVG safety/size, no application API
calls/workers, and server stop/reopen restrictions. Deployment tests exercise the
actual staged files beneath `/ryodev/`, meta-only CSP, icon validity, deterministic
staging, safe areas and the publication boundary. No cases were skipped or removed;
all fixtures and original model assertions are retained.

Contrast checks temporarily hide text without changing geometry, decode the
browser screenshot and compare its actual background pixels with the original
text color (including alpha). The reviewed pass sampled 765 points, with minimum
normal-text contrast **5.73:1**; UI/focus checks retain **3:1**. This replaces the
old nearest-ancestor RGB approximation. See [DESIGN-REVIEW.md](DESIGN-REVIEW.md).

The browser test regenerates these five primary review PNGs in `screenshots/`:

| Inspected Image | Capture |
| --- | --- |
| [Phone 390](screenshots/phone-390.png) | 390x844; mode, Needs me and complete first project without scrolling |
| [Phone 320](screenshots/phone-320.png) | 320x844; no horizontal scrolling |
| [Desktop](screenshots/desktop-1440.png) | 1440x1000 viewport, full-page capture |
| [Stale request](screenshots/stale-request-390.png) | 390x844; last-seen unresolved, separate count |
| [Usage conflict](screenshots/usage-conflict-390.png) | 390x844, scrolled; no current allowance and mode still visible |

Five supplemental captures cover expanded evidence, 200% text at 320px, forced
colors, no blur and artwork failure. All ten actual PNGs were opened and visually
inspected. Enlarged text may scroll vertically; information is not hidden to
preserve the default fold.

Screenshots document layout, not state correctness. Windows Edge is tested;
iOS/Safari, other engines, physical-phone delivery, browser-level zoom, and a live
screen-reader session were not tested. The 200% test enlarges root text, and the
accessibility check inspects Edge's native tree; neither claims those environments.

## Implementation And Boundary

This publication builds on restored, tested baseline `13cb3fc`. It retains plain
HTML/CSS/ES modules, pure state derivation, Node's test runner and the existing
dependency lockfile. No framework, component library or live 3D engine was added.

- `src/model.js`: normalized fixture validation, ordering and pure view derivation.
- `src/fixtures.js`: known, deterministic invented records and scenarios.
- `src/app.js`, `src/styles.css`, `index.html`: one responsive, read-only screen.
- `assets/workstation.svg`: original static, decorative four-computer artwork.
- `scripts/preview.mjs`: temporary static-file preview only.
- `scripts/open-browser.mjs`: isolated visible-browser fallback only.
- `tests/`: focused model and real-browser verification.
- [CONNECTION-GATE.md](CONNECTION-GATE.md): known facts and unresolved later gate.

No arbitrary file import, endpoint configuration, runtime discovery, transcripts,
provider/billing access, credentials, SDK adapters, background observation,
notifications, service worker, approval or remote control is implemented. No
RyoMap, Riff, Agent Station or visualizer repository/environment was inspected or
modified. The coding session itself is not zero model usage.

The source repository and Pages artifact are intentionally different: review
documents and tests belong in the repository, never in the public `dist/` artifact.
Historical design and Android build reports remain in their separate documents;
they do not establish acceptance of current physical-device behavior.

Original plan SHA-256:
`FF4A60CF1DA8D96C05A37CCED964EE88F0A56A36B11623190ACFEA09E86E66DD`.
