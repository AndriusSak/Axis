// OFFLINE block copy/paste for the convert editor (R26 · audit §2.9 in-preset block copy/paste).
//
// The LIVE editor copies a block's model + active-channel settings into an in-memory `BlockClipboard`
// (`editor.copyBlock`) and pastes with `planPasteBlock` (empty cell) / `planReplaceShunt` (shunt) /
// a settings-write (onto a block). This module is the OFFLINE twin: it captures the SAME `BlockClipboard`
// shape from a grid `Cell` + `ScratchBlock`, plans the settings-writes that a paste onto an existing
// block produces, and clones a block for a placement — all framework-free so it is unit-tested in the
// node vitest, with `convertEditor.svelte.ts` a thin shell over it.
//
// ── The offline identity rule (honesty note) ──
// Live matches a paste onto a block by the device-true paramId (`blockOps.pasteChannelWrites`). Offline
// there is no device paramId, so the captured value is matched onto the target block by the param's
// NATIVE NAME (the offline identity — the same key the converter tags each param with). Values the
// target does not expose are COUNTED (`dropped`), never silently written to the wrong param.
//
// A placement (paste into an empty / shunt cell) needs a block INSTANCE. Offline there is no device
// roster to allocate a family instance id from, so the pasted block is a CLONE of the copied block with
// a fresh key; its cell id reuses the copied instance id only when that id is FREE in the layout, else a
// free SYNTHETIC (negative) id — the existing offline convention (see convertScratchAdapter). A synthetic
// id is left OFF the block's device-address extra so the apply-plan counts it unresolved rather than
// sending an invented effect id to the device.

import type { Cell } from './grid';
import type { BlockClipboard } from './editor.svelte';
import type { ScratchBlock } from './convertScratch';
import { buildParams, buildEnums } from './convertParams';

/** Capture a grid cell's block as an in-memory clipboard — the same shape the live editor uses. Offline
 *  the surface is a single in-memory buffer (no device slot), so `preset` is null → the same-preset
 *  paste path (a cross-preset clip can never be produced here). */
export function captureBlockClip(cell: Cell, block: ScratchBlock): BlockClipboard {
  const hasType = block.typeValue != null || block.typeName != null;
  return {
    blockId: cell.effectId,
    display: cell.display,
    pack: cell.pack,
    type: hasType ? { value: block.typeValue ?? 0, name: block.typeName ?? '' } : null,
    channel: cell.channel,
    named: buildParams(block.params),
    enums: buildEnums(block.params),
    preset: null
  };
}

/** One parameter write a paste onto an existing block produces: the target param INDEX (the offline
 *  write address — `convertScratch.setParam` keys on the block's params array index). */
export interface ClipWrite {
  index: number;
  value: number;
  name: string;
}

export interface ClipPlan {
  /** Parameter writes, in capture order (knobs then enums). */
  writes: ClipWrite[];
  /** Captured values the target block does not expose (matched by native name) — never silently lost. */
  dropped: number;
  /** The model retype to apply, when the clip captured a type. */
  retype: { typeName?: string; typeValue?: number } | null;
}

/** Plan the writes that paste a clipboard onto an EXISTING block: each captured value is matched onto
 *  the target by its native name (the offline identity), writing the captured RAW value (offline stores
 *  the raw converter value, not a normalised position). Values the target does not expose are counted. */
export function planClipWrites(target: ScratchBlock, clip: BlockClipboard): ClipPlan {
  const indexByName = new Map<string, number>();
  target.params.forEach((p, i) => indexByName.set(p.nativeName, i));

  const writes: ClipWrite[] = [];
  let dropped = 0;
  const add = (name: string, value: number) => {
    const i = indexByName.get(name);
    if (i == null) {
      dropped++;
      return;
    }
    writes.push({ index: i, value, name });
  };
  for (const p of clip.named) if (p.id != null && (p.value != null || p.norm != null)) add(p.name, p.value ?? p.norm!);
  for (const e of clip.enums) if (e.value != null) add(e.name, e.value);

  return { writes, dropped, retype: clip.type ? { typeName: clip.type.name, typeValue: clip.type.value } : null };
}

/** A fresh block key for a paste placement — the source key plus the lowest free `#n` suffix. */
export function pastedBlockKey(sourceKey: string, usedKeys: Iterable<string>): string {
  const used = new Set(usedKeys);
  let n = 1;
  while (used.has(`${sourceKey}#${n}`)) n++;
  return `${sourceKey}#${n}`;
}

/** The effect id for a placed cell: the copied instance id when it is FREE in the layout, else the
 *  lowest free SYNTHETIC (negative) id (the offline convention — never a real device id). */
export function placedEffectId(usedEffectIds: Iterable<number>, preferred: number): number {
  const used = new Set(usedEffectIds);
  if (Number.isInteger(preferred) && preferred > 0 && !used.has(preferred)) return preferred;
  let n = 1;
  while (used.has(-n)) n++;
  return -n;
}

/** Clone a block for a PASTE placement: a fresh key + position, carrying the clipboard's settings (its
 *  raw params + model), wired from `fromRows`. `effectId` (optional) is the placed cell's identity; pass
 *  it only for a real (device-resolvable) id — a synthetic placement leaves it unset so the apply-plan
 *  counts the block unresolved instead of writing an invented effect id. */
export function cloneBlockForPaste(
  source: ScratchBlock,
  clip: BlockClipboard,
  position: { row: number; col: number },
  fromRows: number[],
  key: string,
  effectId?: number
): ScratchBlock {
  const clone: ScratchBlock = {
    ...source,
    key,
    position: { row: position.row, col: position.col },
    fromRows: [...fromRows],
    params: source.params.map((p) => ({ ...p }))
  };
  const { writes, retype } = planClipWrites(clone, clip);
  if (writes.length) {
    const params = clone.params.map((p) => ({ ...p }));
    for (const w of writes) params[w.index] = { ...params[w.index], value: w.value };
    clone.params = params;
  }
  if (retype) {
    clone.typeName = retype.typeName;
    clone.typeValue = retype.typeValue;
  }
  // Control the device-address extra EXPLICITLY (a spread of the source would otherwise carry the
  // source's own effectId onto the clone → the apply-plan would place the source's instance again).
  const rec = clone as unknown as Record<string, unknown>;
  if (effectId != null) rec.effectId = effectId;
  else delete rec.effectId;
  return clone;
}
