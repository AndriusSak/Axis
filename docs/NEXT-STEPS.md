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

**INCIDENT (2026-10-08) — read `ForgeFX/docs/incident-2026-10-08.md` before probing this unit**

- Blind probing of the **firmware-update function family** (`fn=0x7D/0x7E/0x7F/0x79`) left the FM3 in its
  bootloader showing *"Updating Firmware / Transfer Error / Please reboot the device and try again"*; it
  recovered on a power cycle. The triggering frame is **not established** (no frame tap had been captured).
  Consequences in force: a **hard guard** refuses firmware-family frames from every probe script unless
  `--allow-firmware-family` is passed, every hardware probe now writes a **frame tap**, and no unmeasured
  function byte may be sent to a unit holding a library.

**Open — surfaced by the capture analyser (2026-10-08)**

- **The three `fn=0x01` sub-actions the editor uses constantly are ANSWERED BY THE UNIT — no longer unmapped, and
  no longer capture-gated (2026-10-12).** `0x03`, `0x1b` and `0x2e` were listed here as "unmapped, surfaced by the
  capture analyser", with the FM3-Edit captures that revealed them living on the owner's deck and not in this
  repo. Upstream's gen-3 codec already carries a sub-action table mined from the 2026-06-03 FM9 capture
  (`forgefx-midi/src/devices/gen3/simResponders.ts`: `0x2e` = LAYOUT MAP expected 755B, `0x1b` = PARAM FLAGS
  expected 23B, `0x03` absent), so the question was put to the device with
  `ForgeFX/server/scripts/probe-query-subs.ts` (read-only, both controls in the same run):
  `0x4b` → 60B as known · `0x99` → **SILENT** (so "not implemented" reads as silence here, not as a `0x64`) ·
  **`0x03` → 23B, address-dependent** (the amp's eid in byte 8 yields data bytes `1d 76`, other addresses all-zero)
  · **`0x1b` → 23B, address-dependent** · **`0x2e` → 590B, or 23B when byte 7 is `0x01`** (a selector switches it
  between the table and one small record).
  **The 590-byte reply is address-INDEPENDENT and edit-buffer-INDEPENDENT** — tested by reading it, changing the
  edit buffer through the route (`PP#5`'s HOLD, then restoring) and reading again: the three reads differ ONLY in
  three volatile data bytes (`+22`/`+23`/`+24`), so it is a static model-side table rather than preset state. Its
  576-byte data region is bit-level (220 bytes hold a single-bit value, zero bytes 241/576) and is NOT a
  per-block geometry table — checked against `FM3_BLOCK_GEOMETRY`'s 28 blocks and reported `NO HITS`.
  **ROUND 12 (2026-10-12) ran that README's three next steps. Evidence:
  `ForgeFX/server/test/fixtures/query-subs-decode/` (six taps + a README stating what each row measures) —
  still NOT decoded, but the space is much smaller:**

  - **The `0x2e` volatile trio is per-READ, and it is NOT a counter.** Two connections (constant 500 ms steps,
    then 250/500/1000/2000/4000/8000 ms) predicted different numbers under "counter" and "nonce": 16/16 trios
    distinct with Δ tracking neither spacing nor read ordinal, and the 8000 ms step moved no further than the
    250 ms one. Over 64 samples `+22` **never left `0..3`** while `+23`/`+24` span their 7-bit range — so it is
    not three random bytes either, and `+22`'s boundedness is unexplained. **Everything else in the reply is
    byte-identical across all 80 reads taken**, so masking `+22..+24` is sufficient and no byte of the region
    is a stable identity until further notice. The SHORT `0x2e` reply is fully reproducible (1/64 distinct for
    each of two addresses) — ROUND 11's "byte flipped between runs" was the address change, not volatility.
  - **The 576-byte region is periodic at 8 bytes** (top autocorrelation lags are 8, 40, 72, 32, 16 — all
    multiples of 8) and contains ~20 occurrences of the one-hot ladder `40 20 10 08 04 02 01`. Two hypotheses
    are now KILLED, both reported by `scripts/decode-layout-map-matrix.ts` on every run: **"a family's bit-run
    length equals its param count"** (REFUTED — the longest single-bit run is 7 and the smallest family has far
    more params) and **"the region is a column-major one-bit-per-byte matrix"** (REFUTED — every
    `start 0..72 × width 4..10` alignment was enumerated and none is violation-free; the best still leaves 92
    multi-bit bytes).
  - **`0x03[sel=01]` is a per-eid read whose bytes 5-7 are NOT stable identity.** Its reply is
    `01 <eid> 00 00 00 <b5> <b6> <b7> 00…` with real per-eid content (`0x2a → 28 03`, `0x3a → 6f 0e 01`);
    `sel=00` gives all zeros. The amp's byte 5 advances by **exactly +1 per write to that block** and is stable
    across reads, while **`0x5e`'s advances +6 per READ with nothing written** — so "0x03 mirrors the block's
    state" is NOT established, and the bypass question is OPEN in both directions, not answered.
  - **The bypass arm that first read this nearly published the opposite.** Its first version compared
    before/during/after a toggle and saw `6f → 70 → 71`, which reads as "carries live state" — but an unrelated
    eid moved with no write near it. A before/during/after comparison **without a no-write baseline** cannot
    attribute anything; the arm now runs a drift control (3 reads, nothing written) and 5 reads per stage, and
    the superseded tap is kept as evidence of the trap. **Rule: measure the no-write baseline on the same rows
    before believing a write moved them.**
  - **`0x1b` is the tractable one**: `sel=00` answers stable, reproducible per-eid bytes (`0x2a/0x2b → 7f 7f 01`,
    `0x3a/0x3e → 00 00 00`, `0x46 → 47 42 00`, `0x4e → 0c 00 00`), `sel=01` answers all zeros for every eid,
    and nothing moved it on any read or write. That is where a next round should start.

**Blocked on hardware (an FM3 / the Deck must be attached)**

- **The `0x64` write-refusal latency question (Q5) — MEASURED 2026-10-08, and the framing was wrong twice
  over.** The probe now runs **two arms**, and both were run on the unit (3 times, consistent):
  1. **an unknown effect id** (bogus eid 16382) — NOT refused: the device answers with a reply frame
     **1–2 ms** after the write, and that reply is **not an echo of what was sent** (asked for value
     0, the reply carries different value bytes). So it is neither a refusal nor an acceptance;
  2. **a REAL param with an OUT-OF-RANGE value** (Cab 2 Mute/Solo, a 3-option enum, written 900) — also
     NOT refused: it replies in **12–14 ms**, and the read-back shows the unit **stored 2** — the value
     was **silently CLAMPED and applied**, replacing what was sent.
  **So neither arm provokes a `0x64`, and the FM3's answer to a bad write is SUBSTITUTION, not rejection.**
  The 250 ms write-confirm window is **not marginal**: every reply arrived in **1–14 ms** — but note that
  250–266 ms is what a `request()` *reports*, because the transport resolves on a **quiet gap** and does
  not timestamp frames; the probe now times arrivals itself (via `onFrame`), which is the only reason the
  real number is known. The item's own lesson stands and is now sharper: **absence of a refusal is not
  acceptance** — and, worse, a non-refusal reply is not evidence the value you sent is the value in force.
  **What closing the refusal path itself would still require:** a write the device genuinely rejects
  (probably not reachable from the param-write opcode), or the editor's own refusal handling captured.
- **§3.7 Cab 2 Mute/Solo write — CLOSED (2026-10-08) with TWO independent witnesses.** The gap was that the
  probe read the original and the write-back on the SAME path, so it could prove the write landed but not that
  it had read the unit's real state. Both gaps are now covered, neither by that path:
  1. **The human eye.** The wire read said Cab 2 Mute/Solo = `1` (MUTE); Andy looked at the unit and reported
     it on MUTE — the read and the front panel agree, so the original was captured correctly. Then the write
     was run slowly (`scripts/watch-cab-mute.ts --cycles 1 --hold 8`): the unit showed the change and he
     confirmed it ("I saw it change"), and it was left back at MUTE as it started.
  2. **The device's own UNSOLICITED burst.** As the value moved, the unit PUSHED a `0x74/0x75/0x75/0x76`
     burst naming the cab block (eid 62, 424 items) — a different mechanism from the bulk read, so the write
     reaching the cab block is corroborated on a second path.
     HONEST LIMIT: the burst decoder attributed **no moved param** inside that burst, so the burst corroborates
     "the cab block reacted", NOT "pid 25 moved". The named witness for the param itself is the human.
- **§3.6 item 6 DynaCab 2-axis pad** — verified in e2e only, never on the Deck. **Andy reports it worked the
  last time he used it on the unit** (his observation, 2026-10-08) — recorded as his eyewitness rather than
  re-tested; a wire-level capture has still never been taken for it.
- **§2.5 user-cab IR upload — SOLVED (captured + load-tested 2026-10-08).** The `.syx` export IS the
  wire stream: a USBPcap capture of FM3-Edit 1.07.16 loading an IR onto fw 13.0 shows `0x7A` + 8×`0x7B`
  (byte-identical to the file) + `0x7C`, each answered `0x64 <fn> 00 <fn&0x0f>`. The **only** difference
  from the export is the start frame's first two bytes: the file carries `7F 7F` ("no destination") and
  the editor writes a real `[index, page]` — page `0x10`–`0x13` = the 512 user banks, `0x20` =
  scratchpad. Load test: sending the file's frames with a written destination drew the **same acks the
  editor gets** (start + 8 data + end), so `uploadCabIr` now requires a destination, **refuses the
  scratchpad** (measured-refused in every probe, as is the `7F 7F` sentinel), and reports `ok` from the
  acks rather than from "the frames were handed over".
  **Confirmed on the unit by Andy (2026-10-08):** the slot the load test wrote (user slot 1, which
  already held that IR) **reads the same and sounds the same** — so the verbatim path is confirmed
  end-to-end from both sides of the glass, not just from the acks. (A byte-identical re-upload into the
  same slot is a weak content test by construction; what it establishes is that the path stores and does
  not corrupt, which is the property that was in doubt.)
  **A RENAME IS SOLVED (measured 2026-10-08)** — see §2.5e: the close frame is a checksum over the
  container's content, `buildCabIrSyx` recomputes it for an edit, and a renamed container uploaded to an
  EMPTY slot drew close-code `0x00` with the slot becoming POPULATED. The shipped rename that carried the
  old close was not merely "unverified" — it was **silently discarded by the unit**.
  **Still open:** there is **no cab-NAME read-back** (`fn=0x12` is refused), but there IS a **slot-state
  read-back** — see below. Do not re-derive any of this from the gen-2 wiki page.

- **§2.5e the close frame is a CONTENT CHECK, and a mismatch makes the unit DISCARD the upload —
  MEASURED in four controlled arms (2026-10-08).** Each arm uploaded to an EMPTY user slot, so "was it
  stored" is observable through the slot-state read-back rather than inferred from acks:

  | arm | container sent | close frame answered | destination slot afterwards |
  |---|---|---|---|
  | A | verbatim specimen | `0x00` | **POPULATED** (region == slots 1/12) |
  | B | name rewritten, close carried verbatim | `0x13` | **still EMPTY** |
  | C | samples zeroed (and a one-byte-spike variant) | `0x13` | **still EMPTY** |
  | D | content unchanged, close value mutated | `0x13` | **still EMPTY** |

  So `0x00` = the container's close value MATCHES its content (stored), and `0x13` = mismatch → the whole
  upload is **DISCARDED and the destination is left untouched**. Every frame is still acknowledged in the
  `0x13` arms — which is the trap: **reading only the frame acks reports "acknowledged" for an upload the
  device threw away.** The driver now requires the `0x00` close answer for `ok` and reports
  `discarded`/`closeCode`/`reason`; Axis's strip says "DISCARDED by the unit — nothing was stored".
  **THE ENCODING IS DECODED (2026-10-08) — the close value is the XOR of every decoded 32-bit chunk word
  of the data frames, the 8 NAME chunks INCLUDED (2048 words on both geometries), re-encoded as five
  LSB-first septets.** Reproduced byte for byte by two independent implementations against **11
  containers** spanning model bytes `0x03`, `0x07`, `0x10`, `0x11` and both frame geometries (66×32-chunk
  and 10×256-chunk). Falsified on the way: sum, CRC-32/CRC-32c, Adler-32, FNV-1a, DJB2, a length field,
  an opaque constant, samples-only coverage, and the last byte being a separate flag (it is the top septet
  of the same 32-bit value). Shipped as `cabIrContentXor` / `computeCabIrClosePayload`; `buildCabIrSyx`
  recomputes the close for any edit (a no-op for an untouched container), and the driver **refuses to send
  a container it knows the unit will discard** unless asked to measure that. So an EDITED container is now
  possible — a rename is measured-working, and a converted `.wav`/`.ir` is no longer blocked by this.

- **§2.5b per-slot cab state — the read-back that exists, MEASURED and now SHIPPED (2026-10-08).** `fn=0x01 sub=0x4B` takes the **same `[index, page]` pair** as the IR
  upload's start frame (byte 12 = index, byte 13 = page; `0x10`–`0x13` user banks, `0x20` scratchpad);
  the editor issues it for all 528 slots (512 user + 16 scratchpad) and each draws a 60-byte `01 4B`
  reply. Decoded from that reply: **payload byte 6 is `0x01` for a POPULATED slot and `0x7F` for an empty
  one**, and payload bytes 15–29 are a **content-derived region** — the two slots holding the same IR
  (U0001 and U0012) share it byte for byte, while all 500 empty user slots and all 16 empty scratchpad
  slots share one identical payload. Confirmed on the live unit with
  `scripts/probe-cab-slot-state.ts`: U0001–U0012 `0x01`, U0013+ and the scratchpad `0x7F`, 0 silent.
  **CORRECTED 2026-10-08 — the region is NAME-derived, not sample-derived.** Measured with three
  containers that share the name "LT TV Mix 7" but hold wildly different samples (the real IR, an
  all-zero sample set and a one-byte spike): all three give an IDENTICAL region, while the SAME samples
  under a renamed container give a DIFFERENT one. So the region follows the NAME — which means it CAN
  confirm a rename (it moves) but CANNOT tell two IRs that share a name apart. It is still **not a name
  oracle**: no 4-per-5-septet, 8-per-7 or plain-7-bit decoding at any offset yields the known name, and
  its encoding is undecoded. Report **"populated"**, never "holds `<name>`". The EMPTY-slot payload is
  **not stable across sessions** (the same empty slots read `…3e 00 1e 04 03 38…` in the morning and
  `…3e 00 0d 26 70…` hours later) — treat it as unstable and never build on its bytes. Natural next
  increment: a read-only `queryCabSlot` driver method + route that returns the raw flag/region and the
  measured populated/empty reading.
  **Shipped:** the codec (`forgefx-midi/devices/gen3/cabSlotState.ts`), `Gen3Driver.queryCabSlots()`,
  `GET /cab/slots` on both surfaces (`?user=N` or `?page=&from=&to=`, sweep capped at 128), and Axis's
  IR-import strip now reads the destination **before and after** the send and reports the unit's own
  answer ("reads OCCUPIED now, it was empty before") instead of leaving confirmation to a human.
  **Verified live:** an upload to user slot 13 (which was empty) drew the full ack set AND then read
  back `populated: true` with a content region **byte-identical to slots 1 and 12**, which hold the same
  IR — the content test the byte-identical replay could not do. `?page=0x30` answers a clean 400.

- **§2.5d cab-slot DELETE — SOLVED, and NO capture was needed (2026-10-08).** There is no remove opcode,
  but there IS a delete: a container whose entire chunk area is **`0x7F`** — the blank fill Fractal's own
  loader ships as `empty_ir.syx` — is ACCEPTED (all 2048 words identical ⇒ their XOR is 0 ⇒ close
  `00 00 00 00 00`) and the destination slot then reads **EMPTY**, indistinguishable from a
  never-written slot. Verified on the unit with the slot-state read-back: an already-empty slot stayed
  empty, and **eight slots that held real IRs flipped `populated` → `empty`** while an untouched
  neighbour kept reading populated. Shipped as `buildBlankCabIrContainer` (refuses an unmeasured
  geometry), `Gen3Driver.clearCabSlot` (fail-closed: `ok` needs the `0x00` close AND a post-read of
  `empty`), `POST /cab/slots/clear` on both surfaces (registered in the write gate, refused in remote
  mode), an **erase (×) control** on occupied rows in Axis's USER bank, and `scripts/clear-cab-slot.ts`
  (dry-run by default). Verified end-to-end through the routes: upload → populated → clear → `ok:true`,
  `wasPopulated:true`, `nowPopulated:false`.
  **The earlier "delete-by-zeroing" test does NOT generalise** — zeroing the *samples* keeps a real name,
  is stored, and reads *populated* (a silent IR). The blank FILL is the device's own "unwritten" pattern,
  which is why it reads empty.
  **Still open in the Manage Cabs family:** *reorder* and whether FM3-Edit reveals a user-slot NAME
  (§2.5c). Both now depend on a **slot-data read**, and that has been PROBED for (§2.5f) — it does not
  appear to exist. A capture of Manage Cabs renaming or reordering is what would settle them.

- **§2.5f is there a slot-DATA read (or a user-slot name)? — PROBED 2026-10-08, boundary now measured.**
  Two families were swept, read-shaped and bounded, guarded by a full before/after bank snapshot:
  1. ~~**`fn=0x7D/0x7E/0x7F/0x79` with the `[index, page]` pair** — every one REFUSED with `0x64`~~ —
     **WITHDRAWN as evidence about cabs (2026-10-08).** Those function bytes are the **FIRMWARE-UPDATE
     family**, not cab opcodes: their refusals carry **image codes** (`0x11` image size incorrect, `0x14`
     buffer overrun), and probing them blind left the unit in its bootloader demanding a reboot (see the
     incident note below and `ForgeFX/docs/incident-2026-10-08.md`). They refuse a *cab-shaped* payload
     because it is not a firmware image — which says nothing about cabs either way. **No conclusion about a
     cab slot-data read may rest on this arm.**
  2. **`fn=0x01` sub-actions adjacent to the state query** — `0x4A`, `0x4C`, `0x4D`, `0x4E` are all
     IMPLEMENTED and answer, but **none carries a name or slot data**: `0x4A`/`0x4E` are identical for
     every slot including empty ones, `0x4D` is identical across slots (33 bytes), and `0x4C` varies per
     slot but contains no readable text and its meaning is undecoded. Mapped in
     `CAB_SLOT_FN_SUBACTIONS`.
  **So the surviving evidence for "no slot-data read" is arm 2 alone** — and it is weaker than it was
  written: the editor's cab list is served entirely by `fn=0x01 sub=0x4B` (measured in the refresh capture:
  1056 queries, no other read), so either the 15-byte region decodes to the name or FM3-Edit keeps its own
  record. Until one of those is settled, "no slot-data read exists" stays a **probable** reading, not a
  measured one. The claim that stood on arm 1 is retracted. **Probable, and very likely by design** — extractable user IR data is
  exactly what protects commercial IR vendors. Consequence: **reorder cannot be done by read+write**
  (we cannot read a slot's samples), and a user-slot NAME is not obtainable from any per-slot reply
  probed. Both need the device's own op, and the fixture for that is a capture of FM3-Edit renaming or
  reordering a user cab.
  **Instrument:** `scripts/snapshot-cab-bank.ts` (save/diff) is the guard for any future slot probe, and
  it compares only the region's **stable 9-byte prefix** — the tail drifts on its own (the same empty
  slots read `…00 1e 04 03 38…` in the morning and `…00 0d 26 70…` hours later), and a naive full-region
  diff reports 600+ "changes" that are nothing but that drift, hiding any real one inside the noise.
  `scripts/probe-cab-subs.ts` and `scripts/probe-cab-data-read.ts` are the probes themselves.

