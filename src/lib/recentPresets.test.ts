import { describe, it, expect } from 'vitest';
import {
  RECENT_KEY,
  RECENT_CAP,
  parseRecents,
  pushRecent,
  loadRecents,
  saveRecents,
  recordRecent,
  clearRecents,
  removeRecent,
  recentEntryId,
  type RecentPreset,
  type RecentStorage
} from './recentPresets';

/** In-memory storage standing in for localStorage. */
function mem(): RecentStorage & { dump(): Record<string, string> } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => void m.set(k, v),
    dump: () => Object.fromEntries(m)
  };
}

const rec = (id: string, name = id, at = 0): RecentPreset => ({ id, number: id.startsWith('dev:') ? Number(id.slice(4)) : null, name, source: id.startsWith('dev:') ? 'device' : 'file', at });

describe('recentPresets — MRU list', () => {
  it('recentEntryId builds the library entry id for a device slot', () => {
    expect(recentEntryId('device', 12)).toBe('dev:12');
    expect(recentEntryId('device', -1)).toBeNull();
    expect(recentEntryId('file', null, 'file:a.syx')).toBe('file:a.syx');
  });

  it('pushRecent unshifts, dedupes by id and caps the list', () => {
    let list: RecentPreset[] = [];
    for (let i = 0; i < RECENT_CAP + 5; i++) list = pushRecent(list, rec(`dev:${i}`));
    expect(list).toHaveLength(RECENT_CAP);
    expect(list[0].id).toBe(`dev:${RECENT_CAP + 4}`); // newest first
    // re-pushing an existing id moves it to the front without duplicating or growing
    const again = pushRecent(list, rec('dev:20'));
    expect(again).toHaveLength(RECENT_CAP);
    expect(again[0].id).toBe('dev:20');
    expect(again.filter((r) => r.id === 'dev:20')).toHaveLength(1);
  });

  it('parseRecents drops junk and keeps well-formed entries', () => {
    expect(parseRecents(null)).toEqual([]);
    expect(parseRecents('not json')).toEqual([]);
    expect(parseRecents('{"a":1}')).toEqual([]);
    const raw = JSON.stringify([{ id: 'dev:1', name: 'A', number: 1, source: 'device', at: 5 }, { nope: true }, null]);
    expect(parseRecents(raw)).toEqual([{ id: 'dev:1', name: 'A', number: 1, source: 'device', at: 5 }]);
  });

  it('recordRecent persists across a fresh load and stamps `at`', () => {
    const s = mem();
    const before = Date.now();
    const list = recordRecent({ id: 'dev:7', number: 7, name: 'Seven', source: 'device', at: 0 }, s);
    expect(list[0].id).toBe('dev:7');
    expect(list[0].at).toBeGreaterThanOrEqual(before);
    expect(loadRecents(s)[0].name).toBe('Seven'); // persisted under RECENT_KEY
    expect(s.dump()[RECENT_KEY]).toBeTruthy();
  });

  it('clearRecents empties the store; removeRecent removes one id', () => {
    const s = mem();
    recordRecent(rec('dev:1'), s);
    recordRecent(rec('dev:2'), s);
    expect(removeRecent('dev:1', s).map((r) => r.id)).toEqual(['dev:2']);
    clearRecents(s);
    expect(loadRecents(s)).toEqual([]);
  });

  it('saveRecents + loadRecents round-trip and loadRecents caps to RECENT_CAP', () => {
    const s = mem();
    const many = Array.from({ length: RECENT_CAP + 3 }, (_, i) => rec(`dev:${i}`));
    saveRecents(many, s);
    expect(loadRecents(s)).toHaveLength(RECENT_CAP);
  });
});
