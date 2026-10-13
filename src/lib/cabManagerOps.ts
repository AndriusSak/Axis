// Manage Cabs — the pure half: slot-grid derivation, selection, action availability (with the exact
// reason for every disabled control), move/clear/rename/restore plans, and the sequencers that run them
// through an injected IO. No runes, DOM or network imports (source-guarded), so every decision here is
// unit-tested and the .svelte surface only renders it.
//
// WHAT THE UNIT CAN AND CANNOT DO (measured — do not "improve" this into a fake):
//   • per-slot STATE read: populated / empty. That is all this module renders about a slot. The slot-state
//     reply also carries a name-derived region; it is deliberately never shown as a name here.
//   • there is NO slot-DATA read, so Axis can only act on IR bytes it HOLDS — the server-side library of IRs
//     uploaded through Axis, or a file the user picks. Move/restore/rename therefore need held bytes.
//   • delete = a blank container; move = re-upload to the destination THEN blank the source.
//   • an upload's close frame is a content check: 0x13 = DISCARDED, 0x00 = stored. Acks alone prove nothing.
import type { CabIrUploadResult, CabLibraryListEntry, CabSlotClearResult, CabSlotStateResult } from './types';

/** One request sweeps at most this many slots (the server caps `GET /cab/slots` at 128). */
export const CAB_SWEEP_CAP = 128;
export const CAB_USER_SLOTS = 512;
export const CAB_BANK_PAGES = [0x10, 0x11, 0x12, 0x13] as const;

/** The disclosure that must sit next to the grid: a rendered list is complete or its cap is disclosed. */
export const CAB_GRID_DISCLOSURE =
  'The unit is read one bank (128 slots) per request — its sweep cap — so all 512 user slots take four scans. A slot that has not been scanned yet is shown as “unscanned”, never as empty.';

/** The scope line for the server-side byte library — must stay visible wherever the library is shown. */
export const CAB_LIBRARY_SCOPE_FALLBACK =
  'IRs uploaded through Axis. Slots that already held an IR when the stack first saw the unit are not captured — the firmware has no slot-samples read.';

/** The exact reason a rename of an arbitrary slot is impossible (shown on the disabled control). */
export const RENAME_NOT_HELD_REASON =
  'Axis can only rename an IR it holds. This slot has no stored copy (it was not uploaded through Axis) and the unit has no slot-data read, so its container cannot be rewritten. Import the .syx/.wav file instead and set its name there.';

export const CAB_CONVERSION_UNVALIDATED_BADGE = 'UNVALIDATED — converted IRs have not been tried on a unit yet';

export interface BankInfo {
  index: number;
  page: number;
  first: number;
  last: number;
  label: string;
}

export const CAB_BANKS: readonly BankInfo[] = CAB_BANK_PAGES.map((page, index) => ({
  index,
  page,
  first: index * 128 + 1,
  last: index * 128 + 128,
  label: `Bank ${index + 1} · ${index * 128 + 1}–${index * 128 + 128}`
}));

export function userSlotOf(page: number, index: number): number | null {
  if (!CAB_BANK_PAGES.includes(page as (typeof CAB_BANK_PAGES)[number])) return null;
  if (!Number.isInteger(index) || index < 0 || index > 127) return null;
  return (page - 0x10) * 128 + index + 1;
}

export function destinationOf(user: number): { page: number; index: number } {
  if (!isUserSlot(user)) throw new Error(`user slot ${user} is outside 1..${CAB_USER_SLOTS}`);
  return { page: 0x10 + Math.floor((user - 1) / 128), index: (user - 1) % 128 };
}

export function isUserSlot(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= CAB_USER_SLOTS;
}

// ── the grid ────────────────────────────────────────────────────────────────────────────────────

/** `unscanned` = never read this session; `unreadable` = the unit gave no parseable answer (NOT empty). */
export type SlotStatus = 'populated' | 'empty' | 'unreadable' | 'unscanned';

export interface GridSlot {
  user: number;
  page: number;
  index: number;
  status: SlotStatus;
  /** Why a slot is `unreadable`, when the server said. */
  note?: string;
  /** The newest available library entry for this slot, or null. */
  held: CabLibraryListEntry | null;
  /** A library entry exists but the unit now reads the slot EMPTY — the stored copy is stale for this slot. */
  heldStale: boolean;
}

