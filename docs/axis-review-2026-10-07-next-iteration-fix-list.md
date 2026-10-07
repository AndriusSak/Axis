# Axis — next iteration: prioritized fix list (from the 2026-10-07 third-party review)

**Status:** **P1.1–P1.3, ALL of P2, the P3 items (engines, `.npmrc` heap flag, unit sets, route 400s,
audit claims, build-order script, `version.ts` guard, stale `ROADMAP.md` cites) and the P4 round
(bpm/tuner outcome + Control Switch table + AM4-sunset guard) SHIPPED 2026-10-07** ·
**open: the follow-ups below (the wider optimistic-write census, found during the rounds) and the
hardware probes** ·
**Source:** independent 3-pass review of `61205e5` / `da11b1e` / `0dcda1c`
(full report + provenance: `~/repos/stack/review-2026-10-07/REPORT.md`; the review's rejected claims
are in its §5 — read that before re-litigating any item here).

**Merged-tree verification after the P2 round (2026-10-07) — ALL GREEN:** forgefx-midi **83** ·
ForgeFX **40 suites** (36 → 38 → 40) · Axis **1756 unit tests / 167 files** · `svelte-check`
**0 errors / 0 warnings** · build **ok** (bare `npm run build`, no NODE_OPTIONS prefix — see P3) ·
Playwright **142/142**.

**Merged-tree verification after the P1 round:** ForgeFX 38 suites · Axis 1737 / 166 files ·
svelte-check 0/0 · Playwright 142/142.

**One integration defect the P2 round shipped and the orchestrator fixed (`a5018cd`):** the P2.1
workstream left `pasteChannel` pushing into an undeclared `results` array — 2 svelte-check errors. No
child suite could see it (node-env vitest cannot compile the runes module; sourceguards only grep
wiring), which is exactly why the merged tree gets `svelte-check`.

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

## P2 — ALL SHIPPED (P2.1, P2.2, P2.3, P2.4, P2.5)

### P2.1 Paste reports requested-as-pasted — **DONE** (`bb6dac1`)
The brief's line numbers were shifted; the real sites were `pasteChannel` (:1777), `applyCab` (:1941),
`#applyClip` (:2293) and `recallBlockEntry` (:2461). All four now feed one `#writeSettlement(promise)`
per write into the new pure `settleWriteSet(results, copy)` in `paramWriteOutcome.ts`, which returns
`{requested, landed, failed, rejected, errored, checkpoint, allLanded, noneLanded, toast}`:
`checkpoint` only when `landed > 0`, green on full success, amber `"L — N of M landed, F failed"` on
partial, red `"nothing landed"` on total failure. The generalisation also closes a gap in the
cross-preset reference pattern it was modelled on: that one collected `report.failed` but only caught
**throws**, so an HTTP-200 `{ok:false}` still counted as written.
Tests: `paramWriteOutcome.set.test.ts` (12) + 6 more sourceguard cases; the continuous/streaming paths
(`setParam`, `setPinnedParam`, `setBpm`, `tapTempo`) stay fire-and-forget by design and are pinned as such.
**Left open, flagged by the workstream:** `setPinnedEnum` (`:641`) is a single *discrete* pinned write
that is still optimistically shown and swallowed — that is P1.1's per-write scope (`settleEnumWrite`),
not the set aggregation, so it belongs in a follow-up.

Original filing (kept as the record): every write result was discarded and the toast printed
`writes.length`; the same idiom appeared at the sites listed above.

