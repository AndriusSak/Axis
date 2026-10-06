<script lang="ts">
  // Batch Set Parameter (parity audit §2.11) — "Set a parameter in multiple presets".
  //
  // Apply ONE parameter value to MANY stored device slots. There is no cross-preset param wire op, so
  // the work is a per-slot CLIENT-SIDE SEQUENCE over the endpoints that exist:
  //   GET /preset/locations → POST /preset/select → PUT /preset/blocks/:eid/params/:paramId → POST /preset/store
  // The planning + sequencing lives in `batchSetOps.ts` (unit-tested); this component only wires it to
  // `forgefx` + the editor store, shows a DRY-RUN preview, and gates the run behind an explicit confirm.
  //
  // ⚠ This is DESTRUCTIVE: every selected slot is OVERWRITTEN on the device. There is no undo.
  import { editor } from '../../editor.svelte';
  import { library } from '../../library.svelte';
  import { forgefx } from '../../forgefx';
  import {
    canBatchSet,
    planBatchSet,
    runBatchSet,
    type BatchSetIo,
    type BatchSetPreview,
    type BatchSetRequest,
    type BatchSetResult
  } from '../../batchSetOps';
  import type { PresetLocations } from '../../types';

  // The four device operations, bound to forgefx. `continuous` is passed through EXPLICITLY — the
  // server treats an omitted flag as discrete and clamps a bare ordinal, so a knob write must say so.
  const io: BatchSetIo = {
    locations: () => forgefx.presetLocations(),
    select: (number) => forgefx.selectPreset(number),
    setParam: (eid, paramId, value, continuous) => forgefx.setParam(eid, paramId, value, continuous),
    store: (number) => forgefx.store(number)
  };

  /** The originally selected preset — restored at the end of a run. */
  const restoreTo = $derived(typeof editor.preset?.number === 'number' ? editor.preset.number : null);
  const block = $derived(editor.selected);
  /** Addressable params of the open block (a served paramId is required — never invent one). */
  const params = $derived(editor.params.filter((p) => p.id != null));

  let locations = $state<PresetLocations | null>(null);
  let selected = $state<number[]>([]);
  let paramId = $state<number | null>(null);
  let eid = $state<number | null>(null);
  let value = $state(0.5);
  let continuous = $state(true);
  let preview = $state<BatchSetPreview | null>(null);
  let result = $state<BatchSetResult | null>(null);
  let confirmed = $state(false);
  let scanning = $state(false);
  let running = $state(false);
  let status = $state('');

  const current = $derived(params.find((p) => p.id === paramId) ?? null);
  const request = $derived<BatchSetRequest>({
    eid: eid ?? block?.effectId ?? -1,
    paramId: paramId ?? -1,
    value,
    continuous,
    paramName: current?.name
  });
  const addressable = $derived(canBatchSet(request.eid, request.paramId));
  const canApply = $derived(!!preview && !preview.blocked && preview.targets.length > 0 && confirmed && !running);

  async function scan() {
    if (scanning || running) return;
    scanning = true;
    status = 'Scanning device slots…';
    try {
      locations = await io.locations();
      status = `Found ${locations.count} stored slots`;
    } catch (e) {
      locations = null;
      status = `Scan failed: ${(e as Error).message}`;
    } finally {
      scanning = false;
    }
  }

  function toggle(location: number) {
    selected = selected.includes(location) ? selected.filter((l) => l !== location) : [...selected, location];
    preview = null;
    confirmed = false;
  }

  function pickParam(id: number) {
    paramId = id;
    const p = params.find((x) => x.id === id);
    if (p) value = p.norm ?? p.value ?? value;
    preview = null;
    confirmed = false;
  }

  /** Dry run — decides exactly which slots would change. Touches NO device state. */
  function dryRun() {
    if (!locations) return;
    preview = planBatchSet(locations, selected, request, restoreTo);
    result = null;
    confirmed = false;
    status = preview.blocked
      ? `Blocked: ${preview.blocked}`
      : `Dry run: ${preview.targets.length} slot(s) would be overwritten, ${preview.skipped.length} skipped`;
  }

  async function apply() {
    if (!preview || !canApply) return;
    running = true;
    status = `Writing ${preview.targets.length} slot(s)…`;
    try {
      result = await runBatchSet(preview, io);
      status = result.abortedAt != null
        ? `Aborted at slot ${result.abortedAt} (${result.error}). ${result.written.length} slot(s) already written.`
        : `Done: ${result.written.length} slot(s) overwritten${result.restored ? ' — original preset restored' : ''}.`;
      if (result.written.length) {
        // The edit buffer was replaced; refresh the library summaries for the touched slots.
        for (const loc of result.written) void library.refreshSlot(loc);
      }
    } catch (e) {
      status = `Batch set failed: ${(e as Error).message}`;
    } finally {
      running = false;
      confirmed = false;
      preview = null;
    }
  }

  const label = (loc: number) => {
    const e = locations?.locations.find((l) => l.location === loc);
    return e ? `${e.code ?? String(loc).padStart(3, '0')} · ${e.name}` : String(loc).padStart(3, '0');
  };
