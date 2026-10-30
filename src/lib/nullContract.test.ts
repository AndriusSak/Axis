import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { paramKnown, paramValue, paramValueAtNorm, fmtCompact, fmtNumber, fmtValue } from './format';
import { nudgeNamed, nudgeEnum, stepNorm } from './paramNudge';
import { captureChannel } from './blockOps';
import { captureParamValue } from './paramClipOps';
import { captureEntry } from './blockLibrary';
import type { NamedParam, EnumParam } from './types';

// P10 — the null param contract. ForgeFX now serves a param it could not resolve (a GLOBAL pid the
// assembled body does not carry) as `value: null` + `norm: null` + a reason, never a fabricated 0 (`7d1f800`).
// Axis was widened to match; these tests pin the CLIENT half: an unknown value renders as the em-dash
// `—` and every pure module / capture path REFUSES to coerce it back to 0 (the exact defect class the
// server fix ended, which would otherwise re-appear on the other side of the wire).

const unresolvedKnob = (over: Partial<NamedParam> = {}): NamedParam => ({ id: 5, name: 'FS Brightness', value: null, norm: null, unresolved: 'non-positional family', ...over });
const unresolvedEnum = (over: Partial<EnumParam> = {}): EnumParam => ({ id: 6, name: 'CS Command', value: null, options: [{ value: 0, label: '--' }, { value: 1, label: 'CC' }], unresolved: 'non-positional family', ...over });

describe('format — an unresolved value is UNKNOWN, never 0', () => {
  it('paramKnown keys on the server unresolved marker / a missing norm — never "both happen to be null"', () => {
    expect(paramKnown({ value: null, norm: null })).toBe(false);
    expect(paramKnown({ value: 0, norm: 0 })).toBe(true); // a REAL zero is known
    expect(paramKnown({ value: null, norm: 0.5 })).toBe(true); // a position alone is known
    // P11 REGRESSION — the server marked it unresolved; a stray norm must NOT make it known.
    expect(paramKnown({ value: null, norm: 0.5, unresolved: 'non-positional family' })).toBe(false);
    expect(paramKnown(unresolvedKnob({ norm: 0.5 }))).toBe(false);
    // a missing position (norm) is unknown even when a value is present — you cannot place a control.
    expect(paramKnown({ value: 5, norm: null })).toBe(false);
  });

  it('paramValue returns null (not a number) for an unknown value', () => {
    expect(paramValue({ value: null, norm: null, min: 0, max: 10 })).toBeNull();
    expect(paramValue({ value: null, norm: null })).toBeNull();
    // unresolved dominates a stray norm — never a number from a fabricated position.
    expect(paramValue({ value: null, norm: 0.5, unresolved: 'non-positional family' })).toBeNull();
  });

  it('the formatters render the em-dash, never "0.0" / "0"', () => {
    const p = unresolvedKnob({ min: 0, max: 10, unit: 'dB' });
    expect(fmtCompact(p)).toBe('—');
    expect(fmtNumber(p)).toBe('—');
    expect(fmtValue(p)).toBe('—');
    // the old, defective readings (a fabricated zero at the knob's min) are explicitly NOT produced
    expect(fmtCompact(p)).not.toBe('0.0');
    expect(fmtNumber(p)).not.toBe('0');
  });

  it('a param marked unresolved stays — even with a real, stray norm (the P11 regression)', () => {
    const p = unresolvedKnob({ norm: 0.5, min: -12, max: 12, unit: 'dB' });
    expect(paramKnown(p)).toBe(false);
    expect(paramValue(p)).toBeNull();
    expect(fmtCompact(p)).toBe('—');
    expect(fmtNumber(p)).toBe('—');
    expect(fmtValue(p)).toBe('—');
  });

  it('a REAL zero still formats as zero (unknown is not confused with zero)', () => {
    expect(fmtCompact({ value: 0, norm: 0, min: 0, max: 10 })).toBe('0.0');
    expect(fmtNumber({ value: 0, norm: 0, min: 0, max: 10 })).toBe('0.0');
  });

  it('paramValueAtNorm still computes a known position (device push / local write path)', () => {
    expect(paramValueAtNorm(0.5, { min: 0, max: 10 })).toBe(5);
    expect(paramValueAtNorm(0, { min: 0, max: 10 })).toBe(0);
  });
});

