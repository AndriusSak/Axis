<script lang="ts">
  // Controllers screen — MODIFIERS IN USE (parity audit §3.2 remainder).
  //
  // Shows which parameters currently have a modifier assigned, reusing the decoded modifier
  // assignments (GET /preset/modifiers / PresetSummary.modifiers) through the existing
  // modifierAssignments helpers. NO new endpoint: it rides the same read path as the modifier editor.
  // Degrades honestly — an empty preset says so; a server/device with no read path (404/501 → null)
  // says the read-back is unavailable, never a fabricated row.
  import { forgefx } from './forgefx';
  import { describeModifier, modifiersInUse } from './modifierAssignments';
  import type { PresetModifier } from './types';

  let {
    /** Pre-fetched decoded assignments; omit (undefined) to fetch once. Pass null/[] to disable. */
    modifiers = undefined
  }: { modifiers?: PresetModifier[] | null } = $props();

  let fetched = $state<PresetModifier[] | null>(null);
  let failed = $state(false);
  const mods = $derived(modifiers ?? fetched ?? []);
  const inUse = $derived(modifiersInUse(mods));

  // Fetch once (unless a list was passed in). 404/501 → capOptional resolves null → []; a thrown error
  // marks the read path unavailable so the empty state can say why instead of claiming "none".
  $effect(() => {
    if (modifiers === undefined && fetched === null && !failed) {
      forgefx
        .presetModifiers()
        .then((r) => (fetched = r?.modifiers ?? []))
        .catch(() => {
          failed = true;
          fetched = [];
        });
    }
  });
</script>

<div class="modusage">
  <div class="mhead">
    <span class="mdot" class:on={inUse.length > 0}></span>
    <span class="mtitle">MODIFIERS IN USE</span>
    <span class="mcount">{inUse.length}</span>
  </div>

  {#if inUse.length}
    <div class="mlist">
      {#each inUse as mi (mi.slot ?? `${mi.targetEffectId}:${mi.param}`)}
        <div class="mrow" title={describeModifier(mi)}>
          <span class="msrc">{mi.source}</span>
          <span class="marr">→</span>
          <span class="mtgt">{mi.target}</span>
          <span class="mparam">param {mi.param}</span>
          {#if mi.slot != null}<span class="mslot">slot {mi.slot}</span>{/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="mempty">
      {#if failed}
        Modifier read-back unavailable on this server — no decoded assignments to show.
      {:else}
        No parameters have a modifier assigned in this preset.
      {/if}
    </div>
  {/if}
</div>

<style>
  .modusage {
    flex: none;
    padding: 12px 18px;
    border-bottom: 1px solid var(--line, var(--border2));
    background: var(--bg2);
  }
  .mhead {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .mdot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: none;
    background: var(--border3, var(--border2));
  }
  .mdot.on {
    background: var(--amber, #f5a623);
    box-shadow: 0 0 8px rgba(245, 166, 35, 0.8);
  }
  .mtitle {
    font: 700 10px/1 'JetBrains Mono', monospace;
    letter-spacing: 0.13em;
    color: var(--textfaint, var(--textdim));
  }
  .mcount {
    font: 700 10px/1 'JetBrains Mono', monospace;
    color: var(--textdim);
  }
  .mlist {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 9px;
  }
  .mrow {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 9px;
    border-radius: 8px;
    background: var(--bg);
    border: 1px solid var(--surface2, var(--border2));
    font: 600 11px/1 'JetBrains Mono', monospace;
  }
  .msrc {
    color: var(--amber, #f5a623);
    font-weight: 700;
  }
  .marr {
    color: var(--textfaint, var(--textdim));
  }
  .mtgt {
    color: var(--text2, var(--text));
  }
  .mparam,
  .mslot {
    color: var(--textdim);
  }
  .mempty {
    margin-top: 9px;
    font: 600 11px/1.4 'JetBrains Mono', monospace;
    color: var(--textmuted, var(--textdim));
  }
</style>
