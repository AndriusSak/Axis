import { describe, it, expect } from 'vitest';
import {
  BLOCK_LIB_FORMAT,
  BLOCK_LIB_VERSION,
  captureEntry,
  recallWrites,
  serializeEntry,
  parseEntry,
  searchEntries,
  renameEntry,
  upsertEntry,
  deleteEntry,
  mergeEntries,
  entryFilename,
  type BlockLibraryEntry,
  type CaptureInput
} from './blockLibrary';
import type { NamedParam, EnumParam } from './types';

const named: NamedParam[] = [
  { id: 1, name: 'Gain', value: 4.5, norm: 0.62, min: 0, max: 10 },
  { id: 2, name: 'Bass', value: -1.2, norm: 0.3, min: -12, max: 12 },
  { name: 'NoId', value: 1, norm: 0.1 }, // unwritable — dropped
  { id: 9, name: 'Type', value: 3, norm: 0.9 }, // reserved — dropped
  { id: 10, name: 'Bypass', value: 0, norm: 0 } // reserved — dropped
];
const enums: EnumParam[] = [
  { id: 20, name: 'Reverb Mix', value: 2, options: [{ value: 0, label: 'Off' }, { value: 2, label: 'High' }] },
  { id: 21, name: 'Scene Ignore', value: 0, options: [{ value: 0, label: 'Off' }, { value: 1, label: 'On' }] }
];

const capture: CaptureInput = {
  id: 'blk:test-1',
  name: 'My Round Lead',
  block: 'Amp 1',
  slug: 'amp',
  type: { value: 7, name: 'Recto 1' },
  channel: 'B',
  named,
  enums,
  now: 1000
};

describe('captureEntry', () => {
  it('captures device-true paramIds, knobs by norm and enums by ordinal', () => {
    const e = captureEntry(capture);
    expect(e.format).toBe(BLOCK_LIB_FORMAT);
    expect(e.version).toBe(BLOCK_LIB_VERSION);
    expect(e.name).toBe('My Round Lead');
    expect(e.block).toBe('Amp 1');
    expect(e.slug).toBe('amp');
    expect(e.type).toEqual({ value: 7, name: 'Recto 1' });
    expect(e.channel).toBe('B');
    expect(e.createdAt).toBe(1000);
    expect(e.updatedAt).toBe(1000);
    expect(e.params).toEqual([
      { id: 1, name: 'Gain', kind: 'knob', value: 0.62 },
      { id: 2, name: 'Bass', kind: 'knob', value: 0.3 },
      { id: 20, name: 'Reverb Mix', kind: 'enum', value: 2 },
      { id: 21, name: 'Scene Ignore', kind: 'enum', value: 0 }
    ]);
  });

  it('drops id-less params and the reserved type/bypass rows without fabricating values', () => {
    const e = captureEntry(capture);
    expect(e.params.some((p) => p.name === 'NoId')).toBe(false);
    expect(e.params.some((p) => p.name === 'Type')).toBe(false);
    expect(e.params.some((p) => p.name === 'Bypass')).toBe(false);
  });

  it('survives a null type (blocks with no model selector)', () => {
    const e = captureEntry({ ...capture, type: null, channel: null });
    expect(e.type).toBeNull();
    expect(e.channel).toBeNull();
  });
});

describe('serialize / parse', () => {
  it('round-trips an entry through JSON', () => {
    const e = captureEntry(capture);
    const back = parseEntry(serializeEntry(e));
    expect(back).toEqual(e);
  });

  it('rejects non-JSON, a foreign format, an unknown version and a broken shape', () => {
    expect(parseEntry('not json')).toBeNull();
    expect(parseEntry('{}')).toBeNull();
    expect(parseEntry(JSON.stringify({ format: 'fm3-edit.blk', version: 1 }))).toBeNull();
    expect(parseEntry(JSON.stringify({ format: BLOCK_LIB_FORMAT, version: 99, id: 'x', name: 'x', block: 'x', slug: null, type: null, channel: null, params: [], createdAt: 0, updatedAt: 0 }))).toBeNull();
    const bad = captureEntry(capture) as unknown as Record<string, unknown>;
    bad.params = [{ id: 1, name: 'x', kind: 'wat', value: 0 }];
    expect(parseEntry(JSON.stringify(bad))).toBeNull();
  });

  it('rejects a params array whose member is missing an id', () => {
    const bad = captureEntry(capture) as unknown as Record<string, unknown>;
    bad.params = [{ name: 'x', kind: 'knob', value: 0 }];
    expect(parseEntry(JSON.stringify(bad))).toBeNull();
  });
});

