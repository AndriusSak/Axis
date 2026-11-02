import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The FM3's CPU is not in the status page Axis polls (measured 2026-11-02 against the panel: a 4-block
// preset read 88 on the wire while the panel read 22 %). Until a real source exists the widget must not
// print a number, or it will paint healthy presets amber again.
const widget = readFileSync(new URL('./axis-workbench/widgets/AxisWorkbenchWidget.svelte', import.meta.url), 'utf8');

describe('live CPU widget is honest', () => {
  it('is switched off at the source', () => {
    expect(widget).toMatch(/const CPU_SOURCE_UNAVAILABLE = true;/);
  });

  it('shows n/a rather than a percentage while the source is unavailable', () => {
    expect(widget).toMatch(/CPU_SOURCE_UNAVAILABLE \? 'n\/a'/);
    expect(widget).toMatch(/const cpuLive = \$derived\(!CPU_SOURCE_UNAVAILABLE &&/);
  });

  it('explains why in the tooltip instead of claiming the unit is near its limit', () => {
    expect(widget).toMatch(/does not report it in the status frame Axis polls/);
  });
});
