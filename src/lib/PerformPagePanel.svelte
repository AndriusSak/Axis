<script lang="ts">
  // Per-preset PERFORMANCE PAGE (§2.2) — a READ-ONLY view of the ten controls assigned to the CURRENT
  // preset's device Performance page, decoded server-side from the edit buffer
  // (`forgefx.performPage()` → GET /preset/perform). Fetched lazily on the Read button, never on mount,
  // so opening Device Tools fires no device traffic.
  //
  // HONESTY: an unassigned slot (effectId 0) still carries STALE leftover label text from whatever
  // last occupied it, so `performPageView` blanks it and we render "unassigned" — never the dead string.
  import { forgefx } from './forgefx';
  import { assignedCount, performPageRows, type PerformRow } from './performPageView';
  import type { PerformPage } from './types';

  let page = $state<PerformPage | null>(null);
  let rows = $state<PerformRow[]>([]);
  let loading = $state(false);
  let loaded = $state(false);
  let error = $state('');

  async function load() {
    loading = true;
    error = '';
    try {
      const p = await forgefx.performPage();
      page = p;
      rows = performPageRows(p);
      loaded = true;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }
</script>

<section>
  <h3>Per-preset Performance Page</h3>
  <div class="line">
    <span>Read-only — the ten controls assigned to the current preset's Performance page (decoded from the edit buffer)</span>
    <button onclick={load} disabled={loading}>{loading ? 'Reading…' : 'Read page'}</button>
  </div>
  {#if error}<p class="note err">{error}</p>{/if}
  {#if loaded}
    {#if !rows.length}
      <p class="note">No performance page found in this preset.</p>
    {:else}
      <p class="note mono">{assignedCount(page)}/10 slots assigned</p>
      <div class="list">
        <div class="prow head">
          <span class="slot mono">slot</span>
          <span class="nm">effect · param</span>
          <span class="ids mono">eid / pid</span>
        </div>
        {#each rows as r (r.slot)}
          <div class="prow" class:off={!r.assigned}>
            <span class="slot mono">{r.slot}</span>
            <span class="nm">
              {#if r.assigned}
                <b>{r.effectLabel || '—'}</b>{#if r.paramLabel} · {r.paramLabel}{/if}
              {:else}
                <span class="un">unassigned</span>
              {/if}
            </span>
            <span class="ids mono">{r.assigned ? `${r.effectId} / ${r.paramId}` : '—'}</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</section>

<style>
  section { margin-top: 14px; }
  h3 { margin: 0 0 8px; font-size: 13px; }
  .line { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .line > span { flex: 1; min-width: 0; font-size: 12px; opacity: 0.85; }
  button {
    border: 1px solid var(--line, #33343a);
    background: var(--panel2, #24252b);
    color: inherit;
    border-radius: 7px;
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  button:disabled { opacity: 0.5; cursor: default; }
  .note { margin: 6px 0; font-size: 12px; opacity: 0.8; }
  .note.err { color: #ff6b6b; }
  .list { display: flex; flex-direction: column; gap: 2px; }
  .prow { display: grid; grid-template-columns: 42px 1fr 96px; align-items: center; gap: 8px;
    padding: 4px 6px; border-radius: 6px; font-size: 12px; }
  .prow.head { opacity: 0.55; text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px; }
  .prow.off { opacity: 0.5; }
  .slot { text-align: right; }
  .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .un { font-style: italic; opacity: 0.75; }
  .ids { text-align: right; opacity: 0.85; }
  .mono { font-family: var(--font-mono, ui-monospace, monospace); }
</style>
