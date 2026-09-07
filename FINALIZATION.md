# RyoDev final review handoff

The visual design is ready to retain. Small source corrections and an installable offline Android preview have been prepared. **This is a final review candidate, not full V0 acceptance.** The corrected browser suite and physical Android checks are still open.

## Changes

1. Renamed the unseen-completion counter from “to review” to “new result(s)”. Seen markers can no longer imply that review has happened. Cards still say “review pending”.
2. Required `waiting_on === 'user'` before an input/approval notice takes precedence as “Waiting for you”. Runtime/dependency waits keep their correct label and do not create user attention.
3. Added a persistent, accessible notice when viewer choices cannot be saved/restored; ordinary success messages cannot overwrite it. Reload may lose choices but cannot redate evidence.
4. Made the paused clock show its actual UTC calendar date when advanced across midnight.
5. Ensured browser-test cleanup closes its owned server even if browser launch fails.
6. Added an offline Android wrapper with an exact six-resource allowlist, no permissions, no network fallback and no native JavaScript bridge. Independent review also hardened its builder against deleting an unrelated work directory.

The original model tests remain intact; one focused regression was added (36 total). Three focused browser regressions were added (17 groups total). No visual redesign, frontend framework or polling was added. The original plan, connection gate, fixtures, CSS and artwork are unchanged. RyoMap remains separate and its release unaccepted. Agent Station retains its own decisions and approval authority.

## Evidence and open gates

| Area | Current evidence | Remaining check |
|---|---|---|
| Model | 36 tests passed; independent source review | None identified within this fixture review |
| Browser | New tests added; launch failed cleanly because Edge was absent | Run `npm run check` on the existing Edge laptop; inspect regenerated 390/320/desktop images |
| Visual/accessibility | Ten supplied screenshots and earlier Windows report retained as historical evidence | Recheck current source; real zoom/live screen reader remain untested |
| Android | Built, routing tested, signature/alignment verified, zero permissions and six bundled asset hashes verified | Actual installation, cold launch, rendering, insets, text scaling, Back and TalkBack |
| Real connection | Original gate unchanged | Reviewed eligible session, read contract and private transfer/viewer route; no connection activity was performed |

The browser tool returned `ERR_BLOCKED_BY_CLIENT` for the loopback URL. The standard test-browser download failed with timeouts/502s. No endpoint/tunnel or weakened protection was introduced to work around this. The updated browser groups did not execute; the previous 14-group pass and 765 contrast samples/5.73:1 minimum are historical results.

## Apply on your laptop

The corrected full source is under `source/` in the review ZIP. A narrow `RyoDev-Finalization.patch` is beside it, intended for the uploaded baseline associated with `f3b721a`. It was checked against a separate baseline copy and compared with the corrected files. No access to `C:\dev\ryodev` occurred here.

Extract the review ZIP to a separate review folder. In PowerShell, substitute the actual extracted patch path:

```powershell
cd C:\dev\ryodev
git status --short
git apply --check 'C:\path\to\RyoDev-Finalization.patch'
git apply 'C:\path\to\RyoDev-Finalization.patch'
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

Review local changes first. Do not reset, overwrite or discard newer work to force the patch to apply. If the patch check fails, reconcile against the full source. There is no automatic merge, commit, push or deployment. After tests pass, inspect regenerated screenshots and record the tested commit/browser versions. The APK already contains the same frontend source in this package; rebuilding is unnecessary just to try it.

Node 22+ is required. The sole dev dependency remains pinned `playwright-core` 1.63.0. Browser tests use installed Edge by default; dependency setup with ignored scripts does not download a browser. An already installed supported alternative can be selected with `RYODEV_BROWSER_CHANNEL` for that terminal, for example `chrome`. Do not change the lockfile merely to bypass a missing browser.

Run `npm start` for a foreground loopback preview, then open `http://127.0.0.1:4173/` on that laptop. Ctrl+C stops this preview. Do not stop unknown processes if the port is occupied. An optional `npm run preview:browser` opens an isolated installed Edge window; closing it stops that browser separately. Old handoff sidebar entries may no longer exist.

## Android finish check

Open the separately supplied APK on your Android device. Confirm the installed name is **RyoDev Demo** and the invented-data label is visible. Keep Android's normal security checks enabled. Minimum declared OS is Android 8.0 with a sufficiently current Android System WebView. The development certificate is for this preview; its private key is not distributed. A separately rebuilt certificate requires uninstall/reinstall rather than an in-place update.

Cold-launch in airplane mode, expand evidence, try a stale request and conflicting usage, enlarge text, rotate, switch apps and return, and test TalkBack/Back navigation. Record Android and WebView versions. Android system bars reduce the available viewport, so the earlier 390×844 browser fold measurement is not a promise about every phone.

See [android/README.md](android/README.md) for device checks, verified official documentation and the SDK rebuild procedure. A successful device check accepts only this offline demo delivery. It does not connect computers or accept real RyoDev V0. The source archive excludes dependencies, Git data, SDKs, caches, logs and the temporary signing key.

## Copy-ready Kilo finish prompt

```text
Finish the bounded RyoDev review in C:\dev\ryodev using RyoDev-Final-Review.zip and its RyoDev-Finalization.patch. Preserve the approved navy/pearl design and dimensional artwork. Read source/FINALIZATION.md, source/README.md and the unchanged CONNECTION-GATE.md. Inspect git status and HEAD; do not assume f3b721a is still current.

Apply the patch only after git apply --check succeeds and you have accounted for local edits. Reconcile overlapping newer work; never reset/discard it or overwrite the original plan. Run npm ci --ignore-scripts --no-audit --no-fund and npm run check using installed Edge. Expected size: 36 model tests and 17 browser groups. Do not skip/weaken checks. Fix only reproduced finalization defects; rerun affected checks and the final required gate.

Inspect current 390x844, 320x844 and desktop screenshots: attention/first project, seen completion retaining review pending, persistent storage-failure notice, next-day UTC clock, stale requests and usage conflicts. Distinguish historical images from new evidence. Do not claim Android rendering from desktop tests. The supplied APK is built and static-verified; if web assets change, rebuild using android/README.md and compare all six bundled hashes. Preserve its offline zero-permission boundary.

Report checks, changed files, source/APK hashes and unresolved physical Android checks briefly. Prepare a review package excluding dependencies, caches, SDKs, logs and signing keys. No automatic merges, commits, pushes, deployments, approvals, endpoints, tunnels, connections, observers, credentials, provider calls or session control. Do not touch RyoMap closure or Agent Station authority. Real connection and full V0 remain unaccepted.
```
