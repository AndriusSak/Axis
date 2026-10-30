import { describe, it, expect } from 'vitest';
import { liveRowsFor, liveMetersAfterTick, hasStaleLiveMeters, type MeterRowLike } from './liveMeters';

// Reported: with METER on and audio playing, switching METER off left every tile frozen at its last
// level — the poll stopped, but nothing cleared the map, and the tile kept painting the last reading
// (with the same live styling). These pin the two rules that end it.

const row = (effectId: number, norm = 0.7): MeterRowLike => ({ effectId, norm, db: -6 });

describe('liveRowsFor — a switched-off meter paints nothing', () => {
  it('returns the rows while metering is on', () => {
    const map = { 58: [row(58)] };
    expect(liveRowsFor(map, 58, true)).toHaveLength(1);
  });

  it('returns undefined for the SAME map once metering is off (the freeze)', () => {
    const map = { 58: [row(58)] };
    expect(liveRowsFor(map, 58, false)).toBeUndefined();
  });

  it('treats an empty or absent entry as no reading, never as zero', () => {
    expect(liveRowsFor({ 58: [] }, 58, true)).toBeUndefined();
    expect(liveRowsFor({}, 58, true)).toBeUndefined();
  });
});

describe('liveMetersAfterTick — a tick that could not read keeps nothing', () => {
  it('keeps the map when the tick really polled', () => {
    const map = { 58: [row(58)], 62: [row(62)] };
    expect(liveMetersAfterTick(map, true)).toBe(map);
  });

  it('empties the map when the tick could not poll (metering off / no open block / library)', () => {
    expect(liveMetersAfterTick({ 58: [row(58)] }, false)).toEqual({});
  });

  it('does not allocate a new map when there was nothing to clear', () => {
    const empty = {};
    expect(liveMetersAfterTick(empty, false)).toBe(empty);
  });
});

describe('hasStaleLiveMeters', () => {
  it('is true only while a disabled meter still holds readings', () => {
    expect(hasStaleLiveMeters({ 58: [row(58)] }, false)).toBe(true);
    expect(hasStaleLiveMeters({ 58: [row(58)] }, true)).toBe(false);
    expect(hasStaleLiveMeters({}, false)).toBe(false);
  });
});
