# Axis × FM3-Edit / FM3 hardware — feature-parity audit

**Type:** audit / backlog, not a promise list.
**Date:** 2026-10-06 · **Author:** Lykos (session audit)
**Branches inspected:** Axis `local/dynacab-mic-graph` (main checkout, `~/repos/stack/Axis`),
ForgeFX `main`, forgefx-midi `master`.

**What this is.** A gap analysis of Axis against what FM3-Edit and the FM3 hardware itself can do,
plus a list of features Axis already ships *incompletely*. Everything here is a **candidate** with
evidence (file/line or catalogue fact). **Nothing is hardware-verified** unless it says so — the
whole point of writing it down is so the next session starts from evidence instead of re-deriving it.

**How to read the status tags**

| Tag | Meaning |
|---|---|
| **Absent** | No code path exists; needs a feature build. |
| **Partial** | A screen/endpoint exists, but key sub-capabilities are missing. |
| **Stub** | The control exists and does nothing (or shows "coming soon"). |
| **Unverified** | Implemented, but not proven against hardware / not reachable in all cases. |
| **Axis+** | Axis does this *better or more broadly* than FM3-Edit — do not "fix" it away. |

---

## 0. Method and ground truth

- **FM3-Edit feature set:** Fractal Audio wiki, *Editors* (cached: `Editors` page, sections
  Preferences · Main window · Presets · Scenes · Blocks · Library · Global blocks · Tools ·
  FC Edit). FM3 owner's-manual TOC (sections 4–13) and FM3 firmware release notes (Setlists/Songs,
  NAM) for hardware-side features.
- **Axis implementation:** `src/lib/**` (workbench pages, panels, registry manifest, `editor.svelte.ts`,
  `forgefx.ts`, `ControlSurface.svelte`, `BlockEditor.svelte`, `FcEditor.svelte`,
  `ModifierEditorCore.svelte`, `PresetBrowser.svelte`, `CabPicker.svelte`, `ToolRail.svelte`).
- **Server surface:** `ForgeFX/server/src/runtime/router.ts` route table + `drivers/gen3.ts`;
  `forgefx-midi/catalog/fm3.json` (`FM3_PARAMS`, 2021 rows) for what the device actually exposes.
- **Caveat:** FM3-Edit's internal naming ≠ Axis's. Absence was checked by keyword *and* by reading the
  owning component, but a "not found by grep" claim is marked where it is the only evidence.

---

## 1. Baseline — what Axis already ships (the "have" side)

Verified present and wired:

- **Signal Grid**: place / clear / move / cable / disconnect, auto-inserted shunts on routed empty
  cells, animated cables, swipe meters, mini-map, mobile paging
  (`SignalGrid.svelte`, `gridRouting.ts`, `convertGridEdit.ts`).
- **Block editor** with device-authentic + free Control Surface boards (knob/fader/slider/number/
  switch/select/EQ/action views, per-family pages, arrange mode, three layout variants)
  (`ControlSurface.svelte`, `deviceLayoutBoard.ts`).
- **Cab / DynaCab picker** with mic graph, per-cab Mute/Solo, bank/IR search + favourites
  (`CabPicker.svelte`).
- **Preset browser**: device scan, local folder, imported `.syx`, cloud, converted entries; live
  audition; load-to-buffer; **export to disk (`.syx`)**; rename-and-save on device; saved filters +
  query language; favourites (`PresetBrowser.svelte`, `library.svelte.ts`).
- **Preset backup / restore / decode / firmware validate** (`DeviceTools.svelte`).
- **Version history / snapshot-per-slot** on disk + cloud (`/versions`, `/backup/preset/:n`).
- **Scenes**: switch (8), rename, per-scene bypass/channel reflection over SSE.
- **Channels**: select A–D, live reflection.
- **Tuner** (Hz/note/cents overlay), **Tempo** (get/set/tap + global tap mode), **CPU load**,
  **preset-leveling output meters**.
- **Controllers screen** (LFO 1/2, ADSR 1/2, Envelope, Sequencer, Pitch, Manual, Scene controllers)
  and **Setup screen** (the GLOBAL block) rendered through the generic Control Surface via the
  `global` / `controllers` virtual effects (`axisWorkbenchPages.ts`, `AxisVirtualScreenPanel.svelte`,
  `GEN3_VIRTUAL_EFFECTS`).
- **Modifier editor** (flyout + docked `be-part="modifier"` panel): source bind via `POST /mod/bind`,
  curve fields (min/max/start/mid/end/slope/scale/offset) written live.
