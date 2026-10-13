import { describe, it, expect } from 'vitest';
import type { CabIrUploadResult, CabLibraryListEntry, CabSlotClearResult, CabSlotStateResult } from './types';
import {
  CAB_BANKS,
  RENAME_NOT_HELD_REASON,
  bankCoverage,
  buildBankGrid,
  destinationOf,
  libraryByUser,
  manageActions,
  planClear,
  planMove,
  rangeSelection,
  runClear,
  runMove,
  runRename,
  toggleSelection,
  uploadAndVerify,
  uploadVerdict,
  userSlotOf,
  validateCabName,
  waveformPoints,
  type CabManagerIo,
  type GridSlot
} from './cabManagerOps';

const entry = (user: number, over: Partial<CabLibraryListEntry> = {}): CabLibraryListEntry => ({
  id: `cab-${user}-aaaaaaaa`,
  name: `IR ${user}`,
  page: 0x10 + Math.floor((user - 1) / 128),
  index: (user - 1) % 128,
  user,
  length: 10345,
  sha256: 'a'.repeat(64),
  savedAt: 1000 + user,
  source: 'upload',
  available: true,
  ...over
});
const row = (page: number, index: number, populated: boolean | null, extra: Partial<CabSlotStateResult> = {}): CabSlotStateResult => ({
  index,
  page,
  populated,
  flag: populated === true ? 1 : populated === false ? 0x7f : null,
  nameRegion: [],
  ...extra
});
const bank0 = CAB_BANKS[0]!;
const fullRows = (page: number, pop: (i: number) => boolean | null): CabSlotStateResult[] =>
  Array.from({ length: 128 }, (_, i) => row(page, i, pop(i)));

const slotsOf = (grid: GridSlot[]) => new Map(grid.map((s) => [s.user, s]));

describe('slot arithmetic', () => {
  it('maps page/index ⇄ user slot across all four banks', () => {
    expect(userSlotOf(0x10, 0)).toBe(1);
    expect(userSlotOf(0x13, 127)).toBe(512);
    expect(userSlotOf(0x20, 0)).toBeNull(); // scratchpad is not a user slot
    expect(destinationOf(129)).toEqual({ page: 0x11, index: 0 });
    expect(destinationOf(512)).toEqual({ page: 0x13, index: 127 });
    expect(() => destinationOf(513)).toThrow(/outside 1..512/);
    expect(CAB_BANKS.map((b) => [b.first, b.last])).toEqual([[1, 128], [129, 256], [257, 384], [385, 512]]);
  });
});

describe('buildBankGrid — populated / empty only, with the drift region never a name', () => {
  it('derives status from the unit read, and marks unscanned / unreadable distinctly from empty', () => {
    const rows = [row(0x10, 0, true), row(0x10, 1, false), row(0x10, 2, null, { note: 'reply did not parse' })];
    const g = buildBankGrid(bank0, rows, []);
    expect(g).toHaveLength(128);
    expect(g.slice(0, 4).map((s) => s.status)).toEqual(['populated', 'empty', 'unreadable', 'unscanned']);
    expect(g[2]!.note).toBe('reply did not parse');
  });

  it('a row carrying a decoded name or a name region contributes NOTHING name-like to the cell', () => {
    const g = buildBankGrid(bank0, [row(0x10, 0, true, { name: 'SECRET NAME', nameRegion: [1, 2, 3] })], []);
    expect(JSON.stringify(g[0])).not.toContain('SECRET NAME');
    expect(Object.keys(g[0]!).sort()).toEqual(['held', 'heldStale', 'index', 'page', 'status', 'user']);
  });

  it('rows from another page are ignored', () => {
    const g = buildBankGrid(bank0, [row(0x11, 0, true)], []);
    expect(g[0]!.status).toBe('unscanned');
  });

  it('joins the library by user slot, newest first, and flags a stale copy when the unit reads the slot empty', () => {
    const lib = [entry(1, { savedAt: 10, name: 'old' }), entry(1, { id: 'cab-1-bbbbbbbb', savedAt: 20, name: 'new' }), entry(2)];
    const g = buildBankGrid(bank0, [row(0x10, 0, true), row(0x10, 1, false)], lib);
    expect(g[0]!.held?.name).toBe('new');
    expect(g[0]!.heldStale).toBe(false);
    expect(g[1]!.held?.name).toBe('IR 2');
    expect(g[1]!.heldStale).toBe(true);
    expect(libraryByUser([entry(3, { available: false })]).size).toBe(0);
  });
});