/** Newest-first index of available library entries by user slot. */
export function libraryByUser(entries: readonly CabLibraryListEntry[]): Map<number, CabLibraryListEntry> {
  const m = new Map<number, CabLibraryListEntry>();
  for (const e of [...entries].sort((a, b) => b.savedAt - a.savedAt)) {
    if (e.available && e.user != null && !m.has(e.user)) m.set(e.user, e);
  }
  return m;
}

/**
 * The 128 grid cells of one bank. `rows` is the unit's `GET /cab/slots` answer for that bank's page (or
 * null when not scanned). A row only ever contributes a populated/empty/unreadable state — never a name.
 */
export function buildBankGrid(
  bank: BankInfo,
  rows: readonly CabSlotStateResult[] | null,
  library: readonly CabLibraryListEntry[]
): GridSlot[] {
  const byIndex = new Map<number, CabSlotStateResult>();
  for (const r of rows ?? []) if (r.page === bank.page) byIndex.set(r.index, r);
  const held = libraryByUser(library);
  return Array.from({ length: 128 }, (_, index) => {
    const user = bank.first + index;
    const r = byIndex.get(index);
    const status: SlotStatus = !r ? 'unscanned' : r.populated === true ? 'populated' : r.populated === false ? 'empty' : 'unreadable';
    const entry = held.get(user) ?? null;
    return {
      user,
      page: bank.page,
      index,
      status,
      ...(r && r.populated === null && r.note ? { note: r.note } : {}),
      held: entry,
      heldStale: !!entry && status === 'empty'
    };
  });
}

export interface BankCoverage {
  read: number;
  total: number;
  populated: number;
  empty: number;
  unreadable: number;
  complete: boolean;
  line: string;
}

/** Counts for the header line, derived from the SAME array the grid renders (so a count cannot disagree with it). */
export function bankCoverage(bank: BankInfo, grid: readonly GridSlot[]): BankCoverage {
  const populated = grid.filter((s) => s.status === 'populated').length;
  const empty = grid.filter((s) => s.status === 'empty').length;
  const unreadable = grid.filter((s) => s.status === 'unreadable').length;
  const read = populated + empty + unreadable;
  const total = grid.length;
  const complete = read === total;
  const line = complete
    ? `${bank.label}: ${populated} populated · ${empty} empty${unreadable ? ` · ${unreadable} unreadable (not counted as empty)` : ''} — all ${total} slots read`
    : read === 0
      ? `${bank.label}: not scanned yet — ${total} slots unscanned`
      : `${bank.label}: ${read} of ${total} slots read — the rest are unscanned`;
  return { read, total, populated, empty, unreadable, complete, line };
}

// ── selection ───────────────────────────────────────────────────────────────────────────────────

export function toggleSelection(sel: readonly number[], user: number): number[] {
  return sel.includes(user) ? sel.filter((u) => u !== user) : [...sel, user].sort((a, b) => a - b);
}

/** Inclusive range between two slots (shift-click), merged into the current selection. */
export function rangeSelection(sel: readonly number[], a: number, b: number): number[] {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const out = new Set(sel);
  for (let u = lo; u <= hi; u++) out.add(u);
  return [...out].sort((x, y) => x - y);
}

// ── action availability: every disabled control carries its exact reason ─────────────────────────

export interface ActionState {
  enabled: boolean;
  /** '' when enabled. */
  reason: string;
}

export interface ManageContext {
  /** The device is connected and serves cab IR upload (`caps.cabIrs`). */
  deviceReady: boolean;
  deviceReason?: string;
  /** An IR file (or converted container) is currently staged in the import panel. */
  stagedImport: boolean;
  busy: boolean;
}

export interface ManageActions {
  clear: ActionState;
  move: ActionState;
  rename: ActionState;
  import: ActionState;
}

const ok: ActionState = { enabled: true, reason: '' };
const no = (reason: string): ActionState => ({ enabled: false, reason });

export function manageActions(
  selection: readonly number[],
  slots: ReadonlyMap<number, GridSlot>,
  ctx: ManageContext
): ManageActions {
  const gate = !ctx.deviceReady
    ? no(ctx.deviceReason ?? 'No device is connected, or it does not serve user-cab IR upload.')
    : ctx.busy
      ? no('Another cab operation is still running.')
      : null;
  const need = (what: string) => (selection.length === 0 ? no(`Select at least one slot to ${what}.`) : null);

  const clear = gate ?? need('clear') ?? ok;
  const move = gate ?? need('move') ?? ok;

  let rename: ActionState;
  if (gate) rename = gate;
  else if (selection.length === 0 && ctx.stagedImport) rename = ok; // the staged import carries its own name field
  else if (selection.length !== 1) rename = no('Select exactly one slot to rename.');
  else {
    const s = slots.get(selection[0]!);
    rename = s?.held && s.status === 'populated' ? ok : no(RENAME_NOT_HELD_REASON);
  }

  const imp = gate ?? ok;
  return { clear, move, rename, import: imp };
}