- **FC (footswitch) editor** — the deepest block editor besides the amp: layouts × views × switches,
  per-switch tap/hold category + function + display + params, LED colour, custom labels, **live
  read-back on FM3** (`FcEditor.svelte`, `fc/*`).
- **Looper** block transport + live waveform/playhead telemetry (`forgefx.looper`, `looperControl`).
- **Device Tools** extras: modifier-model viewer, offline `.syx` bank decode, versions.
- **Cross-device preset converter** (FM3↔FM9↔III↔II↔AM4) with an offline edit surface + export
  (`convert.svelte.ts`, `AxisConvert*Panel.svelte`) — **Axis+, no FM3-Edit equivalent**.
- **Workbench shell** (dockable panels/widgets/pages, custom panels pinning parameters, cloud-synced
  layout), multi-device profiles (FM3/FM9/III/AM4/VP4), telemetry, mobile/tablet layout.

---

## 2. Absent features — in FM3-Edit / FM3, not in Axis

Ordered roughly by user value on an FM3.

### 2.1 Scene Manager — **Done (v1 — bypass/channel)** · 2026-10-06
FM3-Edit has a dedicated **Scene Manager** and a Scenes dropdown with **copy / paste / swap scenes,
engage-all / bypass-all blocks per scene**; the FM3 hardware has the same operations. Axis now ships a
real **Scene Manager** page: 8 named scene cards with copy / paste / swap (within the preset), a
per-scene bypass+channel matrix from `GET /preset/scene-state`, and bulk engage-all / bypass-all per
scene. All device work is a **client-side sequence over the existing endpoints** — no new route:
`POST /scene` (switch), `GET /preset/scene-state` (read the active scene), `POST
/preset/blocks/:eid/bypass` + `/channel` (write) — composed in `src/lib/sceneOps.ts`
(`planSceneApply` / `copyScene` / `swapScenes` / `bulkBypass` / `scanSceneMatrix`), wired by
`AxisSceneManagerPanel.svelte` (panel type `axis.sceneManager`). On Fractal hardware a scene IS a
per-block bypass + channel (X/Y) map, so this sequence is a faithful copy/swap — §6.3 is resolved
without new ops or a preset-binary parser.
- ~~The workbench Scenes page is a placeholder~~ — replaced by the real panel; a persisted document's
  stale `axis.placeholder` Scenes panel self-heals via `ensureAxisSceneManagerPanel` (marker-free).
- Still missing: **scene-level "Set all CS" / control-switch state per scene** (catalog carries
  `PRESET_FC_SCENE*_CS*_MODE`, 51 params — reachable via the generic codec but no UI), and
  **scene-controller / per-scene param values** beyond bypass+channel (scene controllers are surfaced
  by the Controllers screen; a whole-scene param dump needs the §6.4 preset-binary parser).
- Scene Ignore per block is **done** (see §3.1).

### 2.2 Perform / Live view — **Absent** (whole surface)
FM3-Edit exposes **Global Performance pages** and **Per-Preset Performance pages** (assign any
parameter to a big performance knob/switch). Axis's **Live page is a placeholder**
(`axisWorkbenchPages.ts:146-158`), and the legacy rail's **Perform** entry is a "coming soon" toast
(`ToolRail.svelte:11, 68-69`). No performance-page data model anywhere.
- **Next step:** scope as a *view* over params (a page definition = an ordered list of
  `(family, paramId)` bindings), persisted per-preset or globally. The workbench widget system
  (`axis.paramControl`, pinning) already supplies most of the rendering; what's missing is the page
  model + a full-screen presentation + device-side persistence story (whether FM3 stores performance
  pages in the preset binary — **needs RE**, see §6.4).

