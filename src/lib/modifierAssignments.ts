// Modifier read-back helpers (parity audit §3.2). The server decodes a preset body's modifier
// assignments (source → target block+param, plus the pre-chain slot) and surfaces them on
// GET /preset/modifiers / PresetSummary.modifiers. These plain-TS helpers turn that list into the
// three things the modifier editor needs: which modifiers are actually IN USE, which one (if any)
// owns the parameter the editor was opened for, and how to address that modifier's live slot so its
// curve values can be read back from the device.
//
// Kept free of Svelte/DOM so it is unit-testable in this repo's node-env vitest (the .svelte component
// cannot be mounted here).
import type { PresetModifier } from './types';

/** The codec's fallback name for an unmapped source ordinal — ordinal 0 ("None"). A modifier with no
 *  source is a reserved/stale entry, not a live assignment. */
export function isNoSource(source: string): boolean {
  return source === 'source_0' || source.trim().toLowerCase() === 'none';
}

/** True when a decoded modifier actually routes a source onto a PLACED target. The codec also emits
 *  empty/stale pre-chain entries (source "None", or a target name that isn't a placed block → null
 *  targetEffectId); those are not assignments and must not show as "in use". */
export function isModifierInUse(m: PresetModifier): boolean {
  return m.targetEffectId != null && !isNoSource(m.source);
}

/** The real assignments from a decoded modifier list (order preserved), for the "modifiers in use" UI. */
export function modifiersInUse(mods: PresetModifier[] | null | undefined): PresetModifier[] {
  return (mods ?? []).filter(isModifierInUse);
}

/** The modifier bound to a specific target (block eid + paramId), or null. Matches on the resolved
 *  effectId only — an unplaced target (null eid) can never match a live control. */
export function findModifierForTarget(
  mods: PresetModifier[] | null | undefined,
  targetEffectId: number | null | undefined,
  targetParam: number | null | undefined
): PresetModifier | null {
  if (targetEffectId == null || targetParam == null) return null;
  return (mods ?? []).find((m) => m.targetEffectId === targetEffectId && m.param === targetParam) ?? null;
}

/** One-line description for the "in use" list: "LFO 1A → Filter 1 (param 1)". */
export function describeModifier(m: PresetModifier): string {
  return `${m.source} → ${m.target} (param ${m.param})`;
}

/** Map a 1-based modifier slot to its virtual-effect eid (slot N = modModel.effectId + N - 1). */
export function modifierSlotEid(modBaseEffectId: number, slot: number): number {
  return modBaseEffectId + (Math.max(1, Math.floor(slot)) - 1);
}
