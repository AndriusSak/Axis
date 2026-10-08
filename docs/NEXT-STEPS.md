# Axis — live status (NEXT-STEPS)

**This file is the only live status document for the repo.** It states what is verified right
now, what is still open and what blocks each item, the decisions already made, and the claims
that have been checked and rejected. It deliberately does **not** narrate shipped work — that
lives in the commit history. The live *feature backlog* is
[`axis-fm3edit-feature-parity-audit.md`](axis-fm3edit-feature-parity-audit.md) (per-item status
+ evidence, kept current).

## What is verified right now

The **authority is the newest `verify-stack-*.out` under `~/repos/stack/review-2026-10-07/`** — read
it with `ls -t ~/repos/stack/review-2026-10-07/verify-stack-*.out | head -1`, **not** from a filename
written here (that line went stale once already). Regenerate it with `~/repos/stack/verify-stack.sh`
on the merged tree. **Do not copy test totals, suite counts or e2e numbers into this file** — read them
from that file of record; hand-copied counts go stale by construction.

```bash
# per branch (cheap, low memory)
npx vitest run <the branch's test files> && npm run check

# on the merged tree (authoritative)
npx vitest run
npm run check
npm run build                                          # heap flag lives in .npmrc
npx playwright test --project=chromium                 # boots its own :5199 server
```

Kill any lingering dev server on `:5199` before the merged-tree e2e run — `reuseExistingServer`
is on, so it will otherwise serve a feature-branch worktree instead of `main`.

A fresh sibling checkout also needs `npm run setup:stack` (forgefx-midi build → ForgeFX/server
build → `svelte-kit sync`): the sibling package `exports` point at gitignored `dist/`, so the
`file:` links resolve but the artifacts do not exist until each package is built, in order.

The repo has **no git remote** configured — `main` is the local tip; nothing is pushed.

`verify-stack.sh` builds `forgefx-midi` **first**, so a codec change merged from `src/` reaches
ForgeFX's import of the built `dist/` only via that build. Starting the server (or a probe) straight
after a merge, without the gate, dies with *"does not provide an export named …"* — run the gate
before touching the device, not after.

## Open items

Each item names its blocker and what closing it would require.

**Blocked on hardware (an FM3 / the Deck must be attached)**

- **The `0x64` latency question is mis-framed (Q5).** The probe's deliberate invalid write (bogus
  eid 16382) produces **no `0x64` at all** — the FM3 *silently ignores* an unknown eid rather than
  refusing it — so the late-rejection window cannot be measured this way. **Closing requires a
  write that actually provokes a refusal.** The finding that matters and stands: **absence of a
  refusal is not acceptance** — a silently-ignored write and an accepted write look identical to a
  client waiting for a refusal.
- **§3.7 Cab 2 Mute/Solo write** — the probe measured it ("matches expectation") but on the **same
  read path** as the original, so it proves the write landed, not that the original was captured.
  Closing requires an independent read (front panel).
