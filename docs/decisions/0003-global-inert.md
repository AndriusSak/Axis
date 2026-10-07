# ADR-0003: GLOBAL Setup params are served UNKNOWN, rendered inert, and unwritable

- **Status:** Accepted (interim)
- **Date:** 2026-10-07
- **Owners:** maintainer

## Context

The FM3 `GLOBAL` family (virtual effect id 1) is the whole Setup screen: display / mini-display
settings, the FC-page params, and the shipped P4 Control Switch group. Its catalog is **not dense** —
it carries 173 device-true paramIds up to 65522, 91 of them `>= ` the family's declared fn=0x1F stride
of 186 (`forgefx-midi/src/gen3/fm3/ranges.generated.ts` / `params.ts`). The bulk-read body is
**positional** (`values[i]` is the param whose device paramId is `i`) and the catalog ships **no
pid→record-ordinal map** for GLOBAL, so `bulk.values[base + pid]` either ran past the block (`undefined`
→ a fabricated `0`) or, for sub-stride pids, read an unrelated record (silently wrong).

That is not hypothetical. A hardware probe read `GLOBAL_FS_BRIGHTNESS` (pid 7115) as `0.0000`, wrote
and then restored through the same path, and the user's footswitch LED rings went dark — a misread `0`
restored over a live value. (Which read path produced that `0` is **not established**: the probe reads
through the per-pid GET, not the bulk path — see the fix-list's Q1 hardware question. The bulk path is
broken for those pids regardless, and the per-pid GET is itself unverified.)

## Decision

**GLOBAL param values are served as an explicit UNKNOWN and are never written.**

- **Server (P9, ForgeFX).** `blockParams` detects a non-positional family structurally
  (`#bulkUnresolvedReason`): if any ordinary (`< 0xff00`) catalog pid reaches the declared stride, the
  family is not provably positional. Its values are served `value: null`, `norm: null`, with an
  `unresolved` reason and `type: null` — never a guessed number. This is the ForgeFX-side decision,
  recorded as `ForgeFX/docs/decisions/0004-global-bulk-read-unknown.md`.
- **Client (P10, Axis).** Every consumer renders and handles the unknown **explicitly**: an unresolved
  control is an inert tile (em-dash + the server's reason) before any knob/fader/slider branch, and
  `setParam`/`setPinnedParam`/`setEnum`/`setPinnedEnum` return early on an unknown value (no fabricated
  undo baseline); capture paths skip it rather than store a `0`.
- Because `familyUnresolved` is **family-wide**, this covers **all 173 GLOBAL params**: the entire Setup
  screen, the shipped P4 Control Switch group, and the P1.2 FC-page params all render inert and are
  unwritable.

This is a **deliberate, defensible interim position**: GLOBAL writes are unproven (the one "success" was
a same-path echo) and one caused a real incident, so neither a plausible value nor a write is served
until a read path is proven.

## Alternatives

- **Serve a fabricated `0` (`?? 0`) / allow the write.** Rejected: that is the exact defect, and it is
  destructive on an off/disabled boundary (0 on a 0..100 level).
- **Keep reading GLOBAL via the positional bulk path.** Rejected: provably wrong for those pids.
- **Wire GLOBAL writes anyway.** Rejected: unproven and incident-causing.
- **Drop GLOBAL params from the served list entirely.** Rejected: it re-blanks the Setup screen (undoing
  P1.2) and hides *which* controls exist. Serving them inert keeps the surface honest and visible.

## Consequences

- Honest, but blunt: the whole Setup screen and the P4 Control Switch group are read-only/inert. The
  annoyance is real and user-visible — it is the price of not writing a misread value.
- No silent wrong numbers and no destructive GLOBAL writes can happen while this stands.
- The layout-membership contract (P1.2) is preserved: the ids are still served, only the *value* is
  unresolved.

## What would reopen it

One of these, then a later round may serve real GLOBAL values (and, with the write side separately
proven, re-enable writes):

1. **An independent read path for GLOBAL values** — not the positional bulk read and not a same-path
   echo of our own write (a distinct sub-action, the front panel, or a proven pid→ordinal map).
2. **A device dump settling the GLOBAL block layout** — the real `0x75` body length and indexing for
   GLOBAL, which would make the positional read provable.

Neither is available now; the FM3 is not currently attached, so this cannot be settled from here.
