<script lang="ts">
  // Quick Build panel (parity audit §2.9) — the remaining "Partial": FM3-Edit's one-click block
  // placement surface, as a workbench panel. A curated shortlist of everyday blocks; one click drops
  // the block into the current target cell (the first free cell by default, or a cell you pick).
  //
  // The DECISION logic (curation, target selection, refusals) is pure and unit-tested in
  // `quickBuild.ts`; this component only wires it to the editor store and the existing grid placement
  // op. Placement goes through `editor.place` (→ forgefx.placeCell) — the SAME op the Cmd+K palette
  // uses. There is deliberately no second placement path here.
  import { editor } from '../../editor.svelte';
  import { forgefx } from '../../forgefx';
  import { catFor, shade } from '../../catalog';
  import { baseName, packFor } from '../../blocks';
  import {
    QUICK_BUILD_BLOCKS,
    resolveQuickBuild,
    quickBuildTarget,
    isQuickBuildPlaced,
    type QuickBuildCell,
    type QuickBuildFamily,
    type QuickBuildRow
  } from '../../quickBuild';

  let families = $state<QuickBuildFamily[]>([]);
  let loading = $state(false);
  let loadError = $state(false);
  let status = $state('');
  /** null = automatic (first free cell); a coordinate = the user's chosen cell. */
  let chosen = $state<QuickBuildCell | null>(null);

  const rows = $derived(resolveQuickBuild(families));
  const layout = $derived(editor.layout);
  const placement = $derived(quickBuildTarget(layout, chosen));
  // Occupied cells (block or shunt) by "row,col", for the cell chooser's labels.
  const occupied = $derived.by(() => {
    const m = new Map<string, { display: string; kind: string }>();
    for (const c of layout.cells) m.set(`${c.row},${c.col}`, { display: c.display, kind: 'block' });
    for (const c of layout.shunts) m.set(`${c.row},${c.col}`, { display: 'shunt', kind: 'shunt' });
    return m;
  });

  async function load() {
    if (loading) return;
    loading = true;
    loadError = false;
    try {
      const list = await forgefx.blocks();
      families = list.map((b) => ({ slug: b.slug, name: b.name, page: b.page }));
    } catch {
      loadError = true;
      families = [];
    } finally {
      loading = false;
    }
  }

  // Load the served roster once when the panel mounts.
  $effect(() => {
    if (families.length || loading || loadError) return;
    void load();
  });

  const glyphFor = (name: string) => catFor(packFor(name), baseName(name));

  function place(row: QuickBuildRow) {
    if (isQuickBuildPlaced(layout.cells, row.page)) {
      status = `${row.name} is already on the grid.`;
      editor.showToast(`${row.name} is already on the grid`, '#d6543f');
      return;
    }
    const p = placement;
    if (!p.ok) {
      // Refuse with the named reason — never a silent drop.
      status = `Cannot place ${row.name}: ${p.reason}.`;
      editor.showToast(`Cannot place ${row.name}: ${p.reason}`, '#d6543f');
      return;
    }
    void editor.place(p.target.row, p.target.col, row.page, row.name); // EXISTING grid placement op
    status = `Placed ${row.name} in cell ${p.target.row + 1},${p.target.col + 1}.`;
    editor.showToast(`Placed ${row.name}`, '#35c9d6');
  }

  function choose(cell: QuickBuildCell | null) {
    chosen = cell;
    status = cell ? `Target cell ${cell.row + 1},${cell.col + 1}.` : 'Target: first free cell.';
  }
</script>

