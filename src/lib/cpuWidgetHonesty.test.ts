import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The FM3 DOES report CPU: a float32 at decoded payload offset 12 of the fn 01 / sub 2E reply (the
// payload is 7-bit MSB-first). The widget must show that number — not the old byte-37 fragment, and
// not "n/a". The decode itself is pinned by forgefx-midi's telemetry golden (65.74 vs a 65.7 panel).
const widget = readFileSync(new URL('./axis-workbench/widgets/AxisWorkbenchWidget.svelte', import.meta.url), 'utf8');

describe('live CPU widget is honest', () => {
  it('shows the live percentage instead of a disabled placeholder', () => {
    expect(widget).not.toMatch(/CPU_SOURCE_UNAVAILABLE/);
    // One decimal, like the panel: 65.7 %, not a rounded integer.
    expect(widget).toMatch(/cpu\.toFixed\(1\)/);
    // The number is visible at the default AND compact sizes (only `mini` may drop it).
    expect(widget).toMatch(/\{#if !mini\}[\s\S]{0,200}cpu-val/);
  });

  it('only calls a reading live while it is fresh', () => {
    expect(widget).toMatch(/const cpuLive = \$derived\(cpu != null && cpuAgeS != null/);
    expect(widget).toMatch(/CPU_STALE_MS/);
  });

  it('explains the source in the tooltip', () => {
    expect(widget).toMatch(/the FM3 reports it with the meter poll/);
  });
});
