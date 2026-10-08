import { describe, it, expect } from 'vitest';
import { planLibraryMove, libraryCanMove, CAB_LIBRARY_NOTE } from './cabMove';
import type { CabLibraryListEntry } from './types';

const entry = (user: number | null, available = true): CabLibraryListEntry => ({
  id: `cab-1-${String(user ?? 0).padStart(8, '0')}`,
  name: `IR ${user}`,
  page: 0x10,
  index: 0,
  user,
  length: 24680,
  sha256: 'a'.repeat(64),
  savedAt: 1,
  source: 'upload',
  available
});

describe('cab move planner (§2.7)', () => {
  it('prefers the stored entry for the source slot', () => {
    const r = planLibraryMove([entry(7)], 7, 12);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entry.user).toBe(7);
  });

  it('refuses a source that is not in the library, and says why (never silent)', () => {
    const r = planLibraryMove([entry(7)], 8, 12);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not in the IR library/);
  });

  it('ignores an entry whose bytes are unavailable (a missing blob cannot be moved)', () => {
    expect(planLibraryMove([entry(7, false)], 7, 12).ok).toBe(false);
    expect(libraryCanMove([entry(7, false)], 7)).toBe(false);
  });

  it('rejects equal source/destination, and out-of-range slots', () => {
    expect(planLibraryMove([entry(5)], 5, 5).ok).toBe(false);
    expect(planLibraryMove([entry(5)], 0, 5).ok).toBe(false);
    expect(planLibraryMove([entry(5)], 5, 513).ok).toBe(false);
    expect(planLibraryMove([entry(5)], 1.5, 5).ok).toBe(false);
  });

  it('libraryCanMove agrees with the planner', () => {
    expect(libraryCanMove([entry(3)], 3)).toBe(true);
    expect(libraryCanMove([entry(3)], 4)).toBe(false);
  });

  it('carries the honest scope wording (uploaded through Axis, not "your library")', () => {
    expect(CAB_LIBRARY_NOTE).toMatch(/uploaded through Axis/);
    expect(CAB_LIBRARY_NOTE.toLowerCase()).not.toMatch(/your (cab )?library|all your/);
  });
});
