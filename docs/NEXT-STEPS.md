# Axis — current state & future work (2026-10-07)

**The single live backlog is [`axis-fm3edit-feature-parity-audit.md`](axis-fm3edit-feature-parity-audit.md)**
(FM3-Edit / FM3-hardware parity, per-item status + evidence, kept current). This file is the short
orientation for a session that has none of the context: what just shipped, what is genuinely left,
and the exact blockers. Every other planning doc under `docs/` is banner-stale — see the table at the
bottom.

## Where `main` is

- Rounds **R16–R20**, **R21–R24**, **R25–R28** and the **P1–P10 fix rounds** are merged
  (2026-10-07). Latest merged-tree verification (`~/repos/stack/review-2026-10-07/verify-stack-p10b.out`):
  **Axis 1835 unit tests / 175 files** · `svelte-check` **0 errors / 0 warnings** · build **ok**
  (bare `npm run build` — the heap flag lives in `.npmrc`) · **Playwright 144** (chromium) · ForgeFX
  **43 suites** · forgefx-midi **84**. *(Corrected: these were the P7/P8-era numbers 1815 / 173, 142 and
  42 suites — a session comparing today's 1835/175/144 against the stale figure would read a false
  regression.)*
- The repo has **no git remote configured** — `main` is the local tip; nothing is pushed.

## Shipped recently (do not redo)

- **R16–R20** — phone bottom-bar reachability (UI-C sweep F1/F2/F3), keyboard-shortcut parity
  (23 chords, 0 reserved), Manage Presets reorder + Reset AMP per preset, param-value clipboard +
  honest cross-preset block paste, Setup/Controllers honest rail gate, the preset-binary write-back
  documented as shipped.
- **R21–R24** — modifier live curve read-back + Controllers usage panel, `batchSet` rail entry,
  Manage Presets drag-and-drop, Quick Build panel (bare `Q`).
- **R25–R28** — Grid Navigation Mode (bare `G`), convert-editor offline block copy/paste, real
  browser proof for R21–R24 (`e2e/30`–`33`), legacy dead-nav cleanup (rail `perform`/`sets`/`scenes`
  gated disabled with reasons; `PresetBrowser` non-device-row stubs honest).

## What is genuinely left

**The next iteration's input is
[`axis-review-2026-10-07-next-iteration-fix-list.md`](axis-review-2026-10-07-next-iteration-fix-list.md)**
— an independent 3-pass review of this tree, every item re-read in the code before filing.
**All of P1–P10 shipped 2026-10-07.** P2.2 included: the write-confirmation window decision was made —
both windows are **250 ms** (`987dfb7`), not the old 120 ms. The remaining P3 items all shipped too
(engines, the `.npmrc` heap flag, one float-vs-enum unit set, 400s on bad route params, the AM4 alias
sunset (P7), `prepare` scripts vs gitignored `dist/` → `setup:stack`, the `version.ts` guard, and the
stale `ROADMAP.md` citations in code); evidence per item is in the fix-list's P3 section.
**Genuinely open after P10:** the deliberately-open *limitations* (the ABA staleness edge; the
repeated-query-key surface divergence) and the code-round items the fix-list's **"Open after P10"** note
lists — plus the FM3 hardware questions that remain (below). See the doc's status header for commits and
the merged-tree counts. The doc also carries a **"do not chase" list** (claims the review checked and
rejected) — read that before re-opening anything.

### Blocked on hardware (needs the FM3 / the Deck)
- **Cab 2 Mute/Solo write** (audit §3.7) — toggle cab 2's M/S on the unit and confirm it reads back;
  if writes are ignored, revise `285c11b` rather than paper over it.
