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
- Still missing: **scene-level "Set all CS" / control-switch state per scene** — **GATED (no invented
  eid/paramId)**, verified 2026-10-06. The catalog carries the 48 per-scene `PRESET_FC_SCENE<n>_CS<m>_MODE`
  rows (family PRESET, paramId 1285..1332; enum ON/OFF/LAST) plus 3 action rows (`_CS_ALL_ON` 65521 /
  `_CS_ALL_OFF` 65522 / `_CS_RESET` 65520; 51 rows total). They are **not addressable** through any
  shipped API: family PRESET has **no wire effectId** (`FM3_EFFECT_IDS.PRESET === null`, test-enforced in
  `forgefx-midi/test/gen3/modern-family/catalog.test.ts`; `profile.familyForEffectId(57|200)` and
  `familyForEffectId(200)` are `undefined` in the built server), so `GET /preset/blocks/:eid/params` can
  never serve them and `PUT /preset/blocks/:eid/params/:paramId` has **no verified eid** to target.
  Neither `GET /preset/blocks` (grid blocks only) nor `GET /preset/scene-state`
  (`{effectId,bypassed,channel}`) carries CS state. On the device the rows sit in the PRESET **section**
  (sectionTag 57 of the param walk; enum ON/OFF/LAST) — the preset-dump/section space — and host→device
  write-back of that space does not exist (§6.4). The one candidate eid (200 / `ID_PRESET_FC`, from the
  `CONTROLLERS` layout page's `crossBlock`) is deliberately excluded from the FM3 effectId table and is
  hardware-**unverified** — do **not** build on it. Revisit only after a capture proves the
  `(eid, paramId)` for family PRESET (see §6.8).
- Still missing: **scene-controller / per-scene param values** beyond bypass+channel (scene controllers
  are surfaced by the Controllers screen; a whole-scene param dump needs the §6.4 preset-binary parser).
- Scene Ignore per block is **done** (see §3.1).

### 2.2 Perform / Live view — **Done (v1 — locally-persisted page)** · 2026-10-06
FM3-Edit exposes **Global Performance pages** and **Per-Preset Performance pages** (assign any
parameter to a big performance knob/switch). Axis's Live page was a placeholder
(`axisWorkbenchPages.ts`), and the legacy rail's **Perform** entry is a "coming soon" toast
(`ToolRail.svelte:11, 68-69`). Axis now ships a real **Performance / Live** page: an ordered list of
`(family, paramId)` bindings rendered full-screen as **large, Deck-friendly tap targets** (− / + step
for knobs, tap-to-cycle for enums), plus quick access to scenes, preset prev/next, the tuner, and tap
tempo. Built on the workbench widget machinery's pinned-control path (`editor.setPinnedParam` /
`setPinnedEnum` + `registerPinnedBlock`), so a bound block reads/writes live even while another block
is open. The model + helpers live in `src/lib/performancePage.ts` (unit-tested); the panel is
`panels/AxisLivePanel.svelte` (+ `PerformanceTile.svelte`), panel type `axis.live`, wired through the
page spec / registry / normalization chain with a marker-free self-heal (`ensureAxisLivePanel`) for
persisted placeholder docs.
- **Persistence is LOCAL ONLY.** Whether the FM3 stores performance pages in the preset binary or in
  system memory is **unknown** (see §6.5) — so the page definition is persisted in `localStorage`
  (`axis.performancePage.v1`), is **never written to the device**, and the UI says so explicitly. No
  endpoint was invented.
- The legacy rail's **Perform** entry (§ToolRail) is still a toast — it is a separate legacy surface
  from the workbench Live page and was left untouched.
- **Next step:** device-side storage needs RE (§6.5). If it turns out the FM3 stores Global/Per-Preset
  performance pages, this local model is what would be serialised into that region.

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

### 2.8 MIDI / Remote configuration — **Partial** (Setup → MIDI / Remote section shipped)
FM3-Edit's Setup covers **MIDI/Remote**: device MIDI channel, **Program Change mapping** (per-slot PC
table), **CC mapping**, **Scene MIDI** messages, preset mapping. Axis now renders the **served** MIDI
settings as a dedicated **MIDI / Remote** section on the Setup (GLOBAL, eid 1) screen
(`src/lib/midiRemote.ts` + `MidiRemoteSection.svelte`, mounted by `VirtualScreen.svelte`); the parts the
served param set cannot represent are shown as honest **disabled rows** (tooltip = addressing + reason),
never faked.

