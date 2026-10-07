# Axis — next iteration: prioritized fix list (from the 2026-10-07 third-party review)

**Status:** **P1.1–P1.3, ALL of P2, the P3 items (engines, `.npmrc` heap flag, unit sets, route 400s,
audit claims, build-order script, `version.ts` guard, stale `ROADMAP.md` cites) and the P4 round
(bpm/tuner outcome + Control Switch table) SHIPPED 2026-10-07** · **P5, P6 and P7 SHIPPED 2026-10-07 ·
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
difference that is not on the documented exception list (**GET /events** only, since the P7 removal of the
`/am4/*` aliases — the guard now asserts the app-only set *equals* `['GET /events']`, so a revived alias or
any newly-drifting one-table-only route fails immediately).
It also asserts router ⊆ app and that every app-only route has an exception.
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
## `version.ts` guard, the build-order script, the audit/`ROADMAP.md` citation fixes · **the AM4 alias
## sunset decision — RESOLVED 2026-10-07 (P7 deleted the aliases outright; Andy: no AM4 owned, not tested)**

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
  against the server's handlers. **Nothing was removed in P4** — the user then decided the v1/AM4 fallback
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

## P6 — shipped 2026-10-07 (the residue: last write-outcome items, route validation, probe runbook)

- **The write-outcome class is now closed end to end** (`77c9f60`, Axis). `settleScalarWrite` got the same
  staleness guard as its enum sibling — the scalar target gained a `get()` reader and the write takes the
  value it sent, so `stale = target.get() !== sent` and a late refusal can no longer wipe a newer value on
  `setBpm` / `toggleTuner` / `toggleBypass` / `setChannel` / `selectScene`. Design note recorded in the
  module: value-comparison over a per-control sequence token, because a token would need store state the
  node-env harness cannot reach and would mint a second staleness vocabulary. `pasteBlock`'s inline
  op-loop — the last site that discarded its write results — now goes through `#runOps` +
  `decideGridOpOutcome` like the routing ops. The final `.catch(() => {})` sweep found only deliberate
  cases (deferred continuous knob streams, the device-screen cursor mirror, `tapTempo` which re-reads
  tempo, and two telemetry imports).
