# RyoDev Phone Prototype — final review candidate

**Finalization update:** Read [FINALIZATION.md](FINALIZATION.md) first. This package
fixes four small correctness/UX issues, hardens test cleanup, and adds an offline
[Android preview](android/README.md). The approved design is retained. The original
plan and connection gate are unchanged; full V0 and its connection remain unaccepted.

Current verification: **36 model tests passed**, with no skips. Android routing,
signature/alignment, zero-permission and six-asset byte checks passed, with independent
source review. **Updated browser and physical Android checks remain open.**
`npm run check` failed at browser launch because Edge is absent here. Browser tooling
blocked the loopback preview and the Chromium download failed. The updated suite has
17 browser groups, but none ran here. Do not reuse the earlier browser pass claims.

The separate `RyoDev-Demo-preview.apk` is a development-signed local demo, named
**RyoDev Demo**, with no Internet permission or laptop dependency. It has not been
installed on a physical device here. See the Android README for installation,
rebuilding and signing/update limitations.

The supplied screenshots and all text below this divider are the **historical
design-stage handoff** associated with reported commit `f3b721a`. They do not describe
these final fixes or Android rendering. The Windows checkout was not accessed or
modified; no preview is claimed to be currently running on that laptop.

---

**Invented data only. No real sessions connected.** The visual fixture prototype
uses an original dimensional workstation, compact status rows and inline evidence.
This is not full RyoDev V0 acceptance or completed phone management. The original
plan and [real-connection gate](CONNECTION-GATE.md) are unchanged.

## Run And Stop

Workspace: `C:\dev\ryodev`. Run commands in that directory. Tested here with Node
22.18.0, npm 10.9.3 and installed Microsoft Edge. No frontend build is needed.

```powershell
npm start
```

Open **http://127.0.0.1:4173/** on this laptop. The static preview binds only
`127.0.0.1`, exposes six exact application/asset routes, disables caching and
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

`npm run check` runs the complete suite: **35 deterministic model tests and 14
browser-check groups**, all passing. Node counts the enclosing browser test as
an additional test. No skipped tests. Tests use an explicit clock, not sleeps.
Browser tests create/close their own isolated browser and temporary loopback
static server on an OS-assigned port, so the handoff preview is not disturbed.

Coverage includes exact freshness boundaries, reload/replay/heartbeat behavior,
ordering and clock faults, explicit outcomes vs idle/submission, attention
deduplication/resolution, shared-meter identity, overlapping windows, decimals,
null/zero/conflicts, failed collection and reset expiry. Browser checks cover all
30 scenarios at 320px with details expanded, persistent demo labels, keyboard
operation, native disclosure accessibility, visible focus, 44px targets, 200%
text enlargement, reduced motion, forced colors, no-blur and failed-art fallbacks.
They also verify the six-route resource allowlist, SVG safety/size, no application
API calls/workers, and server stop/reopen restrictions. No cases were skipped or
removed; the original model, fixtures and model tests were not changed.

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

This revision builds on verified clean baseline `d1fe5f7`. It retains plain
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

The local source-only review archive is
`C:\dev\ryodev\RyoDev-Prototype-Review.zip`. It is made from the verified local
commit with `git archive`; it includes source, original assets, tests, lockfile,
plan, README, design note, connection checklist and screenshots, not `.git`, dependencies, caches, logs or
credentials. No remote was created and nothing was pushed or deployed.

Original plan SHA-256:
`FF4A60CF1DA8D96C05A37CCED964EE88F0A56A36B11623190ACFEA09E86E66DD`.