// ── destination state: three states, never a boolean ─────────────────────────────────────────────

/**
 * What a write DESTINATION currently holds, as far as the last scan knows. A destination that has not
 * been scanned (or whose reply did not parse) is `unknown` — NEVER `empty`: an unscanned slot may hold an
 * IR, and a boolean "populated?" silently reports it as harmless to overwrite.
 */
export type DestState = 'populated' | 'empty' | 'unknown';

export function destStateOf(slot: GridSlot | undefined | null): DestState {
  if (!slot) return 'unknown';
  return slot.status === 'populated' ? 'populated' : slot.status === 'empty' ? 'empty' : 'unknown';
}

/** The warning every destination deserves before it is written, or '' when it is a known empty slot. */
export function destWarning(state: DestState, user: number): string {
  return state === 'populated'
    ? `Slot ${user} reads populated — this will overwrite its IR.`
    : state === 'unknown'
      ? `Slot ${user} has not been scanned — it may hold an IR that this will overwrite. Scan its bank first to be sure.`
      : '';
}

// ── source identity: the check that stops a destructive write over a slot refilled outside Axis ────

export interface HoldCheck {
  ok: boolean;
  /** '' when ok; the named reason otherwise. */
  reason: string;
}

/**
 * Verify that a slot STILL holds the IR a library copy came from, before a write that would erase or
 * replace it (Move erases the source; Rename re-uploads over the same slot).
 *
 * WHAT IS ACTUALLY AVAILABLE: the unit has no slot-samples read, so there is no content hash to compare.
 * The per-slot state reply gives a `populated` flag and the slot's own NAME — and `nameRegion` is that
 * same packed name, decoded (`decodeCabSlotName`), NOT a samples-derived fingerprint (measured 2026-10-08:
 * the region follows the NAME, so two IRs with the same name are indistinguishable and a rename changes
 * it). The library entry stores the name AS SENT in the container, so the NAME is the strongest identity
 * the wire offers — comparing it is equivalent to comparing `nameRegion`, and is the check used here.
 *
 * FAIL-CLOSED on every unknown: a slot that cannot be read, reads EMPTY, reads populated with no name, or
 * holds a DIFFERENT name is refused. A name that matches is not proof the samples match (documented limit).
 */
export function verifySlotHolds(slot: CabSlotStateResult | null, expectedName: string): HoldCheck {
  if (!slot) return { ok: false, reason: 'the slot could not be read back' };
  if (slot.populated === null) return { ok: false, reason: `the unit gave no parseable slot state (${slot.note ?? 'no state reply'})` };
  if (slot.populated === false) return { ok: false, reason: 'the slot now reads EMPTY — the IR this copy came from is gone' };
  const name = (slot.name ?? '').replace(/\s+$/, '');
  if (name === '') return { ok: false, reason: 'the slot reads populated but the unit returned no name to match against' };
  if (name !== expectedName.replace(/\s+$/, '')) return { ok: false, reason: `the slot now holds “${name}”, not “${expectedName}”` };
  return { ok: true, reason: '' };
}

// ── plans ───────────────────────────────────────────────────────────────────────────────────────

export interface ClearPlan {
  users: number[];
  /** Slots that currently read populated — the ones where something is actually lost. */
  willErase: number[];
  /** Slots that read empty/unknown — harmless, the blank container is sent anyway. */
  noop: number[];
}

export function planClear(selection: readonly number[], slots: ReadonlyMap<number, GridSlot>): ClearPlan {
  const users = [...new Set(selection)].filter(isUserSlot).sort((a, b) => a - b);
  const willErase = users.filter((u) => slots.get(u)?.status !== 'empty');
  return { users, willErase, noop: users.filter((u) => !willErase.includes(u)) };
}

export interface MoveItem {
  from: number;
  to: number;
  /** Whether the destination will be OVERWRITTEN — three states: `populated`, `empty`, or `unknown`
   *  (unscanned/unreadable, which must be warned about too, never silently treated as empty). */
  destState: DestState;
  /** `library`: bytes held, runnable. `file`: not held — the exact reason, and the import fallback. */
  source: { kind: 'library'; entry: CabLibraryListEntry } | { kind: 'file'; reason: string };
}