- **Route-input validation finished across both tables** (`b36e51d`, ForgeFX): 19 write routes
  inventoried, ~15 hardened, with the validation living in the **shared handlers** so the Node host and
  the browser-direct runtime inherit it (both route files shed their duplicated inline parsing — route
  counts verified unchanged: 99 app registrations / 92 router rows before and after). **The P5 lesson paid
  off immediately**: the probe proved `driver.setTempo(NaN)` returns `{ok:true}` and pushes a garbage
  tempo frame to the wire — the codec does not throw, so pre-fix `POST /tempo {bpm:'abc'}` was a *silent
  accept with a 200*, not a crash. That case is now a 400 with a valid boundary twin asserted on both
  surfaces. `route-parity` grew to 44 cases. Deliberately unchanged: an in-range scene index the device
  rejects stays `200 {ok:false}` (the driver's documented explicit reject, asserted by write-safety).
- **The hardware questions are now one command** (`adeb1dd`, ForgeFX): `npx tsx scripts/probe-device.ts`
  answers all five open ones with a verdict table — GLOBAL write read-back, Cab-2 Mute/Solo write, whether
  a 16-bit-scaled enum ever arrives, whether a complete bulk read is ever padded, and the real `0x64`
  rejection latency. **Read-only by default**; the three mutating probes sit behind `--writes` and each
  captures, verifies, then **restores and re-verifies** the original value, printing a `FAILED-RESTORE`
  block naming the parameter if it cannot. Exit codes: 0 = every eligible probe gave a verdict, 3 = no
  device, 2 = an eligible probe was inconclusive — a silent pass is impossible. A `--mock` mode plus an
  11-case suite (now the 42nd) proves offline that the default writes nothing, that `--writes` restores,
  and that a missing device exits non-zero. Documented in `docs/TESTING.md`.

**Both P5 flags are now closed** (`settleScalarWrite` staleness guard; `pasteBlock`'s op-loop).
**One open item resolved as unanswerable-by-design:** the CS table's four remaining params
(`GLOBAL_CS_CHAN_BEGIN` 7010, `_CC_NUM_BEGIN` 7034, `_ON_VAL_BEGIN` 7058, `_OFF_VAL_BEGIN` 7082) are
`_BEGIN` **table markers**, not controls — 7010 has a float row but its unit is `unverified` and the FM3's
own layout references it **zero times** (no evidence to serve it under the P1.2 rule), and the other three
have no range row at all. "Disabled with the exact reason" is the correct final rendering, not a stopgap.

---

## P8 — shipped 2026-10-07 (probe honesty, the silent-write verdict, read-route validation)

Three ForgeFX workstreams, all offline, all merged with `--no-ff` and zero conflicts.

- **The probe's reporting and diagnosability were rewritten** (`280d978`). Q5 no longer fabricates a
  latency: it has three mutually-exclusive, single-sourced outcomes — **refused** (a `0x64` arrived, with
  its resultCode and the measured ms to that frame), **silent** (no frame at all; **no latency reported**),
  **accepted** (a reply arrived that isn't a `0x64`). On a real FM3 the bogus-eid write reports `silent`.
  Connection failures now name the port, the errno and which of three classes: nothing enumerated /
  present-but-not-openable (`EACCES: … /dev/ttyACM0`) / openable-but-unresponsive. Suite 11 → 26 cases.
- **Fix-forward from the LED incident.** `restored` is now true only when a *different* read path
  corroborates it; a same-path read-back prints **`UNPROVEN-RESTORE`** and says exactly what it did and did
  not establish — it can never again print a bare "verified" on the strength of an echo of our own write. A
  captured original sitting on an **off/disabled boundary** (0 on `GLOBAL_FS_BRIGHTNESS`, a 0..100 param)
  makes Q1 **refuse to write** with a loud `⚠ HAZARD` — the deliberate trade-off being to lose the Q1
  answer on an all-off unit rather than risk writing a misread 0 over a real value. Every mutating probe now
  prints a `human check:` line naming the thing a person can actually look at.
- **`--writes --dry-run`** performs only the read half and prints the full plan — param, eid/pid, captured
  original, would-write, would-restore, boundary flag — writing **nothing**, and exits **4**, distinct from
  0/2/3 so it can never be mistaken for a completed run. This is the guard that would have prevented the
  incident: the plan would have shown `original 0.0000 → would write 0.1 → would restore 0.0`.
- **Silent-write semantics: verdict (b) — no distinct signal exists, and NO behaviour was changed**
  (`64902c9`, zero `src/` files touched). The trace: discrete write → `gen3.ts:1453` → `#write`
  (`:291-305`) → `request({timeoutMs: 250, quietMs: 250, match: isOurReject})` → `{ok: !rejected}`.
  **Silence — whether the device accepted or silently ignored — is `{ok:true}` → HTTP 200 → Axis reads
  `status:'ok'`.** Continuous and GLOBAL writes go through `#send` and collect no reply at all, so they are
  `{ok:true}` unconditionally. Therefore mapping silence to `ok:false` would break **every** accepted write.
  The recommendation is instead **scoped read-back verification** (`docs/write-protocol.md`): verify
  persisted-global params and low-frequency structural writes (`store`, `placeCell`/`cable`, names) with one
  extra independent GET; leave the hot path (`continuous` knob streams, `tapTempo`, `selectCell`,
  `setTempo`) fire-and-forget. Pinned by a new 16-case suite (ForgeFX is now **42 suites**) which locks the
  indistinguishability itself: accept and ignore produce the same verdict **and a byte-identical outgoing
  frame**, and all ten `#write`-routed ops return `{ok:true}` under silence.
- **Read-route validation finished** (`3fb8f20`): ten read routes whose params are parsed now answer **400**
  on malformed input (non-integer, negative, `> 0x3fff`), in the **shared** handlers so both surfaces
  inherit it. This was a *silent-misread* class rather than a cosmetic one: the driver's own `enc14` masks a
  bad address to a **different** one, so a malformed eid produced a 200 with the wrong block's data. A
  well-formed-but-absent in-range integer still goes to the driver (tested as the boundary twin).
  `route-parity` 44 → 68 cases. **The workstream corrected the orchestrator's own example**: `:eid=99999` is
  *not* "well-formed but absent" — `enc14` cannot carry it and silently wraps it, so it belongs in the
  malformed → 400 bucket; the genuine absent case is an in-range integer naming nothing.
- **Left as-is, and the note was WRONG** (corrected in P9): `GET /fc/state` with garbage does **not** yield a
  driver 503 — `config` becomes NaN, `enc14(NaN)` encodes `[0,0]`, every field is read from **pid 0** and the
  route answers **200**. Same silent-mis-read class the round fixed elsewhere. Also left: `pids[]` array
  validation, which the workstream extended on the same `enc14` reasoning.

**Merged-tree verification — GREEN:** forgefx-midi **84** ✓ · ForgeFX **42 suites** ✓ · Axis **1815
unit tests / 173 files** ✓ · `svelte-check` 0 errors / 0 warnings ✓ · build ok ✓ · Playwright **142/142** ✓.
Route counts verified unchanged across the read-validation refactor (83 app registrations / 92 router rows
before and after) — the deleted lines were inline handlers replaced by the shared ones, not lost routes.

---

## P9 — independent review of P1–P8 (Sonnet 5.5, 2026-10-07) and what it found

One read-only Claude session reviewed the whole P1–P8 diff (8,236 lines / 59 files, 42 non-merge commits)
against six ordered questions. Its report: `~/repos/stack/review-2026-10-07/p9-review/p9-report.md`
(raw JSON alongside). **Every claim below was re-verified by the orchestrator before being acted on; the
verdict column is the orchestrator's, not the reviewer's.**

| Finding | Verdict | Action |
|---|---|---|
| **GLOBAL block-bulk reads are broken** — `bulk.values[base + p.paramId] ?? 0` (gen3.ts:726/733/752) with `GLOBAL stride 186 / recordCount 187` vs **91 served GLOBAL pids >= 186** (max 65522) | **CONFIRMED by reading the code and catalog** | P9 round, priority 1 |
| The P1.2 coverage test cannot catch it (zero fixture, membership only, no value asserted) | **CONFIRMED** | Strengthened in P9 |
| **`GET /fc/state` reads pid 0 and answers 200** on garbage (`enc14(NaN)` = `[0,0]`) | **CONFIRMED** | P9 round |
| **The staleness guard fails on ABA** — `stale = value !== sent` is reachable on an odd-length boolean toggle burst (true/false/true with the first refused wipes the third) | **CONFIRMED by reading `paramWriteOutcome.ts:79`** | P9 round |
| A double refusal can leave an unconfirmed value on screen | **CONFIRMED as described** | P9 round |
| `editor.svelte.ts:2600` claims a scene switch is reject-watched — false on gen3 (`setScene` → `#send` → `{ok:true}` unconditionally) | **CONFIRMED** | P9 round |
| `ToolRail.svelte:40-44` `showTools` still ends `: editor.isAm4` (should be `: false`) → an AM4 with no caps gets a Tools button opening an empty modal | **CONFIRMED** (minor; only reachable on a v1 server or before caps load) | P9 round |
| The above retraction (GLOBAL writes "YES" rests on a same-path echo) | **CONFIRMED as a documentation defect** | Retracted in this commit |
| `/fc/state` "driver 503" note was wrong | **CONFIRMED** | Corrected in this commit |
| P7 AM4 collapse: "no behavioural defect in the collapsed route sites" | **Accepted** — every removed guard was `!isV2 && isAm4`, false whenever `isV2` | No action |
| P8 read-route refactor: "only 400s for malformed" | **Accepted with two caveats** — a malformed `:n` on an AM4 `/summary` was 501, now 400; repeated query keys (`?eid=1&eid=2`) 400 on Fastify but are accepted on the browser router, and `route-parity` does not cover it | Noted |
| Test-quality list (vacuous/partly vacuous suites: `silent-write` case 5, `block-read-failure`, `route-parity` twins, the Axis regex sourceguards matching whole-file, `noAm4Routes` parsing gaps) | **Plausible, not individually verified** | Queued |

**What the review could NOT establish** (its own honest limits, worth keeping): the real GLOBAL `0x75`
body length and indexing; the true wire encoding of pid 7115; what the `01 01 00` GET actually returns for
eid 1; and how real `0x64` refusals behave. **All four need the FM3 attached** — and the first is the one
that would settle the GLOBAL question completely.

---

### P9 round — SHIPPED 2026-10-07 (three fixes from the review above)

- **GLOBAL bulk reads no longer fabricate a value** (`7d1f800`, ForgeFX). The review's premise held:
  `GLOBAL = { stride: 186, recordCount: 187 }` against **173 served GLOBAL pids, 91 of them >= 186** (max
  65522), read as `bulk.values[base + p.paramId] ?? 0` — so those pids indexed past the block, `undefined`
  became **0**, and sub-stride pids resolved to the record at their ORDINAL, which need not be their
  record. **A pid→ordinal map does not exist** in the catalog (the GLOBAL table is keyed by paramId and
  emits no ordinal metadata; the codec's own contract is positional, which GLOBAL violates), so the round
  took the **refuse-to-guess** route: GLOBAL values are no longer read from the bulk path and are reported
  as **`null` with a reason**, never 0. Dense families are proven unaffected (only GLOBAL and PRESET trip
  the check; every audio family has max pid == stride−1). `layout-param-coverage` now uses a **non-zero**
  fixture and asserts VALUES, so this class cannot pass vacuously again — and the round *verified* the
  strengthened test fails on the old code by stashing only the src change. It also found a latent
  double-lookup in `knob-coverage`'s fixture that had only ever "passed" because `?? 0` fabricated a value.
  Decision + the precise live question: `docs/decisions/0004-global-bulk-read-unknown.md`.
- **`GET /fc/state` cannot read pid 0 from malformed input** (`953ea5c`, ForgeFX). Shared `fcStateH` guard
  (absent/'' → 0 as before; non-integer/negative always rejected; each axis bounded by the device's
  **declared** FC geometry — layouts 9 / views 4 / switches 3, which *is* available at the seam, contrary to
  the earlier note) plus a driver backstop that throws rather than encode `[0,0]`. 400 before `driver()`.
  `route-parity` 68 → 77 cases, including a section against the real driver proving `fcReadState(NaN,NaN,NaN)`
  throws and sends nothing.
- **The ABA caveat is REACHABLE, and is now pinned as a known limitation** (`89a0d49`, Axis). Confirmed:
  `stale = value !== sent` means an odd-length same-value burst (A→B→C→B, earlier write refused late) wipes
  the newer write, and a double refusal can leave a value on screen the device never confirmed. **Not
  fixed, deliberately:** closing it needs per-control write-initiation ordering, which the pure settle
  signature provably cannot carry; the documented upgrade is a token minted at write time, and it would
  widen a contract seven store call sites depend on. `paramWriteOutcome.aba.test.ts` pins both cases, so a
  real fix will break the test loudly. The false reject-watch comments are corrected, and
  `src/lib/CLAUDE.md` now carries the reject-watch rule.

**Merged-tree verification — GREEN:** forgefx-midi **84** · ForgeFX **43 suites** · Axis **1820 unit tests
/ 174 files** · `svelte-check` 0/0 · build ok · Playwright **142/142**. Route counts unchanged (83 app /
92 router).

- **⚠ OPEN, created by the P9 fix — the Axis side of the new `null` contract.** ForgeFX now legitimately
  sends `value: null` for an unresolved GLOBAL param, but Axis still types `NamedParam.value: number` and
  `EnumParam.value: number` (`src/lib/types.ts:20-40`) and has no handling for it: the server is honest and
  the client can meet a value it was never told about. **The merged-tree gate cannot catch this** —
  `svelte-check` does not inspect a JSON boundary and no GLOBAL knob is covered by the e2e suite. Fix:
  widen the client types to `number | null`, render unknown explicitly (disabled control / em-dash) and
  ensure no knob position or slider arithmetic turns null into `NaN` — **never coerce back to 0**, which
  would recreate the fabricated-value defect on the other side of the wire.

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

## Hardware questions — MEASURED against a live FM3, 2026-10-07

Run with `npx tsx scripts/probe-device.ts [--writes]` (device on `/dev/ttyACM0`, model `0x11`). Raw output:
`~/repos/stack/review-2026-10-07/` — read-only pass and `--writes` pass. **All five are now closed:**

1. **Does the FM3 ever send a scaled enum wire value? — NO (Q3, `does NOT match`).** Observation:
   `PHASER_ORDER` raw wire value **1** vs displayMax 10 (enumCount 6, channel 0) — a plain ordinal.
   **P2.3 is LATENT, not live:** the fix is correct and worth keeping as defence, but nothing on this
   firmware exercises it. Do not go looking for a scaled-value bug; there is none.
2. **How late can a genuine `0x64` rejection arrive? — STILL OPEN, and the question was mis-framed (Q5).**
   The probe's deliberate invalid write (bogus eid 16382) produced **no `0x64` at all** — the FM3
   *silently ignores* an unknown eid rather than refusing it. So the late-rejection window cannot be
   measured this way, and the P2.2 window (250 ms) was never approached because nothing arrived.
   **The finding that matters: absence of a refusal is NOT acceptance.** A silently-ignored write and an
   accepted write look identical to a client that waits for a refusal. Follow-up filed below.
   ⚠ The probe's own reporting is incoherent here — it printed `no 0x64 arrived within 2000 ms` and
   `latency 251 ms` in the same breath (251 ms matches the writer's own 250 ms window, so it is almost
   certainly the probe's timer, not a device latency). **Probe reporting defect — fix before trusting Q5.**
3. **Do GLOBAL writes actually succeed? — RETRACTED, still UNPROVEN (was marked "YES" in error).**
   The only evidence was `GLOBAL_FS_BRIGHTNESS` reading 0.0000 → writing 0.1000 → **reading back
   0.1000**. Two independent findings now invalidate that reading: (a) P8 established that a read-back
   which merely *echoes our own write* is not verification, and the codec documents a SET returning a
   value echo; (b) the review below found the GLOBAL **read** path itself is broken (out-of-range index →
   `?? 0`), which is also what produced the 0.0000 in the first place. So the write may well work — but
   nothing on record proves it. **The audit's "write side unverified" caveat STANDS.** Re-establishing
   this needs an independent read (a different sub-action, or the front panel) — see the P9 section.
4. ~~Is there a 4th FC port (`PFC4`)?~~ **ANSWERED — no.** `PFC4` is evidenced only in the **Axe-Fx III**
   layouts (`axe-fx-iii/layouts.generated.ts:13698-13699`); the FM3 has FC ports 1-3. Nothing to fix.
5. **Does the FM3 ever pad a complete bulk read? — NO (Q4, `matches the expectation`).** Cab (eid 62):
   the `0x74` head advertised **424** `itemCount`, the assembled read delivered **424** values, extra 0.
   The P1.3 torn-read guard (`values.length >= itemCount` ⇒ complete) is **safe as written**; no tolerance
   needed. (This also confirms the P1.3 harness bug fix was against a real invariant.)

### Filed by the measurement — **all actioned in P8 (below); kept as the filed record**

- **⚠ INCIDENT 2026-10-07 — the probe's "restore verified" destroyed a real setting.** Q1 wrote
  `GLOBAL_FS_BRIGHTNESS` (7115; the FM3 layout places it in a **MINI DISPLAY** section beside
  `GLOBAL_FS_LCD_CONTRAST` 7116, while the RING controls are separate params — `GLOBAL_FC_RING_BRIGHT_LEVEL`
  110 / `GLOBAL_FC_RING_DIM_LEVEL` 111 — so the earlier "Mini-Display + Ring Brightness" label was an
  assumption, not the layout; 0–100 with **0 = off**). It read
  the original as `0.0000`, wrote `0.1000`, then restored `0.0000` and printed **`restore verified`** —
  because the read-back echoed the value the probe itself had just written. The user's footswitch LED
  rings went dark. Two lessons: (a) **a read-back that echoes our own write is not verification** — it
  proves the write landed, not that the original was captured correctly; (b) a captured original sitting
  on a **range boundary that means "off"/"disabled"** (0 on a 0..100 level/brightness) is the destructive
  case, so a misread there silently switches a feature off. Fixed forward in P8 (`probe-reporting`): the
  restore record must say what it actually established, must not claim "verified" without independent
  confirmation, and must tell the human what to look at. **Lesson for all device work: a mutating probe
  needs a human-observable confirmation step, not just a read-back.**
- **Silent-ignore writes are indistinguishable from accepted writes.** The device neither acks nor
  refuses an unknown eid. Determine what the client's write-outcome path does with a silent non-answer:
  if the 250 ms window elapsing is read as *success*, then a silently-ignored write reports as landed —
  exactly the P5 defect class (`200 {ok:true}` for something the device never applied). Check
  `paramWriteOutcome` / `writeGate` semantics against this, and decide whether "no reply" should be
  `ok:false` (timeout) rather than assumed-accepted. **Offline work — no device needed.**
- **`probe-device.ts` Q5 reporting** — its expectation is a *measurement*, not a match/mismatch, and it
  emits two contradictory numbers. Make the observation single-sourced and the verdict meaningful, and
  distinguish "device refused (0x64)" from "device stayed silent".
- **Probe diagnosability** (found on the way in): when port access fails, the probe reports
  `no device: could not open a connection` and falls through to the serial default, so a **permission
  error is indistinguishable from an absent device**. Name the errno and the port in the message.
- ~~**AM4 `#syncTelemetry` guard removal** (P7) — watch for 5 s load timeouts on an AM4~~ **CLOSED BY USER
  DECISION, not verified.** Andy owns an FM3 only and will not test an AM4, so the removed early-return
  (which assumed a v1 AM4 ignoring gen-3 frames) stays unverified on AM4 hardware **by choice**. Do not
  raise it again as an open item, and do not propose AM4 testing or an AM4 probe run. The code change is
  still sound for every supported device: the `sceneCount`/`hasTempo` caps gates cover a v2 device.
