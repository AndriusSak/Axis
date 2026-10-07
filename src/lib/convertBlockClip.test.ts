import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  captureBlockClip,
  planClipWrites,
  cloneBlockForPaste,
  pastedBlockKey,
  placedEffectId
} from './convertBlockClip';
import { addBlock, setBlockParam, type ScratchBlock, type ScratchState } from './convertScratch';
import type { Cell } from './grid';
import type { BlockClipboard } from './editor.svelte';
import type { ConverterParam, ConverterPreset } from './types';

// Offline in-preset block copy/paste (R26 · audit §2.9). The convert surface cannot be imported in the
// node vitest (runes), so the decision logic lives in the framework-free `convertBlockClip.ts` and is
// unit-tested here; `convertEditor.svelte.ts`'s wiring is pinned by a source guard below.

function block(partial: Partial<ScratchBlock> & { key: string; family: string }): ScratchBlock {
  return { instance: 1, params: [], position: null, ...partial } as ScratchBlock;
}
function cell(row: number, col: number, effectId: number, display: string, pack: string | null = 'Amp', channel?: string): Cell {
  return { row, col, kind: 'block', effectId, display, pack, color: '#000', fromRows: [], channel };
}
const param = (nativeName: string, value: number, extra: Partial<ConverterParam> = {}): ConverterParam =>
  ({ nativeName, value, ...extra }) as ConverterParam;

const enumParam = (nativeName: string, value: number, options: string[]): ConverterParam =>
  ({ nativeName, value, enumOptions: options }) as ConverterParam;

describe('captureBlockClip', () => {
  const src = block({
    key: 'amp1',
    family: 'amp',
    instance: 2,
    typeName: 'Brit 800',
    typeValue: 3,
    params: [param('Drive', 0.4), enumParam('Model', 2, ['A', 'B', 'C']), param('Level', 0.7)]
  });

  it('captures the block model + settings in the SAME shape the live editor uses (enum params excluded from named)', () => {
    const clip = captureBlockClip(cell(0, 0, 58, 'Brit 800', 'Amp', 'A'), src);
    expect(clip).toMatchObject({ blockId: 58, display: 'Brit 800', pack: 'Amp', channel: 'A', preset: null });
    expect(clip.type).toEqual({ value: 3, name: 'Brit 800' });
    expect(clip.named.map((p) => [p.id, p.name])).toEqual([
      [0, 'Drive'],
      [2, 'Level']
    ]);
    expect(clip.enums.map((e) => [e.id, e.name, e.value])).toEqual([[1, 'Model', 2]]);
  });

  it('carries a null type when the block exposes no model selector', () => {
    const noType = block({ key: 'vol', family: 'volume', params: [param('Level', 0.5)] });
    expect(captureBlockClip(cell(1, 1, 200, 'Volume'), noType).type).toBeNull();
  });
});

describe('planClipWrites (settings paste)', () => {
  const target = block({
    key: 'drv1',
    family: 'drive',
    params: [param('Drive', 0), param('Level', 0), enumParam('Model', 0, ['A', 'B'])]
  });
  const clip: BlockClipboard = {
    blockId: 58,
    display: 'Brit 800',
    pack: 'Amp',
    type: { value: 3, name: 'Brit 800' },
    named: [
      { id: 0, name: 'Drive', value: 0.4 },
      { id: 2, name: 'Level', value: 0.7 },
      { id: 3, name: 'Presence', value: 0.5 } // not exposed by the target
    ],
    enums: [{ id: 1, name: 'Model', value: 2, options: [] }],
    preset: null
  };

  it('matches each captured value onto the target by NATIVE NAME and writes the captured raw value', () => {
    const plan = planClipWrites(target, clip);
    // Level is index 2 in the clip but index 1 in the target — matched by name, not by id.
    expect(plan.writes).toEqual([
      { index: 0, value: 0.4, name: 'Drive' },
      { index: 1, value: 0.7, name: 'Level' },
      { index: 2, value: 2, name: 'Model' }
    ]);
  });

  it('counts values the target does not expose (never silently writes the wrong param)', () => {
    expect(planClipWrites(target, clip).dropped).toBe(1); // Presence
  });

  it('reports the model retype when the clip captured a type', () => {
    expect(planClipWrites(target, clip).retype).toEqual({ typeName: 'Brit 800', typeValue: 3 });
    expect(planClipWrites(target, { ...clip, type: null }).retype).toBeNull();
  });

  it('end-to-end: applying the planned writes mutates ONLY the target block (via the pure setBlockParam)', () => {
    const source = block({ key: 'amp1', family: 'amp', params: [param('Drive', 0.4)] });
    const state: ScratchState = {
      sourceDevice: 'fm9',
      targetDevice: 'fm3',
      name: 'P',
      topology: { kind: 'grid', rows: 4, cols: 12 },
      blocks: [source, target],
      conflicts: [],
      base: { name: 'P', sourceDevice: 'fm9', blocks: [], routing: {}, decodeDepth: 'full' } as unknown as ConverterPreset
    };
    let next = state;
    for (const w of planClipWrites(target, clip).writes) next = setBlockParam(next, target.key, w.index, w.value);
    const t = next.blocks.find((b) => b.key === 'drv1')!;
    expect(t.params.map((p) => p.value)).toEqual([0.4, 0.7, 2]);
    expect(next.blocks.find((b) => b.key === 'amp1')!.params[0].value).toBe(0.4); // source untouched
  });
});

