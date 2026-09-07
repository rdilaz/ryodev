# Design Review

Presentation revision, 6 September 2026. Visual fixture prototype only; real
connection and full RyoDev V0 remain explicitly unaccepted.

## Grounding And References

Verified clean baseline `d1fe5f7`, 30 built-in scenarios, 35 model tests and 10
browser-check groups before editing. Read the original plan, connection gate,
source/tests and existing screenshots. No applicable workspace instructions or
unrelated changes were present.

Visually inspected both supplied images beside
`C:\dev\ryodev-design-brief\01-RyoDev-Kilo-Implement-and-Polish.md`:

- `REFERENCE-PRIMARY-3D.png`: thick rounded platform, objects above it, cyan edge
  light and purple/navy environment. Used for material/depth, not its phone/room.
- `REFERENCE-SECONDARY-DEPTH.png`: consistent lighting and dimensional objects
  integrated into content. No trees, branding, charts or dense dashboard copied.

Neither reference render is shipped, extracted or traced. No Apple assets,
proprietary fonts, image/model API, purchased assets or graphics platform used.

## Choices And Provenance

- Authored `assets/workstation.svg` locally: one original monitor and three
  laptop forms in a shared three-quarter perspective on a sculpted tray. SVG
  geometry, gradients, a narrow edge highlight, contact shadows and a broader
  shadow create depth at rest. The single illustration is well under 500 KB.
- The original SVG wordmark mark and system-font treatment are local. Midnight
  `#11172c`, desaturated violet/cyan light, 24px ceramic cards, and a compact
  smoked utility disclosure replace the earlier flat paper treatment.
- Operational reading surfaces are opaque. Only the utility surround uses blur;
  its text/control backplates stay filled. Text still visible below the panel's
  shadow stays above the 4.5:1 contrast gate. Art is static, noninteractive and hidden
  from accessibility; none of its lighting represents machine state.
- Removed the slogan and duplicate disclosure affordance. Needs me shows
  project/reason/machine/source age. Routing/opaque IDs stay in evidence; unknown,
  stale, historical and release-not-accepted qualifiers stay visible where needed.
- Current usage conflicts read `Allowance unavailable` / `Conflicting reports`.
  EXACT labels remain inside conflicting source evidence, not beside the current
  unavailable result. Valid values retain quality; expired values are historical.
  Unverified account bylines say machines are referenced, not proven to be sharing.

## Inspection And Corrections

Rendered and opened all five primary review views plus five supplemental
accessibility/fallback captures. Corrected the tallest monitor clipping under the
sticky header; moved Demo lab below the permanent mode label; reduced its shadow
after actual rendered sampling detected sub-4.5:1 contrast below it; and replaced
native disclosure radius inheritance that caused square corners after collapse.

Two bounded read-only independent reviews were performed. The visual reviewer
found no material defects in the ten captures against both references. The
semantic/accessibility reviewer identified an open Demo lab covering focus after
Tab leaves it, and low-contrast outlines on dark main surfaces. The panel now
closes on focus departure; dark targets use a contrasting cyan outline. Regression
checks exercise Tab past every utility control and compare computed focus colors
against actual rendered adjacent surfaces. The model needed no changes.

The default 390x844 capture shows the permanent mode, useful attention rows and
the complete first collapsed project. 320px retains readable 13px supporting
operational text and 15-17px row text without horizontal overflow. At desktop the
same page places Projects and Machines alongside each other. 200% text uses
vertical reflow rather than hiding information. No-blur, forced-colors and failed
artwork views retain the data and controls.

Compared with the references, the result retains visible thickness, four
separated computer silhouettes, edge/reflected light and coherent resting depth.
It is a deliberately small dimensional SVG approximation, not a ray-traced render
or native Liquid Glass implementation. Shading/reflections/contact shadows are
simpler than the supplied artwork. No engine is needed to display it.

## Verification And Boundary

All 35 original model tests and all 30 scenarios are preserved. Browser coverage
expanded from 10 to 14 groups: native Edge disclosure name/expanded state,
keyboard/focus/44px targets, 200% text, unobscured mode, forced colors, no blur,
failed art, strict resource/asset checks, and the existing behavioral cases.

The contrast check hides text without moving it, captures the actual browser
composite, decodes RGB/RGBA PNG pixels with built-in Node zlib, then compares the
original foreground (alpha included) at three positions per visible label.
Light/dark reading surfaces, utility controls, expanded evidence, estimated,
conflicting and expired usage are sampled. The reviewed pass checked 765 points;
minimum normal-text contrast was 5.73:1 against a 4.5:1 gate. UI/focus checks use
the 3:1 gate, including light cards, dark status checking, the skip-link target
and header disclosure. The old nearest-ancestor approximation is no longer the proof.

Model, fixture records, model tests, dependency lockfile and CONNECTION-GATE.md
remain unchanged. Static serving adds exactly `/assets/workstation.svg` with the
correct MIME type; host validation, GET/HEAD-only, no-store and CSP remain intact.
The prototype adds no API/provider/billing calls, arbitrary telemetry import,
credential access, workers, notifications, session control or phone transport.
No unrelated project was accessed.

Original plan SHA-256, verified before and after editing:
`FF4A60CF1DA8D96C05A37CCED964EE88F0A56A36B11623190ACFEA09E86E66DD`.
Packaging also checks the archived plan and every intended file against reviewed
working source. The source ZIP is generated from the final local commit.

Coverage limits: Windows Edge only. No iOS/Safari, other engines, physical-phone
delivery, actual browser zoom or live screen-reader validation is claimed.
Root-font enlargement and Edge's native accessibility tree were tested instead.
Screenshots are visual evidence, not behavioral proof or user acceptance.
