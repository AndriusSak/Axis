# Axis — live status (NEXT-STEPS)

**This file is the only live status document for the repo.** It states what is verified right
now, what is still open and what blocks each item, the decisions already made, and the claims
that have been checked and rejected. It deliberately does **not** narrate shipped work — that
lives in the commit history. The live *feature backlog* is
[`axis-fm3edit-feature-parity-audit.md`](axis-fm3edit-feature-parity-audit.md) (per-item status
+ evidence, kept current).

## What is verified right now

The **authority is the latest `verify-stack-*.out` under `~/repos/stack/review-2026-10-07/`**
(most recent: `verify-stack-p11b.out`). Regenerate it with `~/repos/stack/verify-stack.sh` on the
merged tree. **Do not copy test totals, suite counts or e2e numbers into this file** — read them
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

## Open items

Each item names its blocker and what closing it would require.

**Blocked on hardware (an FM3 / the Deck must be attached)**

- **GLOBAL writes are unproven (hardware question Q1).** The FM3 **reads** GLOBAL from the eid-1
  (`fn=0x1F`) bulk body, measured on the device 2026-10-07 to be **14,880 records indexed by pid**
  (`body[7115]` = `Mini Display/Ring Brightness`, raw `65534` = 100%). GLOBAL values are therefore
  **no longer served as unresolved/inert** — the earlier "served UNKNOWN" refusal (ADR-0003) rested on
  a refuted stride/positional premise and is being reverted (ADR-0004). What remains unproven is
  whether the FM3 *accepts* a GLOBAL **write**. **Closing requires an independent write-confirmation** —
  a different sub-action, or the front panel — because a read-back that merely echoes our own write is
  not verification (P8). Device facts: `docs/decisions/0004-global-bulk-indexed-by-pid.md`.
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
- **§2.5 user-cab IR upload** — the FM3 accepts custom IRs (manual p.118); the multi-frame SyEx
  upload must be implemented, then load-tested on the device.

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

- **Repeated-query-key surface divergence.** `?eid=1&eid=2` → Fastify **400** but the browser
  router **200**, on `/preset/monitors/live`, `/preset/looper` and `/fc/state`; pinned by the
  `route-parity` test (app 400 / router 200 per route). Closing requires unifying the query
  parsers — a `src/` change, not a docs one.

**Blocked on nothing (a `src/` / provenance fix, not editable in a docs-only pass)**

- **`editor.svelte.ts:2761` tempo/tuner comment defect.** The comment above `setBpm` cites
  `gen3.ts:1551` for `setTempo` — but `:1551` is `setBypass` (`setTempo` is `:1610`) — and calls
  `setTuner` unconditional, while `registryCore.ts:814` returns `{ok:false}` when the device has
  no tuner capability; the same "`{ok:true}`-unconditionally" wording is in
  `paramWriteOutcome.ts:195`. **Closing: cite the symbols and drop "unconditional".** The
  conclusion (neither is reject-watched on gen3) still holds for the FM3.
- **The LED incident's `0.0000` cause is now MEASURED — the old "broken GLOBAL bulk read" attribution
  is refuted.** The bulk body holds 14,880 records and **is** pid-indexed (so `base+7115` was in range,
  never past the block). The `0.0000` came from the **per-pid GET** (`fn 0x01 sub 01 00`): on this
  firmware its reply is a **canned template** whose decode yields `2.085e-41` — a denormal that
  **displays as `0.0000`** — which the probe read as the "original" brightness and wrote back as a
  restore, darkening the rings. Code comments (`gen3.ts:265`, `gen3.ts:753`) and `PROVENANCE.md:490-491`
  still carry the refuted attribution, as does the ForgeFX ADR
  `ForgeFX/docs/decisions/0004-global-bulk-read-unknown.md` (outside this repo). Closing: correct those
  files in the next `src/`/provenance round.
- **GLOBAL controls inert — REVERTED; the position was refuted by measurement.** ADR-0003 is superseded
  by ADR-0004: the eid-1 bulk body is pid-indexed and `base+7115` is in range, so GLOBAL is not
  deliberately unreadable/unwritable. Do not re-assert the old position.

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
- **P1.3's original "mixed real/zero snapshot" mechanism**: not reachable. The defect was the
  swallowed failure plus the silent short-burst zeroing, both now fixed.
- **Q3 — the FM3 never sends a scaled enum wire value** (`PHASER_ORDER` raw 1 vs displayMax 10).
  P2.3 is **latent, not live**: the fix is correct defence, but nothing on this firmware exercises
  it. Do not go looking for a scaled-value bug.
- **Q4 — the FM3 never pads a complete bulk read** (Cab eid 62: advertised 424, delivered 424).
  The P1.3 torn-read guard (`values.length >= itemCount` ⇒ complete) is **safe as written**.
- **`PFC4` (a 4th FC port)**: **no.** It exists only in the Axe-Fx III layouts; the FM3 has FC
  ports 1–3.
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