describe('bankCoverage — the count is derived from the rendered cells (complete, or the cap is disclosed)', () => {
  it('a fully read bank says so, and unreadable slots are NOT counted as empty', () => {
    const g = buildBankGrid(bank0, fullRows(0x10, (i) => (i < 10 ? true : i === 11 ? null : false)), []);
    const c = bankCoverage(bank0, g);
    expect(c).toMatchObject({ populated: 10, empty: 117, unreadable: 1, read: 128, total: 128, complete: true });
    expect(c.line).toContain('1 unreadable (not counted as empty)');
    expect(c.line).toContain('all 128 slots read');
  });
  it('an unscanned bank reports 0 read; a partial one reports the remainder as unscanned', () => {
    expect(bankCoverage(bank0, buildBankGrid(bank0, null, [])).line).toContain('not scanned yet — 128 slots unscanned');
    const part = bankCoverage(bank0, buildBankGrid(bank0, [row(0x10, 0, true), row(0x10, 1, false)], []));
    expect(part).toMatchObject({ read: 2, complete: false });
    expect(part.line).toContain('2 of 128 slots read — the rest are unscanned');
  });
});

describe('selection', () => {
  it('toggles and keeps the selection sorted; shift-range is inclusive and merges', () => {
    expect(toggleSelection([5, 9], 7)).toEqual([5, 7, 9]);
    expect(toggleSelection([5, 7, 9], 7)).toEqual([5, 9]);
    expect(rangeSelection([2], 10, 7)).toEqual([2, 7, 8, 9, 10]);
  });
});

describe('manageActions — every disabled control carries its exact reason', () => {
  const ready = { deviceReady: true, stagedImport: false, busy: false };
  const held = buildBankGrid(bank0, [row(0x10, 0, true), row(0x10, 1, true), row(0x10, 2, false)], [entry(1)]);
  const slots = slotsOf(held);

  it('no device → everything disabled with the device reason', () => {
    const a = manageActions([1], slots, { ...ready, deviceReady: false, deviceReason: 'No device is connected' });
    for (const k of ['clear', 'move', 'rename', 'import'] as const) expect(a[k]).toEqual({ enabled: false, reason: 'No device is connected' });
  });
  it('busy disables everything', () => {
    expect(manageActions([1], slots, { ...ready, busy: true }).clear.reason).toMatch(/still running/);
  });
  it('nothing selected: clear/move/rename say what to do; import stays available', () => {
    const a = manageActions([], slots, ready);
    expect(a.clear.reason).toBe('Select at least one slot to clear.');
    expect(a.move.reason).toBe('Select at least one slot to move.');
    expect(a.rename.reason).toBe('Select exactly one slot to rename.');
    expect(a.import.enabled).toBe(true);
  });
  it('rename is enabled ONLY for a populated slot Axis holds; any other slot gets the no-slot-data-read reason', () => {
    expect(manageActions([1], slots, ready).rename.enabled).toBe(true);
    expect(manageActions([2], slots, ready).rename).toEqual({ enabled: false, reason: RENAME_NOT_HELD_REASON });
    expect(manageActions([200], slots, ready).rename.reason).toBe(RENAME_NOT_HELD_REASON); // unscanned / unknown slot
    expect(manageActions([1, 2], slots, ready).rename.reason).toBe('Select exactly one slot to rename.');
    expect(RENAME_NOT_HELD_REASON).toMatch(/no slot-data read/);
  });
  it('a held copy of a slot the unit now reads EMPTY does not enable rename', () => {
    const g = slotsOf(buildBankGrid(bank0, [row(0x10, 0, false)], [entry(1)]));
    expect(manageActions([1], g, ready).rename.enabled).toBe(false);
  });
  it('a staged import makes rename available with no selection (it renames the staged file)', () => {
    expect(manageActions([], slots, { ...ready, stagedImport: true }).rename.enabled).toBe(true);
  });
});