**Verified ground truth (2026-10-06, against the trees — the previous "no eid" claim was WRONG):**
- **No placeable MIDI block.** `GET /blocks` (`gen3.ts blocksCatalog`) enumerates `effectRoster()` over
  the grid `EFFECT_BASES` table; MIDIBLOCK is not in it. MIDIBLOCK is `addressing: 'virtual'`
  (forgefx-midi `src/gen3/fm3/effectIds.ts`, firstId **190**, name **"Scene MIDI"**), so it can never be
  placed on the grid.
- **MIDIBLOCK IS addressable** as a virtual effect: ForgeFX maps **eid 190 → 'MIDIBLOCK'**
  (`devices.ts VIRTUAL_EID_FAMILY`). BUT the FM3 catalogue carries **zero ranges and zero enum vocab**
  for the family (`catalog/fm3.json` has no `FM3_RANGES.MIDIBLOCK` / `FM3_ENUM_OVERRIDES.MIDIBLOCK`;
  CATALOG-COVERAGE.md lists MIDIBLOCK under "Ranges — zero-calib utility families"), so every param is
  dropped by the server's serve filters and `blockParams(190)` returns **no controls**. A Scene-MIDI
  screen would be an empty dead end → **none is offered** (and eid 190 is deliberately NOT added to
  `GEN3_VIRTUAL_EFFECTS`).
- **Served GLOBAL MIDI params** (the section's specs — real device paramIds): `GLOBAL_MIDI_CHAN` (68,
  enum 1..16/OMNI), `GLOBAL_MIDI_PROG_CHANGE` (69), `GLOBAL_NO_REDUNDANT_PC` (70), `GLOBAL_PC_OFFSET`
  (71, knob 0..383), `GLOBAL_SEND_MIDIPC` (73), `GLOBAL_MIDI_MAPPING` (97, OFF/ON **enable** only),
  `GLOBAL_CC_BYPASS_TYPE` (104), `GLOBAL_SEND_REALTIME_SYSEX` (113), `GLOBAL_RCV_MIDI_CLOCK` (14874),
  `GLOBAL_SEND_MIDI_CLOCK` (14875).
- **Not served**: `GLOBAL_REMOTE_MUTE` (114 — unit `unverified`, no range row → dropped by `blockParams`).
- **Still impossible** (honest disabled rows, see `MIDI_REMOTE_GAPS`): the per-slot **PC/CC mapping
  tables** (pid 97 is only the enable; the table is a structured array with no wire param), the **Scene
  MIDI block** (eid 190, zero calibration), and **Remote Mute** (pid 114).

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

### 3.3 Scenes page & Live page — **Scenes done, Live done**
The Scenes page is now the real Scene Manager (§2.1). The Live page is now the real Performance / Live
page (§2.2). No dead-end (the no-dead-nav rule is honoured).

### 3.4 Preset browser device-slot actions — **Wired (duplicate/swap), honest stubs for the rest**
The DEVICE-row context menu now wires **Duplicate** and **Swap with slot** (round 2/3) over the
copy-by-store sequence in `presetSlotOps.ts`; **Move** and **Delete everywhere** render **disabled with
a reason** (the FM3 wire protocol has no slot-erase op — see §2.4). The remaining `SOON` set
(`PresetBrowser.svelte` `['removeDevice','move','delete']`) is only the legacy toast fallback for
NON-device rows (converted/cloud/local entries). See §2.4.

### 3.5 Setup / Controllers depend on the virtual-effect mechanism — **Partial**
Setup = GLOBAL only; Controllers = CONTROLLERS block only. Both are gated on
`caps.virtualEffects` (`ToolRail.svelte:30-42`), so on a legacy v1 server or AM4 **the whole Setup
screen disappears**. FM3-Edit's Setup is broader (MIDI/Remote, FC config, utility, calibration).