export interface MovePlan {
  ok: boolean;
  /** Plan-level refusal (bad destination, overlap, out of range). */
  blocker: string;
  items: MoveItem[];
  runnable: MoveItem[];
  needsFile: MoveItem[];
}

/**
 * Plan moving the selected slots (ascending) onto consecutive slots starting at `destStart`.
 * Refuses a destination range that leaves 1..512 or overlaps a selected SOURCE (a shift-by-one move would
 * overwrite a source before it is copied). Sources not held in the library are listed with the exact reason.
 */
export function planMove(
  selection: readonly number[],
  destStart: number,
  slots: ReadonlyMap<number, GridSlot>,
  library: readonly CabLibraryListEntry[]
): MovePlan {
  const sources = [...new Set(selection)].filter(isUserSlot).sort((a, b) => a - b);
  const fail = (blocker: string): MovePlan => ({ ok: false, blocker, items: [], runnable: [], needsFile: [] });
  if (sources.length === 0) return fail('Select at least one source slot.');
  if (!isUserSlot(destStart)) return fail(`The destination must be a user slot 1–${CAB_USER_SLOTS}.`);
  const last = destStart + sources.length - 1;
  if (last > CAB_USER_SLOTS) return fail(`Moving ${sources.length} slot(s) to ${destStart} would run past slot ${CAB_USER_SLOTS}.`);
  const dests = sources.map((_, i) => destStart + i);
  const clash = dests.find((d) => sources.includes(d));
  if (clash !== undefined) {
    return fail(`Destination slot ${clash} is also a selected source — choose a destination range that does not overlap the selection.`);
  }
  const held = libraryByUser(library);
  const items: MoveItem[] = sources.map((from, i) => {
    const to = dests[i]!;
    const entry = held.get(from);
    return {
      from,
      to,
      destState: destStateOf(slots.get(to)),
      source: entry
        ? { kind: 'library', entry }
        : {
            kind: 'file',
            reason: `slot ${from} is not in the IR library — it was not uploaded through Axis, and the unit cannot read a slot's samples. Import the IR file to slot ${to} instead.`
          }
    };
  });
  return {
    ok: true,
    blocker: '',
    items,
    runnable: items.filter((i) => i.source.kind === 'library'),
    needsFile: items.filter((i) => i.source.kind === 'file')
  };
}

// ── verdict: the unit's own answer, never "uploaded" from acks alone ─────────────────────────────

export type VerdictKind = 'stored' | 'discarded' | 'unconfirmed' | 'failed';

export interface UploadVerdict {
  kind: VerdictKind;
  /** True only for `stored`. */
  ok: boolean;
  text: string;
  closeCode: number | null;
  /** The slot-state read-back after the upload: true/false, null = unreadable/not read. */
  readback: boolean | null;
}

/**
 * Decide what an upload established, from the three things that are evidence: the frame acks, the close
 * code (0x00 stored / 0x13 DISCARDED) and the slot-state read-back. `stored` needs all of them.
 */
export function uploadVerdict(
  r: Pick<CabIrUploadResult, 'ok' | 'discarded' | 'closeCode' | 'acks'>,
  after: CabSlotStateResult | null,
  user: number,
  wasPopulated: boolean | null
): UploadVerdict {
  const closeHex = r.closeCode == null ? 'no answer' : `0x${r.closeCode.toString(16).padStart(2, '0')}`;
  const readback = after ? after.populated : null;
  const base = { closeCode: r.closeCode, readback };
  if (r.discarded || r.closeCode === 0x13) {
    return {
      ...base,
      kind: 'discarded',
      ok: false,
      text: `DISCARDED by the unit — close frame ${closeHex}: the container failed its content check, so nothing was stored (every frame was still acknowledged). Slot ${user} is untouched.`
    };
  }
  if (!r.ok) {
    return {
      ...base,
      kind: 'failed',
      ok: false,
      text: `NOT stored — ${r.acks.data}/${r.acks.expectedData} data frames acknowledged (start ${r.acks.start ? 'yes' : 'no'}, end ${r.acks.end ? 'yes' : 'no'}), close frame ${closeHex}.`
    };
  }
  if (after?.populated === true) {
    return {
      ...base,
      kind: 'stored',
      ok: true,
      text:
        wasPopulated === false
          ? `Stored — close ${closeHex}, and slot ${user} reads POPULATED (it was empty before).`
          : `Stored — close ${closeHex}, and slot ${user} reads populated (it already was, so the read-back shows occupancy, not content).`
    };
  }
  if (after?.populated === false) {
    return {
      ...base,
      kind: 'failed',
      ok: false,
      text: `NOT stored — close ${closeHex} but slot ${user} still reads EMPTY. Treat as failed.`
    };
  }
  return {
    ...base,
    kind: 'unconfirmed',
    ok: false,
    text: `Close ${closeHex} but slot ${user} could not be read back (${after?.note ?? 'no readable state'}) — NOT confirmed; verify on the unit.`
  };
}