describe('planClear', () => {
  it('separates slots that will lose an IR from ones already empty; dedupes and drops out-of-range', () => {
    const p = planClear([3, 1, 1, 2, 999], slots());
    expect(p.users).toEqual([1, 2, 3]);
    expect(p.willErase).toEqual([1, 3]); // 3 is unscanned → treated as possibly populated
    expect(p.noop).toEqual([2]);
    function slots() {
      return slotsOf(buildBankGrid(bank0, [row(0x10, 0, true), row(0x10, 1, false)], []));
    }
  });
});

describe('planMove', () => {
  const g = slotsOf(buildBankGrid(bank0, [row(0x10, 0, true), row(0x10, 1, true), row(0x10, 9, true)], []));
  const lib = [entry(1), entry(2)];
  it('maps ascending sources onto consecutive destinations and flags overwrites', () => {
    const p = planMove([2, 1], 10, g, lib);
    expect(p.ok).toBe(true);
    expect(p.items.map((i) => [i.from, i.to, i.overwrites])).toEqual([[1, 10, true], [2, 11, false]]);
    expect(p.runnable).toHaveLength(2);
    expect(p.needsFile).toHaveLength(0);
  });
  it('a source NOT in the library is named with the exact reason and the import fallback', () => {
    const p = planMove([1, 2, 50], 100, g, lib);
    expect(p.runnable.map((i) => i.from)).toEqual([1, 2]);
    expect(p.needsFile).toHaveLength(1);
    const r = p.needsFile[0]!.source;
    expect(r.kind).toBe('file');
    if (r.kind === 'file') {
      expect(r.reason).toMatch(/slot 50 is not in the IR library — it was not uploaded through Axis/);
      expect(r.reason).toMatch(/Import the IR file to slot 102 instead/);
    }
  });
  it('refuses a destination that overlaps a selected source, runs past 512, or is not a slot', () => {
    expect(planMove([1, 2], 2, g, lib)).toMatchObject({ ok: false });
    expect(planMove([1, 2], 2, g, lib).blocker).toMatch(/also a selected source/);
    expect(planMove([1, 2, 3], 511, g, lib).blocker).toMatch(/run past slot 512/);
    expect(planMove([1], 0, g, lib).blocker).toMatch(/destination must be a user slot/);
    expect(planMove([], 5, g, lib).blocker).toMatch(/at least one source/);
  });
});

// ── the verdict: the unit's own answer ─────────────────────────────────────────────────────────────
const acks = (over: Partial<CabIrUploadResult['acks']> = {}): CabIrUploadResult['acks'] => ({ start: true, data: 8, expectedData: 8, end: true, complete: true, codes: [], ...over });
const up = (over: Partial<CabIrUploadResult> = {}): CabIrUploadResult => ({
  ok: true, discarded: false, closeCode: 0, reason: '', name: 'X', modelId: 0x11, frames: 10, bytes: 10345, sampleSlots: 2040, renamed: false, dest: { page: 0x10, index: 0 }, acks: acks(), ...over
});