- **GLOBAL Setup params** — **serving resolved offline 2026-10-07 (P1.2, `2fa29d9`)**: the device's own
  layout widget is now the serving evidence, so `FS_BRIGHTNESS`/`FS_LCD_CONTRAST` (7115/7116) and the FC
  default-layout/clone dropdowns **serve as controls**, and `server/test/drivers/layout-param-coverage.test.ts`
  enforces the invariant in CI. No clean-store `/diag/ranges` sweep is needed. **Correction (P9/P10):**
  "serve" does not mean a *readable value* — the GLOBAL family is not provably positional, so since P9 its
  **values are `null` (unresolved)** and since P10 it **renders inert** and is unwritable. What remains
  hardware-only is whether GLOBAL **writes** are accepted (§3.7); see
  `docs/decisions/0003-global-inert.md`.
- **DynaCab 2-axis pad** — verified in e2e only, not on the Deck (§3.6 item 6).
- **§2.5 user-cab IR upload** — the FM3 accepts custom IRs (manual "Loading User Cabs", p.118); the
  multi-frame SyEx upload must be implemented, then load-tested on the device.
- **§2.8 per-slot PC/CC mapping tables** and the Scene MIDI block — impossible on the served param
  set as currently understood; a capture could reopen them.

### Blocked on a capture / fixture (offline-possible once provided)
- **§2.2 per-preset Performance Pages** — the per-preset page is stored **in the preset** (FM3-Edit
  1.03.00 release notes; FM3 Owner's Manual pp.124–126: "save the preset to commit"). Decoding it
  needs the **forgefx-midi** repo (`src/devices/gen3/presetBody.ts`) **and** a fixture whose perform
  config is known — the byte layout is **not evidenced** in this repo, so it cannot be done in an
  Axis-only round without inventing a layout. The **global** page (Perform-Gbl) lives in Global
  Settings and needs the system read/write path.
- **§3.8 per-preset FC definitions** — blocked on the same body decode as §2.2.
- **§2.3 Setlists** — **PARKED**: requires an FC-6/FC-12 foot controller and Andy has none. Storage is
  the global SETUP area "FC Setlists/Songs". Do not build.

### Blocked on a new endpoint (out of scope for the offline rounds)
- **§2.7 Preset+Cab bundle / `.bnk` bank import** — the only cab route is `GET /cab/irs` (names);
  nothing returns user-cab **bytes**, so a bundle would need a new server route.

### Honestly impossible (no wire op — keep the honest negatives)
- Slot **Move / Delete everywhere** (no slot-erase op), **Clear Preset** (no clear/init op),
  **Scene MIDI block** (eid 190, zero calibration), **Devices / mirroring**, **MLM warning**
  (stopped as unverifiable), **generic per-block Mute** (no served param — points at Bypass).
  *(Correction: **CS MIDI and FC config are NOT in this list.** The P2.5 narrowing showed CS MIDI is a
  *layout* gap — its trio 6979/6985/6986 serve and the CS exclusives already render — and FC Config is
  PARTIAL via the layout-widget rule (P1.2); the P4 Control Switch group shipped. Only
  **Devices/mirroring** remains genuinely wire-absent.)*

### N/A on FM3
- Global blocks (Axe-Fx only), NAM Manager (Axe-Fx III only — announced coming soon; FM3
  unconfirmed), IR Capture (does not exist on these units).

## Conventions every round must keep (these are load-bearing)

- **Axis-only + offline-provable** for parallel rounds: no hardware, no new server endpoint. (The one
  exception so far is an e2e-only round.)
- **`EditorSurface` seam**: any new member a component reads off the editor store must be declared on
  `src/lib/editorSurface.ts` **and** satisfied by `src/lib/convertEditor.svelte.ts` — forgetting this
  is the #1 integration defect of earlier rounds (it broke svelte-check after the W1–W4 merge).
- **Never fake**: a control that cannot work renders **disabled with the exact reason** in its tooltip
  (no-dead-nav rule, `01-shell.md` §9). Never invent a paramId, a byte layout, a value, or a
  "coming soon" toast.
- **Tests**: node-env vitest; pure logic unit-tested; `.svelte` wiring pinned by **sourceguard** tests
  (`readFileSync` + regex — see `src/lib/listCaps.test.ts`, `src/lib/shortcuts.test.ts`) — and, where a
  surface actually matters, a real Playwright spec.
- Keep edits **additive**; never rename/delete an existing export; grep `e2e/` and `src/` for a
  user-visible string before changing it.
- **Resource limits**: four agents run in parallel on a ~4.4 GB VM. Agents run only their own test
  files + `npm run check`; the full suite / build / Playwright run once on the merged tree.

## How to verify a round

```bash
# per branch (cheap, low memory)
npx vitest run <the branch's test files> && npm run check

# on the merged tree (authoritative)
npx vitest run
npm run check
npm run build   # the heap flag now lives in .npmrc (`node-options`) — no NODE_OPTIONS prefix needed
npx playwright test --project=chromium                  # 144 tests; boots its own :5199 server
```

**Kill any lingering dev server on `:5199` before the merged-tree e2e run** — `reuseExistingServer`
is on, so it will otherwise serve a feature-branch worktree instead of `main`.

### Fresh sibling layout (why `npm ci` alone is not enough)

The three repos sit side by side and Axis links the siblings as `file:` deps
(`"forgefx-server": "file:../ForgeFX/server"`, which in turn links `file:../../forgefx-midi`). Their
package `exports` point at **gitignored `dist/`**, so a fresh checkout has the links but no built
artifacts — the first import fails until each package is built, in order. Run:

```bash
npm run setup:stack   # forgefx-midi build → ForgeFX/server build → svelte-kit sync
```

`setup:stack` is an **explicit, named script — deliberately NOT `prepare`/`postinstall`**. An install
hook fires on *every* `npm ci`/`npm install`, including a consumer's install through the `file:`
link, so it would silently build a sibling tree from someone else's checkout (and re-run on every
install). The order it encodes is the same one `.github/actions/build-stack/action.yml` uses in CI:
codec (`forgefx-midi`) first, then `ForgeFX/server`, then `svelte-kit sync` for Axis.