describe('paramNudge — an unresolved value has no honest step', () => {
  it('nudgeNamed returns null for a null norm (never steps from a fabricated 0)', () => {
    expect(nudgeNamed(unresolvedKnob(), 1)).toBeNull();
    expect(nudgeNamed(unresolvedKnob(), -1)).toBeNull();
  });
  it('nudgeEnum returns null for a null ordinal', () => {
    expect(nudgeEnum(unresolvedEnum(), 1)).toBeNull();
  });
  it('stepNorm never yields NaN for a null norm', () => {
    const s = stepNorm({ norm: null, min: 20, max: 20000, log: true });
    expect(Number.isNaN(s)).toBe(false);
    expect(s).toBeGreaterThan(0);
    expect(Number.isNaN(stepNorm({ norm: null, min: 0, max: 10 }))).toBe(false);
  });
});

describe('capture paths — an unresolved value is never captured (no fabricated 0)', () => {
  it('blockOps.captureChannel drops a param with a null/absent norm and a null-ordinal enum', () => {
    const clip = captureChannel('GLOBAL', null, [unresolvedKnob()], [unresolvedEnum()]);
    expect(clip.knobs).toEqual([]);
    expect(clip.enums).toEqual([]);
  });

  it('paramClipOps.captureParamValue returns null for an unresolved knob/enum', () => {
    expect(captureParamValue(unresolvedKnob(), 'GLOBAL', true)).toBeNull();
    expect(captureParamValue(unresolvedEnum(), 'GLOBAL', false)).toBeNull();
  });

  it('blockLibrary.captureEntry stores no value for an unresolved param', () => {
    const entry = captureEntry({ id: 'e1', name: 'x', block: 'GLOBAL', slug: 'global', type: null, channel: null, named: [unresolvedKnob()], enums: [unresolvedEnum()], now: 1 });
    expect(entry.params).toEqual([]);
  });
});

// The .svelte components cannot be mounted in this repo's node-env vitest, so — like
// controlSwitchWiring.sourceguard.test.ts — the unknown-state RENDERING is pinned by a source scan:
// the ControlSurface must route an unresolved control to the inert `unknownCtl` tile BEFORE any knob
// branch, and must never fall back to `pct(...)`/norm for it.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('ControlSurface — an unresolved control renders inert, not a knob at 0', () => {
  const src = read('./ControlSurface.svelte');

  it('gates BOTH widget loops on ctlUnknown before the cont/knob branch', () => {
    const gates = src.match(/\{#if ctlUnknown\(c\)\}/g) ?? [];
    expect(gates.length).toBe(2); // the search-results list and the board
    // …and each renders the explicit unknown tile, not a value
    expect((src.match(/\{@render unknownCtl\(c\.label, ctlReason\(c\)\)\}/g) ?? []).length).toBe(2);
  });

  it('defines ctlUnknown from the server `unresolved` marker or a missing position (never "both null")', () => {
    expect(src).toMatch(/const knobUnknown = \(id: number\): boolean => \{ const p = knob\(id\); return !!p && \(p\.unresolved != null \|\| p\.norm == null\); \}/);
    expect(src).toMatch(/const enumUnknown = \(id: number\): boolean => \{ const e = enm\(id\); return !!e && \(e\.unresolved != null \|\| e\.value == null\); \}/);
  });

  it('the unknown tile shows the em-dash and the server reason (never a number)', () => {
    const snip = src.slice(src.indexOf('{#snippet unknownCtl'), src.indexOf('{/snippet}'));
    expect(snip).toMatch(/—/);
    expect(snip).toMatch(/value unavailable/);
    expect(snip).toMatch(/reason/);
  });
});

