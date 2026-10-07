# Axis — next iteration: prioritized fix list (from the 2026-10-07 third-party review)

**Status:** **P1.1, P1.2 and P1.3 SHIPPED 2026-10-07** (merged; merged-tree verify ALL GREEN) ·
**P2 and P3 open** · **Source:** independent 3-pass review of `61205e5` / `da11b1e` / `0dcda1c`
(full report + provenance: `~/repos/stack/review-2026-10-07/REPORT.md`; the review's rejected claims
are in its §5 — read that before re-litigating any item here).

**Merged-tree verification after the P1 round (2026-10-07) — ALL GREEN:** forgefx-midi **83** ·
ForgeFX **38 suites** (was 36) · Axis **1737 unit tests / 166 files** (was 1720/164) · `svelte-check`
**0 errors / 0 warnings** · build **ok** · Playwright **142/142**.

Ground truth at review time: `verify-stack.sh` **ALL GREEN** — forgefx-midi 83 · ForgeFX 36 suites ·
Axis 1720 tests / 164 files · svelte-check 0/0 · Playwright 142/142. **None of the defects below was
caught by the suite that existed then.** Each item therefore names the test that must exist with the fix.

The review was run on a fast model (the Claude subscription's 5-hour window was exhausted), so every
item here was re-read in the code before filing. Items are ordered by user-visible risk, not by
effort. P1 and P2 are all offline-provable (no hardware, no new server endpoint).

---

## P1 — SHIPPED

### P1.1 Device-refused discrete writes must not stay on screen — **DONE** (`776b64a`, merged `fc77dd9`)
`Axis/src/lib/editor.svelte.ts` · `src/lib/paramWriteOutcome.ts` (new) · `src/lib/history.svelte.ts`

`setEnum` is now `async`, awaits the discrete write, and maps the outcome through the pure
`decideWriteOutcome` / `settleEnumWrite` module: accepted → keep; `{ok:false}` → revert `e.value` to the
captured `from`, drop the optimistic history entry (`history.record` now returns its id and a new
`history.drop(id)` removes it), and toast `Write rejected by device — <param>`; a thrown transport error
takes the same path with `Write failed — <param>`. The continuous knob path is **untouched** and stays
fire-and-forget by design.

Tests: `src/lib/paramWriteOutcome.test.ts` (9 cases — keep/revert/drop/toast for all three outcomes) and
`src/lib/refusedWrite.sourceguard.test.ts` (8 cases — pins the editor wiring *and* asserts the continuous
path stays deferred + swallowed, so a later "cleanup" cannot silently make it blocking).

Known edge (pre-existing, not introduced): `history.record` truncates the redo tail on push, so if an
enum write is then refused, `drop` removes the entry but an already-lost redo tail stays lost.

### P1.2 Blank Setup/Config controls on a live surface (silent-drop class) — **DONE** (`2fa29d9`, merged `6213ecf`)
`ForgeFX/server/src/devices.ts` · `src/drivers/gen3.ts` · `test/drivers/layout-param-coverage.test.ts` (new)

The device's **own editor layouts** are now the evidence for how a param is presented:
`layoutWidgetByFamily()` indexes every layout `knob`/`dropdown` binding by the param's **owning** family
(`crossBlock.family` for cross-block refs, e.g. the GLOBAL params an FC page draws). The serve filters
honour that evidence — a float param the device draws as a `knob` is served even with a non-display unit
(7115/7116), and a param the device draws as a `dropdown` is served even when the mined row is not an
enum (3602-3604). Every pre-existing exclusion still applies (bypass, degenerate `0..0`, the family type
selector, dedupe).

The guard landed as `test/drivers/layout-param-coverage.test.ts` (registered in `run-all.ts`): it walks
**every** FM3 layout knob/dropdown binding across all families and variants, serves each addressable
family over a mocked transport, and requires the id to be in the served `named ∪ enums` set **or** on an
explicit, documented `UNMOUNT_ALLOWLIST` (no range row / degenerate range / block type-selector). It also
fails on a **stale** allowlist entry, so it catches a different filter regression than the one that
prompted it. This is the class-level guard the item asked for — the audit's §6.2 hardware probe is now CI.

### P1.3 A torn block read must not be served as a complete one — **DONE** (`f8f9b86`, merged `52eabdd`)
`ForgeFX/server/src/drivers/gen3.ts` · `test/drivers/block-read-failure.test.ts` (new)

**The filed mechanism was wrong, and the fix round corrected it.** There is no natural *mid-loop* throw:
the only natural throw is in `assembleGen3BlockBulkRead` **before** any output is populated, so the old
swallow produced an **all-zero** snapshot, not a mixed one — and `valueByPid` is built *after* the catch,
so it could never be stale. The real, verified defects were (a) a failed/torn read was swallowed, so
`blockParamsH` saw a normal return and answered `200` with a valid-looking zeroed block, and (b) a
**short-but-valid** burst (head advertises N, a dropped `0x75` page) never threw at all — the `?? 0` reads
silently zeroed the missing tail.

Fix: a torn-read guard right after assembly (`values.length < itemCount` → throw, mirroring the codec's own
check at `forgefx-midi/src/devices/gen3/reader.ts:136`), and the catch now resets **every** decoded output
(`named`, `enums`, `type`) and **rethrows**, so `blockParamsH`'s existing `404 + {error}` shape surfaces it.
No new error shape was invented.

**Bonus find:** the rethrow exposed a harness bug — `knob-coverage` / `enum-coverage` hardcoded model byte
`0x11` while their invariant loops over the FM3/FM9/III profiles, so those iterations had been passing
**vacuously** on the zeroed fallback. The model byte is now threaded from `profile.model`, and those suites
decode real data on all three profiles.

**Caveat to watch:** the guard assumes the `0x74` head's `itemCount` equals a complete body's value count.
That matches the codec's documented invariant and every test burst, but if real firmware ever pads a complete
read the guard would false-positive — worth a look the first time it runs against the FM3.

---

## P2 — open, same shape as P1

### P2.1 Paste reports requested-as-pasted
`Axis/src/lib/editor.svelte.ts:1748-1751` (same shape at `:2416`, `recallBlockEntry`)

Every write result is discarded and the toast prints `writes.length`. The cross-preset paste at
`:2352-2364` already collects `report.failed` and warns — reuse that pattern; report landed vs
requested, and only checkpoint when something landed. The same swallow idiom also appears at `:1910`,
`:2255-2258`, `:2413-2416`; one helper that "writes a set and reports what landed" would close the whole
class, and `paramWriteOutcome.ts` (P1.1) is the natural home for it.

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
- **Test:** feed a scaled wire value in the mock and assert the served value is a member of its options.
  (P1.3 removed the zero-fill idiom from the two coverage suites, so the harness can now carry real
  values — but nothing yet asserts value-membership, so this is still the biggest remaining test gap.)

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
  the export stale (commit `0dcda1c` exists solely to resync it). Add a consistency check to the
  test script.
- `gen3.ts:157-159` `KNOB_UNITS` has `'pf'`; `devices.ts:534` `CONT_UNITS` does not — so a III pF
  param is branded `kind:'enum'` at profile-build time (phantom dropdowns). One source of truth.
- `app.ts:425,450-453` — unvalidated route params (`/preset/select {number:20000}`, non-integer
  `:paramId`) throw inside `encode14` and surface as 500s; other handlers map bad input to 400.
- `audit:564-568` §6.1 still asks whether the MIDI block is placeable while §2.8 already verified it is
  not; `audit` §2.2 still cites the legacy rail "coming soon" toast that R25 replaced with
  gated-disabled rows (`ToolRail.svelte:64-67`).
- `app.ts:64` / `writeGate.ts:1` cite the banner-stale `ROADMAP.md` as write-safety authority — point
  at `write-protocol.md` + the parity audit.

*(The stale "21 chords" count this list used to carry was corrected in `NEXT-STEPS.md` when the review
was filed — `shortcuts.ts` has 23 wired. Still worth a count assertion in the test.)*

---

## Do NOT chase (checked and rejected by the review)

- **Edit-watch sweep vs channel-A baseline** (`gen3.ts:1371`): the sweep slice and its baseline are
  *both* channel 0, so a front-panel edit on channel B-D does not alter the diffed bytes and emits no
  event. The `watchedChannel` branch is for the open block, which is the case that needed fixing.
- **"Axis ignores the save result"**: `save()` reads `r.ok` (`editor.svelte.ts:2811`). Only the 120 ms
  window (P2.2) is exposed.
- **`GLOBAL_REMOTE_MUTE` as a rendering gap**: 0 layout refs in the FM3 layout — unserved, but also
  unreferenced.
- **P1.3's original "mixed real/zero snapshot" mechanism**: not reachable — see the correction in P1.3
  above. The defect was the swallowed failure plus the silent short-burst zeroing, both now fixed.

## Needs the hardware (updated after the P1 round)

1. Does the FM3 ever send a scaled enum wire value? Decides whether P2.3 is live or latent. **Open.**
2. How late can a genuine 0x64 rejection arrive on a real link? Settles the window in P2.2. **Open.**
3. Do GLOBAL writes actually succeed (not just read)? P1.2 fixed serving/rendering only. **Open.**
4. ~~Is there a 4th FC port (`PFC4`)?~~ **ANSWERED — no.** `PFC4` is evidenced only in the **Axe-Fx III**
   layouts (`axe-fx-iii/layouts.generated.ts:13698-13699`); the FM3 has FC ports 1-3. Nothing to fix.
5. Does the FM3 ever pad a complete bulk read so `values.length > itemCount`? If yes, the P1.3 guard
   needs a tolerance. **Open, low risk.**