- **§2.7 server-side cab-IR BYTE LIBRARY — the bytes of IRs uploaded THROUGH Axis, persisted so they can
  be moved / restored / re-uploaded without re-finding the file (2026-10-08).** A user-cab **move** is a
  device-side no-op: FM3-Edit performs it as two container uploads (the IR re-uploaded to the
  destination, the source blanked — §2.5d), so it needs the IR's **bytes**. Today those bytes exist only
  in the file the user picked, so once an IR is on the unit the stack cannot move it without the user
  re-finding that file.
  **Storage:** no database, no new dependency. On a verified upload (`ok` — every frame acked AND the
  close answered `0x00`) the driver's `uploadCabIr` result triggers `saveCabIr`, which writes one
  metadata doc per entry into the store collection `cabLibrary` (an index — `store/cabLibrary.json` on
  Node) and the bytes as a **content-addressed blob** `cab-<sha256>` in the same blob dir the preset
  versions use (identical bytes stored once). It survives a restart and skips + counts a malformed /
  partial entry rather than crashing a read; an entry whose blob is missing lists `available:false` and
  its bytes route 404s. A **discarded** upload (`ok:false`) is NOT stored — a move must not resurrect an
  IR the unit rejected. **Cap: 200 entries** (`CAB_LIBRARY_MAX`), oldest evicted, blob GC'd when
  unreferenced.
  **SCOPE — the failure mode this avoids:** there is no slot-DATA read (§2.5f), so the library holds
  **only IRs uploaded through Axis**. IRs that were already on the unit (e.g. a preloaded "Res Psycho"
  set) are **not** captured. Every surface says so verbatim (`CAB_LIBRARY_SCOPE`) — never "your cab
  library". **Shipped:** `ForgeFX/server/src/runtime/cabLibrary.ts`, `GET /cab/library` +
  `GET /cab/library/:id/bytes` on **both** route surfaces (plain GET reads — not in the write gate, not
  in the remote-refusal list), and Axis's IR strip gains a **"⇄ Move stored IR…"** panel that prefers the
  stored bytes (no file needed) and, when the source slot is not in the library, says so and falls back
  to ＋ Import IR… — never fails silently (`src/lib/cabMove.ts`).