describe('recallWrites', () => {
  const entry = captureEntry(capture);
  const targetP: NamedParam[] = [{ id: 1, name: 'Gain', value: 0, norm: 0 }, { id: 2, name: 'Bass', value: 0, norm: 0 }];
  const targetE: EnumParam[] = [{ id: 20, name: 'Reverb Mix', value: 0, options: [] }];

  it('plans continuous writes for knobs and discrete writes for enums', () => {
    const w = recallWrites(entry, targetP, targetE);
    expect(w).toContainEqual({ paramId: 1, value: 0.62, continuous: true, name: 'Gain' });
    expect(w).toContainEqual({ paramId: 2, value: 0.3, continuous: true, name: 'Bass' });
    expect(w).toContainEqual({ paramId: 20, value: 2, continuous: false, name: 'Reverb Mix' });
  });

  it('drops ids the target block does not expose (cross-family recall)', () => {
    const w = recallWrites(entry, targetP, []);
    expect(w.some((x) => x.paramId === 20)).toBe(false);
    expect(w.some((x) => x.paramId === 21)).toBe(false);
  });
});

describe('searchEntries', () => {
  const a = captureEntry(capture);
  const b = captureEntry({ ...capture, id: 'blk:test-2', name: 'Clean', block: 'Amp 2', slug: 'amp', type: { value: 1, name: 'Deluxe' }, channel: 'A', named: [{ id: 1, name: 'Gain', value: 0, norm: 0.5 }], enums: [] });

  it('matches on entry name, block, type name and slug, case-insensitively', () => {
    const list = [a, b];
    expect(searchEntries(list, 'round')).toEqual([a]);
    expect(searchEntries(list, 'deluxe')).toEqual([b]);
    expect(searchEntries(list, '')).toEqual(list);
    expect(searchEntries(list, 'amp')).toHaveLength(2);
  });

  it('matches a captured param name (so "gain" finds the lead entry)', () => {
    expect(searchEntries([a, b], 'reverb mix')).toEqual([a]);
  });
});

describe('renameEntry', () => {
  it('trims and bumps updatedAt, keeping createdAt', () => {
    const e = captureEntry(capture);
    const r = renameEntry(e, '  New Name  ', 2000);
    expect(r.name).toBe('New Name');
    expect(r.updatedAt).toBe(2000);
    expect(r.createdAt).toBe(1000);
  });
  it('keeps the old name on an empty rename', () => {
    const e = captureEntry(capture);
    expect(renameEntry(e, '   ', 2000).name).toBe('My Round Lead');
  });
});

describe('upsertEntry / deleteEntry', () => {
  const a = captureEntry(capture);
  const b = captureEntry({ ...capture, id: 'blk:test-2', name: 'Clean', now: 1500 });

  it('replaces an existing entry by id and sorts newest-first', () => {
    const list = upsertEntry(upsertEntry([], a), b);
    expect(list.map((e) => e.id)).toEqual(['blk:test-2', 'blk:test-1']);
    const renamed = renameEntry(a, 'Renamed', 3000);
    const list2 = upsertEntry(list, renamed);
    expect(list2).toHaveLength(2);
    expect(list2[0].name).toBe('Renamed');
  });

  it('deletes by id', () => {
    expect(deleteEntry([a, b], 'blk:test-1').map((e) => e.id)).toEqual(['blk:test-2']);
  });
});

describe('entryFilename', () => {
  it('sanitises the name into a .axblk filename', () => {
    const e = renameEntry(captureEntry(capture), 'Round / Lead: 3', 1000);
    expect(entryFilename(e)).toBe('Round_Lead_3.axblk');
  });
});

describe('mergeEntries', () => {
  const local = captureEntry(capture); // id blk:test-1, updatedAt 1000
  const stale = { ...local, name: 'Old' }; // same id, older
  const backendNewer = captureEntry({ ...capture, id: 'blk:test-1', name: 'Fresh', now: 5000 });

  it('keeps the newer of a duplicate id and returns newest-first', () => {
    const merged = mergeEntries([stale], [backendNewer]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('Fresh');
  });

  it('unions distinct ids', () => {
    const other = captureEntry({ ...capture, id: 'blk:x', name: 'Other', now: 2000 });
    expect(mergeEntries([local], [other]).map((e) => e.id)).toEqual(['blk:x', 'blk:test-1']);
  });
});
