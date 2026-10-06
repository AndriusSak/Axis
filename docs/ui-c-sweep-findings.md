# UI-C sweep — findings handoff (edit mode, overlays, profile variants)

Scope: surfaces not covered by the earlier 7-page geometric sweep. Sweep specs:
`e2e/25-edit-mode-sweep.spec.ts`, `e2e/26-profiles-sweep.spec.ts`; helper
`e2e/support/geometry.ts`. All invariants are clipping-aware (ancestor overflow
intersection + viewport clamp; a scrollable ancestor makes content reachable).

Status: **41 tests green** (17 in spec 25 + 24 in spec 26; 3 marked `test.fail(...)`
= expected-to-fail defects below). No source was changed: every defect lands in a
file this workstream was told not to edit. If an owner fixes one, Playwright reports
the unexpected pass and the `test.fail` marker should be removed.

## Clean (measured, backed by probes)

- Edit mode at **1440 / 1280 / 900**: no sideways document scroll, no element
  wider than the viewport, no in-flow interactive collisions, no unreachable
  control (collapsed rail excluded — its icon-only labels are clipped by design).
- Edit ribbon: every action reachable and unclipped.
- Widget context menu: opens inside the viewport at every width (188×416),
  including from edge widgets (top-right at x=1244/1084/704).
- Customize drawers (Pages/Widgets, Layouts): settle inside the viewport
  (348px), no clipped or unreachable controls.
- Add-block palette: 1440 centered 760×337; below 1366 the mobile bottom-sheet
  (editor `isMobile = vw < 1366`) 1280×336 / 900×336 — inside the viewport.
- Overflow chip menu for a **top-bar** zone @1440: chip 449,14 → menu 70,65 270×495,
  fully visible.
- Tablet widths **1180 / 1024**: all 7 seed pages clean (only the preset-browser
  subtitle ellipsis, which is deliberate).
- Phone **390×844**: page *content* clean for all 7 pages.

## Defects (owned by other workstreams — reported, not fixed)

### F1 — phone bottom nav clips entries unreachable
`NavigationHost.svelte`. `.aw-nav[data-nav-mode='bottom']` is `overflow: hidden`;
at 390px it gets 275px but its 9 entries need 408px (each 40px, step 46, nav right
edge = 327). **Setup (x=328), Theme (x=374), Axis Cloud (x=420)** have zero visible
area and no scrollable ancestor → unreachable by touch. Whatever page is active,
~3 entries clip (on Setup, Grid/PB/Footswitches move to x=−81/−35/11).
Test: `26 … phone: every bottom-nav entry is reachable`.

### F2 — `⋯` overflow chip menu opens off-screen
`WidgetZone.svelte`. `.aw-overflow-menu { top: calc(100% + 8px) }` opens downward,
so for any bottom-bar zone the menu lands below the fold:
- phone 390×844: chip 352,806 43×30 → menu 352,852 270×159, visible height **0**;
  "✥ Rearrange in Customize" at y≈966.
- 1440×900 (bottom zone forced to overflow): chip 1136,868 → menu 183,908 270×1209,
  visible height **0**.
The chip only exists outside edit mode (edit mode sets the zone `overflow: visible`).
Tests: `25 … overflow chip menu (bottom bar zone) @1440`, `26 … phone: the overflow chip menu is reachable`.

### F3 — phone edit mode: bottom-bar controls clip to zero
`NavigationHost.svelte` / `WidgetZone.svelte` (aggravated by the rail in
`WorkbenchHost.svelte`). While editing, `shouldRenderRail` forces the widgets-only
rail visible as a 64px static left strip, shrinking `.aw-frame` to 326px. The bar's
content needs 349px (clientWidth 326) and edit mode disables the overflow chip, so
the surplus is clipped: nav entries Scenes/Live/Setup/Theme/Axis Cloud, the `+`
add-page control and scene buttons 4–8 all measure **zero visible area** (x=300…484
vs a 390px viewport). Test: `26 … phone edit mode: no bottom-bar control is unreachable`.

## Minimal fix proposals (for the owning workstreams)

- **F1**: give `.aw-nav[data-nav-mode='bottom']` `overflow-x: auto` (the design
  comment forbids a scrollbar — alternative: shrink `min-width` below 40px, or seed
  fewer entries on the phone profile).
- **F2**: place `.aw-overflow-menu` upward (`bottom: calc(100% + 8px)`) when there
  is no room below (e.g. when the zone's bottom is within ~menu-height of the
  viewport bottom).
- **F3**: on phone, present the edit-mode rail as an overlay instead of consuming
  frame width; and/or keep the overflow chip active while editing so surplus
  widgets are shelved rather than clipped.

## Not proven / bounded

- Mobile **profile preview** (400px frame @1440): `.aw-workspace` (334px,
  `overflow:hidden`) contains a 588px-wide `.inner.mob` grid → clipped. Does **not**
  reproduce on a real 390px phone (grid fits to 310px), so it is bounded to the
  letterboxed preview frame; not raised as a defect.
- Phone **rest** (`navMode: bottom`): `.aw-overflow-chip` sits at x=352..395, i.e.
  its own 5px right edge is clipped by the bottom bar — same bottom-bar root cause
  as F1/F3, not separately tested.
