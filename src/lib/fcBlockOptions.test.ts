import { describe, expect, it } from 'vitest';
import {
  FC_BLOCK_VALUE_SPACE_CAVEAT,
  fcBlockOptionFor,
  fcBlockOptions,
  fcBlockOptionsIncluding,
  fcBlockRawHint,
  fcBlockRosterNote,
  namedFcBlockCount,
  type FcBlockCell
} from './fcBlockOptions';

// The roster is the preset's PLACED BLOCKS as `GET /preset/grid` serves them (name + effectId), with a
// routing shunt and an unnamed row alongside, so every honesty branch is exercised.
const CELLS: FcBlockCell[] = [
  { effectId: 0x25, name: 'Input 1' },
  { effectId: 0x2e, name: 'Comp 1' },
  { effectId: 0x3a, name: 'Amp 1' },
  { effectId: 0x2a, name: 'Output 1' },
  { effectId: 0x2b, name: 'Output 2' },
  { effectId: 1000, name: 'Shunt', isShunt: true },
  { effectId: 0x5e, name: '' }
];

describe('fcBlockOptions (the FC “Effect” block picker)', () => {
  it('names every placed block from the grid, in chain order, and drops shunts', () => {
    const opts = fcBlockOptions(CELLS);
    // 5 named blocks + the one unnamed placed row; the shunt is not an assignable effect.
    expect(opts.map((o) => o.label)).toEqual(['Input 1', 'Comp 1', 'Amp 1', 'Output 1', 'Output 2', 'id 94 (unnamed)']);
    expect(opts.map((o) => o.value)).toEqual([0x25, 0x2e, 0x3a, 0x2a, 0x2b, 0x5e]);
    // the shunt id is nowhere in the offer
    expect(opts.some((o) => o.value === 1000)).toBe(false);
  });

  it('marks a placed block the grid did not name, rather than leaving a blank', () => {
    const unnamed = fcBlockOptions(CELLS).find((o) => o.value === 0x5e)!;
    expect(unnamed.named).toBe(false);
    expect(unnamed.label).toBe('id 94 (unnamed)');
    // namedFcBlockCount counts only the rows the grid actually named
    expect(namedFcBlockCount(CELLS)).toBe(5);
  });

  it('de-duplicates by effectId so a repeated served row cannot appear twice', () => {
    const twice = fcBlockOptions([{ effectId: 7, name: 'Delay 1' }, { effectId: 7, name: 'Delay 1' }]);
    expect(twice).toHaveLength(1);
  });
});

describe('fcBlockOptionFor (the row’s CURRENT value)', () => {
  it('names a value that matches a placed block', () => {
    expect(fcBlockOptionFor(CELLS, 0x2e)).toEqual({ value: 0x2e, label: 'Comp 1', named: true });
  });

  it('MARKS an id that matches no placed block — never a bare number', () => {
    // 0 is exactly what the panel showed (the `?? 0` fallback); it must read as a marker, not a block.
    const miss = fcBlockOptionFor(CELLS, 0);
    expect(miss.named).toBe(false);
    expect(miss.label).toBe('id 0 (not a placed block)');
    // and the marker is NOT one of the roster names
    expect(fcBlockOptions(CELLS).some((o) => o.label === miss.label)).toBe(false);
  });

  it('names a shunt id for what it is, not as a block', () => {
    expect(fcBlockOptionFor(CELLS, 1000)).toEqual({ value: 1000, label: 'id 1000 (a routing shunt)', named: false });
  });

  it('shows an UNREAD value as —, never as 0', () => {
    expect(fcBlockOptionFor(CELLS, null)).toEqual({ value: 0, label: '—', named: false });
  });
});

describe('fcBlockOptionsIncluding (the roster + the row’s own value)', () => {
  it('keeps the row’s current value always selectable, marked when unplaced', () => {
    const opts = fcBlockOptionsIncluding(CELLS, 0);
    const current = opts.find((o) => o.value === 0)!;
    expect(current.named).toBe(false);
    expect(current.label).toBe('id 0 (not a placed block)');
    // …and a value already in the roster is not duplicated.
    expect(fcBlockOptionsIncluding(CELLS, 0x2e).filter((o) => o.value === 0x2e)).toHaveLength(1);
  });

  it('with a null value returns exactly the roster (the component adds the “no value read” placeholder)', () => {
    expect(fcBlockOptionsIncluding(CELLS, null)).toEqual(fcBlockOptions(CELLS));
  });
});

describe('fcBlockRosterNote discloses the cap', () => {
  it('counts the placed blocks and names the shunts it withheld', () => {
    const note = fcBlockRosterNote(CELLS);
    expect(note).toContain('6 placed blocks');
    expect(note).toContain('1 routing shunt');
    expect(note).toContain('5 named by the grid');
    expect(note).toContain('matches no placed block');
  });

  it('states an empty/absent roster instead of pretending a short list is complete', () => {
    expect(fcBlockRosterNote([])).toContain('roster is empty');
    // shunts alone are not "placed blocks"
    expect(fcBlockRosterNote([{ effectId: 1000, name: 'Shunt', isShunt: true }])).toContain('roster is empty');
  });
});

describe('fcBlockRawHint keeps the raw id AVAILABLE but secondary', () => {
  it('renders id + hex', () => {
    expect(fcBlockRawHint(46)).toBe('id 46 (0x2e)');
    expect(fcBlockRawHint(null)).toBe('id —');
  });
  it('states the value-space caveat plainly', () => {
    expect(FC_BLOCK_VALUE_SPACE_CAVEAT).toContain('has not been decoded');
  });
});