describe('Setup MIDI/Remote — an unresolved GLOBAL knob is inert, not a knob at 0', () => {
  const src = read('./MidiRemoteSection.svelte');
  it('guards every knob branch with pUnknown (server marker / missing norm) and never passes `norm ?? 0`', () => {
    expect(src).toMatch(/const pUnknown = \(p: NamedParam\) => p\.unresolved != null \|\| p\.norm == null/);
    expect(src).toMatch(/const eUnknown = \(e: EnumParam\) => e\.unresolved != null \|\| e\.value == null/);
    // three knob branches now: the MIDI grid, the Control Switches group, and the FC Config group.
    expect((src.match(/pUnknown\(r\.param\)/g) ?? []).length).toBe(3);
    expect(src).not.toMatch(/value=\{r\.param\.norm \?\? 0\}/);
  });
});

// P11 — the guard must hold on the EVENT path and at every `?? 0` site the review flagged that is
// actually reachable. editor.svelte.ts / the components are runic (unimportable in node-env vitest),
// so these are source scans, like the ones above.
describe('P11 — a stray device-edit norm cannot upgrade an unresolved param', () => {
  const ed = read('./editor.svelte.ts');

  it('applyDeviceEvent ignores a param event whose param carries the server `unresolved` marker', () => {
    expect(ed).toMatch(/this\.params\.find\(\(x\) => x\.id === e\.paramId\)\?\.unresolved != null\) break;/);
  });

  it('meterFor returns null (no fabricated 0 fill/HUD) when the active control has no reading', () => {
    expect(ed).toMatch(/const v = ctl \? this\.meters\[cell\.effectId\]\?\.vals\[ctl\.id\] : undefined;[\s\S]{0,400}?if \(!v\) return null;/);
    expect(ed).not.toMatch(/norm: v\?\.norm \?\? 0/);
    expect(ed).not.toMatch(/value: v\?\.value \?\? 0/);
  });
});

describe('P11 — the reachable `?? 0` sites on components are closed', () => {
  it('ControlSurface.onWidgetDown never arms a knob drag on an unresolved/missing param', () => {
    const src = read('./ControlSurface.svelte');
    expect(src).toMatch(/if \(!p \|\| p\.unresolved != null \|\| p\.norm == null\) return;/);
    // the old fabricated baseline is gone
    expect(src).not.toMatch(/sn: knob\(pid\)\?\.norm \?\? 0/);
  });

  it('the DynaCab mic tile gates on its SIBLING Distance param being unresolved (never a cone-face 0)', () => {
    const src = read('./ControlSurface.svelte');
    expect(src).toMatch(/did != null && \(!dist \|\| dist\.unresolved != null \|\| dist\.norm == null\)/);
    expect(src).not.toMatch(/knob\(did\)\?\.norm \?\? 0/);
  });

  it('an unknown control is not offered the ⚡ swipe-control pin (a fabricated-baseline write path)', () => {
    const src = read('./ControlSurface.svelte');
    expect(src).toMatch(/\{#if c\.kind === 'cont' && !ctlUnknown\(c\)\}/);
  });

  it('EQGraph wheel/Q-bump refuse a null q-norm (no 0-based step)', () => {
    const src = read('./EQGraph.svelte');
    expect(src).toMatch(/if \(b\.q\.norm == null\) return;/);
    expect(src).toMatch(/if \(!b\.q \|\| b\.q\.norm == null\) return;/);
    expect(src).not.toMatch(/b\.q\.norm \?\? 0/);
  });

  it('ToolRail shows Tools only for a device with a tool capability — never a bare AM4/v1', () => {
    const src = read('./ToolRail.svelte');
    expect(src).toMatch(/editor\.caps\.backupDump \|\| editor\.caps\.restoreDump \|\| editor\.caps\.firmwareValidate \|\| editor\.caps\.modifiers\?\.model/);
    expect(src).not.toMatch(/\?[\s\S]*?: editor\.isAm4\s*\);/);
  });
});
