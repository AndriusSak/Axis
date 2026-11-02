<script lang="ts">
  // Controllers → METRONOME (FM3-Edit's Tempo/Pitch page, layouts.generated.ts:1880-1888).
  //
  // WHY THIS FETCHES ITS OWN PARAMS: the controls live in the GLOBAL block (eid 1) as `crossBlock`
  // refs, while the Controllers screen has eid 2 open — so `editor.params` (the open block's served
  // set) does not contain them. This section reads GET /global/params, which is the same blockParams(1)
  // decode with `watch: false`: it must NOT move the FM3 front-panel poll off the block the user has
  // open. Writes are pid-addressed SETs on eid 1 (measured 2026-10-30 on the GLOBAL perform page).
  //
  // HONESTY RULES (same as MidiRemoteSection):
  //   • A spec the device did not serve is a GATED row with the reason — never a control on an
  //     invented id. A unit below fw 12.00 genuinely has no metronome toggle.
  //   • A served param the device could not resolve renders inert, never a knob parked at 0.
  //   • A refused write reverts the control and says so; it is never left showing a value the unit
  //     did not take.
  import { onMount } from 'svelte';
  import { forgefx } from './forgefx';
  import { editor } from './editor.svelte';
  import Knob from './Knob.svelte';
  import Dropdown from './Dropdown.svelte';
  import { fmtValue } from './format';
  import { buildMetronomeRows, metronomeServed, METRONOME_EID } from './metronome';
  import type { NamedParam, EnumParam } from './types';

  let params = $state<NamedParam[]>([]);
  let enums = $state<EnumParam[]>([]);
  let phase = $state<'loading' | 'ready' | 'error'>('loading');
  let error = $state('');

  // The pids differ per unit (FM3 14878 / FM9 14907 / III 14655), so the table follows the detected
  // model. Before a device answers nothing is served, so the fallback can only produce gated rows.
  const rows = $derived(buildMetronomeRows(params, enums, editor.detected?.modelId));
  const served = $derived(metronomeServed(rows));

  // The unit's own label wins over our fallback: the served param carries the name the front panel
  // shows, which is the only label that is true for every model.
  const labelOf = (r: { spec: { label: string }; param?: NamedParam; enumParam?: EnumParam }) =>
    r.param?.name || r.enumParam?.name || r.spec.label;

  const pUnknown = (p: NamedParam) => p.unresolved != null || p.norm == null;
  const eUnknown = (e: EnumParam) => e.unresolved != null || e.value == null;

  async function load() {
    phase = 'loading';
    error = '';
    try {
      const p = await forgefx.globalParams();
      params = p.named;
      enums = p.enums;
      phase = 'ready';
    } catch (e) {
      error = (e as Error).message;
      phase = 'error';
    }
  }

  // Knob drags fire per pointer move; coalesce to one write per pid per 60 ms (the same cadence the
  // editor's own write debounce uses) so a drag cannot flood the device.
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  function setKnob(p: NamedParam, norm: number) {
    if (p.id == null || p.norm == null) return;
    const pid = p.id;
    const from = p.norm;
    p.norm = norm; // optimistic — the readout follows the drag
    const prev = timers.get(pid);
    if (prev) clearTimeout(prev);
    timers.set(
      pid,
      setTimeout(async () => {
        timers.delete(pid);
        try {
          const r = await forgefx.setParam(METRONOME_EID, pid, norm, true);
          if (!r.ok) {
            p.norm = from;
            editor.showToast(`Metronome: the unit refused ${p.name}`, '#d6543f');
          }
        } catch (e) {
          p.norm = from;
          editor.showToast(`Metronome: write failed — ${(e as Error).message}`, '#d6543f');
        }
      }, 60)
    );
  }

  async function setSel(e: EnumParam, value: number) {
    if (e.value == null) return;
    const from = e.value;
    e.value = value;
    try {
      const r = await forgefx.setParam(METRONOME_EID, e.id, value, false);
      if (!r.ok) {
        e.value = from;
        editor.showToast(`Metronome: the unit refused ${e.name}`, '#d6543f');
      }
    } catch (err) {
      e.value = from;
      editor.showToast(`Metronome: write failed — ${(err as Error).message}`, '#d6543f');
    }
  }

  onMount(load);
</script>