describe('cloneBlockForPaste (placement)', () => {
  const source = block({
    key: 'amp1',
    family: 'amp',
    instance: 2,
    typeName: 'Plexi',
    typeValue: 1,
    params: [param('Drive', 0.1)],
    position: { row: 0, col: 0 },
    fromRows: [0]
  });
  // the source carries a device-address extra — the clone must NOT inherit it silently
  (source as unknown as Record<string, unknown>).effectId = 58;
  const clip: BlockClipboard = {
    blockId: 58,
    display: 'Brit 800',
    pack: 'Amp',
    type: { value: 3, name: 'Brit 800' },
    named: [{ id: 0, name: 'Drive', value: 0.9 }],
    enums: [],
    preset: null
  };

  it('clones with a fresh key/position/wiring and the clipboard settings applied', () => {
    const clone = cloneBlockForPaste(source, clip, { row: 2, col: 3 }, [1], 'amp1#1');
    expect(clone.key).toBe('amp1#1');
    expect(clone.family).toBe('amp');
    expect(clone.instance).toBe(2);
    expect(clone.position).toEqual({ row: 2, col: 3 });
    expect(clone.fromRows).toEqual([1]);
    expect(clone.params[0].value).toBe(0.9); // clip value applied by native name
    expect(clone.typeName).toBe('Brit 800');
    expect(clone.typeValue).toBe(3);
    expect(source.params[0].value).toBe(0.1); // source untouched
    expect(source.position).toEqual({ row: 0, col: 0 });
  });

  it('omits the device-address extra for a synthetic placement, sets it for a real id', () => {
    expect((cloneBlockForPaste(source, clip, { row: 2, col: 3 }, [], 'amp1#1') as unknown as Record<string, unknown>).effectId).toBeUndefined();
    expect((cloneBlockForPaste(source, clip, { row: 2, col: 3 }, [], 'amp1#2', 59) as unknown as Record<string, unknown>).effectId).toBe(59);
  });
});

describe('pastedBlockKey / placedEffectId', () => {
  it('allocates the lowest free key suffix', () => {
    expect(pastedBlockKey('amp1', [])).toBe('amp1#1');
    expect(pastedBlockKey('amp1', ['amp1#1'])).toBe('amp1#2');
    expect(pastedBlockKey('amp1', ['amp1#1', 'amp1#2'])).toBe('amp1#3');
  });

  it('reuses the copied instance id when free, else a free synthetic (negative) id', () => {
    expect(placedEffectId([100, 101], 58)).toBe(58);
    expect(placedEffectId([58, 101], 58)).toBe(-1);
    expect(placedEffectId([58, 101, -1], 58)).toBe(-2);
  });
});

describe('addBlock (pure transition)', () => {
  const state = (): ScratchState => ({
    sourceDevice: 'fm9',
    targetDevice: 'fm3',
    name: 'P',
    topology: { kind: 'grid', rows: 4, cols: 12 },
    blocks: [block({ key: 'amp1', family: 'amp' })],
    conflicts: [],
    base: {} as ConverterPreset
  });

  it('appends a new block', () => {
    const next = addBlock(state(), block({ key: 'amp1#1', family: 'amp' }));
    expect(next.blocks.map((b) => b.key)).toEqual(['amp1', 'amp1#1']);
  });

  it('is a no-op for a duplicate key', () => {
    const s = state();
    expect(addBlock(s, block({ key: 'amp1', family: 'amp' }))).toBe(s);
  });
});

// ── source guard: convertEditor.svelte.ts cannot be imported here (runes), so pin its wiring by source. ──
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('offline block copy/paste wiring (source guard)', () => {
  const convert = read('./convertEditor.svelte.ts');
  const surface = read('./editorSurface.ts');

  it('implements copyBlock/pasteBlock (the "not available offline" toasts are gone)', () => {
    expect(convert).not.toMatch(/Copy is not available offline/);
    expect(convert).not.toMatch(/Paste is not available offline/);
    expect(convert).toMatch(/copyBlock = async/);
    expect(convert).toMatch(/pasteBlock = async/);
    expect(convert).toMatch(/blockClipboard = \$state<BlockClipboard \| null>/);
  });

  it('reuses the live planners + the same clipboard shape (no second copy path)', () => {
    expect(convert).toMatch(/import type \{ BlockClipboard \} from '\.\/editor\.svelte'/);
    expect(convert).toMatch(/planPasteBlock\(/);
    expect(convert).toMatch(/planReplaceShunt\(/);
    expect(convert).toMatch(/applyRouteOps\(/);
    expect(convert).toMatch(/captureBlockClip\(/);
    expect(convert).toMatch(/planClipWrites\(/);
    expect(convert).toMatch(/cloneBlockForPaste\(/);
    expect(convert).toMatch(/convertScratch\.insertBlock\(/);
  });

  it('refuses every unmodelable case with a NAMED reason (never a silent drop)', () => {
    expect(convert).toMatch(/Nothing to copy/);
    expect(convert).toMatch(/Clipboard is empty/);
    expect(convert).toMatch(/That block cannot be edited offline/);
    expect(convert).toMatch(/Paste placement needs a 2-D grid target/);
    expect(convert).toMatch(/Off the grid/);
    expect(convert).toMatch(/The copied block is no longer in this preset/);
  });

  it('keeps the EditorSurface copy/paste signatures unchanged (seam preserved)', () => {
    expect(surface).toMatch(/copyBlock: \(cell\?: Cell\) => Promise<void>/);
    expect(surface).toMatch(/pasteBlock: \(row: number, col: number\) => Promise<void>/);
  });
});
