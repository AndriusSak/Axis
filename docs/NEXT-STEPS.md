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

`origin` is `github.com/AndriusSak/Axis` (the fork); `main` is pushed and is the reference tip.
Work that is not ready for `main` goes on a topic branch — `cve/major-tooling-bump` is the open one
(kit 3 / vite 8 / vitest 5, green on tests and build, not merged, not hardware-checked).

`verify-stack.sh` builds `forgefx-midi` **first**, so a codec change merged from `src/` reaches
ForgeFX's import of the built `dist/` only via that build. Starting the server (or a probe) straight
after a merge, without the gate, dies with *"does not provide an export named …"* — run the gate
before touching the device, not after.

## Open items

Each item names its blocker and what closing it would require.

**Standing guard — read `ForgeFX/docs/incident-2026-10-08.md` before probing this unit**

- Blind probing of the **firmware-update function family** (`fn=0x7D/0x7E/0x7F/0x79`) left the FM3 in its
  bootloader showing *"Updating Firmware / Transfer Error / Please reboot the device and try again"*; it
  recovered on a power cycle. The triggering frame is **not established** (no frame tap had been captured).
  Consequences in force: a **hard guard** refuses firmware-family frames from every probe script unless
  `--allow-firmware-family` is passed, every hardware probe now writes a **frame tap**, and no unmeasured
  function byte may be sent to a unit holding a library.

**Blocked on hardware (an FM3 / the Deck must be attached)**

- **The `0x64` write-refusal latency question (Q5) — the framing was wrong twice over.** Measured on the unit
  (three times, consistent), two arms: an **unknown effect id** (bogus eid 16382) is NOT refused — the device
  answers 1–2 ms later, and the reply is **not an echo of what was sent**; a **real param with an
  OUT-OF-RANGE value** (Cab 2 Mute/Solo, a 3-option enum, written 900) is NOT refused either — it replies in
  12–14 ms and the read-back shows the unit **stored 2**, i.e. the value was **silently CLAMPED and applied**.
  So the FM3's answer to a bad write is **SUBSTITUTION, not rejection**, and the 250 ms write-confirm window is
  **not marginal** (every reply arrived 1–14 ms; a `request()` reports 250–266 ms only because the transport
  resolves on a **quiet gap** and does not timestamp frames — the probe times arrivals itself, via `onFrame`).
  **What closing the refusal path itself would still require:** a write the device genuinely rejects (probably
  not reachable from the param-write opcode), or the editor's own refusal handling captured. The item's own
  lesson stands and is sharper: **absence of a refusal is not acceptance** — and a non-refusal reply is not
  evidence the value you sent is the value in force.
- **§3.6 item 6 DynaCab 2-axis pad** — verified in e2e only, never on the Deck. Andy reports it worked the last
  time he used it on the unit (his observation, 2026-10-08), recorded as his eyewitness rather than re-tested;
  a wire-level capture has still never been taken for it.

**Blocked on a capture / an owner-authorised device edit (offline-reproducible once provided)**

