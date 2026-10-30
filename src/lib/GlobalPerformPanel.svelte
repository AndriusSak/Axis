<script lang="ts">
  // GLOBAL PERFORMANCE PAGE — the ten controls stored in the unit's GLOBAL settings, so they follow the
  // player from preset to preset (unlike the per-preset page above). Served by ForgeFX
  // `GET /global/perform`; a slot is written with `PUT /global/perform/:slot`.
  //
  // MEASURED 2026-10-30 on the FM3: the page sits in the eid-1 GLOBAL body; the id records and the
  // 16-bit-character label records take ordinary pid-addressed writes, and every write here is answered
  // with a READ-BACK of that body — `ok:false` is a normal outcome, shown with its reason, never hidden.
  //
  // HONESTY: an unassigned slot (effectId 0) is shown as "unassigned" — its record text is not surfaced,
  // and a slot whose ids landed without labels is called out rather than shown as a nameless control.
  import { forgefx } from './forgefx';
  import { patchFromFields, writeVerdict, type PerformSlotFields } from './performPageView';
  import {
    globalAssignedCount,
    globalPageHasUnlabelledSlots,
    globalPerformRows,
    type GlobalPerformRow
  } from './globalPerformView';
  import type { GlobalPerformPage } from './types';

  const EMPTY: PerformSlotFields = { effectId: '', paramId: '', effectLabel: '', paramLabel: '' };

  let page = $state<GlobalPerformPage | null>(null);
  let rows = $state<GlobalPerformRow[]>([]);
  let loading = $state(false);
  let loaded = $state(false);
  let error = $state('');

  let editSlot = $state<number | null>(null);
  let fields = $state<PerformSlotFields>({ ...EMPTY });
  let writing = $state(false);
  let verdict = $state('');
  let verdictOk = $state(false);

  async function load() {
    loading = true;
    error = '';
    try {
      const p = await forgefx.globalPerform();
      page = p;
      rows = globalPerformRows(p);
      loaded = true;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  function readPage() {
    editSlot = null;
    verdict = '';
    void load();
  }

  function startEdit(r: GlobalPerformRow) {
    verdict = '';
    verdictOk = false;
    editSlot = r.slot;
    fields = {
      effectId: r.assigned ? String(r.effectId) : '',
      paramId: r.assigned ? String(r.paramId) : '',
      effectLabel: r.effectLabel,
      paramLabel: r.paramLabel
    };
  }

  function cancelEdit() {
    editSlot = null;
  }

  /** Clear a slot: an empty target is the page's own "unassigned" state (effectId 0). */
  async function clearSlot() {
    if (editSlot === null) return;
    writing = true;
    try {
      const res = await forgefx.setGlobalPerformSlot(editSlot - 1, {
        effectId: 0,
        paramId: 0,
        effectLabel: '',
        paramLabel: ''
      });
      await load();
      verdictOk = res.ok;
      verdict = res.ok ? `Slot ${editSlot} cleared — read back from the unit.` : `Clear failed (${res.reason ?? 'unknown'}).`;
      editSlot = null;
    } catch (e) {
      verdictOk = false;
      verdict = (e as Error).message;
    } finally {
      writing = false;
    }
  }

  async function write() {
    if (editSlot === null) return;
    const patch = patchFromFields(fields);
    if (!patch) {
      verdictOk = false;
      verdict = 'Nothing to write — fill in at least one field.';
      return;
    }
    writing = true;
    try {
      const res = await forgefx.setGlobalPerformSlot(editSlot - 1, patch);
      await load();
      verdictOk = res.ok;
      verdict = writeVerdict(res);
      editSlot = null;
    } catch (e) {
      verdictOk = false;
      verdict = (e as Error).message;
    } finally {
      writing = false;
    }
  }
</script>

<section>
  <h3>Global Performance Page</h3>
  <div class="line">
    <span>The ten controls stored in the unit's GLOBAL settings — they follow you from preset to preset</span>
    <button onclick={readPage} disabled={loading}>{loading ? 'Reading…' : 'Read global page'}</button>
  </div>
  {#if error}<p class="note err">{error}</p>{/if}
  {#if verdict}<p class="note" class:err={!verdictOk}>{verdict}</p>{/if}
  {#if loaded}
    {#if !rows.length}
      <p class="note">This device does not report a Global Performance page.</p>
    {:else}
      <p class="note mono">{globalAssignedCount(page)}/10 slots assigned</p>
      {#if globalPageHasUnlabelledSlots(page)}
        <p class="note err">A slot holds a target but no label — the ids landed and the name did not. Re-enter it with Edit.</p>
      {/if}
      <div class="list">
        <div class="prow head">
          <span class="slot mono">slot</span>
          <span class="nm">effect · param</span>
          <span class="ids mono">eid / pid</span>
          <span class="act"></span>
        </div>
        {#each rows as r (r.slot)}
          <div class="prow" class:off={!r.assigned}>
            <span class="slot mono">{r.slot}</span>
            <span class="nm">
              {#if r.assigned}
                <b>{r.effectLabel || '(unlabelled)'}</b>{#if r.paramLabel} · {r.paramLabel}{/if}
              {:else}
                <span class="un">unassigned</span>
              {/if}
            </span>
            <span class="ids mono">{r.assigned ? `${r.effectId} / ${r.paramId}` : '—'}</span>
            <span class="act">
              <button class="mini" onclick={() => startEdit(r)} disabled={writing || editSlot === r.slot}>Edit</button>
            </span>
          </div>
          {#if editSlot === r.slot}
            <div class="edit">
              <label>effect id<input bind:value={fields.effectId} inputmode="numeric" placeholder="e.g. 58" /></label>
              <label>param id<input bind:value={fields.paramId} inputmode="numeric" placeholder="e.g. 11" /></label>
              <label>effect label<input bind:value={fields.effectLabel} placeholder="AMP" /></label>
              <label>param label<input bind:value={fields.paramLabel} placeholder="Master Vol" /></label>
              <div class="actions">
                <button class="mini go" onclick={write} disabled={writing}>{writing ? 'Writing…' : 'Write to unit'}</button>
                <button class="mini" onclick={clearSlot} disabled={writing}>Clear slot</button>
                <button class="mini" onclick={cancelEdit} disabled={writing}>Cancel</button>
                <span class="warn">Labels are 16 characters; a longer name is truncated. Not saved to flash by this call.</span>
              </div>
            </div>
          {/if}
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
  button.mini { padding: 3px 8px; font-size: 11px; }
  button.go { border-color: #4b7; }
  .note { margin: 6px 0; font-size: 12px; opacity: 0.8; }
  .note.err { color: #ff6b6b; }
  .list { display: flex; flex-direction: column; gap: 2px; }
  .prow { display: grid; grid-template-columns: 42px 1fr 96px 52px; align-items: center; gap: 8px;
    padding: 4px 6px; border-radius: 6px; font-size: 12px; }
  .prow.head { opacity: 0.55; text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px; }
  .prow.off { opacity: 0.5; }
  .slot { text-align: right; }
  .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .un { font-style: italic; opacity: 0.75; }
  .ids { text-align: right; opacity: 0.85; }
  .act { text-align: right; }
  .mono { font-family: var(--font-mono, ui-monospace, monospace); }
  .edit { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; margin: 2px 0 8px 48px;
    padding: 8px; border: 1px solid var(--line, #33343a); border-radius: 7px; }
  .edit label { display: flex; flex-direction: column; gap: 3px; font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.8; }
  .edit label input { width: 108px; font-size: 12px; padding: 4px 6px; border-radius: 5px;
    border: 1px solid var(--line, #33343a); background: var(--panel2, #24252b); color: inherit; }
  .edit .actions { display: flex; align-items: center; gap: 8px; flex: 1 1 100%; }
  .warn { font-size: 11px; opacity: 0.7; }
</style>