- **§2.5c why a user IR shows no NAME in Axis (FM3-Edit shows one) — ANSWERED (2026-10-08).** Three
  measured facts, none of them an oversight to "just fix":
  1. the offline cache builds `cabIrs` from **FACTORY 1/2 + LEGACY only** — `CAB_BANK_IDS` deliberately
     excludes `0xfff3+`, the USER/SCRATCHPAD banks, because those are the donor unit's own IR library
     rather than shippable firmware content;
  2. the live path, `Gen3Driver#liveCabIrs()`, was an unimplemented **stub returning `{}`**;
  3. the cab/IR bank name tables are the device's **special table records (ids ≥ 0xff00) and are NOT
     param-addressable** — probed live: a definition query for `0xfff0` (FACTORY 1) and `0xfff3` (USER)
     at the CABINET block answers nothing, exactly as `liveWalk`'s coverage note documents ("absent from
     a live walk by design"). They exist only in the device's `.cache` byte dump.
  Neither capture contains the name in ANY simple encoding (ascii / 5-septet / 8-per-7, all offsets), the
  per-slot `0x4B` reply is state not text, and the device's own formatted value for a user-cab reference
  is `"#11"` — an index, not a name.

  **CORRECTED 2026-10-08 (the earlier conclusion below was WRONG, and the test that disproved it took 60
  seconds).** A silent, correctly-checksummed container named **`LYKOS-NAMETEST`** was written to `U0030`
  **over the wire** — FM3-Edit had never seen the file, never uploaded it, and had no record of it. Andy
  opened FM3-Edit and it displayed **`LYKOS-NAMETEST`**. So **the editor reads the name FROM THE UNIT.** The
  previous conclusion — "FM3-Edit most plausibly displays names from its own local record" — is retracted.
  Consequences, all measured:
  1. **A user-cab name IS readable over the wire**, by some path this stack has not found yet. Axis therefore
     *can* eventually show real names; it is a missing read, not a device limitation.
  2. **The `0x4B` region IS the name — SOLVED, and shipped (2026-10-08, same day).** The field carries the
     slot's 32-character name **re-packed for the wire**: each character as an 8-bit value, concatenated
     **MSB-first** into one bit stream, and re-split into **7-bit septets** (SysEx payload bytes must be
     ≤ 0x7F), **NUL-terminated**. 32×8 = 256 bits → 37 septets, which is exactly the payload from byte 15 to
     its end (52 − 15 = 37) — the geometry closes. `decodeCabSlotName` recovers it exactly, verified against
     three independent names: `U0001`/`U0012` = `LT TV Mix 7` (owner-confirmed), `U0030` = `LYKOS-NAMETEST`
     (written over the wire by the stack), and `U0002`–`U0011` = `Res Psycho 1`…`Res Psycho X` (nobody on this
     host had supplied those, so the decode is not circular).
     **THIS REPLACES a wrong interim conclusion.** It was argued twice that the region could not be a name —
     "the encoding is undecoded, it is a fingerprint", then "a hash-like fingerprint, proved by the fact that
     a name with E/S/T repeated twice each shows 14 distinct region bytes". That proof was invalid: a
     **bit-level repack destroys per-character byte alignment**, so repeated letters have no reason to
     repeat. A wrong inference, presented as proof, is the thing to remember here.
     The earlier editor question is answered by the same field: the editor's cab list is served entirely by
     `sub=0x4B` (1088 queries at connect — every slot), so it reads the names exactly as this decoder does.
     One more measured detail: an **EMPTY** slot is not blank in that field — the unit puts the literal text
     `<EMPTY>` there, followed by stale bytes that vary between slots and sessions. Only a `populated` slot's
     name means anything, and the decoder stops at the terminator.
  3. **Shipped for this:** `decodeCabSlotName` (+ golden cases on the device's own bytes, including the
     `<EMPTY>` case), the name on `CabSlotStateResult` through the driver and `GET /cab/slots`, and the Axis
     cab picker now showing **real names** for USER slots instead of "name not readable on this firmware".
  4. **§2.5g REORDER — SOLVED, and it needs no new opcode (2026-10-08).** A capture of FM3-Edit's
     *"move to a different slot"* contains **two ordinary container uploads and nothing else** that explains
     it: the IR re-uploaded to the DESTINATION (`U0015` ← container named `LT TV Mix 7`, close `4d 12 08 5d
     03`, consistent with its content) and **the SOURCE erased** (`U0012` ← a container whose name is
     `"<EMPTY>"`). Both were reassembled from the capture and parsed with the shipped codec.
     **Consequences, all measured:**
     - **Reorder = upload to the destination + erase the source.** Both halves are already shipped
       (`uploadCabIr`, the blank-container delete, each verified by the unit's own read-back), so a move is
       implementable for any IR whose BYTES we have — no device-side move op exists to look for;
     - **no slot-data read is involved.** The editor had the IR's bytes from its own library. That is exactly
       why it can move a cab whose samples nobody can read, and why we cannot: the missing piece is the
       bytes, not the opcode. `Res Psycho`-style cabs stay unmovable from here until a slot-data read exists
       (still: none found);
     - it also **explains the `"<EMPTY>"` text** in an empty slot's name field — that is the editor's erase
       marker, stored by the unit, and it is why the name decoder must stop at the terminator;
     - one frame remains **UNEXPLAINED and unprobed**: `fn=0x19` payload `0b 10 16` (once, during the move).
       Recorded as a candidate "cab list changed" notice. It is NOT needed for the move, and it will not be
       sent blind — that is how the unit ended up in its bootloader earlier today.
  5. **What is still capture-gated is now `fn=0x19` alone.** The three sub-actions the editor uses constantly
     (`0x03`, `0x1b`, `0x2e`) are answered by the unit and were narrowed again in ROUND 12 — see the
     "surfaced by the capture analyser" item above and `ForgeFX/server/test/fixtures/query-subs-decode/`. None
     of them is needed for names or for reorder. `U0030` still holds `LYKOS-NAMETEST` and
     should be erased when convenient (blank-container delete, read-back verified).


**Blocked on a capture / fixture (offline-possible once provided)**

- **§2.2 per-preset Performance Pages — SOLVED, READ *and* WRITE, verified on the unit (2026-10-08).**
  Layout (measured from a fixture pair — factory 406 vs the owner's copy 409 — by diffing the DECOMPRESSED
  bodies; the raw dump diff is useless, the body is compressed):
  ```
  10 × u16 EFFECT ids  →  10 × u16 PARAM ids  →  32-byte-stride EFFECT labels  →  32-byte-stride PARAM labels
  ```
  `parsePerformPage` decodes it and `patchPerformSlot` writes it (tables AND labels in one write, because a
  round trip that patched the tables alone left a STALE label — structurally valid, showing the wrong name).
  Verified against a six-control fixture the owner built for the purpose (preset 410): Amp master volume,
  Delay feedback, Reverb pre-delay, Reverb bypass, Cab proximity frequency, Drive tone decode to eids
  58/70/66/66/62/118 with pids 11/10/9/22/41/2 — and pid 22 = REVERB_BYPASS is confirmed independently by
  the profile. Seven golden cases pin the parser to that preset's own bytes.
  **THE WRITE DIRECTION IS REAL:** a host-written, host-RECOMPRESSED dump was sent to the EDIT BUFFER and the
  unit took it — the patched page read back from the device, twice (the second run restored the original).
  This retires the long-standing caveat that a serialised dump was file-backup bytes rather than a verified
  device-bound restore stream. Caveats that remain, all measured: a label longer than 32 bytes is truncated
  ("Proximity Frequ"); an unassigned slot keeps STALE text from whatever occupied it before, so a label means
  nothing unless the eid is non-zero.
  **READ is now shown in Axis (2026-10-08):** the read-only route `GET /preset/perform` (shared handler
  `performPageH` in `runtime/handlers.ts`, registered on BOTH surfaces) and the Device-Tools panel
  `PerformPagePanel.svelte` (via `forgefx.performPage()`). Unassigned slots (effectId 0) render as
  "unassigned" — their stale label text is blanked by `performPageView.ts`.
  **The WRITE side is wired end to end (2026-10-08).** `PUT /preset/perform/:slot` (shared handler
  `performSlotH`, registered on BOTH surfaces) exposes `DeviceDriver.setPerformSlot`, which is the proven
  path as a method: dump the edit buffer → `patchPerformSlot` (ids AND labels together) → recompress +
  rebuild + retarget to 0x3FFF → re-send frame-by-frame → **re-dump**. `ok` is the READ-BACK verdict, never
  the absence of a rejection: a dump the unit silently ignores answers `{ok:false, reason:'readback-mismatch'}`
  with the slot as it actually reads. The route is a DEVICE WRITE (read-only server → 403) and is
  deliberately NOT `?dryRun`-previewable, because its frames come from a device READ — a dry-run request is
  refused 400 `dry-run-unsupported` instead of being answered with a guaranteed decode failure, and a
  preview can never fall through to a live write. `PerformPagePanel.svelte` gained a per-slot editor: an
  EMPTY input means "leave this field alone" (never "write an empty label"), a non-numeric id is dropped
  rather than sent, all-empty refuses to send, and after the write the panel re-reads the page and reports
  the verdict — including "not saved; reloading the preset discards it", because the target is the EDIT
  BUFFER. Suite: `drivers/perform-slot-write` (9 cases, incl. a stateful mock whose edit buffer ADOPTS what
  is written to it — a mock that always echoes the patch would make every write look accepted).
  Writing a *saved* preset slot is still proven only as far as the edit buffer is.
- **§3.8 per-preset FC/switch definitions — DECODED AND WIRED (2026-10-08/09).** The block layout and the
  per-switch target field are measured (see §3.8 at the end of this file); the route (`GET /preset/switches`,
  `PUT /preset/switches/:index`), the shared handlers on BOTH route tables and the Axis panel all landed, and
  the write rides the same recompress/reframe/retarget path the perform-page WRITE proves. The write bound is
  per FIELD, not per index — see §3.8. The last two table rows are still unlabelled (cosmetic; bounded to
  indices 8-16).
- **§2.3 Setlists — PARKED.** Requires an FC-6/FC-12 foot controller, which Andy does not have.
  Do not build.

**Blocked on a new endpoint (out of scope for the offline rounds)**

- **§2.7 Preset+Cab bundle / `.bnk` bank import** — the only cab route is `GET /cab/irs` (names);
  nothing returns user-cab **bytes**, so a bundle needs a new server route.

**Honestly impossible (no wire op — keep the honest negatives)**

- **PRESET-slot** Move / Delete everywhere (no preset slot-erase op — §3.4; note this says nothing about
  **cab** slots, see §2.5d), **Clear Preset** (no clear/init op),
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