- **The `fn=0x01` sub-action decode (`0x03` / `0x1b` / `0x2e`) — one sub-item left open.** The
  three sub-actions the editor uses constantly are **ANSWERED BY THE UNIT** (no longer unmapped and no longer
  capture-gated). Evidence: `ForgeFX/server/test/fixtures/query-subs-decode/` (taps + a README that states what
  each row measures, kept per round) and the read-only observers `scripts/probe-1b-*.ts`,
  `scripts/probe-2e-*.ts`, `scripts/probe-03-cadence.ts`, `scripts/probe-hole-vs-scene.ts`. Settled, all
  measured: `0x2e` **IS** `SUB_LAYOUT_MAP` (its tail decodes to the 13 placed eids via `parseFm3GridLayout`;
  only its 8-byte-periodic HEAD stays unexplained); `0x03` byte 5 is a free-running **counter at ≈93.8 units/s,
  mod 128**, NOT per-read; `0x1b` is an **addressed table read** (upstream's name "PARAM FLAGS" is unsupported
  by anything measured); the "hole/default" record's first byte **IS the scene index** (8 for 8); the region
  carries **no bypass state** (every head record and tail grid cell unchanged under the bypass toggle) and is
  **scene-invariant**. Status of the three former sub-items:
  1. **`H_head` — ANSWERED 2026-10-29, placement arm run (owner-authorised).** `probe-2e-placement --go`
     placed an unplaced block (chorus 2, eid `0x4f`) into a verified-empty cell (1,1) and cleared it again:
     landing proved both ways through the `fn=0x13` status dump, restore proved **byte-identical through the
     edit-buffer body**, and the offline diff (`diff-2e-head-vs-grid.ts`) reports **1 tail cell moved, 0 of
     44 head records moved**, `before==after` true. With round 14's nulls for bypass and scene, the HEAD is
     **preset-static metadata**, not a per-placement state table. Disclosed blind spot: data 22..27 was
     masked (derived volatile), so a change confined to head records #2/#3 cannot be seen — the verdict holds
     for the 41 visible records.
  2. **the hole-record second regime — characterised; trigger NOT found.** It has two modes: an INDEX mode
     (byte 0 = scene, `00`/`01`, reverting exactly — reproduced 3× on 2026-10-29) and a HANDLE mode (an opaque
     token such as `28 00 00 00 00`, once `1b 14 4c 7a 0a`, lasting ~26 min today). A scene select returns it
     to index mode. Refuted: param writes do not cause it (two re-entry attempts failed) and the body content
     does not drive it (body byte-identical across the change). Rule for readers: `c5` (kind) and the address
     echo are usable, `c0..c4` is not — never compare it across a write boundary or across days; normalise with
     one scene select first. Evidence: `review-2026-10-29/FINDINGS-1B-REGIME.md`, instrument
     `ForgeFX/server/scripts/probe-1b-regime.ts`.
  3. **the standing read — EXISTS (`scripts/standing-read.ts`, built round 15) and was run.** It appends
     hole record + `fn=0x0d` preset + `fn=0x13` placed set + scene index to
     `~/repos/stack/standing-read.jsonl`; the earlier "to add" wording was stale. Run it at the start and end
     of every hardware round — that is what dates a regime flip.

**Closed this cycle — demoted to one-line pointers (the narrative lives in the commit history)**

- **Tooling major (kit 3 / vite 8 / vitest 5 / electron 45) — MERGED 2026-10-29** (`0f476d3`), after the
  hardware gate: HIL layer 3 on the branch matched the previous baseline feature-for-feature, read-only
  proof clean, and a param write (Input impedance `AUTO`→`1M`) restored with a byte-identical body.
- **`cve/major-tooling-bump`'s browser dependency** — Playwright 1.64.1 needs its own
  `npx playwright install chromium`; without it five HIL specs fail and the run reports `EMPTY`, which reads
  like a code failure. Do not skip that step on a fresh checkout.

- **§2.2 per-preset Performance Pages — SOLVED, read AND write, verified on the unit** (`5030535`, `215576c`,
  `1a9328f`); the read-only route and the Device-Tools panel shipped with it.
- **§2.5 user-cab IR upload — SOLVED, captured + load-tested** (`fa75d77`, `127d516`); the close frame is a
  **content check** (`cabIrContentXor` / `computeCabIrClosePayload`) — a mismatched close makes the unit
  **DISCARD** the upload.
- **§2.5b per-slot cab state read-back — measured and SHIPPED** (`1fe4d75`, `a9ab856`): `cabSlotState.ts`,
  `Gen3Driver.queryCabSlots()`, `GET /cab/slots`.
- **§2.5d cab-slot DELETE — SOLVED, no capture needed** (`4945aef`): the blank `0x7F` fill container, plus
  `Gen3Driver.clearCabSlot` and `POST /cab/slots/clear`.
- **§2.5c the `0x4B` region IS the slot NAME — decoded and shipped** (`a0a40e8`, `7750e08`):
  `decodeCabSlotName`, carried on `CabSlotStateResult.name`; the cab picker shows real user-slot names.
- **§2.7 server-side cab-IR byte library — SHIPPED** (`GET /cab/library`, `GET /cab/library/:id/bytes`).
- **§3.7 Cab 2 Mute/Solo write — CLOSED with two independent witnesses** (the human eye, and the device's own
  unsolicited `0x74/0x75/0x75/0x76` burst naming the cab block — a different mechanism from the bulk read).
