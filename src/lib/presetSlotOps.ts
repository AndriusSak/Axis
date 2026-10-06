// Device-slot copy / swap composed over the EXISTING preset endpoints (audit §2.4).
//
// The FM3 (gen-3) wire protocol exposes NO "copy slot N → M" op, and no slot-erase op at all — so the
// only provable librarian operations are the ones we can build from primitives the server already
// serves:
//   1. dump a slot            POST /preset/backup  { location }   → { bytes }   (forgefx.presetBackup)
//   2. load bytes → EDIT BUFFER  POST /preset/load  (octet-stream)             (forgefx.loadBytes)
//      (the gen-3 driver retargets the dump's 0x77 header to the 0x3FFF edit-buffer sentinel, so a
//       dump captured from slot N loads into the buffer instead of re-storing to N)
//   3. store the buffer → slot  POST /preset/store { number }                  (forgefx.store)
//
// That is the "swap-by-store" sequence the audit prescribes (dump → load → store). It is DESTRUCTIVE
// to the edit buffer (the caller warns first) but leaves the device's current slot unchanged.
//
// NOT provable, and therefore NOT implemented here (the UI keeps honest disabled stubs):
//   - MOVE  (copy + clear the source slot)  → needs a slot-erase primitive the protocol lacks
//   - DELETE (clear a slot)                 → same missing erase primitive
//
// Pure + dependency-free so it unit-tests under the repo's node-env vitest (no .svelte mount). The
// client is injected; the editor supplies one bound to forgefx.

/** The three device capabilities the copy-by-store sequence needs (all true on gen-3 / FM3). */
export interface SlotOpsCaps {
  /** Device answers POST /preset/backup (verbatim .syx dump of a slot). */
  backupDump: boolean;
  /** Device answers POST /preset/load (load raw bytes into the edit buffer). */
  loadBytes: boolean;
  /** Device answers POST /preset/store (write the edit buffer to a slot). */
  store: boolean;
}

/** Minimal transport the ops drive — implemented over forgefx in the editor. */
export interface SlotOpsClient {
  dump(location: number): Promise<{ bytes: number[] | Uint8Array }>;
  load(bytes: Uint8Array): Promise<{ ok: boolean }>;
  store(location: number): Promise<{ ok: boolean }>;
}

export class SlotOpError extends Error {}

/** True when every primitive the copy-by-store sequence needs is advertised by the device. */
export function canCopySlots(caps: SlotOpsCaps): boolean {
  return !!(caps.backupDump && caps.loadBytes && caps.store);
}

const toU8 = (b: number[] | Uint8Array): Uint8Array => (b instanceof Uint8Array ? b : Uint8Array.from(b));

function assertSlots(from: number, to: number): void {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0) {
    throw new SlotOpError('slot numbers must be non-negative integers');
  }
  if (from === to) throw new SlotOpError('source and target are the same slot');
}

/** Duplicate one device slot into another: dump source → load into the edit buffer → store to target.
 *  Leaves the source slot intact; overwrites the target slot and the edit buffer. */
export async function duplicateSlot(client: SlotOpsClient, from: number, to: number): Promise<void> {
  assertSlots(from, to);
  const { bytes } = await client.dump(from);
  await client.load(toU8(bytes));
  const r = await client.store(to);
  if (!r.ok) throw new SlotOpError(`store to slot ${to} was rejected`);
}

/** Swap two device slots: capture both dumps first, then write each into the other slot. The dump-both-
 *  first order is essential — writing slot A before capturing B would destroy B's content. */
export async function swapSlots(client: SlotOpsClient, a: number, b: number): Promise<void> {
  assertSlots(a, b);
  const aBytes = toU8((await client.dump(a)).bytes);
  const bBytes = toU8((await client.dump(b)).bytes);
  await client.load(bBytes);
  const ra = await client.store(a);
  if (!ra.ok) throw new SlotOpError(`store to slot ${a} was rejected`);
  await client.load(aBytes);
  const rb = await client.store(b);
  if (!rb.ok) throw new SlotOpError(`store to slot ${b} was rejected`);
}
