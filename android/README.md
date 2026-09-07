# RyoDev Demo for Android

This is an **offline, invented-data preview** of the same RyoDev web screen. It bundles the frontend directly into an APK and does not connect to any laptop or session. A successful APK build does not accept the real connection or full RyoDev V0.

The preview is named **RyoDev Demo**, application ID `dev.ryodev.demo`, version `0.1-preview` (1). Its package identity is deliberately separate from a future live application. Minimum OS: Android 8.0 / API 26; target and compile API: 36. The installed Android System WebView must support the web app's modern JavaScript and CSS. OS eligibility is not a device compatibility claim.

## Try the supplied APK

1. Copy `RyoDev-Demo-preview.apk` to your Android device and open it there. Android may ask you to allow installation from the specific file/browser app you used. Keep the normal platform security checks enabled.
2. Confirm the installed name is **RyoDev Demo**. Open it and confirm the permanent invented-data label.
3. Turn on airplane mode, close the app and reopen it. The full demo should still load; it does not require your laptop, port 4173, a tunnel or a hosted website.
4. Try a scenario, its expanded evidence and larger Android text. Use **Reset demo** to clear the demo's locally saved scenario, clock and seen markers. Android's Clear storage or uninstall also removes local demo state.

Installation, actual Android WebView rendering, airplane-mode launch, system-bar insets, text scaling, gesture/three-button Back and TalkBack have **not been tested in the build environment**. Those are the remaining acceptance checks for Android. The supplied APK is suitable for this hands-on preview, not a claim of a reviewed production Android release.

Normal Android Back returns to the previous task/home; the wrapper does not inject JavaScript to turn Back into a web-panel control. In the page, tap Demo lab again to close it. Rotating/recreating the activity reloads the fixture UI using its saved scenario, clock and seen markers; open disclosures and scroll position are not promised to persist.

## What is packaged and how it stays offline

Only these six web files are copied into the APK, byte-for-byte, at build time:

- `index.html`
- `src/app.js`
- `src/model.js`
- `src/fixtures.js`
- `src/styles.css`
- `assets/workstation.svg`

`AssetPolicy.java` maps six exact HTTPS paths to those six APK assets and explicit MIME types. The starting origin is `https://appassets.androidplatform.net/index.html`. This is a WebView interception origin, **not a DNS server, endpoint, local socket or private transfer route**. Android documents HTTPS in-app content and request interception for this purpose. The wrapper uses the platform `WebViewClient.shouldInterceptRequest` callback with a fixed allowlist rather than importing a generic asset-routing library. No arbitrary path is resolved. A missing or nonallowlisted resource gets a local 404/403 response; it never falls through to the network. The Java routing tests cover authority spoofing, user-info, explicit ports, encoded paths, traversal, queries, unsupported schemes and source-file navigation.

Additional controls:

- **Zero manifest permissions**, including no `INTERNET`, storage, camera, microphone, notifications or location permission.
- No JavaScript-to-native bridge, `addJavascriptInterface`, native message listener, injected JavaScript, runtime integration, intent-driven URL, download handler, file picker or external navigation.
- Application and WebView debugging explicitly disabled, including for the development-signed build.
- Network loads, service-worker requests, cleartext traffic, file/content access, universal file access, mixed content, cookies, geolocation, autofill and automatic new windows disabled.
- Every bundled response receives restrictive CSP, no-store, nosniff and no-referrer headers. Main-frame navigation is limited to the one HTML document and its fragments.
- No background service, scheduled work, observer, receiver, provider, credentials, telemetry, billing reads, release signing key or native shared storage.
- Normal Android text scaling and pinch zoom remain enabled. System bars, cutouts and keyboard insets protect content. The OS's normal Back behavior remains enabled; no deprecated Back interception is used.

The local storage belongs to this app's sandbox and contains invented demo settings only. Backup is disabled. An APK update requires rebuilding and installing a new APK; there is no self-updater or remote-content path. WebView is a system component, so these app controls are not a claim that Android or other applications perform no networking.

## Rebuild on Windows

Use existing installations of Python 3.10+, JDK 17, **Android SDK Platform 36** and **Android SDK Build Tools 36.0.0**. The standard Android SDK Manager can install the latter two packages. The build script does not install tools, download dependencies, start a server, invoke Gradle, modify accounts, or install the APK on a device.

Open PowerShell:

```powershell
cd C:\dev\ryodev
python android\build-preview.py --sdk "$env:LOCALAPPDATA\Android\Sdk" --work-dir "$env:TEMP\ryodev-apk-build" --output "$env:USERPROFILE\Downloads\RyoDev-Demo-preview.apk"
```

