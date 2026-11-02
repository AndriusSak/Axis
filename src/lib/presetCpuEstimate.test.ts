import { describe, expect, it } from 'vitest';
import { EST_CPU_BASE, EST_CPU_WEIGHT, estCpuColor, estimatePresetCpu } from './presetCpuEstimate';
import { CPU_MUTE_PCT, CPU_WARN_PCT } from './cpuGauge';

describe('estimated preset CPU', () => {
  it('reads a minimal Input/Amp/Cab/Output preset as a healthy load', () => {
    // The shape Andy reported as "yellow CPU with only 4 blocks". 8 + 0 + 28 + 12 + 0 = 48.
    expect(estimatePresetCpu(['input', 'amp', 'cab', 'output'])).toBe(48);
    expect(estCpuColor(48)).toBe('#33c46b');
  });

  it('is the same number the monolith browser and the docked list show', () => {
    // Both surfaces call this one function; the old split (weight sum vs blockCount*3.5) read the same
    // preset as ~48 % and ~14 %.
    const slugs = ['input', 'amp', 'cab', 'reverb', 'output'];
    expect(estimatePresetCpu(slugs)).toBe(EST_CPU_BASE + 28 + 12 + 12);
  });

  it('charges unknown families the default weight and ignores case', () => {
    expect(estimatePresetCpu(['AMP'])).toBe(EST_CPU_BASE + EST_CPU_WEIGHT.amp);
    // 8 + 4 = 12, under the 20 % floor an idle unit sits at anyway.
    expect(estimatePresetCpu(['mystery'])).toBe(20);
    expect(estimatePresetCpu([null, undefined])).toBe(20);
  });

  it('clamps to a plausible range', () => {
    expect(estimatePresetCpu([])).toBe(20);
    expect(estimatePresetCpu(Array(40).fill('amp'))).toBe(99);
  });

  it('colours with the hardware thresholds, never an invented 62/80', () => {
    expect(estCpuColor(CPU_WARN_PCT - 1)).toBe('#33c46b');
    expect(estCpuColor(CPU_WARN_PCT)).toBe('#f5a623');
    expect(estCpuColor(CPU_MUTE_PCT)).toBe('#d6543f');
  });
});
