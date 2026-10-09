<script lang="ts">
  // Per-preset PERFORMANCE PAGE (§2.2) — the ten controls assigned to the CURRENT preset's device
  // Performance page, decoded server-side from the edit buffer (`forgefx.performPage()` →
  // GET /preset/perform). Fetched lazily on the Read button, never on mount, so opening Device Tools
  // fires no device traffic.
  //
  // WRITE: a slot can be re-pointed at another effect/param (ids AND labels together — patching one
  // and not the other leaves the slot showing the old target's name). The server sends the recompressed
  // preset to the unit's EDIT BUFFER, so NOTHING IS SAVED and reloading the preset discards it. The
  // answer is a READ-BACK verdict, not an ack: `ok:false` is a normal outcome and is reported as such.
  //
  // HONESTY: an unassigned slot (effectId 0) still carries STALE leftover label text from whatever
  // last occupied it, so `performPageView` blanks it and we render "unassigned" — never the dead string.
  // The editor therefore starts BLANK for an unassigned slot rather than prefilling stale text.
  import { forgefx } from './forgefx';
  import {
    assignedCount, clearLabelOnTargetChange, patchFromFields, performPageRows, writeVerdict,
    type PerformRow, type PerformSlotFields
  } from './performPageView';
  import type { PerformPage } from './types';

  const EMPTY: PerformSlotFields = { effectId: '', paramId: '', effectLabel: '', paramLabel: '' };

  let page = $state<PerformPage | null>(null);
  let rows = $state<PerformRow[]>([]);
  let loading = $state(false);
  let loaded = $state(false);
  let error = $state('');

  // ── write side ──
  let editSlot = $state<number | null>(null);
  let fields = $state<PerformSlotFields>({ ...EMPTY });
  let writing = $state(false);
  let verdict = $state('');
  let verdictOk = $state(false);
  /** The label whose target was edited since it was prefilled, so it no longer names what it points at. */
  let labelCleared = $state('');

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

  /** The Read button: a fresh read is also where an in-progress edit and the last verdict are dropped. */
  function readPage() {
    editSlot = null;
    verdict = '';
    void load();
  }

  function startEdit(r: PerformRow) {
    verdict = '';
    verdictOk = false;
    labelCleared = '';
    editSlot = r.slot;
    fields = {
      effectId: r.assigned ? String(r.effectId) : '', // an unassigned slot's ids are 0, not "the old target"
      paramId: r.assigned ? String(r.paramId) : '',
      effectLabel: r.effectLabel,
      paramLabel: r.paramLabel
    };
  }

  /**
   * Changing a TARGET clears the label that names it. The rule itself lives (and is unit-tested) in the
   * pure view model — `clearLabelOnTargetChange`; here we only apply its result. An already-empty label
   * clears nothing and raises no notice, so we touch neither the fields nor the marker in that case.
   */
  function onIdChange(which: 'effectLabel' | 'paramLabel') {
    const next = clearLabelOnTargetChange(fields, which);
    if (next.cleared) {
      fields = next.fields;
      labelCleared = next.cleared;
    }
  }

  function cancelEdit() {
    editSlot = null;
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
      const res = await forgefx.setPerformSlot(editSlot, patch);
      await load(); // show what the unit NOW holds; the verdict below says whether it matches
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
  <h3>Per-preset Performance Page</h3>
  <div class="line">
    <span>The ten controls assigned to the current preset's Performance page (decoded from the edit buffer)</span>
    <button onclick={readPage} disabled={loading}>{loading ? 'Reading…' : 'Read page'}</button>
  </div>
  {#if error}<p class="note err">{error}</p>{/if}
  {#if verdict}<p class="note" class:err={!verdictOk}>{verdict}</p>{/if}
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
          <span class="act"></span>
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
            <span class="act">
              <button class="mini" onclick={() => startEdit(r)} disabled={writing || editSlot === r.slot}>Edit</button>
            </span>
          </div>
          {#if editSlot === r.slot}
            <div class="edit">
              <label>effect id<input bind:value={fields.effectId} inputmode="numeric" placeholder="e.g. 62" oninput={() => onIdChange('effectLabel')} /></label>
              <label>param id<input bind:value={fields.paramId} inputmode="numeric" placeholder="e.g. 41" oninput={() => onIdChange('paramLabel')} /></label>
              <label class:cleared={labelCleared === 'effectLabel'}>effect label<input bind:value={fields.effectLabel} placeholder="CAB" /></label>
              <label class:cleared={labelCleared === 'paramLabel'}>param label<input bind:value={fields.paramLabel} placeholder="Proximity Frequ" /></label>
              <div class="actions">
                <button class="mini go" onclick={write} disabled={writing}>{writing ? 'Writing…' : 'Write to unit'}</button>
                <button class="mini" onclick={cancelEdit} disabled={writing}>Cancel</button>
                <span class="warn">Writes the unit's EDIT BUFFER — not saved; reloading the preset discards it.</span>
              </div>
              {#if labelCleared}
                <span class="warn">The {labelCleared === 'effectLabel' ? 'effect' : 'param'} label was CLEARED because
                  its target changed — re-enter the name that belongs to the new target. A label left over from
                  the old target reads back as confirmed, and names the wrong thing.</span>
              {/if}
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
