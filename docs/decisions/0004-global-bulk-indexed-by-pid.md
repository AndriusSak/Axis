# ADR-0004: GLOBAL values are read by pid from the eid-1 bulk body

- **Status:** Accepted
- **Date:** 2026-10-07
- **Owners:** maintainer

## Context

ADR-0003 served the whole FM3 GLOBAL family (virtual effect id 1) as UNKNOWN and read-only, on the
premise that the `fn=0x1F` bulk body was a **186-record channel block indexed positionally**
(`values[base + pid]`): pids `>= 186` — including `GLOBAL_FS_BRIGHTNESS` (7115) — would read past the
block, and the `?? 0` fallback would fabricate a `0`, which was recorded as the cause of an incident
where brightness read `0.0000`.

A read-only measurement on the real FM3 (2026-10-07) refuted that premise:

- The eid-1 (`fn=0x1F`) body is **14,880 records** (head `itemCount` 14880, assembled 14880). So
  `base + 7115` is **in range** — nothing runs past the block.
- The body **is indexed by pid**, proven against the device panel:
  - `Mini Display/Ring Brightness` (pid 7115) at 100% read `body[7115] = 65534`; changed to 70% it
    read `body[7115] = 45874` — exactly `0.70 × 65534`.
  - `Mini Display Contrast` (pid 7116) at 50% read `body[7116] = 32767` (half of 65534).
  - `Ring Intensity Bright` (pid 110) at 100% read `body[110] = 65534`.
  - Raw scale: **65534 == 100%** for these `knob 0..100` params.
- The incident's `0.0000` has a **different cause**: the per-pid GET (`fn 0x01 sub 01 00`) replies with
  a **canned template** on this firmware; decoding it yields `2.085e-41`, a denormal that **displays as
  `0.0000`**. That is what the probe read as the "original" brightness and then wrote back as a restore.

## Decision

**We will read GLOBAL bulk values by pid (`body[pid]`) from the eid-1 (`fn=0x1F`) body, which is at
least 14,880 records long. A value is UNKNOWN only when its pid is beyond the assembled body length —
not because of a family-wide stride rule.**

- Serve GLOBAL param values by pid from the bulk body. The blanket `#bulkUnresolvedReason` refusal
  based on the declared stride (ADR-0003) is **reverted**.
- Treat the per-pid GET (`fn 0x01 sub 01 00`) reply as **unusable on this firmware** (a canned
  template that decodes to `2.085e-41`) — never use it as an independent read or as a restore source.
- Keep the raw scale in mind: **65534 == 100%** for `knob 0..100` params such as 7115/7116.

## Alternatives

- **Keep serving UNKNOWN (ADR-0003).** Rejected: its premise is refuted by measurement, and it makes
  responsive Setup controls needlessly inert.
- **Trust the declared stride / positional indexing.** Rejected: the body is not the assumed channel
  block; it is keyed by pid.
- **Use the per-pid GET as the read path.** Rejected: its reply is a canned template on this firmware
  and decodes to `2.085e-41`.

## Consequences

- The Setup screen's GLOBAL controls read real values again; the over-broad inert refusal is withdrawn.
- The GLOBAL **write** question remains open — the provenance of the incident's restore is separate
  from the read path — and is tracked in `NEXT-STEPS.md`. Values may be served while writes stay
  unproven.
- Out of scope here (ForgeFX repo): `ForgeFX/docs/decisions/0004-global-bulk-read-unknown.md` and
  comments in `ForgeFX/server/src/drivers/gen3.ts` still carry the refuted attribution and must be
  corrected in a ForgeFX round.
