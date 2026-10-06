<script lang="ts">
  // One large, Deck-friendly performance tap target for a single (family, paramId) binding.
  //
  // The bound block is resolved by FAMILY against the current preset's placed grid (a binding
  // survives a preset change as long as a block of that family is present), then its params are
  // hydrated on demand through the same pinned-control path the workbench widgets use — so the tile
  // reads and writes live even while another block is open (editor.setPinnedParam / setPinnedEnum).
  import { editor } from '../../editor.svelte';
  import { fmtNumber, withUnit } from '../../format';
  import { nudgeNorm, resolvePerformanceEffectId, type PerformanceBinding } from '../../performancePage';

  let {
    binding,
    index,
    count,
    editMode,
    onremove,
    onmove
  }: {
    binding: PerformanceBinding;
    index: number;
    count: number;
    editMode: boolean;
    onremove: (index: number) => void;
    onmove: (index: number, dir: number) => void;
  } = $props();

  const effectId = $derived(resolvePerformanceEffectId(binding, [...editor.layout.cells, ...editor.layout.shunts]));
  const view = $derived(effectId != null ? editor.pinnedView(effectId) : { named: [], enums: [] });
  const named = $derived(view.named.find((p) => p.id === binding.paramId));
  const enumParam = $derived(view.enums.find((p) => p.id === binding.paramId));
  // Keep the bound block hydrated for as long as this tile is mounted.
  $effect(() => {
    if (effectId == null) return;
    return editor.registerPinnedBlock(effectId);
  });

  const missing = $derived(effectId == null);
  const ready = $derived(!!named || !!enumParam);
  const isEnum = $derived(!!enumParam);
  const label = $derived(binding.label ?? named?.name ?? enumParam?.name ?? `Param ${binding.paramId}`);
  const blockLabel = $derived(binding.block ?? '');
  const valueText = $derived.by(() => {
    if (named) return withUnit(fmtNumber({ norm: named.norm, value: named.value, min: named.min, max: named.max, log: named.log }), named.unit);
    if (enumParam) return enumParam.options.find((option) => option.value === enumParam.value)?.label ?? String(enumParam.value);
    return missing ? '--' : '…';
  });
  const tip = $derived(
    missing
      ? `${label} · no ${binding.family} block in this preset`
      : `${blockLabel ? `${blockLabel} · ` : ''}${label}${isEnum ? ' · tap to cycle' : ' · tap − / + to step'}`
  );

  function step(dir: number) {
    if (editMode || effectId == null) return;
    if (named) {
      editor.setPinnedParam(effectId, named, nudgeNorm(named.norm, dir * 0.01));
      return;
    }
    if (enumParam) {
      const options = enumParam.options;
      if (!options.length) return;
      const at = options.findIndex((option) => option.value === enumParam.value);
      const next = options[(at + dir + options.length) % options.length];
      editor.setPinnedEnum(effectId, enumParam, next.value);
    }
  }
</script>

<div class="tile" class:missing class:enum={isEnum} title={tip}>
  <div class="tile-head">
    <span class="block">{blockLabel || binding.family}</span>
    {#if editMode}
      <span class="tile-edit">
        <button type="button" title="Move earlier" disabled={index === 0} onclick={() => onmove(index, -1)}>‹</button>
        <button type="button" title="Move later" disabled={index === count - 1} onclick={() => onmove(index, 1)}>›</button>
        <button type="button" class="del" title="Remove from the performance page" onclick={() => onremove(index)}>×</button>
      </span>
    {/if}
  </div>

  {#if isEnum}
    <button class="face" type="button" disabled={editMode || missing || !ready} onclick={() => step(1)}>
      <span class="val enum-val">{valueText}</span>
    </button>
  {:else}
    <div class="face static">
      <span class="val">{valueText}</span>
    </div>
  {/if}

  <div class="tile-foot">
    <button class="step" type="button" aria-label={`${label} down`} disabled={editMode || missing || !ready} onclick={() => step(-1)}>−</button>
    <span class="name">{label}</span>
    <button class="step" type="button" aria-label={`${label} up`} disabled={editMode || missing || !ready} onclick={() => step(1)}>+</button>
  </div>
</div>

<style>
  .tile {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 128px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    color: var(--text);
  }
  .tile.missing {
    opacity: 0.55;
  }
  .tile-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    min-height: 20px;
  }
  .block {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--textdim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tile-edit {
    display: flex;
    gap: 3px;
  }
  .tile-edit button {
    width: 30px;
    height: 30px;
    border: 1px solid var(--border2);
    border-radius: 7px;
    background: var(--surface2);
    color: var(--text2);
    font-size: 14px;
    cursor: pointer;
  }
  .tile-edit button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .tile-edit .del {
    color: var(--danger, #d6543f);
    border-color: var(--danger-border, var(--border2));
  }
  .face {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 46px;
    padding: 4px;
    border: 1px solid transparent;
    border-radius: 9px;
    background: var(--bg2);
    color: inherit;
  }
  button.face {
    cursor: pointer;
  }
  button.face:disabled {
    cursor: default;
  }
  .val {
    font-family: var(--font-mono);
    font-size: 26px;
    font-weight: 700;
    line-height: 1.1;
    text-align: center;
  }
  .enum-val {
    font-size: 15px;
  }
  .tile-foot {
    display: flex;
    align-items: stretch;
    gap: 6px;
  }
  .step {
    flex: none;
    width: 48px;
    min-height: 48px;
    border: 1px solid var(--border2);
    border-radius: 10px;
    background: var(--surface2);
    color: var(--text);
    font-size: 22px;
    font-weight: 700;
    cursor: pointer;
    touch-action: manipulation;
  }
  .step:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .name {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
    color: var(--text2);
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
