# Layouts

> **⚠️ STATUS (2026-10-07):** the two "Status note" blocks below were written before the workbench
> rounds and are **wrong now** — corrected inline. The served `layout` IS carried
> (`BlockParams.layout`, `src/lib/types.ts`) and **is** consumed by the Control Surface's
> Axis-Layouts profiles; and the tool rail **no longer** shows "coming soon" stubs — Setup /
> Controllers / FC open virtual-effect screens (gated honestly, audit §3.5). The live backlog is
> `docs/axis-fm3edit-feature-parity-audit.md`.

How Axis organizes a block's controls into pages, where that arrangement comes from, and where the
work is headed. This doc describes both **what ships today** and the **design being implemented** —
each section is tagged accordingly so the two are never confused.

> **Legend** — **Implemented**: in the code today. **Planned / In-progress**: designed and being
> built; not yet wired (or only partly).

## The data flow

Editor layouts originate in `fractal-midi` as per-device, per-family layout data and travel through
ForgeFX to Axis:

```
fractal-midi  ──►  ForgeFX  ──►  Axis
  *_LAYOUTS         serves          renders as
  (device-          layout on       switchable
   authentic        the param       layout
   pages)           response        profiles
```

- **`fractal-midi`** exports per-device layout maps (`FM3_LAYOUTS` / `FM9_LAYOUTS` / `AXE3_LAYOUTS`):
  `family -> { editorName?, pages: [{ name, controls: [{ label, paramName, paramId, col? }] }] }`.
  This is **device-authentic editor layout data derived from the device editor configuration** —
  pages, control labels, and column positions as the device organizes them.
- **ForgeFX** attaches the family's layout to `GET /preset/blocks/:eid/params` as an optional
  `layout` field, alongside the live `named`/`enums`/`type` values. *(See the ForgeFX repo's
  `docs/LAYOUTS.md`.)*
- **Axis** is meant to consume that served layout as the **Default** layout profile for a block
  family, with the user able to switch between Default, a Blank canvas, and their own custom
  profiles.

## What ships today — the Control Surface

**Implemented.** The block editor body is a **widget-grid Control Surface**
([`src/lib/ControlSurface.svelte`](../src/lib/ControlSurface.svelte)): controls are tiles (knob,
fader, slider, number, switch, select, EQ, action) you can arrange, resize, and retype, organized
into **pages/tabs**.

Today those tabs are built **client-side** from the flat parameter list ForgeFX returns
([`src/lib/layouts.ts`](../src/lib/layouts.ts)):

- **Ideal** *(built-in)* — a heuristic pick of the most musician-facing knobs.
- **Advanced** *(built-in)* — the remaining knobs plus all discrete selectors.
- **EQ** *(built-in, amp only)* — the amp's graphic-EQ band params.
- **Custom tabs** — any number of user-created tabs, each a named set of param ids.

Custom tabs and swipe-control assignments are **persisted client-side** (`localStorage`), keyed by
**block-family slug + device-true paramId**, so a custom Amp view applies to every amp. This is the
layout machinery in place now; it does **not** yet read the served `layout` field.

## What's being built — Axis-Layouts (layout profiles)

**Planned / In-progress.** The **Axis-Layouts** system generalizes the per-family tabs above into
named, switchable **layout profiles** per context (per block family, and per virtual-effect screen):

- **Default** — *device-authentic*, seeded from the `layout` ForgeFX serves (the `*_LAYOUTS` pages,
  control labels, and column positions). This is the profile that turns the served layout into the
  initial arrangement.
- **Blank** — an empty canvas to build a layout from scratch.
- **Custom / duplicated** — user-created profiles (including duplicates of Default or another
  profile), switchable and persisted.

> **Status note (SUPERSEDED 2026-10-07 — this SHIPPED).** The served `layout` is carried on
> `BlockParams.layout` (`src/lib/types.ts`) and consumed by `ControlSurface.svelte`'s Axis-Layouts
> profiles: **Default** (device-authentic, seeded from the served layout, re-seeded on a type change
> via a variant fingerprint), **Blank**, and user custom profiles. The built-in Ideal/Advanced/EQ
> tabs plus user custom tabs remain as the predecessor/fallback.

## Virtual-effect screens — Setup / Controllers / Modifier / FC

**Planned / In-progress.** ForgeFX exposes the device's non-audio editor sections on the same
`(effectId, paramId)` path as audio blocks, addressed by a reserved effect id:

| Effect id | Screen |
|-----------|--------|
| `1` | Setup (device-global) |
| `2` | Controllers |
| `3` | Modifier |
| `199` | Foot Controller (FC) |

The design points the **same Control Surface** at one of these effect ids — i.e. "Setup" is the
block editor pointed at effect id `1` — and renders it with the Default layout profile seeded from
the served layout, just like an audio block.

> **Status note (SUPERSEDED 2026-10-07 — this SHIPPED).** The rail opens **Setup** (eid 1),
> **Controllers** (eid 2) and **Footswitches** (eid 199) as virtual-effect screens through the normal
> param path, and the misleading "coming soon" toasts are **gone**. A screen whose capability is
> absent renders **disabled with the exact reason** (`src/lib/gateRailItems.ts`, audit §3.5);
> `perform`/`sets`/`scenes` have no host in the legacy shell and are gated disabled. The live backlog
> is `docs/axis-fm3edit-feature-parity-audit.md` — the [ROADMAP](ROADMAP.md) is banner-stale.

## Multi-device

**Implemented (device selection).** Axis auto-detects the attached unit; ForgeFX selects the matching
`DeviceProfile`, so the served layouts and virtual-effect resolution already correspond to the
connected device (FM3/FM9/Axe-Fx III) with no client changes. Each device supplies its own family
layouts; the gen-3 units share the virtual effect ids. Rendering those served layouts as layout
profiles is the **Planned / In-progress** half above.