- **§3.8 per-preset FC/switch definitions — DECODED AND WIRED** (`7d98e94`, `fafd1be`, `cdaaf14`, `3131a62`);
  the geometry is the per-index observed-offset table in §3.8 at the end of this file (`PP_SWITCH_COUNT`
  remains an explicit assumption).

## Not possible on FM3 / parked — do not re-open

The owner has authorised these as **labelled permanent limitations / parked decisions**, removed from the open
backlog. Each carries its reason and an evidence pointer. Do not re-open or re-litigate any of them.

- **Clear Preset — no clear/init wire op exists.** The gen-3 write codec exposes no clear/init/edit-buffer-reset,
  the server route table has no clear/erase route, and `src/lib/presetSlotOps.ts` documents "no slot-erase op
  at all". Evidence: audit §2.7.
- **Preset-slot Move / Delete — the FM3 wire protocol exposes no slot copy/erase primitive.** The current
  behaviour is honest disabled entries, not fakes. The Manage-Cabs clear/blank trick
  (`buildBlankCabIrContainer`) applies to **CAB** slots only, never preset slots. Evidence: audit §2.4, §3.4.
- **MIDI / Remote per-slot PC + CC mapping tables, and the Scene MIDI block — impossible on the served param
  set.** `GLOBAL_MIDI_MAPPING` (pid 97) is only the enable; the mapping table is a structured array with no wire
  param. The Scene MIDI block (eid 190, "MIDIBLOCK") is virtual and carries zero ranges / enum vocab, so
  `blockParams(190)` is empty — the section shows honest disabled rows. Evidence: audit §2.8, `MIDI_REMOTE_GAPS`.
- **FC Devices / mirroring — no served param exposes it.** The MIDI/Remote section renders the *served* GLOBAL
  params; Devices/mirroring is genuinely wire-absent. (CS MIDI and FC Config are **not** parked — CS MIDI is a
  *layout* gap and FC Config is partial via the layout-widget rule.) Evidence: audit §2.8.
- **`.bnk` bank import, and Preset+Cab bundle export/import — nothing returns user-cab BYTES.** The only cab
  route is `GET /cab/irs` (names); a bundle would need a new device read that does not exist. Evidence: audit §2.7.
- **Setlists / Songs — requires an FC-6 or FC-12 foot controller**, which the owner does not own; not a target
  for this rig. Evidence: audit §2.3 (PARKED, no FC).
- **Global blocks — Axe-Fx only. NAM Manager — Axe-Fx III only** (FM3 support unconfirmed — do not plan for it).
  Evidence: audit §7 "Deferred / N/A on FM3".
- **AM4 — out of scope by owner decision** (he owns an FM3 only). The `/am4/*` alias fallback was removed
  outright; the AM4 load-timeout question is closed *by decision, not by verification*. Do not propose AM4
  testing or a probe run. Evidence: Decisions index.
- **Manage Cabs REORDER and reading a user-slot NAME off the unit — parked; the general case needs a capture of
  FM3-Edit doing it.** There is **no slot-DATA read** (probed — §2.5f; probable by design, since extractable
  user IR data is what protects commercial IR vendors), so a cab already on the unit has no sample-byte source
  here. *Which is which, measured:* **rename** is measured-working (§2.5e); **clear/delete** is shipped (§2.5d);
  **move** is upload-to-destination + erase-source (§2.5g, no new opcode); **import** is the `.syx` path — these
  ARE possible and proceed. A user slot's **NAME** is decoded from the unit's own `0x4B` reply
  (`CabSlotStateResult.name`; the cab picker shows it). What stays parked without a capture of FM3-Edit: a
  **bank-wide REORDER across cabs whose bytes we do not hold**, and any operation that would need a slot's
  samples. Evidence: §2.5e/§2.5f/§2.5g, audit §2.5.
- **IR Capture — does not exist on these units** (no IR-capture feature on the FM3; FM3-Edit's capture is
  front-panel / III-editor). Already corrected in the audit; recorded here so it is not re-litigated.
  Evidence: audit §7.
