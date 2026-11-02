// Estimated DSP load for presets we can only read OFFLINE.
//
// The device's real CPU is a live poll (`editor.cpu`, float32 at decoded payload offset 12 of the
// `fn 0x01 / sub 0x2E` reply — see cpuGauge.ts). A stored preset does not carry that number, so a
// browser listing stored presets can only estimate from block makeup. Every surface must therefore
// keep the "~" it renders with.
//
// Two rules, both learned from a wrong number on screen:
//
//  1. ONE estimator for every surface. The monolith browser summed per-family weights while the docked
//     workbench list used `blockCount * 3.5`, so the SAME preset read ~48 % in one and ~14 % in the other
//     — and a 4-block Input/Amp/Cab/Output preset can land either side of the colour break.
//  2. Colour with the HARDWARE's thresholds (`cpuGauge`: 85 % warn, 100 % mute), never an invented 62/80.
//     Invented thresholds are what painted perfectly healthy presets amber.
//
// The weights are relative DSP cost per family (amp/cab/reverb/pitch dominate; IO and EQ are cheap) and
// are a complexity indicator, not a measurement.

import { cpuColor } from './cpuGauge';

export const EST_CPU_BASE = 8;

export const EST_CPU_WEIGHT: Record<string, number> = {
  amp: 28,
  cab: 12,
  reverb: 12,
  pitch: 14,
  multitap: 10,
  megatap: 10,
  synth: 9,
  delay: 8,
  flanger: 5,
  phaser: 5,
  chorus: 5,
  rotary: 5,
  formant: 5,
  tremolo: 4,
  filter: 4,
  drive: 4,
  enhancer: 3,
  comp: 3,
  wah: 3,
  ringmod: 3,
  geq: 2,
  peq: 2,
  gate: 2,
  volume: 1,
  input: 0,
  output: 0
};

/** Estimated load (%) from the placed blocks' family slugs. Unknown families cost 4. */
export function estimatePresetCpu(slugs: readonly (string | null | undefined)[]): number {
  let sum = EST_CPU_BASE;
  for (const slug of slugs) sum += EST_CPU_WEIGHT[(slug ?? '').toLowerCase()] ?? 4;
  return Math.max(20, Math.min(99, Math.round(sum)));
}

/** Colour for an estimated load — the same hardware thresholds the live meter uses. */
export const estCpuColor = cpuColor;