### 3.6 Known UX defects already logged (still open)
From the current handoff (`docs/handoff-cab-mute-and-dynacab.md` §"REMOTE WORK"):
1. **Block pane too short** — **ADDRESSED** (drawer expands on open + GridMap yields). NOTE the
   "fit-to-view cell scale" candidate was tried and **reverted the same day**: it shrank dials to
   ~30px on tall boards. The accepted behaviour is a board that always fills the pane width and
   **scrolls** (the card is the scroll container). See `ControlSurface.svelte`.
2. **Control search renders full control cards** — **DONE** (compact `.resrow` list; many matches visible).
3. **`GET /diag/ranges` not surfaced in the UI** — the endpoint that would end the
   "profile-vs-catalogue" guessing class is CLI-only. (It lives in `server/src/app.ts`, NOT in
   `runtime/router.ts` — grep BOTH route files before concluding an endpoint is missing.)
   **ADDRESSED:** the Device Tools modal now has a "Range trace" panel
   (`src/lib/DeviceTools.svelte` + `src/lib/rangeTrace.ts`) that queries the endpoint by family/pid
   and shows, per paramId, the row that serves it vs the catalogue row.
4. **Pseudo-params (`CABINET_BTN_MUTE<n>`) resolved client-side** by matching a served NAME — fragile;
   the driver could rewrite them server-side. **ADDRESSED:** the ForgeFX gen-3 driver now rewrites a
   `_BTN_` pseudo layout control to the REAL served param it drives while serving the layout
   (`resolvePseudoParamControls` in `ForgeFX/server/src/devices.ts`, wired in `gen3.ts` `blockParams`),
   so the served layout carries live ids (cab M → `CABINET_MUTE1/2`, pids 24/25) and no client matches a
   name. The Axis board builder keeps its name-matching resolution only as a **documented fallback** for
   servers that predate the rewrite (`deviceLayoutBoard.ts` `btnPseudoParamKey`); a sibling with no served
   param of its own (the S button — SOLO is an option of the MUTE enum) still gaps, collapsing the M/S
   pair onto the one state control.
5. **Touch targets**: 53 sub-40 px interactive elements at 1280×800 (preset arrows 24×36, slot chips
   21×22) — **ADDRESSED** (already shipped): `AxisWorkbenchWidget.svelte` scopes an enlarged hit area to
   `@media (pointer: coarse)` via transparent `::after` overlays, leaving desktop density untouched;
   guarded by `e2e/23-touch-targets.spec.ts` (asserts the coarse hit area grows AND the fine-pointer
   boxes are unchanged).
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
  → **Addressed:** the metadata-driven controls (LED colour, custom label, display-mode label) are now
  GATED — rendered disabled with the exact missing metadata named — instead of hidden. Decision logic
  is pure/shape-derived in `src/lib/axis-workbench/fc/fcFieldGates.ts`; the FM3 served model carries
  every table (0 gated), FM9 gates colour + custom label, the III gates all three. Still worth probing
  the served `/fc/model` field coverage against FM3-Edit as a separate check.

### 3.8 FC Edit sub-features missing vs FM3-Edit
Present: layouts × views × switches, tap/hold function, category, display mode, params, LED colour,
custom label, live read-back. Status after the FC-parity round (`fcParity.ts` +
`fcLayoutPackage.ts`, wired in `FcEditor.svelte`; the served `/fc/model` is the sole source of truth):
- **Per-Preset Override / Per-Preset switches** — **switch assignment DONE**: category “Per-Preset”
  (ord 9) is served, so a switch can reference a PP slot through the existing category/function UI
  (hinted in the editor). The **per-preset definition itself is GATED**: it lives in the preset
  binary, not the FC param space (§5) — shown as a gated parity row, no invented paramId.
- **Layout Links** (switch changes layout after press) — **DONE via the served Layout category
  (ord 6)**: functions Select / Master Layout / Inc-Dec render through the generic per-switch
  fields; the editor hints the mapping. No separate device param exists (verified in `fcModel`).
- **CS MIDI** (control-switch MIDI assignment) — **GATED**: it is a Setup → MIDI/Remote table
  (§2.8); no FC (eid 199) param serves it.