- **MLM warning** — stopped as unverifiable. **Generic per-block Mute** — no served param; the editor's Mute
  points at Bypass and is honestly disabled. Evidence: audit §3.5, §3.1.

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
- **Scale-1 OFFSET selectors serve the display value and index labels by `value − displayMin` — IMPLEMENTED
  2026-10-08 (server-side, `#enumOptions`).** `GLOBAL/7389` stores the DISPLAY value (body raw `2` ↔ panel
  "2 SECONDS") while the device-true label tables are 0-based by ORDINAL, so reading the label at index
  `value` shifted every offset label by one and rendered the option AFTER the true one. Fixed in
  `ForgeFX/server/src/drivers/gen3.ts` by indexing at `value − min` (`min` = displayMin; a no-op for 0-based
  lists and the scaled PHASER_ORDER). Six served FM3 offset enums were live-affected (DELAY/87 SVF Type,
  PITCH/35 Track Mode, PITCH/76 Tempo, FILTER/21 · FLANGER/30 · PHASER/23 Quantize). The Axis client needed
  no change (it renders `options.find(o => o.value === value)`). Guarded by
  `ForgeFX/server/test/drivers/enum-coverage.test.ts` (the DELAY/87 mapping pinned literally + a
  `value − displayMin` invariant over every served offset enum). Panel remains the oracle; no hardware claim.
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
- **"Axis ignores the save result"**: `save()` reads `r.ok` (in `editor.svelte.ts`). Only the
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

### §3.8 per-preset switch definitions — BLOCK AND TARGET DECODED (2026-10-08)

Body offsets (decompressed preset): marker `0x05F5 / 0x0001` at **11420** (an earlier note said ~11412 — the
marker MOVES between presets, and 11420 is the measured anchor for preset 410), **one 16-bit action code per switch**
at marker+4 (measured: 11424 for preset 410) (`0x04` = Effect: Bypass, `0x03` = Scene: Select — INFERRED
from two configured switches, not measured across all functions), and the **PP#1 target byte at marker+148**.

The target is an **index into the FM3's alphabetically ordered FX-slot enumeration, instances expanded**
(the list the switch-assignment picker shows: Amp 1, Cab 1, Chorus 1, Chorus 2, Comp 1, …).

Measured on the unit — 14 anchors, each one edit plus one read-only dump:
`Amp 1=0 · Cab 1=1 · Chorus 1=2 · Chorus 2=3 · Delay 1=7 · Delay 2=8 · Filter 4=20 · Gate 1=25 · GEQ 1=27 ·
In 1=29 · Looper=31 · Megatap 1=32 · MultDly 1=38 · Reverb 1=51`

NOT the eid, NOT the block-list order, NOT the chain order, NOT a grid cell, NOT a type id (a Chorus 1 →
Chorus 2 edit returned 2 → 3, so it is per-instance). Two earlier models were refuted by their own
predictions — an alphabetical list with a short inventory (predicted Reverb 15, measured 51) and a grid
position (the layout is one row, so Reverb would have been ≈ 10). Do not re-derive either.

**Delay 2 = 8 — MEASURED (2026-10-09), and it refuted a model.** The owner set PP#1's target to Delay 2 and
the PP#1 target byte at marker+148 went 20 → 8. Two things follow:

- the anchor table gains `Delay 2 = 8`, which also confirms that a family's INSTANCES are consecutive
  (`Delay 1 = 7` → `Delay 2 = 8`);
- **the target bytes are NOT a flat one-per-switch array.** The same capture changed PP#2's action code
  (marker+6, 3 → 4) and set PP#2's own target, yet the byte at **marker+149 did not move**. A contiguous
  reading predicted it must. So "one byte per switch" is dead, and a field whose offset was never observed
  reads `null` — the geometry is a per-index OBSERVED-offset table (`PP_MEASURED_OFFSETS`), not a stride.

`scripts/check-switch-offsets.ts` now walks all three captures and includes the refutation as a
`mustMove: false` prediction, so the dead reading cannot come back unnoticed. `diff-switch-capture.ts` is the
general tool for "one edit + one dump": it prints every moved byte in marker-relative terms.

**Open, and the next question is a cheap one:** the byte at **marker+160** moved 1 → 14 in the same capture
that reconfigured PP#2, and sits exactly `148 + 12`. That makes it the leading candidate for PP#2's target
byte with a 12-byte record stride — BUT it is one observation and 14 does not match what the alphabetical
model predicts for the block that was picked there, so it stays a HYPOTHESIS, not a finding. It could equally
be a checksum or unrelated state that FM3-Edit rewrites whenever the block changes. **One edit settles it:
set PP#2's target to a KNOWN anchor (e.g. Reverb 1 = 51) and read marker+160 — 51 confirms the byte and the
stride; anything else kills the hypothesis.**

