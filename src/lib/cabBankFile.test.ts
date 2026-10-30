import { describe, expect, it } from 'vitest';
import {
  CAB_BANK_FILE_KIND,
  base64ToBytes,
  buildCabBankFile,
  bytesToBase64,
  describeImportPlan,
  parseCabBankFile,
  planBankImport,
  serializeCabBankFile,
  type CabBankFile
} from './cabBankFile';

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7) & 0xff);

describe('base64', () => {
  it('round-trips the lengths that matter, including the padding cases', () => {
    for (const n of [0, 1, 2, 3, 600, 1024, 10345]) {
      const b = bytes(n);
      expect(Array.from(base64ToBytes(bytesToBase64(b)))).toEqual(Array.from(b));
    }
  });

  it('refuses a non-base64 character instead of silently truncating', () => {
    expect(() => base64ToBytes('AAAA$AAA')).toThrow(/outside the alphabet/);
    expect(() => base64ToBytes('AAA')).toThrow(/multiple of 4/);
  });
});

describe('buildCabBankFile', () => {
  it('sorts slots, keeps the name, and records NOT-HELD slots explicitly', () => {
    const f = buildCabBankFile({
      device: 'FM3',
      bank: 'User Bank 1',
      now: '2026-10-30T00:00:00.000Z',
      slots: [
        { user: 3, name: 'MARSHALL', bytes: bytes(10) },
        { user: 1, name: 'FENDER', bytes: null }
      ]
    });
    expect(f.kind).toBe(CAB_BANK_FILE_KIND);
    expect(f.slots.map((s) => s.user)).toEqual([1, 3]);
    expect(f.slots[0]!.bytes).toBeNull();
    expect(f.slots[1]!.bytes).toBe(bytesToBase64(bytes(10)));
  });

  it('keeps ONE copy per slot — the server library holds every upload of a slot', () => {
    const f = buildCabBankFile({
      device: 'FM3',
      bank: 'B',
      slots: [
        { user: 17, name: 'OLD', bytes: bytes(8), savedAt: '2026-10-01T00:00:00.000Z' },
        { user: 17, name: 'NEW', bytes: bytes(9), savedAt: '2026-10-30T00:00:00.000Z' },
        { user: 18, name: 'NAME-ONLY', bytes: null, savedAt: '2026-10-30T00:00:00.000Z' },
        { user: 18, name: 'WITH-BYTES', bytes: bytes(4), savedAt: '2026-10-02T00:00:00.000Z' }
      ]
    });
    expect(f.slots.map((s) => [s.user, s.name])).toEqual([
      [17, 'NEW'],
      [18, 'WITH-BYTES']
    ]);
    // and the strict parser accepts it
    expect(parseCabBankFile(serializeCabBankFile(f)).ok).toBe(true);
  });

  it('treats an empty payload as not held (never a zero-byte IR)', () => {
    const f = buildCabBankFile({ device: 'FM3', bank: 'B', slots: [{ user: 2, name: 'X', bytes: new Uint8Array(0) }] });
    expect(f.slots[0]!.bytes).toBeNull();
  });
});

describe('parseCabBankFile', () => {
  const good = buildCabBankFile({
    device: 'FM3',
    bank: 'User Bank 1',
    now: '2026-10-30T00:00:00.000Z',
    slots: [{ user: 1, name: 'A', bytes: bytes(12) }]
  });

  it('round-trips an archive Axis wrote', () => {
    const r = parseCabBankFile(serializeCabBankFile(good));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file.slots).toEqual(good.slots);
  });

  it('refuses a foreign JSON file', () => {
    const r = parseCabBankFile('{"presets":[]}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not an axis\.cabset file/);
  });

  it('refuses another version rather than guessing at it', () => {
    const r = parseCabBankFile(JSON.stringify({ ...good, version: 2 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unsupported version 2/);
  });

  it('refuses a duplicate slot', () => {
    const r = parseCabBankFile(JSON.stringify({ ...good, slots: [good.slots[0], good.slots[0]] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/appears twice/);
  });

  it('refuses a slot number outside the user bank', () => {
    const r = parseCabBankFile(JSON.stringify({ ...good, slots: [{ user: 513, name: 'X', bytes: null }] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid user number/);
  });

  it('refuses corrupt base64 instead of importing a truncated IR', () => {
    const r = parseCabBankFile(JSON.stringify({ ...good, slots: [{ user: 1, name: 'X', bytes: '!!!!' }] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/outside the alphabet/);
  });

  it('refuses non-JSON text', () => {
    expect(parseCabBankFile('not a file').ok).toBe(false);
  });
});

describe('planBankImport', () => {
  const file: CabBankFile = buildCabBankFile({
    device: 'FM3',
    bank: 'User Bank 1',
    slots: [
      { user: 1, name: 'HELD-1', bytes: bytes(8) },
      { user: 2, name: 'NOT-HELD', bytes: null },
      { user: 3, name: 'HELD-3', bytes: bytes(9) }
    ]
  });

  it('packs into consecutive empty destinations and skips what it cannot write', () => {
    const rows = planBankImport(file, { occupied: [] });
    expect(rows.map((r) => [r.source, r.dest, r.action])).toEqual([
      [1, 1, 'upload'],
      [2, 2, 'skip-not-held'],
      [3, 3, 'upload']
    ]);
    expect(describeImportPlan(rows)).toBe('2 to empty slots, 1 skipped');
  });

  it('never overwrites unless asked, and says which slot blocked it', () => {
    const rows = planBankImport(file, { occupied: [2], destStart: 2 });
    const blocked = rows.find((r) => r.source === 1)!;
    expect(blocked.dest).toBe(2);
    expect(blocked.action).toBe('skip-occupied');
    expect(blocked.reason).toMatch(/slot 2 already holds an IR/);
    expect(blocked.bytes).not.toBeNull(); // the payload is known — the row was skipped, not lost
  });

  it('overwrites when the caller opts in, and labels the row as such', () => {
    const rows = planBankImport(file, { occupied: [1], overwrite: true });
    expect(rows[0]!.action).toBe('overwrite');
  });

  it('keeps the archive numbering when asked, and refuses a destination outside the bank', () => {
    const rows = planBankImport(file, { occupied: [], keepSlots: true });
    expect(rows.map((r) => r.dest)).toEqual([1, 2, 3]);
    // slot 512 is legal for the first row; the next one would be 513 and is refused, not wrapped
    const two = planBankImport(
      { ...file, slots: [{ user: 1, name: 'A', bytes: 'AAAA' }, { user: 2, name: 'B', bytes: 'AAAA' }] },
      { occupied: [], destStart: 512 }
    );
    expect(two[0]!.dest).toBe(512);
    expect(two[0]!.action).toBe('upload');
    expect(two[1]!.action).toBe('skip-occupied');
    expect(two[1]!.reason).toMatch(/outside the user bank/);
  });

  it('yields no rows for an empty archive (no invented uploads)', () => {
    expect(planBankImport({ ...file, slots: [] }, { occupied: [] })).toEqual([]);
  });
});