describe('uploadVerdict — never "uploaded" from acks alone', () => {
  it('stored needs ok + close 0x00 + the slot reading POPULATED', () => {
    const v = uploadVerdict(up(), row(0x10, 0, true), 1, false);
    expect(v).toMatchObject({ kind: 'stored', ok: true, closeCode: 0, readback: true });
    expect(v.text).toMatch(/was empty before/);
  });
  it('an already-populated destination says the read-back shows occupancy, not content', () => {
    expect(uploadVerdict(up(), row(0x10, 0, true), 1, true).text).toMatch(/occupancy, not content/);
  });
  it('0x13 is DISCARDED even though every frame was acknowledged', () => {
    const v = uploadVerdict(up({ ok: false, discarded: true, closeCode: 0x13 }), null, 1, false);
    expect(v).toMatchObject({ kind: 'discarded', ok: false });
    expect(v.text).toMatch(/DISCARDED.*0x13.*untouched/);
  });
  it('accepted close but the slot still reads EMPTY is a failure, not a success', () => {
    expect(uploadVerdict(up(), row(0x10, 0, false), 1, false)).toMatchObject({ kind: 'failed', ok: false, readback: false });
  });
  it('accepted close but an unreadable slot is UNCONFIRMED (not ok)', () => {
    expect(uploadVerdict(up(), row(0x10, 0, null, { note: 'no state reply' }), 1, false)).toMatchObject({ kind: 'unconfirmed', ok: false });
    expect(uploadVerdict(up(), null, 1, false).kind).toBe('unconfirmed');
  });
  it('missing acks is a failure that reports the counts', () => {
    const v = uploadVerdict(up({ ok: false, closeCode: null, acks: acks({ data: 5, complete: false, end: false }) }), null, 1, false);
    expect(v.kind).toBe('failed');
    expect(v.text).toMatch(/5\/8 data frames/);
  });
});

// ── sequencers over a fake IO ──────────────────────────────────────────────────────────────────────
function fakeIo(script: {
  uploadOk?: (user: number) => boolean;
  closeFor?: (user: number) => number;
  populatedAfter?: (user: number) => boolean | null;
  clearOk?: (user: number) => boolean;
  bytes?: Uint8Array | null;
}) {
  const calls: string[] = [];
  const io: CabManagerIo = {
    upload: async (_b, user) => {
      calls.push(`upload:${user}`);
      const close = script.closeFor?.(user) ?? 0;
      const ok = (script.uploadOk?.(user) ?? true) && close === 0;
      return up({ ok, discarded: close === 0x13, closeCode: close });
    },
    readSlot: async (user) => {
      calls.push(`read:${user}`);
      const p = script.populatedAfter?.(user);
      return row(0x10, user - 1, p === undefined ? true : p);
    },
    clear: async (user) => {
      calls.push(`clear:${user}`);
      const ok = script.clearOk?.(user) ?? true;
      return { ok, index: user - 1, page: 0x10, wasPopulated: true, nowPopulated: ok ? false : true, closeCode: 0, reason: ok ? 'cleared' : 'still populated' } as CabSlotClearResult;
    },
    libraryBytes: async () => (script.bytes === undefined ? new Uint8Array([1, 2, 3]) : script.bytes)
  };
  return { io, calls };
}