**The decoder no longer contains the refuted stride (2026-10-09).** The layout is now a per-index
**observed-offset table** (`PP_MEASURED_OFFSETS = { 1: { actionCode: 4, target: 148 }, 2: { actionCode: 6 } }`)
instead of a formula. Consequences, all deliberate:

- a field whose offset nobody has located is reported as **null**, never read out of a guessed position, and
  `confidence` is a three-way split — `measured` (both offsets) · `partial` (action code only) · `unknown`
  (neither). Indices 3+ therefore list as `unknown` rather than carrying values from `marker+4+2i`;
- `evidence` is DERIVED from that table, so it cannot drift from the model it describes;
- the WRITE route's bound is evidence-driven and **per field**: PP#1 accepts both fields, **PP#2 now accepts an
  action-code write** (its offset is observed) but a target write there is refused `400` naming the reason, and
  PP#3+ are refused entirely. The panel disables the target input and says why;
- adding a measured index is now a ONE-LINE data change, which is the whole point: the next hardware round
  should not need a code change to unlock a switch.

**The roster shortcut is CLOSED — do not re-open it.** Two candidate enumerations exist in the repo
(`effectRoster()` with `blockInstances`, and `FM3_EFFECT_ID_TABLE`) and both reproduce **1 of 13** anchors:
each gets `Amp 1 = 0` and then mis-places the rest by 2–4 slots, because the anchors demand Amp to contribute
ONE entry (`Amp 1 = 0`, `Cab 1 = 1`) and no table here gives the FM3's Amp block one instance. The measured
ORDER does fit alphabetical-with-instances-expanded, but the per-block COUNTS are not in any table we hold, so
the index cannot be computed — only measured. (Both models were tried as PREDICTIONS and both failed, which is
the only reason to believe the negative.)

**WIRED (2026-10-08), and the geometry is now better evidenced.** `DeviceDriver.perPresetSwitches()` /
`setPerPresetSwitch()` back `GET /preset/switches` and `PUT /preset/switches/:index` (shared handlers, BOTH
route tables, on `DEVICE_WRITES` and on `NOT_DRY_RUNNABLE`), with an Axis panel (`PerPresetSwitchesPanel`).
The write is bounded **per FIELD, by the offsets actually observed**: PP#1 accepts an action code AND a target
byte, PP#2 accepts only its action code, and any unlocated field is refused (400, `no-target-offset`) rather
than written to an unmeasured offset.

**A two-fixture differential confirmed the offsets by prediction.** The same preset was captured twice — the
committed `preset-perform/preset-410.bin` (no switch configured) and, later, with PP#1 and PP#2 configured —
and the decompressed bodies differ at **marker+4 (0→4 = PP#1's Bypass code), marker+6 (0→3 = PP#2's
Scene: Select code) and marker+148 (0→20 = PP#1's target, index 20 = "Filter 4", matching the wire anchor)**.
So the action codes are a contiguous u16 array (two entries confirmed, not one) and marker+148 is PP#1's
target byte. The decoder now reports how far each field's evidence reaches
(`evidence.actionCodesMeasured = 2`, `targetBytesMeasured = 1`) instead of implying the whole block is known.
The check is a script, not a note: `scripts/check-switch-offsets.ts` states the predictions and fails if a
predicted byte does not move.

**One open observation, recorded rather than smoothed over:** the byte at **marker+160** changed (0→1)
between the two captures and nothing in the model explains it — it is one byte past the 12 assumed target
bytes, so a 13th entry, a neighbouring field, or unrelated content (the same diff also moved a perform-page
label, so the captures are not a controlled experiment). It touches none of the offsets the decoder reads.
`PP_SWITCH_COUNT = 12` therefore remains an explicit ASSUMPTION.

**A MEANING caveat that fell out of the live fixture:** PP#2's action is Scene: Select, and its target byte
read 0 — for a scene action that byte is most likely a SCENE number, not an FX-slot index, so the anchor
table must NOT be applied across action types. PP#2's target byte is unlocated, so its row is `partial` and
its target reads `null`; the panel shows the raw index; treat "target = FX-slot index" as true for the
bypass-style action measured, unestablished elsewhere.