// ── the IO seam + sequencers ────────────────────────────────────────────────────────────────────

export interface CabManagerIo {
  upload(bytes: Uint8Array, user: number): Promise<CabIrUploadResult>;
  readSlot(user: number): Promise<CabSlotStateResult | null>;
  clear(user: number): Promise<CabSlotClearResult>;
  libraryBytes(entry: CabLibraryListEntry): Promise<Uint8Array | null>;
}

export interface UploadOutcome {
  verdict: UploadVerdict;
  result: CabIrUploadResult | null;
}

/** before-read → upload → after-read → verdict. A thrown transport error becomes a `failed` verdict. */
export async function uploadAndVerify(io: CabManagerIo, bytes: Uint8Array, user: number): Promise<UploadOutcome> {
  const before = await io.readSlot(user).catch(() => null);
  let result: CabIrUploadResult;
  try {
    result = await io.upload(bytes, user);
  } catch (e) {
    return {
      result: null,
      verdict: {
        kind: 'failed',
        ok: false,
        closeCode: null,
        readback: null,
        text: `Not sent — ${(e as Error).message}`
      }
    };
  }
  const after = result.ok ? await io.readSlot(user).catch(() => null) : null;
  return { result, verdict: uploadVerdict(result, after, user, before?.populated ?? null) };
}

export interface MoveOutcome {
  item: MoveItem;
  state: 'moved' | 'copied-not-erased' | 'failed' | 'refused' | 'skipped';
  text: string;
}

/**
 * Run a move's runnable items in order. Per item, in this order:
 *   1. RE-READ the source slot and REFUSE unless it still holds the IR the library copy came from — Move
 *      would otherwise overwrite the (stale) library copy onto the destination, then ERASE a slot that was
 *      refilled outside Axis. Nothing is written and nothing is erased on a refusal.
 *   2. re-upload the held bytes to the destination;
 *   3. ONLY when the verdict is `stored` blank the source (erasing after an unconfirmed copy could destroy
 *      the only copy).
 * The first failure or refusal halts the run: later items are `skipped`, not attempted.
 */
export async function runMove(items: readonly MoveItem[], io: CabManagerIo): Promise<MoveOutcome[]> {
  const out: MoveOutcome[] = [];
  let halted = '';
  for (const item of items) {
    if (halted) {
      out.push({ item, state: 'skipped', text: `Skipped — ${halted}` });
      continue;
    }
    if (item.source.kind !== 'library') {
      out.push({ item, state: 'skipped', text: item.source.reason });
      continue;
    }
    const entry = item.source.entry;
    const srcSlot = await io.readSlot(item.from).catch(() => null);
    const hold = verifySlotHolds(srcSlot, entry.name);
    if (!hold.ok) {
      halted = `source slot ${item.from} no longer holds “${entry.name}”`;
      out.push({
        item,
        state: 'refused',
        text: `Slot ${item.from} → ${item.to}: REFUSED — ${hold.reason}. Nothing was written and source ${item.from} was NOT erased.`
      });
      continue;
    }
    const bytes = await io.libraryBytes(entry).catch(() => null);
    if (!bytes) {
      halted = `the stored bytes for slot ${item.from} could not be read`;
      out.push({ item, state: 'failed', text: `Slot ${item.from} → ${item.to}: the stored bytes could not be read; nothing was sent.` });
      continue;
    }
    const up = await uploadAndVerify(io, bytes, item.to);
    if (!up.verdict.ok) {
      halted = `slot ${item.from} → ${item.to} did not store`;
      out.push({ item, state: 'failed', text: `Slot ${item.from} → ${item.to}: ${up.verdict.text} Source slot ${item.from} was NOT erased.` });
      continue;
    }
    const c = await io.clear(item.from).catch((e: Error) => ({ ok: false, reason: e.message }) as { ok: boolean; reason: string });
    if (c.ok) {
      out.push({ item, state: 'moved', text: `Slot ${item.from} → ${item.to}: ${up.verdict.text} Source ${item.from} erased — ${c.reason}` });
    } else {
      halted = `source slot ${item.from} did not erase`;
      out.push({
        item,
        state: 'copied-not-erased',
        text: `Slot ${item.from} → ${item.to}: ${up.verdict.text} Source ${item.from} NOT erased — ${c.reason}. The IR now exists in BOTH slots.`
      });
    }
  }
  return out;
}