describe('runMove — copy first, erase the source ONLY after a confirmed store', () => {
  const plan = () => planMove([1, 2], 10, new Map(), [entry(1), entry(2)]).items;
  it('happy path: upload → read-back → clear per item, in order', async () => {
    const { io, calls } = fakeIo({});
    const out = await runMove(plan(), io);
    expect(out.map((o) => o.state)).toEqual(['moved', 'moved']);
    expect(calls.filter((c) => c.startsWith('upload') || c.startsWith('clear'))).toEqual(['upload:10', 'clear:1', 'upload:11', 'clear:2']);
  });
  it('a DISCARDED copy never erases its source and halts the rest', async () => {
    const { io, calls } = fakeIo({ closeFor: (u) => (u === 10 ? 0x13 : 0) });
    const out = await runMove(plan(), io);
    expect(out.map((o) => o.state)).toEqual(['failed', 'skipped']);
    expect(out[0]!.text).toMatch(/DISCARDED/);
    expect(out[0]!.text).toMatch(/Source slot 1 was NOT erased/);
    expect(calls.some((c) => c.startsWith('clear'))).toBe(false);
  });
  it('a copy the unit reads back as EMPTY never erases the source', async () => {
    const { io, calls } = fakeIo({ populatedAfter: () => false });
    const out = await runMove(plan(), io);
    expect(out[0]!.state).toBe('failed');
    expect(calls.some((c) => c.startsWith('clear'))).toBe(false);
  });
  it('a copy whose read-back is unreadable (unconfirmed) never erases the source', async () => {
    const { io, calls } = fakeIo({ populatedAfter: () => null });
    expect((await runMove(plan(), io))[0]!.state).toBe('failed');
    expect(calls.some((c) => c.startsWith('clear'))).toBe(false);
  });
  it('a source that fails to erase is reported as copied-not-erased (in BOTH slots) and halts', async () => {
    const { io } = fakeIo({ clearOk: () => false });
    const out = await runMove(plan(), io);
    expect(out.map((o) => o.state)).toEqual(['copied-not-erased', 'skipped']);
    expect(out[0]!.text).toMatch(/exists in BOTH slots/);
  });
  it('missing stored bytes sends nothing', async () => {
    const { io, calls } = fakeIo({ bytes: null });
    const out = await runMove(plan(), io);
    expect(out[0]!.state).toBe('failed');
    expect(calls.some((c) => c.startsWith('upload'))).toBe(false);
  });
  it('an item whose source is not held is skipped with its reason, never attempted', async () => {
    const { io, calls } = fakeIo({});
    const items = planMove([77], 5, new Map(), []).items;
    const out = await runMove(items, io);
    expect(out[0]).toMatchObject({ state: 'skipped' });
    expect(out[0]!.text).toMatch(/not in the IR library/);
    expect(calls).toEqual([]);
  });
});

describe('uploadAndVerify / runClear / runRename', () => {
  it('a transport error becomes a failed verdict (no throw)', async () => {
    const io: CabManagerIo = { ...fakeIo({}).io, upload: async () => { throw new Error('port busy'); } };
    const o = await uploadAndVerify(io, new Uint8Array(1), 3);
    expect(o.verdict).toMatchObject({ kind: 'failed', ok: false });
    expect(o.verdict.text).toMatch(/port busy/);
  });
  it('runClear continues past a failure and reports each slot', async () => {
    const { io } = fakeIo({ clearOk: (u) => u !== 2 });
    const out = await runClear([1, 2, 3], io);
    expect(out.map((o) => o.ok)).toEqual([true, false, true]);
    expect(out[1]!.text).toMatch(/Slot 2: still populated/);
  });
  it('runRename rewrites the bytes with the codec rewrite, uploads to the same slot, and reports the verdict', async () => {
    const { io, calls } = fakeIo({});
    let got = '';
    const r = await runRename(new Uint8Array([9]), 7, 'New Name', io, (b, n) => { got = n; return new Uint8Array([...b, 1]); });
    expect(got).toBe('New Name');
    expect(r.verdict?.ok).toBe(true);
    expect(calls).toContain('upload:7');
  });
  it('runRename refuses an invalid name before sending anything', async () => {
    const { io, calls } = fakeIo({});
    const r = await runRename(new Uint8Array([9]), 7, 'x'.repeat(33), io, (b) => b);
    expect(r.verdict).toBeNull();
    expect(calls).toEqual([]);
    expect(validateCabName('Café')).toMatch(/7-bit/);
    expect(validateCabName('')).toMatch(/Enter a name/);
    expect(validateCabName('Mesa 4x12')).toBe('');
  });
});

describe('waveformPoints', () => {
  it('maps +1 / −1 to the top / bottom edge and a flat zero to the middle', () => {
    const peak = waveformPoints([1, -1], 100, 60, 1).split(' ');
    expect(peak.map((p) => Number(p.split(',')[1]))).toEqual([0, 60]);
    const flat = waveformPoints([0, 0, 0, 0], 100, 60, 2).split(' ');
    expect(new Set(flat.map((p) => p.split(',')[1]))).toEqual(new Set(['30.00']));
    expect(waveformPoints([], 100, 60)).toBe('');
  });
});
