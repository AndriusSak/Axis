# Axis — next iteration: prioritized fix list (from the 2026-10-07 third-party review)

**Status:** unstarted · **Source:** independent 3-pass review of `61205e5` / `da11b1e` / `0dcda1c`
(full report + provenance: `~/repos/stack/review-2026-10-07/REPORT.md`; the review's rejected claims
are in its §5 — read that before re-litigating any item here).

Ground truth at review time: `verify-stack.sh` **ALL GREEN** — forgefx-midi 83 · ForgeFX 36 suites ·
Axis 1720 tests / 164 files · svelte-check 0/0 · Playwright 142/142. **None of the defects below is
caught by the current suite.** Each item therefore names the test that must exist with the fix.

The review was run on a fast model (the Claude subscription's 5-hour window was exhausted), so every
item here was re-read in the code before filing. Items are ordered by user-visible risk, not by
effort. P1 and P2 are all offline-provable (no hardware, no new server endpoint).

---

## P1 — fix in the next round

### P1.1 Device-refused discrete writes must not stay on screen
`Axis/src/lib/editor.svelte.ts:1677` · `ForgeFX/server/src/drivers/gen3.ts:274-277,1391-1396` ·
`ForgeFX/server/src/runtime/handlers.ts:61-65`

`setEnum` sends `forgefx.setParam(eid, id, value, false)` and swallows the result
(`.catch(() => {})`), while the server reject-watches that write and answers `200 {ok:false}`. No
revert, no re-read, and the edit-watch baseline only emits on *change* from the pre-edit snapshot —
so a refused model/cab/enum write is displayed as applied indefinitely. `save()`
(`editor.svelte.ts:2809-2817`) reads `r.ok` and toasts "Save rejected by device"; the write path
must do the same.

- **Change:** await the write in `setEnum`; on `ok:false` (or a transport error) revert `e.value` to
  `from`, drop the optimistic history record, and toast the refusal with the param name.
- **Test:** server-side — script a 0x64 reply and assert the route answers `200 {ok:false}`; Axis-side
  — assert the editor restores `from` and emits a refusal toast. Pin the `200 {ok:false}` contract
  end-to-end; today Axis mocks `forgefx` with a resolved `{ok:true}`.
- **Leave alone:** the continuous knob path is fire-and-forget **by design** (documented at
  `gen3.ts:1391-1393`). Do not "fix" it into a blocking write — it streams during drags.

### P1.2 Blank Setup/Config controls on a live surface (silent-drop class)
`forgefx-midi/src/gen3/fm3/layouts.generated.ts:7893,7929,7965-7966,8001-8004` ·
`params.ts:907-909,931-932` · `ranges.generated.ts:3602-3604,7115-7116` ·
`ForgeFX/server/src/drivers/gen3.ts:632-645` · `Axis/src/lib/deviceLayoutBoard.ts:123-124,137`

The FM3's own layout references these GLOBAL params, and **neither** serve filter accepts them, so
`resolveControl` resolves each to `'gap'` and the board draws nothing:

| param | id | refs | why dropped |
|---|---|---|---|
| `GLOBAL_FS_BRIGHTNESS` | 7115 | 3 | float 0..100 on a `unit:'unverified'` def → not in `KNOB_UNITS` |
| `GLOBAL_FS_LCD_CONTRAST` | 7116 | 3 | same |
| `GLOBAL_FC_DEFAULT_LAYOUT_PFC1-3` | 3602-3604 | 2 each | `kind:'float'` range row on a def whose unit is `enum` |

`PFC4` (`FC_TYPE_PFC4` 3601, `FC_CLONE_PFC4` 3609) has **no range row at all** while its siblings do.

- **Change:** correct the catalog rows (unit for 7115/7116; `kind` for 3602-3604) so the params serve,
  or — if the correct values are genuinely unknown — render the control **disabled with the exact
  reason** per the no-dead-nav rule. Never leave an unexplained hole.
- **Guard (do this regardless):** assert that **every paramId referenced by a served layout has a
  servable range row or a declared unmount reason**. Same executable-rule shape as
  `Axis/src/lib/listCaps.test.ts`. This is what turns the audit's §6.2 hardware probe into CI.
- **Then** the audit's "25 unverified GLOBAL params" list can be re-derived offline instead of by
  probing the unit.

### P1.3 A torn block read must not be served as a complete one
`ForgeFX/server/src/drivers/gen3.ts:706-709`

The catch resets only `named`; `enums`, `type` and the layout-selector values keep the entries decoded
before the throw, and the exception is swallowed — so `blockParamsH` answers `200` with a mixed
real/zero snapshot.

- **Change:** reset `enums`/`type` with `named`, and answer an error (or an explicit `partial: true`
  marker the UI can surface) instead of a plausible-looking block.
- **Test:** throw mid-loop in a mock block read and assert the response is not a silent 200 with
  partial data.

---

## P2 — same round if capacity allows

### P2.1 Paste reports requested-as-pasted
`Axis/src/lib/editor.svelte.ts:1748-1751` (same shape at `:2416`, `recallBlockEntry`)

Every write result is discarded and the toast prints `writes.length`. The cross-preset paste at
`:2352-2364` already collects `report.failed` and warns — reuse that pattern; report landed vs
requested, and only checkpoint when something landed.

### P2.2 Reconcile the two write-confirmation windows
`ForgeFX/server/src/drivers/gen3.ts:271-277` (120 ms / quiet 60 ms) vs
`forgefx-midi/src/devices/gen3/writer.ts:159-185` (250 ms)

`write-rejection.test.ts:9-11` documents this exact failure ("a 50 ms window could close before a
genuine rejection arrives and report a rejected write as accepted"). All mock replies are synchronous,
so the case is unreachable in the suite.

- **Change:** pick one window (the writer's 250 ms is the better-evidenced number) or justify the split.
- **Test:** a mock that returns the 0x64 *after* the window would close, asserting the write is not
  reported as accepted.
- **Related:** `gen3.ts:273-276` keys attribution on the function byte only — store/setParam/setType/
  setBlock/setBypass all ride `fn=0x01`, so a rejection of one is attributable to another within the
  window. The suite covers only the foreign-*function* case.

### P2.3 Scaled-enum value decode vs option list
`ForgeFX/server/src/drivers/gen3.ts:686-697` · `ranges.generated.ts:1407`

`PHASER_ORDER` is `{kind:'enum', displayMin:0, displayMax:10, scale:2, enumCount:6}` — the only scaled
enum in `FM3_RANGES`. The option list is correctly capped at ordinal `ordMax = min+enumCount-1` (0..5),
but the **value** is unscaled into display space (`raw>max` → `round(raw/65534*(max-min))+min` = 0..10),
so a served value can sit outside its own options and write back as an invalid ordinal.

- **Change:** decode the value in ordinal space when `enumCount` is present (`round(display / scale)`),
  or document why the unscale branch can never fire for a scaled enum.
- **Test:** feed a scaled wire value in the mock (today `enum-coverage.test.ts:51` fills bulk values
  with `0`, making the whole branch dead code under test) and assert the served value is a member of
  its options.

### P2.4 `/diag/ranges` (and the convert routes) are missing from the browser-direct runtime
`ForgeFX/server/src/app.ts:140,346,373,123` vs `ForgeFX/server/src/runtime/router.ts:122`

`/diag/ranges`, `POST /preset/convert`, `/preset/convert/export` and `POST /debug/raw` exist only in
the Fastify table, so in browser-direct mode the Range Trace panel and the Convert dialog are 404s —
including the diagnostic the audit recommends as ground truth.

- **Change:** port them into `runtime/router.ts` or gate the Axis features off in direct mode.
- **Guard:** a path-set diff test over both route tables, so a future endpoint can't land in one only.

### P2.5 The audit's "honestly impossible" claims need narrowing
`Axis/docs/NEXT-STEPS.md:58` · `docs/axis-fm3edit-feature-parity-audit.md:482-486`

CS MIDI is not a wire gap: `GLOBAL_CS1_ENABLE` (6979), `GLOBAL_CS_EDIT_NUMBER` (6985) and
`GLOBAL_CS_COMMAND_BEGIN` (6986) carry enum rows and are served today; `GLOBAL_CS1-6_EXCLUSIVE`
(7107-7112) are served **and** already rendered. The trio is a *layout* gap, not a wire gap. Only
Devices/mirroring is genuinely wire-absent. `FC_DEFAULT_LAYOUT`/`FC_CLONE` are one calibration row
away (see P1.2). A wrong "impossible" stops startable offline work.

Also: `audit:457` lists `GLOBAL_MIDI_MAPPING` as a candidate silent gap while `audit:274` correctly
records it as served (OFF/ON) — the two lists cannot both be right.

---

## P3 — cleanup, cheap, do alongside

- `ForgeFX/server/package.json:20` — `engines: ">=20 <21"` while the toolchain that passes every suite
  runs **Node 22.23.1** (`@types/node ^22.10.0`); Axis declares no `engines` at all. Align them.
- `app.ts:105` — AM4 alias `Sunset: Tue, 01 Dec 2026` (~8 weeks) with live v1 fallback callers
  (`Axis/src/lib/library.svelte.ts:315`, `DeviceTools.svelte:36-40`, `history.svelte.ts:252-284`) and
  no removal plan. Decide: migrate or drop the fallback before the sunset date.
- No `prepare`/`postinstall` in any of the three packages while `exports` point at gitignored `dist/`
  — a fresh `npm ci` on the sibling layout leaves the `file:` deps unbuilt. Encode the build order or
  add a prepare script.
- `Axis/package.json:15` — bare `vite build`; the 2560 MB heap workaround lives only in
  `NEXT-STEPS.md:92`. Put the flag in the build script so no agent OOMs.
- `forgefx-midi/src/version.ts` — `gen-version.ts` runs on build only, so a version-bump merge leaves
  the export stale (HEAD commit `0dcda1c` exists solely to resync it). Add a consistency check to the
  test script.
- `gen3.ts:157-159` `KNOB_UNITS` has `'pf'`; `devices.ts:534` `CONT_UNITS` does not — so a III pF
  param is branded `kind:'enum'` at profile-build time (phantom dropdowns). One source of truth.
- `NEXT-STEPS.md:19` says "21 chords"; `shortcuts.ts` has **23** wired (Q, G). No test asserts the
  count.
- `app.ts:425,450-453` — unvalidated route params (`/preset/select {number:20000}`, non-integer
  `:paramId`) throw inside `encode14` and surface as 500s; other handlers map bad input to 400.
- `audit:564-568` §6.1 still asks whether the MIDI block is placeable while §2.8 already verified it is
  not; `audit` §2.2 still cites the legacy rail "coming soon" toast that R25 replaced with
  gated-disabled rows (`ToolRail.svelte:64-67`).
- `app.ts:64` / `writeGate.ts:1` cite the banner-stale `ROADMAP.md` as write-safety authority — point
  at `write-protocol.md` + the parity audit.

---

## Do NOT chase (checked and rejected by the review)

- **Edit-watch sweep vs channel-A baseline** (`gen3.ts:1371`): the sweep slice and its baseline are
  *both* channel 0, so a front-panel edit on channel B-D does not alter the diffed bytes and emits no
  event. The `watchedChannel` branch is for the open block, which is the case that needed fixing.
- **"Axis ignores the save result"**: `save()` reads `r.ok` (`editor.svelte.ts:2813`). Only the 120 ms
  window (P2.2) is exposed.
- **`GLOBAL_REMOTE_MUTE` as a rendering gap**: 0 layout refs in the FM3 layout — unserved, but also
  unreferenced.

## Needs the hardware (unchanged by this review)

1. Does the FM3 ever send a scaled enum wire value? Decides whether P2.3 is live or latent.
2. How late can a genuine 0x64 rejection arrive on a real link? Settles the window in P2.2.
3. Do GLOBAL writes actually succeed (not just read)? P1.2 is about serving/rendering.
4. Is there a 4th FC port (`PFC4`)? If yes, its config is silently uneditable today.
