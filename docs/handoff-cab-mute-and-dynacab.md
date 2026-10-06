# Handoff — Cab Mute/Solo, DynaCab graph, CPU readout (Oct 2026)

Status: **the reported bug is fixed and confirmed on hardware** ("It is visible now"). This file
records what shipped, what is still open, and how to pick it up. Written for a session that has none
of the context above.

## What was fixed

Five independent causes stacked up behind "Mute 2 does not exist anywhere in cab tab or anywhere
else" (FM3 Cab block, second cab slot):

1. **`CABINET_DYNACAB_R1/R2` (pids 93/94) declared `unit: 'unverified'`** → excluded by ForgeFX's
   `KNOB_UNITS` allowlist → the DynaCab Position param was dropped, so the mic graph had nothing to
   bind. Fixed in `forgefx-midi` (`83d46ca`).
2. **The Cab page was selected by `CABINET_PRETYPE` instead of `CABINET_MODE`** — `#paramId(family,
   'type')` fell through to a loose `/TYPE$/` match and grabbed Preamp Type (pid 43). Fixed by
   preferring `${family}_MODE` before the loose match; the Preamp Type dropdown also came back
   (`ForgeFX e3eb3ec`).
3. **Cab M/S buttons carry pseudo paramIds** (`65286…65289`, `CABINET_BTN_MUTE<n>` / `..._SOLO<n>`)
   that no served param matches, so the board builder drew a gap. Fixed by re-resolving the `_BTN_`
   infix against the served NAME (`deviceLayoutBoard.ts` `btnPseudoParamKey`).
4. **The CPU byte is the percentage** — the readout was fitted at a single capture point
   (`32 + raw·0.5`, exact only at raw 64). Now identity (`forgefx-midi 313a69c`).
5. **THE reported cause: a device-cache range row that could not be served.** The device's
   on-connect self-describe cache described `CABINET/25` as a FLOAT while the catalogue says enum,
   and the def's unit is the marker `unverified`. A float row on a marker-unit def is served by
   NEITHER filter (knobs need a real display unit, enums need `kind: 'enum'`), so the parameter
   vanished from the response entirely and the device's own cab-2 M/S button bound to nothing.
   Fixed in `ForgeFX` by choosing the row that actually SERVES a param, falling back to the
   catalogue row when it describes a discrete selector (`285c11b`, plus `c944780` for the degenerate
   -row case and `2a1ddc7` for the diagnostic below).