If JDK `java`/`keytool` are not on PATH, set `JAVA_HOME` in that terminal to your existing JDK 17 path first. If your SDK is elsewhere, replace the `--sdk` value with its actual directory. The work directory must be outside `C:\dev\ryodev`; it holds generated build intermediates and a temporary development signing key. It must be empty on first use. An ownership marker permits later rebuilds; the script refuses to clean a nonempty directory without its exact marker. Do not include that directory in a review ZIP.

The script runs the routing tests; compiles resources with AAPT2; compiles Java 8 bytecode using JDK 17's compiler module; converts it with D8; aligns, signs and verifies the APK; inspects packaged permissions and debuggability; compares every APK web asset with the source; and writes `RyoDev-Demo-preview.build-evidence.json` beside the APK. It rejects a source change during a build. Run the project's web checks separately before packaging because compilation does not verify the browser UI.

The supplied build uses a newly generated development certificate, with the standard `androiddebugkey` alias and development-only password. **The private key is not included.** This is a sideloadable preview, not Play signing or release-key setup. An APK rebuilt with another development certificate cannot update the supplied installation in place; uninstalling the demo first is the simple path and removes its demo state. A stable production signing/update identity belongs to a later reviewed release decision.

## Build evidence and remaining Android checks

The initial build was executed on Linux using JDK 17.0.20. Windows commands are provided but have not been executed here. No emulator or physical Android device was available. `*.build-evidence.json` records the exact APK hash, asset hashes, package metadata and Android signature verification output for the delivered build. Signing timestamps/keys can change APK bytes between builds, so this is a reproducible procedure with byte-verified bundled inputs, not a promise of identical APK bytes.

Before accepting Android delivery, record device model, Android version and WebView version and check:

1. Install and cold launch successfully; visible **DEMO — invented data** label; no permission requests from RyoDev.
2. Cold launch in airplane mode; artwork, all four sections, fixture controls and evidence work.
3. Default portrait: Needs me and project content remain readable with real status/navigation bars. Test landscape, cutout, gesture navigation and three-button navigation if available.
4. Android's larger font setting and pinch zoom retain access to every control without clipping. Test TalkBack reading order, summaries and expanded/collapsed state.
5. Select a stale request and a conflicting-usage scenario; neither becomes a current request or a precise remaining allowance.
6. Switch apps, return, rotate and relaunch: demo labels persist; saved settings remain invented; the paused clock is not silently converted to wall-clock time.
7. Reset demo and, if desired, clear Android app storage; prior local seen markers disappear. No account/session control is available.

Record failures with a screenshot and the device/WebView versions. These are Android delivery checks; they do not authorize any connection, tunnel, observer, provider/account call or session control.

## Official sources checked

- [Load in-app content](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content): local HTTPS-origin content, subresource interception, and reasons to avoid file URL access.
- [WebSettings API](https://developer.android.com/reference/android/webkit/WebSettings): network/file access, DOM storage, text zoom and mixed-content configuration.
- [Android 16 behavior changes](https://developer.android.com/about/versions/16/behavior-changes-16): edge-to-edge enforcement and current Back behavior for target API 36.
- [AAPT2](https://developer.android.com/tools/aapt2), [D8](https://developer.android.com/tools/d8), [apksigner](https://developer.android.com/tools/apksigner): official direct command-line packaging, bytecode conversion, signing and verification.
- [Sign your app](https://developer.android.com/studio/publish/app-signing): development versus release signing and update identity.

Official Google SDK archives used for this Linux build (not redistributed):

| Artifact | Official location | Size | Verified SHA-1 from SDK repository | Computed SHA-256 |
|---|---|---:|---|---|
| Platform 36 revision 2 | `https://dl.google.com/android/repository/platform-36_r02.zip` | 65,878,410 | `2c1a80dd4d9f7d0e6dd336ec603d9b5c55a6f576` | `37607369a28c5b640b3a7998868d45898ebcb777565a0e85f9acf36f29631d2e` |
| Build Tools 36.0.0 Linux | `https://dl.google.com/android/repository/build-tools_r36_linux.zip` | 63,737,259 | `b0b6376977657e8ad9b969bacf4093601da2c6fb` | `5d9ac77fb6ff43d9da518a337b4fcf8f9097113df531d99ccefe80ef7ce8250b` |

Sizes and SHA-1 values were checked against [Google's SDK repository index](https://dl.google.com/android/repository/repository2-1.xml) before using the archives. One incomplete download was rejected and downloaded again; only the verified complete archive was extracted and used.