- **§3.6 item 6 DynaCab 2-axis pad** — verified in e2e only, never on the Deck.
- **§2.5 user-cab IR upload — the wire path is MEASURED-REFUSED; the real opcodes are uncaptured.**
  Built and load-tested 2026-10-08 on a real FM3-Edit export (`U1.001_LT_TV_Mix_7.syx`, 10,345 B,
  model `0x11`, all 10 checksums valid). What the container IS, measured: `1 × fn=0x7A` + `8 × fn=0x7B`
  + `1 × fn=0x7C`; each data frame is a 2-byte prefix plus 256 five-byte chunks (32-bit value as 5
  LSB-first septets); chunks 0–7 of the first data frame are the **32-char name** ("LT TV Mix 7", bit 7
  of a slot is a flag of unverified meaning); the remaining **2040 chunks are sample slots whose encoding
  is NOT decoded** (not plausible PCM/float32 under any alignment tried). The `0x7C` payload is a
  5-septet value no candidate algorithm reproduced. `forgefx-midi/devices/gen3/cabIrSyx.ts` parses,
  replays verbatim, renames (flags preserved) and can retarget `0x7A`; `POST /cab/ir/upload` +
  the CabPicker import strip are wired; `scripts/upload-cab-ir.ts` is the load-test instrument
  (dry-run by default, listens to the inbound stream).
  **The negative:** sending the frames verbatim drew a `0x64` on **every frame** — `fn=0x7A` → result
  `0x16`, all eight `fn=0x7B` → result **`0x10` (bad message length)**, `fn=0x7C` likewise. So the
  export container is **not accepted as-is**, and the gen-2 `0x7A/0x7B/0x7C` IR-download family
  (the wiki documents it for the **Axe-Fx II** only) is **not what the FM3 listens for**. The driver
  therefore **fails closed** (`uploadCabIr` refuses unless `allowUnverified`; route: `?force=1`) — a
  caller cannot push refused frames at a unit and read `{ok:true}` as success. **Closing requires a
  CAPTURE of FM3-Edit / Fractal-Bot actually loading an IR onto the unit** — the real opcodes and frame
  lengths exist only in that stream. Do not re-derive them from the gen-2 wiki page. Two side facts that
  stand: **`fn=0x12` GET_CAB_NAME is refused by fw 13** (so no cab-name read oracle — confirmation is a
  human looking at the slot), and the device's own workflow stores to the cab slot the unit has
  **selected**, so a test must aim the Cab block first (`--select-scratchpad N` in the instrument, which
  puts the selection back afterwards). A `.syx` measuring 1×`0x77`+16×`0x78`+1×`0x79` = 49,336 B is a
  **preset**, not an IR — that mistake has already been made once.

**Blocked on a capture / fixture (offline-possible once provided)**

- **§2.2 per-preset Performance Pages** — the per-preset page is stored *in the preset*
  (FM3-Edit 1.03.00 notes; FM3 manual pp.124–126), but the byte layout is **not evidenced in this
  repo**. Closing needs the forgefx-midi preset-body decoder (`src/devices/gen3/presetBody.ts`)
  **and** a fixture whose perform config is known. The global page (Perform-Gbl) lives in Global
  Settings and needs the system read/write path.
- **§3.8 per-preset FC definitions** — blocked on the same body decode as §2.2.
- **§2.3 Setlists — PARKED.** Requires an FC-6/FC-12 foot controller, which Andy does not have.
  Do not build.

**Blocked on a decision**

- **A scale-1 OFFSET enum would display its selected option one off, if it were ever served (latent —
  measured 2026-10-08).** `GLOBAL/7389` (options `["1 SECOND","2 SECONDS",…]`) has body raw `2` while the
  panel shows **"2 SECONDS"**: the stored value is the DISPLAY value, not a 0-based index. The client builds
  its option list ordinal-indexed and shows the label at that index, so a served `2` would render the *third*
  option. It is unserved today (76 GLOBAL params are served; 7389 is not), so nothing misbehaves. **Closing
  requires deciding the serving contract for offset selectors** (serve the display value and index labels by
  `value − displayMin`) — a `src/` change, no capture needed, panel is the oracle.
- **Repeated-query-key surface divergence.** `?eid=1&eid=2` → Fastify **400** but the browser
  router **200**, on `/preset/monitors/live`, `/preset/looper` and `/fc/state`; pinned by the
  `route-parity` test (app 400 / router 200 per route). Closing requires unifying the query
  parsers — a `src/` change, not a docs one.

**Blocked on a new endpoint (out of scope for the offline rounds)**

- **§2.7 Preset+Cab bundle / `.bnk` bank import** — the only cab route is `GET /cab/irs` (names);
  nothing returns user-cab **bytes**, so a bundle needs a new server route.

**Honestly impossible (no wire op — keep the honest negatives)**