<section class="quick-build">
  <header>
    <div class="titles">
      <h2>Quick Build</h2>
      <p>One-click block placement into the Signal Grid (§2.9).</p>
    </div>
    <button class="btn" onclick={load} disabled={loading}>{loading ? 'Loading…' : 'Reload blocks'}</button>
  </header>

  <div class="targetbar" class:bad={!placement.ok}>
    {#if placement.ok}
      <span class="mono">
        {placement.auto ? 'Auto target' : 'Chosen cell'} — cell {placement.target.row + 1},{placement.target.col + 1}
      </span>
      {#if !placement.auto}
        <button class="mini" onclick={() => choose(null)}>Use first free cell</button>
      {/if}
    {:else}
      <span class="mono">No target: {placement.reason}</span>
    {/if}
  </div>

  {#if status}<div class="status">{status}</div>{/if}

  {#if loadError}
    <div class="empty">Could not read the block roster — connect a device, then Reload blocks.</div>
  {:else if loading && !rows.length}
    <div class="empty">Loading blocks…</div>
  {:else if !rows.length}
    <div class="empty">No curated blocks are available on this device.</div>
  {:else}
    <div class="blocks">
      {#each rows as row (row.slug)}
        {@const cat = glyphFor(row.name)}
        {@const placed = isQuickBuildPlaced(layout.cells, row.page)}
        <button
          class="block"
          class:placed
          disabled={placed}
          title={placed ? `${row.name} is already on the grid` : `Place ${row.name}`}
          onclick={() => place(row)}
        >
          <span
            class="chip"
            style="background:linear-gradient(180deg,{shade(cat.accent, 0.16)},{shade(cat.accent, -0.18)}); border-color:{shade(cat.accent, -0.3)};"
            >{cat.glyph}</span
          >
          <span class="blabel">{row.name}</span>
          {#if placed}<span class="on">on grid</span>{/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if layout.rows > 0 && layout.cols > 0}
    <div class="cells">
      <div class="cells-head">
        Pick a target cell
        <button class="mini" onclick={() => choose(null)} class:on={chosen === null}>first free</button>
      </div>
      <div class="grid" style={`grid-template-columns:repeat(${layout.cols}, minmax(0, 1fr));`}>
        {#each Array.from({ length: layout.rows }, (_, r) => r) as r (r)}
          {#each Array.from({ length: layout.cols }, (_, c) => c) as c (`${r},${c}`)}
            {@const occ = occupied.get(`${r},${c}`)}
            {@const isChosen = chosen?.row === r && chosen?.col === c}
            <button
              class="cell"
              class:occupied={!!occ}
              class:chosen={isChosen}
              disabled={!!occ}
              title={occ ? occ.display : `Cell ${r + 1},${c + 1}`}
              onclick={() => choose({ row: r, col: c })}
            >
              {occ ? '·' : '+'}
            </button>
          {/each}
        {/each}
      </div>
    </div>
  {/if}
</section>

<style>
  .quick-build {
    position: absolute;
    inset: 0;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: auto;
    background: var(--bg2);
    color: var(--text);
  }
  header {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px;
    border-bottom: 1px solid var(--border);
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  h2 {
    margin: 0;
    font-size: 15px;
  }
  p {
    margin: 0;
    color: var(--textdim);
    font-size: 11px;
  }
  .targetbar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    font-size: 11px;
    color: var(--accent);
    background: var(--accent-tint, transparent);
    border-bottom: 1px solid var(--border);
  }
  .targetbar.bad {
    color: var(--danger, #d6543f);
    background: color-mix(in srgb, var(--danger, #d6543f) 12%, transparent);
  }
  .status {
    flex: none;
    padding: 7px 12px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--textdim);
    border-bottom: 1px solid var(--border);
  }
  .btn {
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--accent-border, var(--border2));
    border-radius: 8px;
    background: var(--accent-tint, var(--surface));
    color: var(--accent);
    font-weight: 700;
    cursor: pointer;
  }
  .mini {
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--border2);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text2);
    font-size: 11px;
    cursor: pointer;
  }
  .mini.on {
    border-color: var(--accent-border, var(--border2));
    color: var(--accent);
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .blocks {
    flex: none;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 8px;
    padding: 12px;
  }
  .block {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 9px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }
  .block:hover:not(:disabled) {
    border-color: var(--accent-border, var(--border2));
  }
  .block.placed {
    opacity: 0.45;
    cursor: default;
  }
  .chip {
    flex: none;
    width: 30px;
    height: 24px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: var(--text);
    border: 1px solid;
  }
  .blabel {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .on {
    flex: none;
    font-size: 9.5px;
    font-weight: 700;
    color: var(--amber, #d6a43f);
  }
  .cells {
    flex: none;
    padding: 0 12px 12px;
  }
  .cells-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 6px;
    font-size: 11px;
    color: var(--textdim);
  }
  .grid {
    display: grid;
    gap: 3px;
  }
  .cell {
    height: 22px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface);
    color: var(--textdim);
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
  }
  .cell.occupied {
    background: var(--surface2, var(--bg));
    color: var(--textfaint, var(--textdim));
    cursor: default;
  }
  .cell.chosen {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-tint, transparent);
  }
  .empty {
    padding: 30px 20px;
    text-align: center;
    color: var(--textfaint, var(--textdim));
    font-size: 12px;
  }
  .mono {
    font-family: var(--font-mono);
  }
</style>