</script>

<section class="batch-set">
  <header>
    <div class="titles">
      <h2>Batch Set Parameter</h2>
      <p>Apply one parameter value to many stored presets at once (§2.11).</p>
    </div>
    <button class="btn" onclick={scan} disabled={scanning || running}>{scanning ? 'Scanning…' : 'Scan slots'}</button>
  </header>

  <div class="warn" role="alert">
    <strong>Destructive.</strong> This <em>overwrites</em> every selected slot on the device — the value you set
    is stored into each preset, replacing what was there. There is no undo.
  </div>

  {#if status}<div class="status">{status}</div>{/if}

  <div class="form">
    <div class="field">
      Block
      <span class="readout">{block ? `${block.display} (eid ${block.effectId})` : 'no block open'}</span>
    </div>
    <label>
      Parameter
      <select value={paramId ?? ''} onchange={(e) => pickParam(Number((e.currentTarget as HTMLSelectElement).value))} disabled={!params.length}>
        <option value="" disabled>Pick a parameter…</option>
        {#each params as p (p.id)}
          <option value={p.id}>{p.name} (id {p.id})</option>
        {/each}
      </select>
    </label>
    <label>
      Value
      <input type="number" step="any" bind:value />
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={continuous} />
      continuous (normalized 0..1 knob — uncheck for a discrete enum ordinal)
    </label>
  </div>

  {#if !addressable}
    <div class="gate">Pick a block and a parameter (a served paramId is required) — a batch write with no addressable target is blocked.</div>
  {/if}

  {#if locations}
    <div class="slots">
      <div class="slots-head">
        {locations.count} stored slots — select the ones to overwrite
        <button class="mini" onclick={() => { selected = locations!.locations.filter((l) => !l.isEmpty).map((l) => l.location); preview = null; confirmed = false; }}>All non-empty</button>
        <button class="mini" onclick={() => { selected = []; preview = null; confirmed = false; }}>None</button>
      </div>
      <div class="slot-list">
        {#each locations.locations as entry (entry.location)}
          <label class="slot" class:empty={entry.isEmpty}>
            <input type="checkbox" checked={selected.includes(entry.location)} disabled={entry.isEmpty} onchange={() => toggle(entry.location)} />
            <span class="code">{entry.code ?? String(entry.location).padStart(3, '0')}</span>
            <span class="name">{entry.isEmpty ? '(empty)' : entry.name}</span>
          </label>
        {/each}
      </div>
    </div>

    <div class="actions">
      <button class="btn" onclick={dryRun} disabled={!addressable || !selected.length || running}>Preview (dry run)</button>
    </div>
  {/if}

  {#if preview}
    <div class="preview">
      <h3>Dry-run preview</h3>
      {#if preview.blocked}
        <p class="blocked">{preview.blocked}</p>
      {:else}
        <p>
          <strong>{preview.targets.length}</strong> slot(s) would be <em>overwritten</em> with
          {current?.name ?? `param ${request.paramId}`} = {request.value}
          ({request.continuous ? 'continuous' : 'discrete'}).
        </p>
        <ul class="targets">
          {#each preview.targets as t (t.location)}
            <li>{label(t.location)}</li>
          {/each}
        </ul>
        {#if preview.skipped.length}
          <p class="skipped-head">Skipped:</p>
          <ul class="skipped">
            {#each preview.skipped as s}
              <li>slot {s.location} — {s.reason}</li>
            {/each}
          </ul>
        {/if}
        <label class="confirm">
          <input type="checkbox" bind:checked={confirmed} />
          I understand this permanently overwrites the {preview.targets.length} listed slot(s) on the device.
        </label>
        <button class="btn danger" onclick={apply} disabled={!canApply}>
          {running ? 'Writing…' : `Overwrite ${preview.targets.length} slot(s)`}
        </button>
      {/if}
    </div>
  {/if}

  {#if result}
    <div class="result" class:bad={result.abortedAt != null}>
      {#if result.abortedAt != null}
        Aborted at slot {result.abortedAt}: {result.error}.
        <strong>{result.written.length}</strong> slot(s) were already written
        {#if result.written.length}: {result.written.map((l) => String(l).padStart(3, '0')).join(', ')}{/if}.
      {:else}
        Overwrote <strong>{result.written.length}</strong> slot(s).
      {/if}
      {result.restoreTo != null ? (result.restored ? ' Original preset restored.' : ' Could not restore the original preset.') : ''}
    </div>
  {/if}
</section>

<style>
  .batch-set {
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
  .warn {
    flex: none;
    padding: 9px 12px;
    font-size: 11.5px;
    color: var(--amber, #d6a43f);
    background: color-mix(in srgb, var(--amber, #d6a43f) 12%, transparent);
    border-bottom: 1px solid var(--border);
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
  .btn.danger {
    border-color: var(--danger, #d6543f);
    background: color-mix(in srgb, var(--danger, #d6543f) 16%, transparent);
    color: var(--danger, #d6543f);
  }
  .btn:disabled,
  .mini:disabled {
    opacity: 0.4;
    cursor: default;
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
  .form {
    flex: none;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 10px;
    padding: 12px;
  }
  .form label,
  .form .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    color: var(--textdim);
  }
  .form .check {
    flex-direction: row;
    align-items: center;
    gap: 6px;
  }
  .readout {
    color: var(--text);
    font-size: 12px;
  }
  select,
  input[type='number'] {
    height: 28px;
    padding: 0 6px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--input, var(--bg2));
    color: var(--text);
    font-size: 12px;
  }
  .gate {
    padding: 10px 12px;
    color: var(--amber, #d6a43f);
    font-size: 11.5px;
  }
  .slots {
    flex: none;
    padding: 0 12px 12px;
  }
  .slots-head {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--textdim);
    padding-bottom: 6px;
  }
  .slot-list {
    max-height: 220px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .slot {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    font-size: 11.5px;
    border-bottom: 1px solid var(--border);
  }
  .slot.empty {
    opacity: 0.5;
  }
  .slot .code {
    font-family: var(--font-mono);
    color: var(--text2);
  }
  .slot .name {
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .actions {
    flex: none;
    padding: 0 12px 12px;
  }
  .preview,
  .result {
    flex: none;
    margin: 0 12px 12px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }
  .preview h3 {
    margin: 0 0 6px;
    font-size: 12.5px;
  }
  .targets,
  .skipped {
    margin: 6px 0;
    padding-left: 18px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text2);
    max-height: 180px;
    overflow: auto;
  }
  .skipped-head {
    color: var(--textdim);
  }
  .confirm {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 10px 0;
    font-size: 11.5px;
    color: var(--text);
  }
  .result.bad {
    border-color: var(--danger, #d6543f);
    color: var(--danger, #d6543f);
  }
</style>