- Slot **Move / Delete everywhere** (no slot-erase op), **Clear Preset** (no clear/init op),
  **Scene MIDI block** (eid 190, zero calibration), **Devices / mirroring**, **MLM warning**
  (stopped as unverifiable), **generic per-block Mute** (no served param — points at Bypass).
  *CS MIDI is NOT in this list* — the P2.5 narrowing showed it is a *layout* gap (its trio
  6979/6985/6986 serve and the exclusives render), and FC Config is PARTIAL via the
  layout-widget rule; the P4 Control Switch group shipped. Only **Devices/mirroring** remains
  genuinely wire-absent.
- **N/A on FM3:** global blocks (Axe-Fx only), NAM Manager (Axe-Fx III only), IR Capture (does
  not exist on these units).

## Decisions index

One line per recorded decision. ADRs live in `docs/decisions/`.

- **A front-panel edit to a GLOBAL param IS reflected, while the Setup screen is open — measured 2026-10-08,
  and NOT a defect.** The edit watch re-reads the **open block**; the Setup rail item is `{ eid: 1,
  slug: 'global' }` (`ToolRail.svelte`), so opening that screen calls `blockParams(1)` and that call is what
  arms eid 1 (`gen3.ts` `#watchedEid`). Armed, turning Mini Display/Ring Brightness emitted
  `{"type":"param","effectId":1,"paramId":7115,"norm":0.64…}` twice as the knob moved — traffic P16's stride
  fix is what makes that diff possible at all. **Do NOT add a blind GLOBAL poll:** the eid-1 body is 14,880
  records, so polling it every tick costs far more than arming it on demand. (An earlier revision of a note
  here called this a gap; that reading came from a test that never armed eid 1 — the instrument was wrong.)
- **SSE clients must ARM a session.** A bare `GET /events` receives `: connected` and heartbeats and nothing
  else; the edit watch and telemetry start once any route has touched the device (`GET
  /preset/blocks/:eid/params` is enough). A test that skips that step reports a false "nothing is emitted".

- `docs/decisions/0000-template.md` — the ADR template (not a decision).
- `docs/decisions/0001-claude-code-setup.md` — Claude Code setup for Axis: shared guardrails for
  the feature-gated dual UI, node-env-only tests, and the framework/binding layer split.
- `docs/decisions/0002-app-feature-tooling.md` — app-feature tooling: the singleton runes store
  as the single source of truth, hand-mirrored API types, and the cross-repo workflow.
- `docs/decisions/0003-global-inert.md` — **GLOBAL Setup params were served UNKNOWN, rendered
  inert, and unwritable** (accepted, interim; **superseded by ADR-0004** — its stride/positional
  premise was refuted by the 2026-10-07 device measurement).
- `docs/decisions/0004-global-bulk-indexed-by-pid.md` — **the eid-1 GLOBAL bulk body is 14,880
  records indexed by pid**; values are served by pid and are UNKNOWN only for a pid beyond the body
  (accepted). Records the 65534 = 100% raw scale and the per-pid GET's unusable canned-template reply.
- **AM4 is out of scope by user decision.** Andy owns an FM3 only and will not test an AM4; the
  `/am4/*` alias fallback was removed outright (P7, not migrated), so the AM4 load-timeout
  question is closed *by decision, not by verification*. **Do not propose AM4 testing or an AM4
  probe run.**
- **Probe restore semantics: a same-path read-back is `UNPROVEN-RESTORE`.** A read that merely
  echoes our own write proves the write landed, not that the original was captured, so the probe
  must print what it actually established and what a human should check by eye. A captured
  original sitting on a range boundary meaning "off" (e.g. `0` on a 0–100 brightness) is the
  destructive case.
- **Write-confirmation window = 250 ms** (both windows; `987dfb7`), not the earlier 120 ms.
- **The ABA staleness edge is closed** by the module-level write-settlement sequencer (P11,
  `a04c9c6`); the pinned test asserts the fixed behaviour.