**Red signature of cause 5** (matches the device's real response): served enum ids jump
`0,1,24,30,42,43,47,56,…` — 24 present, 25 gone, next 30.

## Commits (all unmerged feature branches)

- `Axis` @ `local/dynacab-mic-graph` — `5cc2237`, `53e217d`, `3a5c771`, `a114042`, `db60abf`, `7e663da`
- `forgefx-midi` @ `local/dynacab-position-unit` — `83d46ca`  (and `local/fm3-cpu-percent` — `313a69c`)
- `ForgeFX` @ `local/dynacab-position-guard` — `3fa4bf6`, `e3eb3ec`, `c944780`, `285c11b`, `2a1ddc7`

## REMOTE WORK — pick these up in order

1. **Verify a WRITE to cab 2's mute on real hardware.** This is the one thing I could not prove:
   the cache row said float, the catalogue says enum, I trusted the catalogue. Toggle cab 2's M/S on
   the device and confirm the state changes (and reads back). If writes are ignored, the device's
   float row was right and the layout is stale — then revise `285c11b` rather than paper over it
   (e.g. serve the catalogue enum only when the layout draws that param as a discrete control, or
   render it read-only with a tooltip). No test can cover this without hardware.
2. **The block pane is too short and that is a real UX defect.** Measured at 1440x900: the block
   editor card is 323px, of which **226px is chrome** (block header + page tabs + search), leaving
   the control area **170px** for a **471px** Cab board — cab 2's control lands at y1074 while the
   card ends near y857. It scrolls (thin scrollbar only). Candidates, cheapest first: fold the
   search into the tabs row (`ControlSurface.svelte`); raise the bottom region height in the tablet
   preset (`axisWorkbenchLayoutPresets.ts` — note a seed change needs another
   `layoutVariantSig` marker bump to reach users, and that discards their board arrangement); a
   fit-to-view cell scale. Cheap test to write first: at 1280x800, assert BOTH cab M/S controls have
   real visible area inside the pane without scrolling (`e2e/27-cab-mute-controls.spec.ts` has the
   mock and the geometry helpers).
3. **The search renders matches as FULL control cards**, so a short pane shows one. A match count is
   now displayed (`db60abf`); consider a compact result list instead.
4. **Surface `/diag/ranges` in the UI.** The endpoint (`GET /diag/ranges?family=X&pid=N`) prints the
   serving row, the catalogue row and the def's unit — enough to end this class of guessing in one
   call. A "profile vs catalogue" row in the device info would make it self-service.
5. **Optional: resolve pseudo-params server-side.** The `_BTN_` handling lives in the Axis board
   builder, i.e. matching a served NAME on the client. The driver has the params table and could
   rewrite `CABINET_BTN_MUTE2 → pid 25` when serving the layout, removing the client dependency.
   Deliberately not done — the client fix was smaller.
6. **Re-check the DynaCab 2-axis pad on the Deck** (vertical = Position CAP→EDGE, horizontal =
   Distance via the sibling `CABINET_DYNACAB_Z<n>` binding). Verified in e2e only.
7. **Cleanup:** `ForgeFX/server/scratch-cab-mute.ts` is untracked — promote it into
   `test/drivers/` or delete it. The scratch tesseract OCR helpers are under
   `~/.hermes/cache/scratch/` (pruned when idle).
8. **Merge/review** the three branches above upstream.

## Environment / build notes (these cost real time)

- Rebuild the Deck AppImage with `~/.hermes/cache/scratch/build-deck-appimage.sh`. It now restores
  dev deps up front because its OWN step 2 runs `npm prune --omit=dev`, which otherwise makes a
  second build die in `tsc` with "Cannot find name 'process'/'Buffer'/'setTimeout'" — that looks
  like a broken repo, not a pruned one.
- `npx tsc` resolves to a stub package in this repo: use `npm run build` or
  `node_modules/.bin/tsc`. And **`tsx` type-strips** — a type error can pass every test and still
  fail the build (this happened once).
- The last artifact built and verified is `Axis-0.9.24-dynacab-build12.AppImage`
  (`sha256 4555ed20d19cf5b6c9f7ea30c6c65e7a6ccdf64736f9afe5e7424ae5616d9999`) in `~/axis-dist/`.
  **The LAN file server on :8099 has been stopped.**
- To hand a build over: serve `~/axis-dist/` (`python3 -m http.server 8099 --bind 0.0.0.0`), and
  run it on the Deck with `APPIMAGE_EXTRACT_AND_RUN=1 ./Axis-*.AppImage --no-sandbox` (no libfuse2).

## Test state at handoff

- Axis: unit **1148 pass** (106 files), `svelte-check` **0 errors / 0 warnings**, e2e
  `27-cab-mute-controls` **7/7** (the full e2e suite was 70 green before these additions).
- ForgeFX: **all 34 suites pass**, including `test/drivers/cab-mute-cache-row.test.ts` (4 shapes:
  missing row / degenerate row / usable-but-narrower row / float row).
- forgefx-midi: **83/83**.

## Unverified / honest caveats

- The write path for cab 2's mute (item 1) — untested against hardware.
- The CPU readout is identity-calibrated per Fractal's MIDI reference; a 1-point lag vs the front
  panel was observed once (widget 80 where the panel read 79) and is expected, not re-measured.
- Which source supplied the device's cached ranges (`live` walk vs an imported FM3-Edit `.cache`
  vs cloud) was never established — `GET /device/cache` reports `meta.source` if it matters.