export interface ClearOutcome {
  user: number;
  ok: boolean;
  text: string;
}

/** Clear each slot in turn (one serial port); a failure is reported and the run continues — clears are independent. */
export async function runClear(users: readonly number[], io: CabManagerIo): Promise<ClearOutcome[]> {
  const out: ClearOutcome[] = [];
  for (const user of users) {
    try {
      const r = await io.clear(user);
      out.push({ user, ok: r.ok, text: `Slot ${user}: ${r.reason}` });
    } catch (e) {
      out.push({ user, ok: false, text: `Slot ${user}: NOT cleared — ${(e as Error).message}` });
    }
  }
  return out;
}

/** A container name the unit can store: 1–32 characters, 7-bit printable ASCII. Returns '' when valid. */
export function validateCabName(name: string): string {
  const chars = [...name];
  if (chars.length === 0) return 'Enter a name.';
  if (chars.length > 32) return `The unit stores 32 characters; this is ${chars.length}.`;
  if (chars.some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) > 0x7e)) return 'Names are 7-bit printable ASCII (no accents or symbols outside it).';
  return '';
}

export interface RenameOutcome {
  verdict: UploadVerdict | null;
  text: string;
}

/**
 * Rename an IR Axis HOLDS: rewrite the name in the container (`rewrite` is the codec's own
 * `renameCabIrSyx`, which also recomputes the close value), upload it over the same slot, verify through
 * the slot-state read-back. The unit's discard check guards the upload: a close that did not match would be
 * answered 0x13 and leave the slot untouched.
 *
 * A rename re-uploads over the SAME slot, so it must not silently substitute content: the slot is RE-READ
 * first and the rename is REFUSED unless it still holds `entry`'s IR (matched by name — see
 * `verifySlotHolds`). A slot refilled outside Axis would otherwise be replaced by the old, renamed bytes.
 */
export async function runRename(
  bytes: Uint8Array,
  user: number,
  newName: string,
  io: CabManagerIo,
  rewrite: (bytes: Uint8Array, name: string) => Uint8Array,
  entry: CabLibraryListEntry
): Promise<RenameOutcome> {
  const bad = validateCabName(newName);
  if (bad) return { verdict: null, text: bad };
  const srcSlot = await io.readSlot(user).catch(() => null);
  const hold = verifySlotHolds(srcSlot, entry.name);
  if (!hold.ok) return { verdict: null, text: `Refused — ${hold.reason}. Nothing was written to slot ${user}.` };
  let renamed: Uint8Array;
  try {
    renamed = rewrite(bytes, newName);
  } catch (e) {
    return { verdict: null, text: `The stored container could not be rewritten: ${(e as Error).message}` };
  }
  const up = await uploadAndVerify(io, renamed, user);
  return { verdict: up.verdict, text: `Rename “${newName}” → slot ${user}: ${up.verdict.text}` };
}

/**
 * An SVG polyline `points` string for a min/max waveform preview: `buckets` columns across `width`, each a
 * vertical line from the bucket's min to its max, drawn as a zig-zag polyline. Pure so it is testable; the
 * preview is for eyeballing a conversion, not a measurement.
 */
export function waveformPoints(samples: ArrayLike<number>, width: number, height: number, buckets = 240): string {
  const n = samples.length;
  if (n === 0 || buckets < 1) return '';
  const mid = height / 2;
  const pts: string[] = [];
  for (let b = 0; b < buckets; b++) {
    const lo = Math.floor((b * n) / buckets);
    const hi = Math.max(lo + 1, Math.floor(((b + 1) * n) / buckets));
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = lo; i < hi && i < n; i++) {
      const v = samples[i]!;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const x = ((b + 0.5) * width) / buckets;
    const clampY = (v: number) => Math.max(0, Math.min(height, mid - v * mid));
    const flip = b % 2 === 0;
    pts.push(`${x.toFixed(2)},${clampY(flip ? mx : mn).toFixed(2)}`, `${x.toFixed(2)},${clampY(flip ? mn : mx).toFixed(2)}`);
  }
  return pts.join(' ');
}