- **FC Config** (startup layout/view, 1:1 copy) and **Devices** tab (mirroring) — **GATED**:
  external-FC device settings; no served param exposes them.
- **Import / export layouts** (backup) — **DONE** (client-side, `fcLayoutPackage.ts`): Axis JSON
  `.fclayout.json`, FM3 exports by live read-back (`/fc/state`), blind devices export the session’s
  values; import validates then writes back field-by-field with configs remapped to the target layout.
- **Master Layout Menu warning / edit** precondition — still open.
- **Songs/Setlists** integration (§2.3) — still open (needs §2.3).

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
8. **Are the 51 `PRESET_FC_SCENE*_CS*_MODE` rows fn=0x01-addressable?** Family PRESET has no wire
   effectId (`FM3_EFFECT_IDS.PRESET === null`; `familyForEffectId(57)` = `familyForEffectId(200)` =
   `undefined`). The device param walk lists them in **section 57** (family PRESET; enum ON/OFF/LAST),
   and the `CONTROLLERS` layout's "CS per Scene" page carries them as `crossBlock: ID_PRESET_FC` —
   whose roster firstId is **200** (flagged `addressable:false` = MIDI-bypass only, not fn=0x01). So the
   real question is whether **eid 200** is the fn=0x01 effectId for family PRESET on FM3. → **Probe:**
   with the FM3 connected, `POST /preset/blocks/200/read` `{"pids":[1285]}` (or `/readrange`) and
   `GET /preset/blocks/200/raw`, and watch the reply for pid 1285's value/label; if the device answers
   with the CS ordinal, add eid 200 to `FM3_EFFECT_ID_TABLE` (`family:'PRESET', firstId:200`) and build
   the Scene-Manager CS section on the generic codec. Do NOT assume 200 until the capture answers.

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
6. **Block-pane height / search-card** UX fixes (§3.6 items 1-2) — **DONE** (compact search rows).
   Item 3 (`GET /diag/ranges` in the UI) is **DONE** too — see §7.12. NOTE: the fit-to-view cell cap
   added here was **reverted the same day** — it shrank dials to ~30px on tall boards; the board now
   always fills the pane width and scrolls instead (see ControlSurface).

**Moderate (new endpoints / structured UI)**
7. ~~**Scene Manager page** (§2.1) with copy/swap/bulk engage~~ — **DONE 2026-10-06**
   (`sceneOps.ts` + `AxisSceneManagerPanel.svelte`, panel type `axis.sceneManager`); §6.3 resolved via
   client-side sequences over the existing endpoints (no new route). The CS-state remainder is
   **GATED** (§2.1): family PRESET has no wire effectId, so there is no eid to write — see §6.8.
8. **Setup expansion**: **MIDI/Remote section DONE 2026-10-06** (§2.8 — served GLOBAL MIDI params +
   honest gated rows; `midiRemote.ts` + `MidiRemoteSection.svelte`). Remaining: the per-slot PC/CC
   mapping **tables** and the Scene MIDI block are **impossible** on the served param set (see §2.8);
   FC config stays gated.
9. **FC Edit completion** (§3.8) — **PARTIALLY DONE**: Layout Links + Per-Preset switch assignment
   (served Layout/Per-Preset categories) and layout import/export shipped; CS MIDI and FC
   devices/config **gated** (no served param); per-preset definitions blocked on the preset-binary
   parser (§5).
10. ~~**Preset Librarian / Manage Presets** (§2.4)~~ — **DUPLICATE + SWAP DONE 2026-10-06** (both the
    monolith `PresetBrowser.svelte` and the workbench menu, over the copy-by-store sequence in
    `presetSlotOps.ts`). **Move / Delete remain impossible**: the FM3 wire protocol has no slot-erase
    op, so they are honest disabled entries. No new endpoint was needed.
11. **Block library (.blk-style)** if a Fractal-compatible format is wanted (§2.6).
12. ~~**Surface `GET /diag/ranges` in the UI** (§3.6 item 3)~~ — **DONE 2026-10-06** (round 2:
    `rangeTrace.ts` + the Device Tools "Range trace" panel; the endpoint already existed in
    `server/src/app.ts`).

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