- **GLOBAL writes ARE accepted and verifiable (Q1 — answered 2026-10-08).** A GLOBAL write lands and is
  confirmed through the eid-1 `fn=0x1F` bulk body — an **independent** read path, not the write's own
  echo: `0.40` → `body[7115]` raw `26214` = 40.0%, restore → `45874` = 70.0%. The closure evidence came
  from `ForgeFX/server/scripts/verify-global-write.ts` (it reads the body as its oracle), **not** from
  `ForgeFX/server/scripts/probe-device.ts`: that probe's Q1 still reads through the `0x1a` route (a
  *normalized* value) and checks itself on that same path, so it only proves the write landed, not that
  the original was captured. **The probe's Q1 still needs its oracle switched to the independent bulk
  read.** Reads stay as ADR-0004 describes: 14,880 records, indexed by pid, raw `65534` = 100%.
- **Write units are PER-OPCODE, not per-param or per-family** — measured on the unit 2026-10-08 by
  sending raw floats straight to the codec (no driver, no script convention in the way) and reading the
  body: the **continuous** opcode takes the client's **normalized 0..1** (`0.25` → 25.0%), the
  **discrete** opcode takes the parameter's **display value in its own range**. (Reasoning from pid 7115
  alone, whose range IS 0..100, produced the narrower — and wrong as a general rule — "percent 0..100";
  measured 2026-10-08 on `GLOBAL/110`, range **25..100**: writing `50` set display **50.0**, raw 21845, where
  a percentage would have given 62.5. For scale-1 selectors the same holds and is confirmed by the panel:
  `GLOBAL/7389` body raw `2` ↔ the unit showing "2 SECONDS", whose option list starts `"1 SECOND"`.)
  Axis's knobs send `continuous: true` with a 0..1 value (`editor.svelte.ts`), so the client is correct
  as-is and **no conversion belongs in the driver**; scale-1 enum round-trips are correct too (the served
  value is the display value and Axis writes it straight back). Guarded offline by
  `ForgeFX/server/test/drivers/setparam-units.test.ts`, which compares the driver's frame against the codec's
  own encoding **and** decodes the value bytes out of the sent frame against a literal, with a sensitivity
  control — so a scale re-introduced in the driver OR inside the codec fails. **Always pass `continuous`
  explicitly** — omitting it silently selects the other opcode's unit, and the scaled-enum case
  (`PHASER_ORDER`) is still unmeasured (see ADR 0006).
- **An unchanged read is not evidence of a change, and a fire-and-forget write reports `{ok:true}`
  unconditionally.** A write to a port that answers nothing still "succeeds", so a value that did not
  move is evidence *against* the write, not for it. Verify through an independent path and against a
  value you did not start from. (This is how the P14 unit "fix" was believed to work for an hour.)

## Do NOT chase (checked and rejected by the review)

Read this before re-opening anything — its purpose is to stop a future session re-litigating
claims already found to be non-issues.

- **Edit-watch sweep vs channel-A baseline** (`gen3.ts` `#editSnapshot` / `#watchedChannel`): the
  sweep slice and its baseline are *both* channel 0, so a front-panel edit on channel B–D emits no
  event. The `watchedChannel` branch is for the open block, which is the case that needed fixing.
- **"Axis ignores the save result"**: `save()` reads `r.ok` (`editor.svelte.ts:2931`). Only the
  write-confirmation window is exposed — and that is **250 ms** since `987dfb7`, not 120 ms.
- **`GLOBAL_REMOTE_MUTE` as a rendering gap**: 0 layout refs in the FM3 layout — unserved, but
  also unreferenced.
- **"GLOBAL Setup params are deliberately unreadable/unwritable" (ADR-0003) — REFUTED, do not
  re-assert.** Its stride/positional premise was refuted by the 2026-10-07 device measurement; ADR-0003
  is superseded by ADR-0004 (the eid-1 body is pid-indexed and `base+7115` is in range), and GLOBAL
  writes are verified (see the Decisions index).
