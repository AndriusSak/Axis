# Axis × FM3-Edit / FM3 hardware — feature-parity audit

**Type:** audit / backlog, not a promise list.
**Date:** 2026-10-06 · **Author:** Lykos (session audit)
**Branches inspected:** Axis `local/dynacab-mic-graph` (main checkout, `~/repos/stack/Axis`),
ForgeFX `main`, forgefx-midi `master`.

**What this is.** A gap analysis of Axis against what FM3-Edit and the FM3 hardware itself can do,
plus a list of features Axis already ships *incompletely*. Everything here is a **candidate** with
evidence (file/line or catalogue fact). **Nothing is hardware-verified** unless it says so — the
whole point of writing it down is so the next session starts from evidence instead of re-deriving it.

**Re-verified against HEAD `8ec6e40` (2026-10-06, later the same day):** §2.4, §2.6, §2.13 and §3.2
had **already shipped** by the time this draft was read back, and are corrected below. Rule: trust the
code over any tag in this file — a tag that disagrees with HEAD is a bug in the tag.

**Re-verified against HEAD `45484f3` (2026-10-07, round R16–R20):** §2.4 (reorder + Reset AMP per
preset), §2.10 (honest cross-preset block paste), §2.11 (param-value clipboard), §2.12 (the last four
reserved chords) and §3.5 (Setup/Controllers gated honestly) **shipped**; §3.8's Master-Layout-Menu
warning item is **STOPPED as unverifiable**. Round table + verification in §7.

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
  (sectionTag 57 of the param walk; enum ON/OFF/LAST) — the preset-dump/section space — and there is no
  host→device write-back of *that section's rows* (the dump chain itself IS writable — §5 — but no
  per-section addressing exists). The one candidate eid (200 / `ID_PRESET_FC`, from the
  `CONTROLLERS` layout page's `crossBlock`) is deliberately excluded from the FM3 effectId table and is
  hardware-**unverified** — do **not** build on it. Revisit only after a capture proves the
  `(eid, paramId)` for family PRESET (see §6.8).
- Still missing: **scene-controller / per-scene param values** beyond bypass+channel (scene controllers
  are surfaced by the Controllers screen; a whole-scene param dump needs the §6.4 preset-binary parser).
- Scene Ignore per block is **done** (see §3.1).

### 2.2 Perform / Live view — **Done (v1 — locally-persisted page)** · 2026-10-06
FM3-Edit exposes **Global Performance pages** and **Per-Preset Performance pages** (assign any
parameter to a big performance knob/switch). Axis's Live page was a placeholder
(`axisWorkbenchPages.ts`), and the legacy rail's **Perform** entry used to be a "coming soon" toast —
**corrected 2026-10-07 (R28, `2244c2c`)**: the rail no longer toasts; an unavailable screen renders
visible + disabled with its real reason (`ToolRail.svelte:64-67`, `gateRailItems.ts`). Axis now ships a real **Performance / Live** page: an ordered list of
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
- The legacy rail's **Perform** entry (§ToolRail) is **no longer a toast** (R28, `2244c2c`): the rail
  row is visible + disabled with its reason, and `gateRailItems.ts` stopped proxying it through
  `caps.gridRouting`. The workbench Live page above is the real surface.
- **Next step — storage now known (§6.5, official sources):** the FM3 has two Performance pages —
  **Perform-PP (per-preset)** is part of the **preset** (save the preset to commit), **Perform-Gbl
  (global)** is in **Global Settings**; each hosts ten controls, set up only in FM3-Edit (a "power-user
  routine not possible on the unit itself"). So the per-preset page should be decoded from the preset
  body — our `presetBody.ts` does **not** surface it today (`grep -i perform` → 0) — and the global page
  read/written through the system/global path. The local Axis model is what would be serialised into
  whichever region. Exact frames still need a capture.

### 2.3 Sets & Songs (Setlists) — **Parked (no FC controller)** · 2026-10-07
FM3 firmware ≥ 9 exposes **Setlists/Songs** (custom preset/scene order for live use) and FM3-Edit has
a corresponding area with **import/export**. Axis: no page, no nav entry in the workbench (the legacy
rail's `sets` falls through to the toast path, `ToolRail.svelte:12`), no endpoints.
- **Storage known (§6.5, official sources):** a global SETUP area, **"FC Setlists/Songs"** (system
  region, **not** a preset) — no preset-binary work involved.
- **PARKED — the feature REQUIRES an FC-6 or FC-12 foot controller** (manual: "The Setlist Songs feature
  requires an FC-6 or FC-12") and **Andy has none (confirmed 2026-10-07)**, so this is **not a target for
  this rig**. Revisit only if an FC is added. Do not dispatch work on it.

### 2.4 Manage Presets (bank librarian) — **Partial** (duplicate + swap + reorder + Reset AMP per preset DONE; move/delete impossible)
FM3-Edit's **Manage Presets** does multi-select **reorder / move / swap / duplicate / delete**
across device slots, drag-and-drop, plus **Reset AMP blocks** per preset. Axis's preset browser is a
*viewer/loader*, and (verified at HEAD 2026-10-06) the DEVICE-row context menu in BOTH browsers — the
monolith `PresetBrowser.svelte` and the workbench panel — wires **Duplicate** and **Swap with slot**
over the copy-by-store sequence in `src/lib/presetSlotOps.ts`; **Move** and **Delete everywhere** are
honest disabled entries (no slot-erase op on the wire — §3.4). The `SOON` list is now only the legacy
toast fallback for NON-device rows.
- **No new endpoint was needed:** `POST /preset/store` + `POST /preset/name` + the location scan cover
  the shipped ops. The FM3 wire protocol exposes **no slot copy/erase** primitive, so Move/Delete stay
  honest negatives rather than fakes.
- **DONE 2026-10-07 (§2.4 remainder):** multi-select **reorder** across slots and **Reset AMP blocks
  per preset** — `slotReorderOps.ts` (a CONTENT PERMUTATION over the copy-by-store transport: dump →
  load edit buffer → store; refuses anything that is not a permutation of the same slot set) and
  `resetAmpOps.ts` (the device's own AMP model re-select per slot over the `batchSetOps` sequence).
  Both surface as select-head "Reorder…" / "Reset AMP…" actions in the workbench preset browser, each
  with a dry-run preview, explicit confirm and abort reporting (captures every source dump before any
  write; aborts on the first error naming the moves already written; re-selects the origin preset).
  No new endpoint. **DONE 2026-10-07 (R23):** **drag-and-drop reorder** in the Manage Presets area —
  HTML5 DnD that permutes the same order array and calls the SAME `planSlotReorder`/`runSlotReorder`
  path (single order source; dry-run → confirm → abort unchanged; the same-slot-set guard untouched).
  **Move / Delete everywhere** stay honest negatives (no slot-erase op on the wire).

### 2.5 User Cab / IR management — **Partial** (upload / library / slot state DONE and hardware-cycled; the Manage-Cabs UI and the import options are still absent)
FM3-Edit: **Manage Cabs** (reorder/rename/delete user IRs), **IR import** (`.wav`/`.ir` with MPT /
Auto-Trim / output format options), Scratchpad naming, UltraRes marking.

**This entry said "Absent" when the audit was written on 2026-10-07; it is now measured otherwise.** Verified
2026-10-11 against the route tables and the unit:
- **IR upload WORKS and was load-tested on the FM3** — `POST /cab/ir/upload` (Content-Type MUST be
  `application/octet-stream`, or JSON `{bytes:[…]}`; a bare `--data-binary` gets 415). The multi-frame transfer,
  the close frame's CONTENT CHECK (a mismatch makes the unit DISCARD the upload) and a per-slot state read
  (`fn=0x01 sub=0x4B`, the same `[index, page]` pair the IR picker uses) were all measured on hardware, and the
  verification rule is real: `ok` means every frame was acked AND the close answered `0x00`.
- **A server-side cab-IR BYTE LIBRARY** persists the bytes of IRs uploaded through Axis (`GET /cab/library`,
  `GET /cab/library/:id/bytes`; `runtime/cabLibrary.ts`, cap 200, oldest evicted) and the **move** action uses the
  STORED bytes (sha256-matched), so a later move needs no file. Only a VERIFIED upload is stored.
- **Cab-slot DELETE is solved** — `POST /cab/slots/clear` (there is no remove opcode; the clear is the primitive),
  `GET /cab/slots` reads per-slot state. Both surfaces carry every one of these routes.

**Still absent:** the **Manage Cabs** UI (reorder/rename/delete as a browser), the **import options**
(MPT / Auto-Trim / output format), Scratchpad naming, UltraRes marking, and an IR-capture UI (IR capture on the
FM3 is front-panel/III-editor). Per-slot IR **data** reads do not exist — the boundary was probed and measured —
so nothing can name or edit an IR the stack never uploaded, and the library's scope line says so.

### 2.6 Library (block/channel library on disk) — **DONE (Axis-local format)** · 2026-10-06
FM3-Edit's **Library** stores named **blocks (all 4 channels) and single channels** as `.blk` files,
recallable into any instance, shareable, with modifiers included for whole-block saves.
**Shipped 2026-10-06** (`src/lib/blockLibrary.ts` + `blockLibrary.svelte.ts` + `BlockLibraryPanel.svelte`,
wired through `BlockEditor.svelte` / `editorSurface.ts` / `editor.svelte.ts`): a named **local** block
library with save / list / search / rename / delete / recall, plus **`.axblk` export/import**.
- The format is **Axis-local, deliberately NOT byte-compatible with Fractal's `.blk`** (a
  Fractal-internal format). FM3-Edit `.blk` interop is **not** a goal of this build.
- Axis's **workbench library drawer** is a *layout* library (pages/panels/widgets) — a different
  thing. Don't conflate them.
- **Remaining (optional, low value):** Fractal-compatible `.blk` import/export, if ever wanted.

### 2.7 Preset templates, bundles, snapshots-to-folder — **Partial** (Recent + Snapshot + Revert **done**; templates **DONE (local-only)**; Clear Preset **not possible**; bundles/.bnk still absent)
FM3-Edit: **New from Template / Save as Template**, **Preset+Cab bundle** export/import, **Snapshot**
button writing `name.syx` into a Snapshots folder, **Clear Preset**, **Revert Preset** (discard
unsaved changes back to the stored version), import from `.bnk` banks, **Recent Presets**.

**Verified 2026-10-06 against the trees:**
- **Revert Preset — DONE** (same-slot re-select; `revertPreset.ts` + history barrier — see §7 item 1).
- **Recent Presets — DONE (local-only).** A shared, locally-persisted MRU store
  (`src/lib/recentPresets.ts`, `localStorage` key `axs.recent.v1`, cap 12, dedupe by library entry id)
  is recorded on browse/load and surfaced in BOTH preset browsers — the workbench
  `axis-workbench/panels/preset-browser/AxisPresetBrowserPartPanel.svelte` (a "Recent" section in the
  Sources sidebar) and the monolith `PresetBrowser.svelte` — plus the Preset Picker. NOTE: the picker
  previously kept a picker-LOCAL recents array in `axs.presets`; that duplicate is now retired in
  favour of the one shared store. **Local-only** (never leaves the machine; no server route involved).
- **Snapshot to folder — DONE.** A "Snapshot" button in Device Tools writes the CURRENT preset as
  `<name>.syx` into `Presets/Snapshots/` (`editor.snapshotToFolder()` → `runSnapshotToFolder`). It
  REUSES the existing per-slot **version-history / `.syx` export** pair — `forgefx.snapshotPreset(slot)`
  (captures a version) → `forgefx.versionSyx(id)` (that version's `.syx` bytes), the SAME calls the
  browser's `deviceEntryBytes()` and the picker already use — then writes through the existing
  local-folder route `forgefx.saveLocalPreset(name, bytes, { dir: 'Snapshots' })` (`POST /local/presets`
  → `Presets/Snapshots/<name>.syx`). **No second export path was added.** Falls back to a browser
  download when no Presets folder is configured; overwrites only after the user confirms.
- **Clear Preset — NOT POSSIBLE (honest negative; nothing was implemented).** The gen-3 write codec
  exposes NO clear/init/edit-buffer-reset op: `forgefx-midi/src/gen3/axe-fx-iii/setParam.ts` exports
  only set/get/bypass/grid/routing/`buildClearBlock` (that clears a single grid CELL), the scene-name
  ops, `buildStorePreset`, `buildSwitchPreset*` and the rename ops — there is no `clearPreset`/
  `initPreset`. The server route table (`ForgeFX/server/src/runtime/router.ts` §preset) has no
  clear/erase route either, and `src/lib/presetSlotOps.ts` already documents "no slot-erase op at all".
  Clearing the edit buffer would require a wire primitive that does not exist → **not a genuine op, so
  not faked.**
- **New from Template / Save as Template — DONE (local-only) · 2026-10-06.** `src/lib/presetTemplate.ts`
  + `presetTemplates.svelte.ts` + `PresetTemplatesPanel.svelte` (opened from Device Tools); registry in
  `localStorage` (`axs.presetTemplates.v1`); format `.axtpl.json` with the captured `.syx` embedded as
  base64. Save reuses the EXISTING export pair (`snapshotPreset` → `versionSyx`, or the active-buffer
  `presetBackup`); load reuses the EXISTING imported-file buffer path (`loadBytes` → `POST /preset/load`).
  **Never written to the device.** Honest limits: the server's local-write route only accepts `.syx`, so a
  configured Presets folder gets a `.syx` mirror under `Presets/Templates/` while the `.axtpl.json`
  itself is a browser download — disclosed in the panel, not hidden.
- **Preset+Cab bundle / `.bnk` bank import — still Absent.**


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
| **Move an entire row / column** (grid border sliders) | **Implemented** | `planGridShiftRow`/`planGridShiftColumn` (`gridShift.ts`) + `editor.shiftRow/shiftColumn` + Signal Grid row/column border controls; an off-edge move is refused with a named reason (never a silent drop); modeled offline in `convertEditor` too. `grep moveRow` → 0 only because the planners are named `planGridShift*`. |
| Explicit **Insert shunt** command/shortcut | **Implemented** | `planInsertShunt` + `editor.insertShunt` (Cmd+U) |
| **Quick Build panel** (Q) | **Implemented (R24)** — a dedicated `axis.quickBuild` panel places blocks through the existing `editor.place`; the `Q` chord opens it (palette unchanged) | `AxisQuickBuildPanel.svelte`, `quickBuild.ts`, `shortcuts.ts` |
| **Grid Navigation Mode** (fast grid ops, skip param fetch) | **Implemented (R25)** — a grid-nav toggle (bare `G` chord + header pill) suppresses the automatic per-block param read on select/navigate/place/route; an explicit open always fetches, and a param edit in nav mode refuses with a named reason | `gridNavMode.ts`, `SignalGrid.svelte` |
| **Block Info** overlay (which blocks are Global) | **N/A on FM3** (Global blocks are Axe-Fx only) | — |

### 2.10 Channel operations — **DONE** (select + copy/paste/reset, across blocks, scenes and presets)
Channels A–D select is present (`editor` channel writes + reflection). **Copy channel → paste
channel**, **reset channel**, and **reset block** are implemented client-side in the Block Editor
footer (`src/lib/blockOps.ts` + `editor.svelte.ts` `copyChannel/pasteChannel/resetChannel/
resetBlock`) over the existing per-block param/type writes — no new endpoint.
- Copy/paste snapshots the channel's served params (knobs by norm, enums by ordinal) keyed by
  device paramId and writes them back; ids the target block does not expose are dropped.
- Reset is the FM3 **model re-select soft reset**: "Reset CH" resets the active channel only;
  "Reset Block" (and the grid's Cmd+I) clears + re-places the block in place — routing preserved,
  structurally undoable.
- **DONE 2026-10-06:** **copy channel across blocks** and **set channel across all scenes**
  (`src/lib/channelOps.ts` + the Block Editor footer). The cross-scene sequence always restores the
  origin scene and reports per-scene failures rather than pretending success.
- **DONE 2026-10-07:** **copy/cut a block across presets** is now honest rather than blind — the
  in-memory `blockClipboard` used to address the SOURCE preset's eid and write the SOURCE paramIds
  blindly. `r19BlockClipOps.ts` (pure decision + injectable IO) decides the target eid against the
  TARGET layout (onto-block, or place reusing the source eid when free, else a free instance of the
  SAME family from the served roster), retypes, RE-READS the target preset's served params and writes
  only the ids it exposes (dropped counted); it gates with a precise reason when no family instance is
  free or the roster is unavailable. `BlockClipboard` gained an additive `preset` field.

### 2.11 Cross-preset / batch editing — **DONE** (batch set + param-value clipboard)
FM3-Edit's hidden **Parameter Batch Set** ("Set In Multiple Presets" on a parameter context menu) is
**implemented**: `src/lib/batchSetOps.ts` (pure planner + injectable IO, the `sceneOps.ts` pattern) plus
the registered workbench panel `axis.batchSet` (action `axis.openBatchSet`) — a dry-run preview of
exactly which slots change, an explicit confirm, then per slot `GET /preset/locations` →
`POST /preset/select` → `PUT /preset/blocks/:eid/params/:paramId` (the `continuous` flag sent
explicitly) → `POST /preset/store`, restoring the origin preset at the end and aborting on the first
error with the precise list of slots already written. **Destructive by design** — it overwrites slots,
and the UI says so. **DONE 2026-10-07 (R22):** reachable from a `batchSet` **action nav entry** in the
workbench rail (plus an idempotent self-heal onto persisted docs) that fires the existing
`axis.openBatchSet` — the panel, its action and its destructive-by-design flow are unchanged.
- **DONE 2026-10-07:** **copy/paste a single parameter VALUE between blocks** — `paramClipOps.ts`
  (pure planner + injectable IO) snapshots one served param by its DEVICE paramId (knob norm / enum
  ordinal) and writes it back through the existing per-block PUT. An id the target block does not
  expose, or a kind mismatch (norm vs ordinal), is DROPPED with a reason — never guessed. Surfaced from
  the EXISTING `ControlSurface` control context menu (`paramClipMenu.ts`); no new footer button.

### 2.12 Keyboard shortcut parity — **DONE** (FM3-Edit parity set)
FM3-Edit is shortcut-rich (Cmd+S save, Cmd+M manage, P preset picker, A/B/C/D channels, Space
bypass, Backspace delete, Cmd+D disconnect, Cmd+U shunt, Shift+Space engage-all-scenes, Cmd+I reset,
arrow-key value nudges…). Axis now has a single-source registry, `src/lib/shortcuts.ts`
(`SHORTCUTS`, data-driven, unit-tested; the `.svelte` hookup is pinned by a source guard in
`shortcuts.test.ts`): **21 chords, all `wired`** — palette, undo/redo, save, preset picker, channels
A–D, bypass, delete block, dismiss, disconnect-all, insert shunt, reset, block copy/paste, plus the
**former four reserved gaps**: ⌘M manage-presets (opens the workbench Preset Browser page, else the
legacy library screen), ⇧Space engage-all-scenes (`sceneOps.bulkBypass` — the Scene Manager's own bulk
sequence, no wire op), ↑/↓ parameter nudges (`paramNudge.ts` over the SERVED min/max/norm or enum
ordinal list, applied via setParam/setEnum; the target is the last-touched param in the open block
editor, falling back to the block's primary control; gated — the key is not swallowed — when nothing
is open / no served step exists). Modifiers must match exactly, and bare chords are skipped while a
text field is focused. Any future FM3-Edit chord with no backing action is registered
`not-yet-wired` with a reason rather than faked.

### 2.13 Preset / cab colour tagging — **DONE** · 2026-10-06
FM3-Edit lets you colour/flag picker entries and filter by colour. **Shipped**
(`src/lib/presetColors.ts` + `library.svelte.ts`, surfaced in BOTH preset browsers through
`presetBrowser/presetBrowserWorkbenchData.ts`): per-entry colour/flag tags + filter-by-colour,
alongside the existing favourites and saved filters.

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

### 3.2 Modifier editor — **read-back DONE** · 2026-10-06 (curve-field writes stay model-gated)
**Read-back SHIPPED** (`src/lib/modifierAssignments.ts` + `ModifierEditorCore.svelte`; guarded by
`modifierAssignments.test.ts` and `modifierReadback.sourceguard.test.ts`). The server decodes a preset
body's modifier assignments and serves them on **`GET /preset/modifiers`** — registered in **BOTH**
route tables (`runtime/router.ts` *and* `app.ts`), decoded in `gen3.ts` from a single preset dump with
no extra wire. The editor now shows the assignment that already owns the opened parameter
(`findModifierForTarget`) and a **"modifiers in use"** list (`modifiersInUse`), degrading to `null` on
404/501 (older server / no read capability).
- Still true from the original note: Channel / PC Reset / Update Rate / Attack / Release / Damping /
  Auto Engage / Off Value are rendered but only written when the model exposes their pid
  ("pending decode" otherwise).
- **DONE 2026-10-07 (R21):** **live curve read-back** — `modifierCurve.ts` decodes the assignment's slot
  curve (min/max/start/mid/end/slope/scale/offset) from the served raw block via the served model
  (`/mod/model` pids + kinds), rendered as a CURVE READ-BACK section; **honest gate** — no model, no
  field def, or no served value ⇒ `pending`, never an invented pid/value; chain-embedded assignments
  (`slot == null`) have no addressable slot and stay pending. **Modifier usage on the Controllers
  screen** — `ModifierUsagePanel.svelte` (reuses `modifiersInUse`/`describeModifier` over the existing
  `GET /preset/modifiers`), mounted by `VirtualScreen.svelte` when the controllers screen is active.

### 3.3 Scenes page & Live page — **Scenes done, Live done**
The Scenes page is now the real Scene Manager (§2.1). The Live page is now the real Performance / Live
page (§2.2). No dead-end (the no-dead-nav rule is honoured).

### 3.4 Preset browser device-slot actions — **Wired (duplicate/swap), honest stubs for the rest**
The DEVICE-row context menu now wires **Duplicate** and **Swap with slot** (round 2/3) over the
copy-by-store sequence in `presetSlotOps.ts`; **Move** and **Delete everywhere** render **disabled with
a reason** (the FM3 wire protocol has no slot-erase op — see §2.4). The remaining `SOON` set
(`PresetBrowser.svelte` `['removeDevice','move','delete']`) is only the legacy toast fallback for
NON-device rows (converted/cloud/local entries). See §2.4.

### 3.5 Setup / Controllers depend on the virtual-effect mechanism — **Done (honest gate)** · 2026-10-07
Setup = GLOBAL only; Controllers = CONTROLLERS block only. Both were **FILTERED out of the rail**
whenever the served caps lacked the backing virtual effect (`caps.virtualEffects = []` on AM4/VP4 or a
legacy v1 server), so **the whole Setup screen disappeared with no explanation**. Now they stay
**visible and render DISABLED with the exact capability reason** in their tooltip (no-dead-nav rule,
01-shell §9). Visibility/availability is derived from the SERVED capabilities (never a device id) by
the pure module `src/lib/gateRailItems.ts` — unit-tested against the real device cap shapes (grid trio
vs AM4) and source-guarded against the old silent-filter branch; `ToolRail.svelte` renders the state in
both the desktop rail and the mobile drawer. No user-visible label changed. Still true: FM3-Edit's
Setup is broader (MIDI/Remote, FC config, utility, calibration) — the served-param limits are §2.8/§3.7.

### 3.6 Known UX defects already logged (5 of 6 addressed; only item 6 open)
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
- **GLOBAL family: 25 params are `unit: 'unverified'`** in the FM3 catalog — **largely RESOLVED
  2026-10-07 (P1.2, `2fa29d9`)**. The original diagnosis was that `KNOB_UNITS` (`gen3.ts:157-159`)
  excludes `unverified`, so any *float* row on those defs is dropped from the served knob list (the
  mechanism that had deleted the DynaCab Position param). The fix makes the **device's own editor
  layout** the evidence: `layoutWidgetByFamily()` (`devices.ts`) indexes every layout `knob`/`dropdown`
  binding by the param's OWNING family, and the serve filters honour it, so a param the device draws is
  served even when the catalog unit/kind disagrees. `GLOBAL_FS_BRIGHTNESS` / `_LCD_CONTRAST` (7115/7116,
  knob 0..100), `GLOBAL_FC_DEFAULT_LAYOUT_PFC1-3` (3602-3604, dropdowns) and the FC clones now serve —
  the earlier blanket "candidate silent gaps" list is superseded (it was also wrong about
  `GLOBAL_MIDI_MAPPING` 97, long served — see §2.8).
  **What is still genuinely unserved** is only what has **no range row at all**, and none of those is a
  `knob`/`dropdown` binding: `GLOBAL_REMOTE_MUTE` (114, 0 layout refs — nothing renders a hole),
  `GLOBAL_DEVICE_NAME_BEGIN` (1334, referenced by name-entry widgets that the guard below does not
  cover). → **Probe:** now CI, not hardware: `server/test/drivers/layout-param-coverage.test.ts`
  asserts every layout-referenced param is served or on a documented unmount allowlist. Remaining
  hardware question is only whether those GLOBAL **writes** are accepted (§3.7 item 1 spirit).
  **Measured 2026-10-07 (read-only, real FM3) — corrects the old stride/positional "runs past the
  block" story:** the eid-1 (`fn=0x1F`) bulk body is **14,880 records indexed by pid**, so
  `body[7115]` (`GLOBAL_FS_BRIGHTNESS`) = `65534` at 100% and `45874` at 70% (`0.70 × 65534`);
  `body[7116]` = `32767` at 50%; `Ring Intensity Bright` `body[110]` = `65534`. Raw scale
  **65534 = 100%**. The per-pid GET (`fn 0x01 sub 01 00`) reply is a **canned template** on this
  firmware (`2.085e-41`, displays `0.0000`) and is unusable as a read. The GLOBAL families are
  therefore **not** deliberately unreadable — see ADR-0004 (ADR-0003 superseded).
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
- **CS MIDI** (control-switch MIDI assignment) — **PARTIALLY AVAILABLE, reclassified 2026-10-07.** The
  earlier "GATED: no served param serves it" was too broad. The GLOBAL family serves the CS params:
  `GLOBAL_CS1_ENABLE` (6979), `GLOBAL_CS_EDIT_NUMBER` (6985) and `GLOBAL_CS_COMMAND_BEGIN` (6986) all
  carry enum rows, and `GLOBAL_CS1-6_EXCLUSIVE` (7107-7112) are served **and already rendered** on the
  Setup MIDI/Remote board (4 layout refs each). What is missing is a **layout** for the
  enable/edit-number/command trio — those three have 0 layout refs, so they are not drawn, not
  unserved. Building the MIDI/Remote CS table is startable offline: no new wire op and no
  calibration row is required.
- **FC Config** (startup layout/view, 1:1 copy) and **Devices** tab (mirroring) — **Devices/mirroring is
  genuinely GATED** (no served param exposes it). **FC Config is now PARTIAL**: with the layout-widget
  rule (P1.2), `GLOBAL_FC_DEFAULT_LAYOUT_PFC1-3` (3602-3604) and the `FC_CLONE_*` siblings (3606-3608)
  serve, and the device's own layout draws them as dropdowns. `PFC4` (3601/3609) does **not** exist on
  the FM3 — it appears only in the **Axe-Fx III** layouts (`axe-fx-iii/layouts.generated.ts:13698-13699`);
  do not plan for a 4th FC port.
- **Import / export layouts** (backup) — **DONE** (client-side, `fcLayoutPackage.ts`): Axis JSON
  `.fclayout.json`, FM3 exports by live read-back (`/fc/state`), blind devices export the session’s
  values; import validates then writes back field-by-field with configs remapped to the target layout.
- **Master Layout Menu warning / edit** precondition — **STOPPED as UNVERIFIABLE (2026-10-07):** the
  served `/fc/model` (`FcModel` contract) carries no MLM / edit-precondition field
  (`GLOBAL_FC_MLM_DISABLED` is a GLOBAL-family param, not FC eid 199), so no warning is added and no
  field is invented; a guard test (`fcMasterLayoutEvidence.test.ts`) records the evidence boundary.

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
  `ForgeFX` consumes it (`POST /preset/decode`, backups, local scan). **The host→device write-back also
  EXISTS — corrected 2026-10-07 (verified in code).** The gen-3 driver pushes the 0x77/0x78/0x79 chain
  straight into the device's EDIT BUFFER (`Gen3Driver.loadPresetBytes` → `retargetPresetDumpToEditBuffer`
  patches the 0x77 header to the `7F 7F` edit-buffer sentinel and fixes the frame checksum in place),
  wired at `POST /preset/load` and used by Axis's audition / file-load / template-load paths; a slot is
  written only by the separate `store(n)`, and a version restore is load-then-store. The code records
  this direction as **live-validated on FM3 by the ForgeFX version-audition flow**, and the
  authored-output leg is offline-gated by `presetValidate.ts` + the author round-trip tests
  (`preset-author-ir.test.ts`). `presetDump.ts`'s own header still reads "not captured" — read that as
  the *evidence-discipline* note (no recorded host→device USBPcap), **not** as "unimplemented". What
  remains is a **hardware load test** of an *authored/edited* dump. So the follow-ons below are no
  longer blocked on "build a parser" or "build a writer" — they are blocked on *surfacing* the decoded
  model (e.g. modifier read-back, §3.2) or on RE for things the body does not contain.
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

1. ~~**Is the MIDI block placeable on the FM3?**~~ — **ANSWERED (no).** §2.8 already verified it: the
   `MIDIBLOCK` family is `addressing:'virtual'`, absent from `EFFECT_BASES` (so `effectRoster()` never
   offers it), absent from `GEN3_VIRTUAL_EFFECTS` (`registryCore.ts`), and `blockParams(190)` serves no
   controls (13 defs, all `_BEGIN` markers/TEST rows, 0 range rows). Keep the honest negative — do not
   re-probe.
2. ~~**Which GLOBAL params are actually served?**~~ — **ANSWERED OFFLINE 2026-10-07.** Reading
   `ranges.generated.ts` + `params.ts` + `rangeFor` settles it (the blanket "25 unverified = candidate
   gaps" list was wrong — most are served), and the device's own layout widget is now honoured (P1.2,
   `2fa29d9`). The invariant is enforced in CI by
   `server/test/drivers/layout-param-coverage.test.ts`; no live `/diag/ranges` sweep is needed.
   GLOBAL **values** are read by pid from the 14,880-record eid-1 body — see ADR-0004 and §3.7.
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
   `POST /preset/decode`. **RESOLVED 2026-10-07:** host→device **write-back** of that chain also exists
   (`Gen3Driver.loadPresetBytes` + `retargetPresetDumpToEditBuffer` → `POST /preset/load`; live-validated
   on FM3 for edit-buffer audition; store via `store(n)`; authored output offline-gated by
   `presetValidate.ts`). Remaining: a hardware load test of an authored dump — see §5.
5. ~~**Does FM3 store performance pages / setlists in the preset or in system memory?**~~ — **ANSWERED
   2026-10-07 from the OFFICIAL sources** (FM3 Owner's Manual pp.124–126; FM3 firmware **3.02** release
   notes "Added Per-Preset and Global Performance Pages"; FM3-Edit **1.03.00** release notes):
   - **Perform-PP (per-preset page)** is **stored in the PRESET** — "when you edit the Per-Preset
     Performance page you must save the preset to commit changes"; adding/removing a control changes the
     preset's EDIT state (so it is in the preset binary).
   - **Perform-Gbl (global page)** is **stored in the Global Settings** (system) — edited controls are
     auto-saved, "no need to store anything".
   - **Setlists/Songs** live in a **global SETUP menu area, "FC Setlists/Songs"** (system region, NOT the
     preset) and **require an FC-6 or FC-12 foot controller**.
   → The per-preset page is in the preset binary (our `presetBody` decoder does not surface it yet —
   `grep -i perform src/devices/gen3/` → 0); the global page + Setlists need the system/global
   read-write path. Exact frames still need a capture (or the editor's write path).
6. **Cab 2 Mute/Solo write path** (see §3.7) — the outstanding hardware check from the last handoff.
7. ~~**Setlists/Songs availability** on Andy's firmware~~ — **RESOLVED 2026-10-07: the FM3 supports
   Setlists/Songs** (confirmed by Andy). The only open question is the storage region (item 5).
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
4. ~~**Keyboard shortcut map** (§2.12)~~ — **DONE** (`shortcuts.ts` registry; **23 wired, 0 reserved** — corrected 2026-10-07, the count in this
 line had gone stale at 21 after Q and G were added in R24/R25).
5. **Mute + Scene Ignore** (§3.1) — **Scene Ignore DONE** (served `*_SCENEIGNORE` enum); **Mute
   left disabled** (no served generic per-block mute param — see §3.1).
6. **Block-pane height / search-card** UX fixes (§3.6 items 1-2) — **DONE** (compact search rows).
   Item 3 (`GET /diag/ranges` in the UI) is **DONE** too — see §7.12. NOTE: the fit-to-view cell cap
   added here was **reverted the same day** — it shrank dials to ~30px on tall boards; the board now
   always fills the pane width and scrolls instead (see ControlSurface).

**§2.7 remainder (Recent / Snapshot / Clear) — addressed 2026-10-06:** **Recent Presets DONE**
(`recentPresets.ts`, one shared local MRU store surfaced in the workbench panel + the monolith browser
+ the picker) and **Snapshot-to-folder DONE** (`snapshotPreset.ts` + Device Tools "Snapshot", reusing
`snapshotPreset`/`versionSyx` and writing `Presets/Snapshots/<name>.syx` via `saveLocalPreset`).
**Clear Preset NOT POSSIBLE** — no clear/init wire op exists (evidence in §2.7). Templates/bundles/`.bnk`
remain absent.

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
   parser (§5). The **Master Layout Menu warning** item is **STOPPED as unverifiable** (2026-10-07) —
   no served MLM field exists to gate on.
10. ~~**Preset Librarian / Manage Presets** (§2.4)~~ — **DUPLICATE + SWAP DONE 2026-10-06** (both the
    monolith `PresetBrowser.svelte` and the workbench menu, over the copy-by-store sequence in
    `presetSlotOps.ts`). **REORDER + RESET AMP DONE 2026-10-07** (`slotReorderOps.ts` content
    permutation + `resetAmpOps.ts` per-slot AMP model re-select; select-head actions with dry-run +
    confirm). **Move / Delete remain impossible**: the FM3 wire protocol has no slot-erase op, so they
    are honest disabled entries. No new endpoint was needed.
11. ~~**Block library (.blk-style)**~~ — **DONE 2026-10-06** as an Axis-local `.axblk` library (§2.6);
    byte-compatible Fractal `.blk` interop remains out of scope.
12. ~~**Surface `GET /diag/ranges` in the UI** (§3.6 item 3)~~ — **DONE 2026-10-06** (round 2:
    `rangeTrace.ts` + the Device Tools "Range trace" panel; the endpoint already existed in
    `server/src/app.ts`).

**Keystone / research**
13. ~~**Preset-binary parser**~~ — **ALREADY EXISTS** (read path; see §5). ~~modifier read-back~~
    **DONE 2026-10-06** (§3.2). ~~host→device write-back~~ — **ALSO EXISTS (verified 2026-10-07; §5)**:
    edit-buffer push + store + offline-validated authoring all ship; only a hardware load test of an
    *authored* dump remains. What is left is blocked on **RE / hardware**, in value order:
    **Performance pages** device-side storage (§2.2/§6.5), **Setlists/Songs** (§2.3/§6.7 — FM3 support
    confirmed 2026-10-07; storage region still unknown), **IR/cab management** (§2.5 — custom-IR upload
    available on the FM3 per 2026-10-07; the multi-frame upload must be implemented + load-tested).

**Round W1–W4 — merged 2026-10-06** (orchestrator: Lykos; four parallel subagents, one git worktree
each, all four Axis-only and offline-provable — no hardware, no new endpoint). All four merged with
**zero conflicts** and disjoint new members (no duplicate-definition hazard). Verification on the merged
tree: forgefx-midi **83 suites** · ForgeFX **36 suites** · Axis **1520 unit tests / 144 files** ·
`svelte-check` **0 errors** · Axis build **ok** · Playwright **135/136**.

| # | Item | Result | Commit |
|---|---|---|---|
| W1 | §2.7 Preset templates | Done — local-only `.axtpl.json` | `f9c1d8b` |
| W2 | §2.9 Move a row / column | Done — pure planner + border controls (row axis only: a cross-column move would strand every wire) | `037aed6` |
| W3 | §2.11 Batch-set a param across presets | Done — dry-run + confirm, destructive | `6c64b7e` |
| W4 | §2.10 Channel ops | Done — across scenes / across blocks | `f4ec211` |

**Integration defect no subagent could see** (found and fixed by the orchestrator, `ddca770`):
components read the store through the **`EditorSurface` seam** (`editorSurface.ts`), so every new member
had to be declared there — and `convertEditor`, which is typed as `EditorSurface`, must satisfy the
shape too (it now models row/column shift over its in-memory layout and leaves the device-backed channel
ops inert, like its other §2.10 stubs). svelte-check went **8 errors → 0**.

**One regression came out of the merge, and it is FIXED (`1c7b62d`).** `28-block-pane-and-search.spec.ts:246`
went red at 1280x800 (5 visible control-search rows vs a `>= 6` threshold; 1440x900 stayed fine at 7).
Round 5 recorded 136/136 at `8ec6e40`, so it was this round's. **A/B on the merged tree, one suspect file
at a time:** reverting `SignalGrid.svelte` alone **still failed** (5 rows), reverting `BlockEditor.svelte`
alone **passed** (6) — the new grid column bar was innocent; the two new footer actions were the cause.
Measured in-browser: 12 buttons need 1171 + 8×11 gap + 32 padding = **1291px inside a 1280px footer**,
11px over, so the row wrapped (footer height 65 → 117px) and took exactly one 44px row from the block
pane. Fix: footer button inset 16 → 12px (~85px slack) + shorter labels with the full wording kept in
`title`/`aria-label`. Lesson: **chrome must not steal content area** — measure `scrollWidth` against
sum(button widths) + gaps + padding before adding an action to a full toolbar.

**Round R16–R20 — merged 2026-10-07** (orchestrator: Lykos; five parallel subagents, one git worktree
each, Axis-only / offline-provable — no hardware, no new endpoint). All five merged into `main`
(`45484f3`) with **one conflict**, resolved by unioning the import block in `src/lib/editor.svelte.ts`
(r17's `sceneOps`/`paramNudge` vs r19's `paramClipOps`/`r19BlockClipOps`); the rest auto-merged.
Verification on the merged tree: Axis **1629 unit tests / 154 files** · `svelte-check` **0 errors,
0 warnings** · build **ok** (`--max-old-space-size=2560`; default heap OOMs in this VM) · e2e `25`+`26`
**41/41**.

| # | Item | Result | Commit |
|---|---|---|---|
| R16 | UI-C sweep F1/F2/F3 (phone bottom-bar reachability) — *not an audit §* | Done — nav shrinks + swipes, `⋯` menu opens upward, phone edit rail suppressed | `1b7c98f` |
| R17 | §2.12 keyboard shortcut parity | Done — the four reserved chords wired (⌘M / ⇧Space / ↑ / ↓) | `8fd1b42` |
| R18 | §2.4 Manage Presets remainder | Done — multi-select reorder + Reset AMP per preset (no new endpoint) | `cb227ce` |
| R19 | §2.10 + §2.11 clipboard | Done — param-value clipboard + honest cross-preset block paste | `c12d7ca` |
| R20 | §3.5 + §3.8 rail gating | Done — Setup/Controllers gated honestly; MLM warning stopped (unverifiable) | `c429b1f` |

**Round R21–R24 — merged 2026-10-07** (orchestrator: Lykos; four parallel subagents, one git worktree
each, **Axis-only / offline-provable** — no hardware, no new endpoint). All four merged into `main`
with **zero conflicts**, and no `EditorSurface` seam change was needed (no new editor-store members).
Verification on the merged tree: Axis **1679 unit tests / 160 files** · `svelte-check` **0 errors,
0 warnings** · build **ok** · Playwright **136/136**.

| # | Item | Result | Commit |
|---|---|---|---|
| R21 | §3.2 modifier editor remainder | Done — `modifierCurve.ts` (honest pending-decode when the model/DTO exposes no curve) + a CURVE READ-BACK section; `ModifierUsagePanel.svelte` on the Controllers screen | `1994913` |
| R22 | §2.11 batch-set entry | Done — a `batchSet` action nav entry (+ idempotent self-heal on persisted docs) firing the existing `axis.openBatchSet` | `4a64c2c` |
| R23 | §2.4 Manage Presets drag-and-drop | Done — HTML5 DnD over the SAME `slotReorderOps` permutation + dry-run/confirm/abort path (no second reorder path) | `a5e767d` |
| R24 | §2.9 Quick Build panel (Q) | Done — `axis.quickBuild` panel + `axis.openQuickBuild`, one-click placement via the existing `editor.place`, wired to the `Q` chord | `10bb746` |

**Round R25–R28 — merged 2026-10-07** (orchestrator: Lykos; four parallel subagents, one git worktree
each; **Axis-only / offline-provable** — R27 is e2e-only). All four merged into `main` with **zero
conflicts**. Verification on the merged tree: Axis **1720 unit tests / 164 files** · `svelte-check`
**0 errors, 0 warnings** · build **ok** · Playwright **142/142** (136 existing + 6 new).

| # | Item | Result | Commit |
|---|---|---|---|
| R25 | §2.9 Grid Navigation Mode | Done — `gridNavMode.ts` policy + a grid-nav toggle (bare `G` + header pill); suppresses the per-block fetch on nav/place/route, explicit open always fetches, param edit refuses with a named reason | `fdae2d1` |
| R26 | Convert-editor offline block copy/paste | Done — `convertBlockClip.ts` + `copyBlock`/`pasteBlock` over the SAME `planPasteBlock`/`applyRouteOps` path (occupied = settings paste, shunt = replace, empty = place); named refusals, no silent drop | `fede807` |
| R27 | Browser proof for R21–R24 | Done — 4 new Playwright specs (`30`–`33`) proving the batch-set entry, Quick Build + `Q`, Manage Presets DnD and the modifier CURVE READ-BACK + Controllers usage panel in Chromium | `2d8c1b0` |
| R28 | Dead-nav / dishonest stubs | Done — legacy rail `perform`/`sets`/`scenes` no longer toast (visible + disabled with the real reason), `gateRailItems` no longer proxies them through `caps.gridRouting`, PresetBrowser's non-device-row `SOON` stubs are disabled-with-reason | `2244c2c` |

**Deferred (needs the device, a bigger build, or a sibling repo):**
- **§2.2 per-preset Performance Pages** — storage known (§6.5); the per-preset page is in the preset
  binary, but the byte layout is **not evidenced** here (no fixture with a known perform config), so the
  decode needs a capture/fixture — and the decoder lives in the **forgefx-midi** repo, so this needs a
  forgefx-midi worktree, not an Axis-only round. The **global** page needs the system path.
- **§2.5 user-cab IR upload**, **§2.8 PC/CC tables**, **§3.7 GLOBAL probes** — hardware.
- **§3.8 per-preset FC definitions** — blocked on the body decode for that structure.
- **§2.3 Setlists** — parked (no FC).
- **§2.7 `.bnk` bank import / Preset+Cab bundle** — BLOCKED: the only cab route is `GET /cab/irs`
  (names); nothing returns user-cab BYTES, so a bundle would need a new endpoint.

**Deferred / N/A on FM3**
- Global blocks (§2.9) — Axe-Fx only.
- NAM Manager — Axe-Fx III only (announced 2026-10-07 as coming soon to the III); **FM3 support is
  unconfirmed — do not plan for it.**
- ~~IR Capture~~ — **does not exist (corrected 2026-10-07)**: there is no IR-capture feature on these
  units, so it was never a real gap.

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
| Shortcuts | `src/lib/shortcuts.ts` (the registry) + the dispatch in `src/routes/+page.svelte` |
| Client API surface | `src/lib/forgefx.ts` |
| Server route table | `ForgeFX/server/src/runtime/router.ts` |
| KNOB_UNITS / range serving | `ForgeFX/server/src/drivers/gen3.ts:141-143, 557-578` |
| Virtual effects | `ForgeFX/server/src/drivers/registryCore.ts` (`GEN3_VIRTUAL_EFFECTS`) |
| FM3 parameter catalog (2021 rows) | `forgefx-midi/catalog/fm3.json` |
| Existing open handoff work | `docs/handoff-cab-mute-and-dynacab.md` |
| Prior gap analysis (partly stale) | `docs/ROADMAP.md` (kept); the workbench layout-rework plan/status/verification docs were shipped-work history and were removed 2026-10-07 — recover any with `git show <sha>:docs/<file>` (see `docs/NEXT-STEPS.md`) |
| Defect backlog (all merged) | `~/repos/stack/BACKLOG.md` |