## Stale docs (banner-ed / corrected, kept as history)

| Doc | Why it is stale |
|---|---|
| `ROADMAP.md` | 2026-06-28 gap list; its "missing" items all shipped. |
| `axis_layout_rework_progress_log.md` | round-by-round log, ends mid-rework. |
| `axis_layout_rework_review_and_remaining_plan.md` | superseded plan. |
| `axis_workbench_design_aware_rebuild_plan_for_claude_code.md` | superseded build plan. |
| `axis_workbench_implementation_status_and_next_plan.md` | superseded status. |
| `axis_workbench_verification_report.md` | superseded verification report. |
| `workbench-dc-parity/*.md` | 2026-07-07 design-parity specs; the `- [ ]` gap lists are unmaintained. |
| `ui-c-sweep-findings.md` | F1/F2/F3 all fixed; kept as the measurement record. |
| `handoff-cab-mute-and-dynacab.md` | items 2–5/7/8 done; only items 1 and 6 (hardware) remain. |
| `LAYOUTS.md` | its two "Status note" blocks predate the layout-profile + rail work (corrected inline). |
| `CHANGELOG.md` | frozen 2026-07-16 — release notes live on the GitHub releases page. |

## Pointers

- Next iteration (review-sourced P1/P2/P3, with the checked-and-rejected list):
  `docs/axis-review-2026-10-07-next-iteration-fix-list.md`.
- Live backlog / evidence: `docs/axis-fm3edit-feature-parity-audit.md` (§7 has the round logs,
  §6 the probe list, §8 the file index).
- Design-parity specs (binding, but see the staleness banner): `docs/workbench-dc-parity/`.
- E2E harness + selectors: `e2e/README.md`.
- Layer guides for agents: `src/lib/CLAUDE.md`, `src/lib/axis-workbench/CLAUDE.md`.