### P2.2 Reconcile the two write-confirmation windows — **DONE** (`987dfb7`)
**The decision (reversible, recorded):** align the driver's discrete-write confirmation with the writer's
better-evidenced **250 ms**, because the cost of the longer wait is ~130 ms of extra latency on a rare,
user-initiated discrete write, while the cost of the short window is a false "accepted" that the Axis
client now trusts (P1.1). **The real knob was `timeoutMs`, not `quietMs`**: `request()` resolves on
`match` (immediate), `quietMs` silence after the last inbound frame, or the `timeoutMs` hard cap — and on
ACCEPT the device is silent, so the quiet timer never even starts and the window *is* the timeout. Both
are now set to 250 for that reason (`gen3.ts:282-290`).
The missing **delayed-rejection test** exists now: `MockTransport` answers synchronously and ignores the
windows, which is exactly why the case was unreachable, so the new `write-window` suite drives a
`WindowTransport` that replays `#once`'s real resolution semantics with a schedule of delayed frames —
0x64 at 180 ms → `{ok:false}` (the old window's blind spot), at 130 ms → `{ok:false}`, silence →
`{ok:true}`, late *foreign*-function 0x64 → `{ok:true}`.
**Attribution sub-item: closed as impossible-without-inventing.** The 0x64 body is only
`[echoedFn, resultCode]` (`write-protocol.md:29-31`; `parseMultipurposeResponse` slices 2 bytes) — there
is no sub-action on the wire to compare, so the narrower disambiguation is not available. The limit is
documented in `#write` and the same-function residual is pinned conservatively (matching fn ⇒ treated as
ours ⇒ `{ok:false}`), erring toward "rejected" and never toward a false "accepted".
**Unverifiable without the FM3:** the real post-120 ms rejection latency; 250 ms is inherited from the
hardware-evidenced writer path rather than re-measured.

`write-rejection.test.ts:9-11` documents this exact failure ("a 50 ms window could close before a
genuine rejection arrives and report a rejected write as accepted"). All mock replies are synchronous,
so the case is unreachable in the suite.

- **Change:** pick one window (the writer's 250 ms is the better-evidenced number) or justify the split.
- **Test:** a mock that returns the 0x64 *after* the window would close, asserting the write is not
  reported as accepted.
- **Related:** `gen3.ts:273-276` keys attribution on the function byte only — store/setParam/setType/
  setBlock/setBypass all ride `fn=0x01`, so a rejection of one is attributable to another within the
  window. The suite covers only the foreign-*function* case.

### P2.3 Scaled-enum value decode vs option list — **DONE** (`88ce0d0`)
`PHASER_ORDER` is the only scaled enum in any gen-3 catalog, and the only row where `ordMax != displayMax`,
so the fix is exactly scoped. The `raw > max` branch now unscales against the **ordinal** end and clamps:
`value = Math.min(ordMax, Math.round((raw/65534) * (ordMax - min)) + min)` — `ordMax === max` for every
unscaled enum, so it is a no-op off the scaled rows, and a served value is now always a member of its own
options (no more `float32(6)` written back as a discrete ordinal).
Test: `enum-coverage` gained case 4, feeding `raw 65534` through the mock transport — **RED before**
(`value 10 ∈ [0..5]`), green after; it asserts both membership and `options.length === enumCount`.
**Still unverified offline:** whether a real FM3 sends that param as a 16-bit-scaled value at all (the
`raw ≤ max` ordinal path is unchanged either way).

Original filing (kept as the record): the value was computed in display space (0..10) while the options
lived in ordinal space (0..5), and no test fed a scaled wire value, so the branch was dead under test.

### P2.4 `/diag/ranges` (and the convert routes) are missing from the browser-direct runtime — **DONE** (`cc25d95`)
All four named routes ported into `runtime/router.ts`, plus a fifth the workstream found (`GET /preset/body`).
The browser-safety constraint did **not** block any of them — `services/convert.ts`'s `forgefx-midi` graph
bundles clean (base64 now uses `atob`, not the Node-only `Buffer`), and `scripts/check-browser-safe.ts`
passes with convert in the graph.
The drift guard also **found a real pre-existing drift on its first run** and it is fixed: `/device/cache/cloud/pull|publish`
were registered unconditionally in the router (answering a "cloud disabled" 503 shape) while `app.ts`
registers them only under `AXIS_CLOUD=1` — now gated on `deps.cloud`, matching the Node host. Axis gates its
cloud actions on `cloud.available` (`deviceDefs.ts:43`), so no reachable client path changes.
Guard: `test/api/route-parity.test.ts` (11 cases) enumerates both tables authoritatively — `app.ts` through a
new test-only `onRoute` seam, the router through a new `listRoutes()` — and fails on any `(method, path)`
difference that is not on the documented exception list (**/am4/* deprecated aliases**, **GET /events**,
both verified in code). It also asserts router ⊆ app and that every app-only route has an exception.
P3 in the same commit: `presetSelectH` and `setParamH` now answer **400** on missing/non-integer/out-of-range
params (previously an unhandled 500 out of `encode14`), shared by both surfaces.

Original filing (kept as the record):
`ForgeFX/server/src/app.ts:140,346,373,123` vs `ForgeFX/server/src/runtime/router.ts:122`

`/diag/ranges`, `POST /preset/convert`, `/preset/convert/export` and `POST /debug/raw` exist only in
the Fastify table, so in browser-direct mode the Range Trace panel and the Convert dialog are 404s —
including the diagnostic the audit recommends as ground truth.

- **Change:** port them into `runtime/router.ts` or gate the Axis features off in direct mode.
- **Guard:** a path-set diff test over both route tables, so a future endpoint can't land in one only.

### P2.5 The audit's "honestly impossible" claims need narrowing — **DONE** (`afbef9d`, Axis docs)
The audit now says: CS MIDI is partially available (the trio 6979/6985/6986 is served; the CS exclusives
already render) and startable offline as a MIDI/Remote *layout*, not a wire gap; FC Config is PARTIAL via
the layout-widget rule; Devices/mirroring stays genuinely GATED; `PFC4` is recorded as Axe-Fx III only;
§6.1's MIDI-block probe is marked answered (by §2.8) and §6.2's GLOBAL sweep is replaced by the CI guard.

Original filing (kept as the record):
`Axis/docs/NEXT-STEPS.md:58` · `docs/axis-fm3edit-feature-parity-audit.md:482-486`

CS MIDI is not a wire gap: `GLOBAL_CS1_ENABLE` (6979), `GLOBAL_CS_EDIT_NUMBER` (6985) and
`GLOBAL_CS_COMMAND_BEGIN` (6986) carry enum rows and are served today; `GLOBAL_CS1-6_EXCLUSIVE`
(7107-7112) are served **and** already rendered. The trio is a *layout* gap, not a wire gap. Only
Devices/mirroring is genuinely wire-absent. `FC_DEFAULT_LAYOUT`/`FC_CLONE` are one calibration row
away (see P1.2). A wrong "impossible" stops startable offline work.

Also: `audit:457` lists `GLOBAL_MIDI_MAPPING` as a candidate silent gap while `audit:274` correctly
records it as served (OFF/ON) — the two lists cannot both be right.

---

## P3 — cleanup: **SHIPPED** engines, `.npmrc` heap flag, one float-vs-enum unit set, route 400s, the
## `version.ts` guard, the build-order script, the audit/`ROADMAP.md` citation fixes · **OPEN: the AM4
## alias sunset decision** (the only substantive P3 item left — see below)

The individual entries below are the original filings, kept as the record; the SHIPPED list above is
authoritative. Evidence per item: engines (`afbef9d`, `6ca47d2`), `.npmrc` heap flag (`afbef9d`, proven
with a bare `npm run build`), `KNOB_UNITS` single source (`88ce0d0`), route 400s (`cc25d95`),
`version.ts` drift guard (`b6e24f1` — `test/version-consistency.test.ts`), build-order script
(`33a1e8d` — `npm run setup:stack`), audit claims (`afbef9d`), stale `ROADMAP.md` cites in code
(ForgeFX `a26ee49`).

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

## P4 — shipped 2026-10-07 (scope chosen after the review list closed)

Not from the original review: what the rounds themselves surfaced as the next best use of a round.

- **The optimistic-write class, closed for the BPM/tuner sites** (`9d71729`, Axis): `setBpm` and
  `toggleTuner` now honour a `200 {ok:false}` through the new pure `settleScalarWrite` (the scalar
  counterpart of `settleEnumWrite`), and `tapTempo` is pinned as deliberately fire-and-forget because it
  re-reads truth. The doc that taught the anti-pattern (`src/lib/CLAUDE.md`) is corrected.
  **The wider census is in the follow-ups section below — three more sites of the same class are known
  and unfixed.**
- **Control Switch group in Setup → MIDI/Remote** (`aba4063`, Axis) — the largest remaining
  offline-startable feature, and the one the review reclassified from "impossible" to "layout gap":
  `GLOBAL_CS1_ENABLE` (6979), `GLOBAL_CS_EDIT_NUMBER` (6985), `GLOBAL_CS_COMMAND_BEGIN` (6986) and the six
  `GLOBAL_CS1-6_EXCLUSIVE` (7107-7112) are all served but had **0 layout refs** on the Setup screen (the
  exclusives' only refs are on the FC "CONTROL SWITCH LINK" row, i.e. the Foot Controller screen). Now
  rendered as a group in the existing `MidiRemoteSection.svelte`, built purely from served data via a new
  pure `controlSwitch.ts` ledger: device-true option labels come from the FM3 override table
  (`6979→YES,NO` · `6985→CS1..CS6` · `6986→--,CC,PC` · `7107-7112→Not Exclusive,Exclusive`). Honest
  unavailability is explicit — an unserved param renders disabled with the reason, and a served selector
  with no labels shows `no option labels served — ordinal N` rather than a fabricated label. Recorded
  gap: the per-switch message *values* (`GLOBAL_CS_CHAN_BEGIN` 7010 + 7034/7058/7082) are not served —
  7010 is a float on an `unverified` unit with no layout `knob` ref, the rest have no range row at all.
- **AM4 alias sunset (2026-12-01) made non-silent** (`5c98cac`, Axis, + `docs/am4-alias-sunset-2026-10-07.md`):
  12 of ForgeFX's 16 deprecated `/am4/*` aliases are still called from live client paths. All 12 **have** a
  unified equivalent that exists in *both* server route tables — 6 are a straight swap, 6 need a
  capability check first (the client's v2 branch gates on `caps.*`, which `legacyAm4 ||` currently
  short-circuits). `am4Deprecation.ts` holds the inventory and `am4Deprecation.test.ts` derives the alias
  list, the client-called paths, the sunset date and the unified-route existence **from source**, so a new
  or removed alias fails the test instead of rotting. The alias→unified mapping is the only hand-maintained
  part (the join is by handler identity and one handler answers two unified paths) and it is cross-checked
  against the server's handlers. **Nothing was removed** — whether the v1/AM4 fallback should be migrated
  away or kept past the sunset is a product decision, and this round only made the deadline visible.

---

## Follow-ups found DURING the rounds (not in the original review)

**Closed in the P4 round (`9d71729`):**
- **`setBpm` (`Axis/src/lib/editor.svelte.ts:2710`)** — was: optimistic `this.bpm = n` then
  `await forgefx.setTempo(n).catch(() => {})`. **FIXED** via the new pure `settleScalarWrite`.
- **`toggleTuner` (`:2737`)** — was: reverted on a *throw* only, so `{ok:false}` left the toggle
  displayed. **FIXED** via the same helper.
- **`setPinnedEnum`** — **FIXED earlier** (`33a1e8d`).
- `tapTempo` stays fire-and-forget **by design** (it re-reads the tempo via `getTempo`, so its display
  cannot lie) and is now pinned as deliberate by the guard.
- **The docs were also teaching the defect:** `src/lib/CLAUDE.md` called a catch-only revert "THE
  canonical action shape". Corrected, with the example matching the shipped `toggleTuner`.

**Still open — the same class, found by the P4 sweep and NOT fixed (deliberately):**
- **`toggleBypass` (~:1740), `setChannel` (~:1753), `selectScene` (~:2564)** — optimistic value,
  throw-only catch, ignores a `200 {ok:false}`, and they return `{ok:boolean}` like the fixed sites.
  `toggleBypass` additionally toasts a success that may not have happened. **The next obvious round.**
- **The grid/routing ops (`place` ~:1980, `removeAt` ~:2008, `move` ~:2037, `connect` ~:2149,
  `replaceShunt` ~:2168, `disconnect` ~:2190, `#runPlan` ~:2205)** — optimistic and then reconciled by
  `load()`, so the *display* self-corrects, but a mid-op `{ok:false}` is not detected, which means
  **history/undo can record an operation that never landed**. A different symptom (undo fidelity) from
  the same root cause.
- **`retype` (~:1924)** — no optimistic value, but a false-success toast on a refusal. Note only.
- The sweep's full classification (deliberate / already correct / same class) is in the P4 workstream's
  transcript; the two lists above are the actionable residue. Re-derive it with a grep for
  `.catch(() => {})` before starting any follow-up round — the line numbers shift.

---

## Found by the Opus effort A/B (2026-10-07) — ALL SHIPPED in P5 (two flags remain)

That run's original purpose was to calibrate `--effort` (it did — see the skill note), but it doubled as
an unbriefed 122-line bug hunt on the code these rounds had just shipped. Everything listed here was
re-read in the source before filing and then fixed in round P5 — see the P5 section below for what
landed, plus the two things the fix round deliberately left open.

- **[HIGH] `match` closes the write window on ANY 0x64, so a late rejection is missed.**
  `ForgeFX/server/src/drivers/gen3.ts:290` — `match: (fs) => fs.some((f) => f[5] === 0x64)` resolves on
  *any* 0x64, while the rejection check on the next line requires the echoed function to be ours
  (`f[6] === undefined || f[6] === fn`). A **foreign**-function 0x64 (e.g. a refused read) therefore ends
  the wait immediately, our own rejection arriving after it is never collected, and the write reports
  `{ok:true}`. The comment directly above promises the opposite. Fix: one `isOurReject(f)` predicate used
  in BOTH `match` and `rejected`. **This partially defeats P2.2, which is why it matters.**
- **[MEDIUM] A late rejection overwrites a newer value.** `Axis/src/lib/paramWriteOutcome.ts`
  `settleEnumWrite` does `if (!d.keep) target.value = from` with **no check that the value on screen is
  still the one this write set**. A discrete write now holds the window ~250 ms, so A→B then B→C is an
  easy user sequence: if B is rejected, the display is reverted to B's `from` (= A), wiping C. Fix: revert
  only when the current value still equals the value this write set, or keep a per-param sequence token.
- **[MEDIUM] The optimistic value is set before the guard.** `Axis/src/lib/editor.svelte.ts:1687-1691`:
  `e.value = value` runs first; the `if (!c || (!c.pack && !this.paramsWithoutPack)) return;` then exits
  without sending, recording history or reverting — so an unsent value stays on screen. Fix: guard first,
  or restore `from` before returning.
- **[LOW] `#lastLocalEditAt` is set after the await** (`gen3.ts:~1446`), so on the 250 ms discrete path
  the device-edit poll can run in that gap and echo our own write; it is also never set if `#write`
  throws. Fix: stamp it before sending.
- **[LOW] `value` is still unvalidated on the write route** (`runtime/handlers.ts:64-70`, shared by both
  surfaces): P2.4 hardened `addr`/`paramId` but not `value`, so a `NaN`/non-integer ordinal relies on the
  codec throwing → 500 instead of 400. Fix: require `Number.isFinite`, and an integer in range when
  `!continuous`.
- **[LOW] A post-save failure is reported as a failed save** (`editor.svelte.ts:~2897`): `await this.poll()`
  sits inside the save `try`, so a poll error toasts "Save failed" *after* "Saved to preset N" and after
  the checkpoint was recorded. Fix: move the poll/`refreshSlot` into their own catch.
- **[LOW] Duplicated settlement logic** (`editor.svelte.ts:1698-1703`): the block repeats
  `#writeSettlement` (1715-1721) inline, so the two can drift. Fix: call the wrapper.
- **[NIT] Stale line citation** (`editor.svelte.ts:1686`): the comment cites `gen3.ts:1391-1393` for the
  fire-and-forget design, which now lives ~1443. Cite the symbol, not the line — this is the exact rot
  class that made the guides a liability.

**Answered by the run (don't re-ask):** does `dev.request` throw on timeout, or return what it collected?
The P2.2 suite pins the silent case as `{ok:true}` (the `WindowTransport` replays the real resolution
semantics), so a completed wait with no 0x64 is an accept — not an error.

## P5 — shipped 2026-10-07 (the A/B findings + the wider write-outcome census)

- **The write-outcome sweep is finished** (`e58482d`, Axis). `settleEnumWrite` gained a required `sent`
  argument and now reverts **only when the on-screen value is still the one this write set**
  (`stale = target.value !== sent`) — so a late rejection can no longer wipe a newer value, which the
  250 ms discrete window made easy (A→B then B→C). Design note: the guard lives in the pure module
  because that is the only place the node-env harness can prove it; the history-drop and the refusal
  toast still apply to a stale settlement. Also fixed: `setEnum` guards **before** its optimistic write;
  `toggleBypass`, `setChannel` and `selectScene` settle their outcome (no more throw-only catch, and
  `toggleBypass` no longer toasts an unverified success); `retype` gates its "Type changed" toast;
  `save()`'s `poll()`/`refreshSlot` moved out of the save `try` so a poll error can't be reported as a
  failed save; `setEnum`/`setPinnedEnum` call `#writeSettlement` instead of duplicating it; and the stale
  `gen3.ts:1391-1393` citation now names the symbol.
  **Export signature changed (reported, all call sites updated):**
  `settleEnumWrite(target, from, sent, historyId, outcome, io)`.
- **Grid/routing undo is honest** (`4e4bc56`, Axis). The premise held for every op: `forgefx.placeCell/
  clearCell/cable` all resolve `{ok}` and `req()` only throws on non-2xx, so a refusal was awaited and
  discarded while `history.record` fired regardless; `load()` reconciled the display and left the undo
  entry. Now a new pure `gridOpOutcome.ts` decides over the collected settlements (reusing
  `settleWriteSet`): the op is recorded **only when every write landed**, a transport error aborts the
  remaining steps instead of hammering a dead link, a device refusal continues past the refused step, and
  the success toasts are conditional (all seven ops toasted unconditionally before).
  **Seam change (the known #1 hazard, verified by the merged-tree `svelte-check`):**
  `EditorSurface.removeAt` widened to `Promise<boolean | void>` — the store returns whether the clear
  landed, the offline `convertEditor` returns void, both satisfy the seam.
- **The write window closes only on OUR rejection** (`af18f50`, ForgeFX) — the A/B's HIGH. One
  `isOurReject(f)` predicate is now used in **both** `match` and `rejected`, so a foreign-function 0x64
  (a refused read, say) can no longer end the wait early and hide a real rejection; the conservative bias
  is preserved (a too-short 0x64 still counts as ours; the same-function residual cannot be
  disambiguated) and the comment now agrees with the code. Test: a foreign 0x1f at 60 ms then our 0x01
  rejection at 150 ms → `{ok:false}` (red before the fix). Also: `#lastLocalEditAt` is stamped **before**
  the send in `setParam` (and in its identical sibling `setType`), and the shared write route now
  validates `value` (finite; an integer ordinal in the codec's `0..16383` when `!continuous`) → 400.
- **Premise correction worth keeping:** the A/B filed the unvalidated `value` as "relies on the codec
  throwing → 500 instead of 400". Probing the codec disproved that: `buildSetParameter` encodes `NaN`,
  `1.5`, `20000` and `Infinity` as a float32 **without throwing**, and a live route probe returned
  **200 `{ok:true}`** with the garbage reaching the driver — a silent garbage write reported as success,
  which is worse than the 500 it was filed as. The 400 validation was implemented anyway.

**Left open by P5 (both flagged by the workstreams, not silently dropped):**
- `settleScalarWrite` has **no equivalent staleness guard** — a rapid double-write on one control
  (bypass/scene) can still clobber. The A→B→C protection currently covers enum writes only.
- **`pasteBlock`'s inline op-loop (~:2350) still has the grid-op class**: its writes are awaited and
  discarded, so a refusal is not reflected in its toasts. Outside the round's declared region.

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