<section class="metro">
  <header class="mh">
    <h3>Metronome</h3>
    <span class="sub">Controllers → Tempo/Pitch · served from the GLOBAL block (eid 1)</span>
    <span class="spacer"></span>
    <button class="refresh" onclick={load} disabled={phase === 'loading'} title="Re-read the metronome settings from the unit">
      {phase === 'loading' ? '…' : '↻'}
    </button>
  </header>

  {#if phase === 'error'}
    <div class="msg">Couldn't read the metronome settings — {error}</div>
  {:else if phase === 'loading' && params.length === 0 && enums.length === 0}
    <div class="msg">Reading the metronome settings…</div>
  {:else if !served}
    <div class="msg">
      This unit's read did not include the metronome toggle, so there is nothing here to control.
      {#if editor.detected?.modelId === 0x11}On an FM3 the toggle needs firmware 12.00 or newer.{/if}
    </div>
  {:else}
    <div class="grid">
      {#each rows as r (r.spec.id)}
        {#if r.status === 'knob'}
          {#if pUnknown(r.param)}
            <div class="gated" title={`${labelOf(r)} — value unavailable: ${r.param.unresolved ?? 'the device did not resolve it'}`}>
              <span class="gl">{labelOf(r)}</span>
              <span class="gw">value unavailable — {r.param.unresolved ?? 'the device did not resolve it'}</span>
            </div>
          {:else}
            <Knob
              value={r.param.norm!}
              label={labelOf(r)}
              valueText={fmtValue(r.param)}
              onInput={(v) => setKnob(r.param, v)}
              onReset={() => setKnob(r.param, 0)}
            />
          {/if}
        {:else if r.status === 'select'}
          {#if r.spec.widget === 'toggle' && r.enumParam.options.length === 2}
            <!-- FM3-Edit draws this one as a toggle, not a dropdown. -->
            <div class="ctl">
              <button
                class="tog"
                class:on={r.enumParam.value === 1}
                disabled={eUnknown(r.enumParam)}
                title={`${r.spec.name} (pid ${r.spec.id})`}
                onclick={() => setSel(r.enumParam, r.enumParam.value === 1 ? 0 : 1)}
              >
                <span class="dot"></span>
                <span class="tl">{labelOf(r)}</span>
                <span class="tv mono">{eUnknown(r.enumParam) ? '—' : (r.enumParam.options.find((o) => o.value === r.enumParam.value)?.label ?? '—')}</span>
              </button>
            </div>
          {:else}
            <div class="ctl">
              <Dropdown
                label={labelOf(r)}
                value={r.enumParam.value}
                options={r.enumParam.options}
                onChange={(v) => setSel(r.enumParam, v)}
              />
              <span class="hint" title={`${r.spec.name} (pid ${r.spec.id})`}>{r.spec.name}</span>
            </div>
          {/if}
        {:else}
          <div class="gated" title={`${r.spec.label} (${r.spec.name}) — not served: ${r.reason}`}>
            <span class="gl">{r.spec.label}</span>
            <span class="gw">not served on this device — {r.reason}</span>
          </div>
        {/if}
      {/each}
    </div>
    <p class="note">
      The click follows the global Tempo (top bar). Levels are per output; Metronome CC is the
      controller that toggles it from a pedal or footswitch.
    </p>
  {/if}
</section>

<style>
  .metro {
    flex: none;
    padding: 14px 18px 10px;
    border-bottom: 1px solid var(--border2);
  }
  .mh {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-bottom: 12px;
  }
  .mh h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    color: var(--text);
  }
  .sub {
    font-size: 11px;
    color: var(--textdim);
  }
  .spacer {
    flex: 1;
  }
  .refresh {
    background: transparent;
    border: 1px solid var(--border2);
    color: var(--text2);
    border-radius: 7px;
    padding: 2px 9px;
    font-size: 13px;
    line-height: 1.4;
    cursor: pointer;
  }
  .refresh:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .refresh:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 16px 20px;
    align-items: flex-start;
  }
  .ctl {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .hint {
    font-size: 10.5px;
    line-height: 1.3;
    color: var(--textdim);
    max-width: 180px;
  }
  .tog {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 12px;
    border: 1px solid var(--border2);
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.02);
    color: var(--text2);
    cursor: pointer;
    font: inherit;
  }
  .tog .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--textdim);
  }
  .tog.on {
    border-color: var(--accent);
    color: var(--text);
  }
  .tog.on .dot {
    background: var(--accent);
    box-shadow: 0 0 6px var(--accent);
  }
  .tog:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .tl {
    font-size: 12px;
    font-weight: 600;
  }
  .tv {
    font-size: 11px;
    color: var(--textdim);
  }
  .gated {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 150px;
    max-width: 320px;
    padding: 9px 11px;
    border: 1px dashed var(--border2);
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.015);
    opacity: 0.85;
    cursor: not-allowed;
  }
  .gl {
    font-size: 12px;
    font-weight: 600;
    color: var(--text2);
  }
  .gw {
    font-size: 10.5px;
    line-height: 1.35;
    color: var(--textdim);
  }
  .msg {
    font-size: 12.5px;
    color: var(--textdim);
    padding: 4px 0 6px;
  }
  .note {
    margin: 12px 0 0;
    font-size: 10.5px;
    line-height: 1.4;
    color: var(--textdim);
    max-width: 640px;
  }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
</style>