### 2.3 Sets & Songs (Setlists) — **Absent** (whole surface)
FM3 firmware ≥ 9 exposes **Setlists/Songs** (custom preset/scene order for live use) and FM3-Edit has
a corresponding area with **import/export**. Axis: no page, no nav entry in the workbench (the legacy
rail's `sets` falls through to the toast path, `ToolRail.svelte:12`), no endpoints.
- **Next step:** determine storage (front-panel Setup menu area ⇒ almost certainly a *system/global*
  region, **not** a preset ⇒ needs an RE spike for read/write). Until then it is a **research item**,
  not a wiring task.

### 2.4 Manage Presets (bank librarian) — **Absent**
FM3-Edit's **Manage Presets** does multi-select **reorder / move / swap / duplicate / delete**
across device slots, drag-and-drop, plus **Reset AMP blocks** per preset. Axis's preset browser is a
*viewer/loader*; the device-slot context menu shows **Duplicate / Remove from device / Delete
everywhere but marks them "soon"** (`PresetBrowser.svelte:519`, `548`).
- Backing endpoints missing: no `POST /preset/move|swap|copy` in `router.ts`; only
  `POST /preset/store` (store edit buffer → slot) and `POST /preset/name`.
- **Next step:** device-side slot ops need the write protocol for "copy slot N → M" (does gen-3 even
  expose it? verify — FM3-Edit does it, so it's in *some* SyEx path); alternatively implement a
  **swap-by-store** sequence (dump → load → store) client- or server-side.

### 2.5 User Cab / IR management — **Absent**
FM3-Edit: **Manage Cabs** (reorder/rename/delete user IRs), **IR import** (`.wav`/`.ir` with MPT /
Auto-Trim / output format options), Scratchpad naming, UltraRes marking. Axis has only the *picker*
(`GET /cab/irs`, `CabPicker.svelte`) + favourites. No `POST /cab/*` write endpoints at all; no
upload; no IR-capture UI (IR capture on the FM3 is front-panel/III-editor).
- **Next step:** low priority unless Andy shares IR packs; IR upload is a multi-frame SyEx transfer
  that must be verified on hardware first.

### 2.6 Library (block/channel library on disk) — **Absent**
FM3-Edit's **Library** stores named **blocks (all 4 channels) and single channels** as `.blk` files,
recallable into any instance, shareable, with modifiers included for whole-block saves. Axis has no
`.blk` concept (grep `.blk`/`block library` → only CSS class names).
- Note: Axis's **workbench library drawer** is a *layout* library (pages/panels/widgets) — a
  different thing. Don't conflate them.
- **Next step:** a `.blk` is a serialised block-param set + type; Axis already reads full per-block
  params. "Save block to disk / recall into a block" is feasible **without** new device work if the
  file format is Axis-local (not byte-compatible with FM3-Edit's `.blk`, which is a Fractal format).

### 2.7 Preset templates, bundles, snapshots-to-folder — **Absent**
FM3-Edit: **New from Template / Save as Template**, **Preset+Cab bundle** export/import, **Snapshot**
button writing `name.syx` into a Snapshots folder, **Clear Preset**, **Revert Preset** (discard
unsaved changes back to the stored version), import from `.bnk` banks, **Recent Presets**.
Axis has none of these (grep `template` matches are unrelated; no `revert`/`clearPreset` preset op —
only history's `revertTo`).
- Closest existing: per-slot **version history** (device snapshot + download `.syx`) covers the
  *backup* use-case, but not "discard my changes and reload the stored preset".
- **Next step:** **Revert Preset is the cheap, high-value one** — it's just "re-read the stored slot
  into the edit buffer"; there is already a load-from-slot path (`POST /preset/select`). Snapshots
  map onto the existing version-history store.

### 2.8 MIDI / Remote configuration — **Absent**
FM3-Edit's Setup covers **MIDI/Remote**: device MIDI channel, **Program Change mapping** (per-slot PC
table), **CC mapping**, **Scene MIDI** messages, preset mapping. Axis's Setup screen is the GLOBAL
block only.
- The FM3 catalogue *does* carry these: `GLOBAL_MIDI_CHAN`, `GLOBAL_MIDI_PROG_CHANGE`,
  `GLOBAL_PC_OFFSET`, `GLOBAL_MIDI_MAPPING`, `GLOBAL_SEND_MIDIPC`, plus a separate **`MIDIBLOCK`
  family (13 params, incl. `MIDIBLOCK_SEND_MSG`, per-message chan/num/val arrays)** and **scene MIDI**
  params. **But**: `MIDIBLOCK` is **not one of the four virtual effects** (`GEN3_VIRTUAL_EFFECTS` =
  global/controllers/modifier/fc), so it has **no screen and no eid to address** in Axis today.
- **Next step:** (a) verify whether the FM3 in use even exposes a *placeable* MIDI block (the catalog
  family exists; the roster may not) — if yes, it needs a block editor entry; (b) the PC/CC **mapping
  tables** are structured arrays, i.e. a different UI from a knob grid — scope separately.

### 2.9 Grid/block editing operations FM3-Edit has and Axis doesn't

| FM3-Edit operation | Axis status | Evidence |
|---|---|---|
| Copy / cut / paste a block (incl. across presets) | **Implemented (in-preset)** | `editor.copyBlock/pasteBlock` (Cmd+C/Cmd+V); pastes onto a block (settings), a shunt, or an empty cell; `planPasteBlock` in `gridRouting.ts` |
| Drag block onto block/shunt to **swap** positions (cables preserved) | **Implemented** | `planSwap` + `editor.swap`; SignalGrid block-onto-block drop swaps (cables stay with each cell) |
| **Reset channel / reset block** to defaults | **Implemented** | footer Reset CH (active channel, model re-select) / Reset Block (structural clear+re-place, undoable) + grid Cmd+I; `planResetBlock` |
| **Disconnect all cables** from a block (Cmd+D) | **Implemented** | `planDisconnectAll` + `editor.disconnectAll` (Cmd+D) |
| **Move an entire row / column** (grid border sliders) | **Absent** | grep `moveRow` → 0 |
| Explicit **Insert shunt** command/shortcut | **Implemented** | `planInsertShunt` + `editor.insertShunt` (Cmd+U) |
| **Quick Build** panel (Q) | **Partial** — the Cmd+K command palette covers placement differently | `CommandPalette.svelte` |
| **Grid Navigation Mode** (fast grid ops, skip param fetch) | **Absent** | grep `gridNav` → 0 |
| **Block Info** overlay (which blocks are Global) | **N/A on FM3** (Global blocks are Axe-Fx only) | — |

### 2.10 Channel operations — **Partial**
Channels A–D select is present (`editor` channel writes + reflection). **Copy channel → paste
channel**, **reset channel**, and **reset block** are implemented client-side in the Block Editor
footer (`src/lib/blockOps.ts` + `editor.svelte.ts` `copyChannel/pasteChannel/resetChannel/
resetBlock`) over the existing per-block param/type writes — no new endpoint.
- Copy/paste snapshots the channel's served params (knobs by norm, enums by ordinal) keyed by
  device paramId and writes them back; ids the target block does not expose are dropped.
- Reset is the FM3 **model re-select soft reset**: "Reset CH" resets the active channel only;
  "Reset Block" (and the grid's Cmd+I) clears + re-places the block in place — routing preserved,
  structurally undoable.
- Still missing: **copy channel across blocks/presets**, **set channel across all scenes** (FM3-Edit
  Block menu), and **copy/cut a block across presets** (the block clipboard is in-memory, same session).

### 2.11 Cross-preset / batch editing — **Absent**
FM3-Edit's hidden **Parameter Batch Set** ("Set In Multiple Presets" on a parameter context menu) and
copy/paste of a parameter value between blocks are not implemented in Axis.

### 2.12 Keyboard shortcut parity — **Partial**
FM3-Edit is shortcut-rich (Cmd+S save, Cmd+M manage, P preset picker, A/B/C/D channels, Space
bypass, Backspace delete, Cmd+D disconnect, Cmd+U shunt, Shift+Space engage-all-scenes, Cmd+I reset,
arrow-key value nudges…). Axis registers only **Cmd+K** (palette) and **Cmd+Z / Cmd+Y**
(`routes/+page.svelte:86-94`). No global shortcut map.

### 2.13 Preset / cab colour tagging — **Absent**
FM3-Edit lets you colour/flag picker entries and filter by colour. Axis has favourites + saved
filters but no colour/flag dimension.

---

## 3. Incomplete features already inside Axis

These are the highest-value items: the screen exists, the plumbing partly exists, the feature stops
short.

### 3.1 Block editor footer — **Done (Scene Ignore), Mute honestly disabled**
`BlockEditor.svelte` footer, `src/lib/blockOps.ts`:
- **Scene Ignore** — **implemented**. The FM3 catalog serves a per-family `<FAMILY>_SCENEIGNORE`
  enum (27 families: `CABINET_SCENEIGNORE` pid 84, `DELAY_SCENEIGNORE` pid 83, `DISTORT_SCENEIGNORE`
  pid 137, …; all `unit: "enum"`, `displayLabel: "Scene Ignore"`), so the footer toggles the block's
  own served selector via the existing discrete param write. No invented paramId. It is gated off
  (disabled with a tooltip) for the few families that do not expose one.
- **Mute** — **honest disabled stub; no backing param exists.** `grep -io '"[A-Z_0-9]*MUTE[A-Z_0-9]*"'`
  over `forgefx-midi/catalog/fm3.json` returns ONLY family-specific rows — `CABINET_MUTE1..4` +
  `CABINET_BTN_MUTE1..2` (per cab slot), `MULTICOMP_MUTE1..3` (per multiband-comp band),
  `GLOBAL_TUNERMUTE` (global tuner) and `GLOBAL_REMOTE_MUTE` (global remote) — none is a generic
  per-block mute. The one generic-looking route (setting the family's `*_LEVEL` param to its dB min)
  is ambiguous on many families (CABINET/MULTITAP/PITCH carry several `*_LEVEL`s) and is not -∞. The
  footer button is therefore `disabled` with a tooltip stating this, and points at **Bypass** (the
  served "silence this block" control, sitting right beside it). Do NOT wire it to an invented id.

### 3.2 Modifier editor — **Partial / Unverified**
`ModifierEditorCore.svelte` header (lines 7-10): curve fields are written live, *"Channel / PC Reset /
Update Rate / Attack / Release / Damping / Auto Engage / Off Value are rendered but only written when
the model exposes their pid (flagged 'pending decode' otherwise)"*, and *"local edit state (no
read-back yet — sensible defaults from the design's defaultMod)"* (line ~78).
- **No read-back of existing modifier assignments.** Axis can *create/bind* a modifier but cannot show
  "this parameter already has modifier from Source X with these curve values". FM3-Edit shows that.
- Where modifiers are used in a preset is likewise not listed anywhere (FM3-Edit's Controllers screen
  shows "where Modifiers are being used").
- **Next step:** the modifier state lives in the preset body; a read path over the mod virtual effect
  (or the preset-binary parser, §6.4) is the blocker.

### 3.3 Scenes page & Live page — **Scenes done, Live stub**
The Scenes page is now the real Scene Manager (§2.1). The Live page remains a placeholder panel (§2.2).
No dead-end (the no-dead-nav rule is honoured).

### 3.4 Preset browser device-slot actions — **Stub**
`PresetBrowser.svelte:519` `const SOON = new Set(['duplicate', 'removeDevice', 'delete'])` — the
context menu renders them but they do nothing. See §2.4.

### 3.5 Setup / Controllers depend on the virtual-effect mechanism — **Partial**
Setup = GLOBAL only; Controllers = CONTROLLERS block only. Both are gated on
`caps.virtualEffects` (`ToolRail.svelte:30-42`), so on a legacy v1 server or AM4 **the whole Setup
screen disappears**. FM3-Edit's Setup is broader (MIDI/Remote, FC config, utility, calibration).

### 3.6 Known UX defects already logged (still open)
From the current handoff (`docs/handoff-cab-mute-and-dynacab.md` §"REMOTE WORK"):
1. **Block pane too short** — at 1440×900 the card is 323 px with 226 px of chrome; a 471 px Cab board
   is scrolled. Candidate fixes listed there (fold search into the tab row / raise the bottom region /
   fit-to-view cell scale).
2. **Control search renders full control cards**, so a short pane shows one match.
3. **`GET /diag/ranges` not surfaced in the UI** — the endpoint that would end the
   "profile-vs-catalogue" guessing class is CLI-only. (It lives in `server/src/app.ts`, NOT in
   `runtime/router.ts` — grep BOTH route files before concluding an endpoint is missing.)
   **ADDRESSED:** the Device Tools modal now has a "Range trace" panel
   (`src/lib/DeviceTools.svelte` + `src/lib/rangeTrace.ts`) that queries the endpoint by family/pid
   and shows, per paramId, the row that serves it vs the catalogue row.
4. **Pseudo-params (`CABINET_BTN_MUTE<n>`) resolved client-side** by matching a served NAME — fragile;
   the driver could rewrite them server-side.
5. **Touch targets**: 53 sub-40 px interactive elements at 1280×800 (preset arrows 24×36, slot chips
   21×22) — a deliberate design decision, not yet taken.
6. **DynaCab 2-axis pad** (Position/Distance sibling binding) verified in e2e only, not on the Deck.

### 3.7 Unverified device writes / calls (need hardware confirmation)
- **Cab 2 Mute/Solo write** — the one item the last handoff could not prove; the cache row said float,
  the catalogue says enum, and the fix trusted the catalogue (`285c11b`). **Toggle cab 2's M/S on the
  unit and confirm the state changes + reads back.**
- **GLOBAL family: 25 params are `unit: 'unverified'`** in the FM3 catalog. ForgeFX's `KNOB_UNITS`
  allowlist (`gen3.ts:141-143`) excludes `unverified`, so any *float* row on those defs is dropped
  from the served knob list (this exact mechanism deleted the DynaCab Position param). Enum-shaped
  rows are still served (`rangeFor`, `gen3.ts:557-563`). **Candidate silent gaps in Setup:**
  `GLOBAL_CS*_*` (control-switch config, 12 params), `GLOBAL_MIDI_MAPPING`, `GLOBAL_REMOTE_MUTE`,
  `GLOBAL_USB_RECORD` / `_3_4_PLAYBACK`, `GLOBAL_FC_TYPE_PFC*` / `_CLONE_*` / `_DEFAULT_LAYOUT_*`,
  `GLOBAL_FS_BRIGHTNESS` / `_LCD_CONTRAST`, `GLOBAL_FC_FS_TUNER_MODE`, `GLOBAL_DEVICE_NAME_BEGIN`.
  → **Probe:** `GET /diag/ranges?family=GLOBAL&pid=N` for each suspect pid, then open Setup with a
  **clean store** (`bootCleanWorkbench` / fresh cache) and check the control is present.
- **FC editor fields** whose metadata is absent from the served model are silently *hidden* rather
  than gated (`FcEditor.svelte` header) — so an FM3 whose model lacks a field shows a shorter editor
  with no warning. Verify the served `/fc/model` covers every control FM3-Edit's FC Edit shows.

### 3.8 FC Edit sub-features missing vs FM3-Edit
Present: layouts × views × switches, tap/hold function, category, display mode, params, LED colour,
custom label, live read-back. Missing (grep for `csMidi|layoutLink|perPreset|startup|mirror` in
`FcEditor.svelte` + `fc/*` → **0 hits**):
- **Per-Preset Override / Per-Preset switches** (FM3-Edit has a whole `FC Per-Preset` area).
- **Layout Links** (switch changes layout after press).
- **CS MIDI** (control-switch MIDI assignment).
- **FC Config** (general footswitch settings) and **Devices** tab (startup layout/view, mirroring,
  1:1 copy).
- **Import / export layouts** (backup).
- **Master Layout Menu warning / edit** precondition.
- **Songs/Setlists** integration (§2.3).

---

## 4. Where Axis is ahead of / different from FM3-Edit — **do not regress**

- **Cross-device preset conversion** (`convert*`): FM3 ↔ FM9 ↔ III ↔ II ↔ AM4 translation.
- **Layout workbench**: dockable panels, custom param panels, pinning, per-profile layouts, cloud sync.
- **Undo/redo** covers *grid* and *scene* ops, not just parameter edits (FM3-Edit explicitly does
  **not** undo grid/system/footswitch changes). Axis: `history.svelte.ts` `HistoryOp` includes
  `place|remove|cable|scene|sceneName|presetName`.
- **Offline-capable**: offline `.syx` decode, offline convert edit surface, local folder library,
  device-defs folder, browser-direct runtime (`direct/`). FM3-Edit explicitly refuses offline editing.
- **Reflection extras**: SSE live parameter/scene/channel reflection from the front panel, CPU readout,
  looper telemetry, telemetry-mode polling control (≈ FM3-Edit's "Pause Communications", `F8`).
- **Multi-device profiles** (FM3/FM9/III/AM4/VP4) and a much broader device coverage than one editor.

---

## 5. Cross-cutting observations

- **The four virtual effects are the whole "settings" story.** `GEN3_VIRTUAL_EFFECTS` (global=1,
  controllers=2, modifier=3, fc=199) — anything the FM3 exposes as a family that is *not* one of those
  (MIDIBLOCK, IRCAPTURE, PRESET) has **no screen and no address** in Axis.
- **The preset-binary parser EXISTS — corrected 2026-10-06 (verified in code).** `forgefx-midi/src/
  devices/gen3/presetDump.ts` parses the 0x77/0x78/0x79 stored-dump chain (`parsePresetDump`,
  `parsePresetBank`, `serializePresetDump`, `extractPresetName`, `retargetPresetDumpToEditBuffer`) and
  `presetBody.ts` decodes the reassembled body into a typed model — grid cells, placed blocks,
  per-channel effect types, amp model + knobs, **modifiers** (`Gen3Modifier`) and scene controllers.
  `ForgeFX` consumes it (`POST /preset/decode`, backups, local scan). What is still **not** captured is
  the host→device **write-back** of 0x77/0x78/0x79 (stated in that file's own header). So the
  follow-ons below are no longer blocked on "build a parser" — they are blocked on *surfacing* the
  decoded model (e.g. modifier read-back, §3.2) or on RE for things the body does not contain.
- **Silent-drop gates are the recurring defect class here** (`KNOB_UNITS`, enum length caps). Two of
  this audit's "candidate gaps" (§3.7) are that same class — verify before building UI for them.

### 5.1 Silent list truncation (same family of defect — audited 2026-10-06)

**Rule: a rendered list is either COMPLETE, or its cap is DISCLOSED in the UI.** These are the audited
surfaces. Two of them were *misreported as undisclosed* in the first draft of this table and are in
fact fine — the lesson is that "there is a `slice` here" is not evidence until the header/count
derivation is read too.

| Site | Cap | Disclosed? | Status |
|---|---|---|---|
| `CommandPalette.svelte` model + block rows (now `paletteRows.ts`) | `list.slice(0, 80)` | **No** — and the header count came off the *truncated* array, so the FM3's 331 amp models showed as "80 results" (251 hidden) | **FIXED** — `local/list-cap-fixes` (`e8e476b`); guards in `paletteRows.test.ts` |
| `AxisHistoryDockPanel.svelte` | `80` of up to 200 | **No** — and the row click is the *only* jump-back control (`history.revertTo(i)`), so entries past 80 were **unreachable**, not just invisible | **FIXED** — `local/list-cap-fixes` (`55d8563`); guard in `listCaps.test.ts` |
| `CabPicker.svelte:92` | `CAP = 250` (1024 factory IRs) | **Yes** — "showing 250 of N, search to narrow" | OK as-is |
| `PresetPicker.svelte:149` | `300` (512 slots) | **Yes** — "+N more — type a number or name to filter" | OK as-is |
| `AxisFcPartPanel.svelte:220` | `64` flat configs | **Yes** — "+N more" (corrected; first draft said undisclosed) | OK as-is |
| `presetBrowserWorkbenchLayout.ts:19` | `AXIS_PB_SOFT_ROW_CAP = 14` | **Yes** — expander "Show all N presets" (`AxisPresetBrowserPartPanel.svelte`); `applyRowCap` already returns `totalRows`/`capped`/`hiddenCount` and is unit-tested | OK as-is |

The rule is executable now: `src/lib/listCaps.test.ts` guards the uncapped surfaces stay uncapped and
the four capped ones keep rendering their disclosure.

Related *diagnostic* half of this class: when a parameter is dropped by an allowlist gate, the UI shows
nothing rather than "hidden because …". `GET /diag/ranges` exists (`ForgeFX` `server/src/app.ts`) but is
not surfaced — see §3.6 item 3.

---

## 6. Uncertain / needs verification (probe list, no guessing)

1. **Is the MIDI block placeable on the FM3?** The catalog has a `MIDIBLOCK` family (13 params) and
   `SMI: 'MIDIBLOCK'` mapping, but no virtual effect / roster entry was confirmed. → list `GET /blocks`
   from a live FM3 and check for a midi/smi slug.
2. **Which GLOBAL params are actually served?** → `GET /diag/ranges?family=GLOBAL&pid=<n>` for the 25
   `unverified` pids; open Setup on a clean store and diff the rendered controls against the catalog.
3. **Scene ops over the wire.** `setScene` is deliberately fire-and-forget (`BACKLOG.md` W1.1: scene is
   not in the write-protocol op table). Copy/swap/bulk scenes need a plan: either new ops (verify they
   exist) or a client-side dump→store sequence. **RESOLVED 2026-10-06 (§2.1):** no wire op is needed —
   a scene IS a per-block bypass+channel (X/Y) map, so copy/paste/swap/engage-all/bypass-all are
   client-side sequences over the EXISTING `POST /scene` + `GET /preset/scene-state` +
   `POST /preset/blocks/:eid/bypass|channel` (see `src/lib/sceneOps.ts`). A whole-scene param dump
   (beyond bypass/channel) still needs the preset-binary model below.
4. ~~**Is a preset-binary parser in scope?**~~ **ANSWERED 2026-10-06: it already exists.** `forgefx-midi/
   src/devices/gen3/presetDump.ts` handles the 0x77/0x78/0x79 read chain and `presetBody.ts` decodes
   grid / channels / types / amp knobs / **modifiers** / scene controllers; `ForgeFX` exposes it via
   `POST /preset/decode`. The genuine remaining gap is host→device **write-back** of that chain.
5. **Does FM3 store performance pages / setlists in the preset or in system memory?** Determines
   whether either can be built without new RE.
6. **Cab 2 Mute/Solo write path** (see §3.7) — the outstanding hardware check from the last handoff.
7. **Setlists/Songs availability** on Andy's firmware (added in a later fw line; confirm the unit's
   version supports it before treating §2.3 as a target).

---

## 7. Suggested sequencing

**Cheap + high value (no RE, no new endpoints)** — items 1-4 and 6 **DONE 2026-10-06** (merged to `main`).
1. ~~**Revert Preset** (§2.7)~~ — **DONE** (same-slot re-select; `revertPreset.ts` + history barrier).
2. ~~**Grid operations**: block copy/paste, reset channel/block, disconnect-all, block swap (§2.9)~~ —
   **DONE** (`planDisconnectAll/planInsertShunt/planResetBlock/planSwap/planPasteBlock` in `gridRouting.ts`;
   ⌘D/⌘U/⌘I/⌘C/⌘V). Caveat: reset restores placement+wires, not the pre-reset param VALUES (v1 limit).
3. ~~**Channel copy/paste/reset** (§2.10)~~ — **DONE** (`blockOps.ts` + Block Editor footer).
4. ~~**Keyboard shortcut map** (§2.12)~~ — **DONE** (`shortcuts.ts` registry; 17 wired, 4 reserved).
5. **Mute + Scene Ignore** (§3.1) — **Scene Ignore DONE** (served `*_SCENEIGNORE` enum); **Mute
   left disabled** (no served generic per-block mute param — see §3.1).
6. **Block-pane height / search-card** UX fixes (§3.6 items 1-2) — **DONE** (board fits without
   scrolling at 1440×900 / 1280×800; compact search rows). Item 3 (surface the *existing* CLI-only
   `GET /diag/ranges` in the UI) is still **open** — cheap, no new endpoint.

**Moderate (new endpoints / structured UI)**
7. ~~**Scene Manager page** (§2.1) with copy/swap/bulk engage~~ — **DONE 2026-10-06**
   (`sceneOps.ts` + `AxisSceneManagerPanel.svelte`, panel type `axis.sceneManager`); §6.3 resolved via
   client-side sequences over the existing endpoints (no new route).
8. **Setup expansion**: MIDI/Remote tables + FC config (§2.8) — needs §6.2 and possibly new ops.
9. **FC Edit completion**: per-preset switches, layout links, CS MIDI, devices/config, layout
   import/export (§3.8).
10. **Preset Librarian / Manage Presets** (§2.4) — needs slot move/swap/copy ops.
11. **Block library (.blk-style)** if a Fractal-compatible format is wanted (§2.6).
12. **Surface `GET /diag/ranges` in the UI** (§3.6 item 3) — the endpoint already exists (server-side,
    `server/src/app.ts`); this is a small client panel. Ends the profile-vs-catalogue guessing class.

**Keystone / research**
13. ~~**Preset-binary parser**~~ — **ALREADY EXISTS** (read path; see §5). The keystone work left is
    **surfacing** it: **modifier read-back** (§3.2, in flight), then **Performance pages** (§2.2),
    **Setlists/Songs** (§2.3), **IR/cab management** (§2.5).

**Deferred / N/A on FM3**
- Global blocks (§2.9) — Axe-Fx only.
- NAM Manager — Axe-Fx III only (fw 2026 line).
- IR Capture — front panel / III-editor.

---

## 8. Evidence index (fast re-orientation for the next session)

| Topic | File |
|---|---|
| Seed pages, placeholders for Scenes/Live, convert page | `src/lib/axis-workbench/axisWorkbenchPages.ts` |
| Placeholder panel component | `src/lib/axis-workbench/panels/AxisPlaceholderPanel.svelte` |
| Legacy rail (Perform/Sets toasts) | `src/lib/ToolRail.svelte` |
| Mute / Scene Ignore | `src/lib/BlockEditor.svelte` footer, `src/lib/blockOps.ts`, `src/lib/blockOps.test.ts` |
| Preset browser "soon" actions | `src/lib/PresetBrowser.svelte:519,548` |
| Modifier editor limits | `src/lib/ModifierEditorCore.svelte` |
| FC editor model/limits | `src/lib/FcEditor.svelte`, `src/lib/axis-workbench/fc/*` |
| Undo/redo scope | `src/lib/history.svelte.ts` |
| Shortcuts | `src/routes/+page.svelte:86-94` |
| Client API surface | `src/lib/forgefx.ts` |
| Server route table | `ForgeFX/server/src/runtime/router.ts` |
| KNOB_UNITS / range serving | `ForgeFX/server/src/drivers/gen3.ts:141-143, 557-578` |
| Virtual effects | `ForgeFX/server/src/drivers/registryCore.ts` (`GEN3_VIRTUAL_EFFECTS`) |
| FM3 parameter catalog (2021 rows) | `forgefx-midi/catalog/fm3.json` |
| Existing open handoff work | `docs/handoff-cab-mute-and-dynacab.md` |
| Prior gap analysis (partly stale) | `docs/ROADMAP.md`, `docs/axis_layout_rework_review_and_remaining_plan.md` |
| Defect backlog (all merged) | `~/repos/stack/BACKLOG.md` |