- **P1.3's original "mixed real/zero snapshot" mechanism**: not reachable. The defect was the
  swallowed failure plus the silent short-burst zeroing, both now fixed.
- **Q3 — the FM3 never sends a scaled enum wire value** (`PHASER_ORDER` raw 1 vs displayMax 10).
  P2.3 is **latent, not live**: the fix is correct defence, but nothing on this firmware exercises
  it. Do not go looking for a scaled-value bug.
- **Q4 — the FM3 never pads a complete bulk read** (Cab eid 62: advertised 424, delivered 424).
  The P1.3 torn-read guard (`values.length >= itemCount` ⇒ complete) is **safe as written**.
- **`PFC4` (a 4th FC port)**: **no.** It exists only in the Axe-Fx III layouts; the FM3 has FC
  ports 1–3.
- **"GLOBAL writes are ~100× too small" — FALSE. Do not re-open, and do not "fix" it again.** The
  reading came from a diagnostic calling `setParam` **without the required `continuous` argument**, so
  it silently took the *discrete* (percent) opcode and set 0.4%. Units are per-opcode (see the Decisions
  index); the client was never wrong. A change built on this premise (P14) converted norm → display on
  the continuous path, clamped every knob write to 100%, and was **reverted** (ForgeFX `1b380d3`,
  forgefx-midi `6ae3636`); ADR-0006 is superseded by measurement. The guard test now fails if the
  conversion returns.
- **The workbench layout rework is shipped and must not be re-opened** — the shell, dockable
  panels, page/panel registry, responsive sweeps, per-profile presets, floating widgets, layout
  undo/redo and import/export all landed (the workbench is the default shell). Do not resurrect
  `docs/ROADMAP.md` or the deleted layout-rework plans. The design specs under
  `docs/workbench-dc-parity/` remain the binding visual reference (their `- [ ]` gap lists are
  unmaintained).

## How this file is maintained

- **Live docs state only open work.** A *completed* narrative belongs in the commit history —
  never re-add a "shipped" section here.
- Every open item **names its blocker** (device / capture / decision / nothing / new endpoint)
  **and what closing it requires.**
- Facts that rot by construction — counts, test totals, line citations, file paths — are either
  **omitted** or **generated**; this file points at the authoritative `verify-stack-*.out` rather
  than embedding numbers.
- Claims already checked and rejected go under **Do NOT chase**, stated precisely (not
  paraphrased into vagueness) so they are not re-opened.

### Recovering a deleted shipped-work doc

The workbench/layout-rework and review docs were removed from the live tree on 2026-10-07 (their
work is shipped; git keeps them permanently). Recover any one with `git show <sha>:docs/<file>`,
and find the last commit that held it with `git log --oneline -- docs/<file>`.

| Deleted file | Last-held commit (sha you can `git show`) |
|---|---|
| `axis-review-2026-10-07-next-iteration-fix-list.md` | `9253ef8` |
| `axis_layout_rework_progress_log.md` | `99bb966` |
| `axis_workbench_design_aware_rebuild_plan_for_claude_code.md` | `99bb966` |
| `axis_workbench_implementation_status_and_next_plan.md` | `99bb966` |
| `axis_workbench_verification_report.md` | `99bb966` |
| `axis_layout_rework_review_and_remaining_plan.md` | `99bb966` |

## Pointers

- Live feature backlog / evidence: `docs/axis-fm3edit-feature-parity-audit.md` (§7 round logs,
  §6 probe list, §8 file index).
- Design-parity specs (binding visual reference): `docs/workbench-dc-parity/`.
- E2E harness + selectors: `e2e/README.md`.
- Layer guides for agents: `src/lib/CLAUDE.md`, `src/lib/axis-workbench/CLAUDE.md`.
