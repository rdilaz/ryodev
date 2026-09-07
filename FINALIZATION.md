# RyoDev Demo Finalization

The accepted target is the polished, public, invented-data visual demo, not full
RyoDev V0 or a real connection. Preserve the navy/pearl interface, dimensional
four-computer artwork, Needs me, Projects, Machines, Usage and all 30 scenarios.

## Restored Baseline

The complete corrected source was already restored in `C:\dev\ryodev`.
**Do not apply RyoDev-Finalization.patch.** The earlier review-package patch
instructions are superseded by this restored source and its Git history.

Every restored file was inspected. Before publication edits, the requested
dependency installation and full gate passed in installed Microsoft Edge:
**36 model tests and 17 browser groups**, no skips. All ten regenerated review
PNGs were opened, including 390x844, 320x844 and 1440px desktop. There was no
horizontal overflow; 765 rendered contrast samples retained a 5.73:1 minimum.
The clean invented-demo baseline is commit `13cb3fc`.

The original plan bytes remain unchanged. SHA-256:
`ff4a60cf1da8d96c05a37cced964ee88f0a56a36b11623190acfea09e86e66dd`.

## Publication Changes

- Relative document/assets and a standalone `RyoDev Demo` manifest work beneath
  `/ryodev/`, without root-relative application URLs or a base element.
- Original Apple touch/app icons and all four safe-area insets support the iPhone
  Home Screen presentation, without changing theme color or locking orientation.
- A static meta CSP disables application connections, objects, frames, workers and
  form actions. There is no service worker, telemetry, API, cookie or third-party code.
- `npm run build` stages exactly 12 public files into a clean `dist/`. No developer
  documents, tests, screenshots, Android package/source, credentials or maps deploy.
- The official, release-commit-pinned GitHub Pages workflow runs the full test gate
  before staging/upload, deploys only from `main`, minimizes permissions and serializes
  production deployment. Pages must use the GitHub Actions publishing source.
- Eight additional model tests reproduce and protect three narrow import fixes:
  reject null request entries without throwing; order tied usage evidence by actual
  observation time, never receipt, with shorter validity for exact ties; require
  current coverage before omission resolves a pending request. The original 36
  model tests, 17 browser groups, 30 scenarios and all original assertions remain.

The permanent invented-data label and "No real sessions connected" remain present.
Seen is local only, never approved or accepted; finished results stay review-pending.
Runtime/dependency waits are not "Waiting for you". Storage failures remain visible,
and reload never changes evidence timestamps. RyoMap remains release-unaccepted;
Agent Station retains its own decisions and approval authority.

## Verification And Devices

Run `npm ci --ignore-scripts --no-audit --no-fund`, then `npm run check` and
`npm run build`. `npm run verify:live` compares the live HTTPS assets with the local
public files and checks the actual page in isolated Edge. See [README.md](README.md)
for the staging boundary, screenshot coverage and Safari Add to Home Screen steps.

The source dependency remains pinned `playwright-core` 1.63.0; tests use installed
Edge, not a downloaded replacement. Physical iPhone installation/Safari rendering,
live screen-reader use and Android installation are separate device checks. No new
APK or Android-wrapper modification is part of this publication; its optional web
metadata is not a prerequisite for the six-resource native demo.

GitHub Pages must not become the future transport for private machine/session data.
The unchanged [CONNECTION-GATE.md](CONNECTION-GATE.md) still requires a separately
reviewed private connection and viewer contract. No real sessions, runtime adapters,
machine observers, messaging, user inputs or remote controls were added.
