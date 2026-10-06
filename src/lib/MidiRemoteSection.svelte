<script lang="ts">
  // Setup → MIDI / Remote (parity audit §2.8). Renders ONLY the served GLOBAL MIDI params (live from
  // the open block's params/enums — see midiRemote.ts for the verified ground truth) plus honest,
  // disabled rows for the FM3-Edit MIDI features that the served param set cannot represent.
  import { editor } from './editor.svelte';
  import Knob from './Knob.svelte';
  import Dropdown from './Dropdown.svelte';
  import { fmtValue } from './format';
  import { buildMidiRemoteRows, MIDI_REMOTE_GAPS } from './midiRemote';
  import type { NamedParam, EnumParam } from './types';

  const rows = $derived(buildMidiRemoteRows(editor.params, editor.enums));
  const setKnob = (p: NamedParam, n: number) => editor.setParam(p, n);
  const setSel = (e: EnumParam, v: number) => editor.setEnum(e, v);
</script>

<section class="midi">
  <header class="mh">
    <h3>MIDI / Remote</h3>
    <span class="sub">Setup → MIDI / Remote · served from the GLOBAL block (eid 1)</span>
  </header>

  <div class="grid">
    {#each rows as r (r.spec.id)}
      {#if r.status === 'knob'}
        <Knob
          value={r.param.norm ?? 0}
          label={r.param.name}
          valueText={fmtValue(r.param)}
          onInput={(v) => setKnob(r.param, v)}
          onReset={() => setKnob(r.param, 0)}
        />
      {:else if r.status === 'select'}
        <Dropdown
          label={r.enumParam.name}
          value={r.enumParam.value}
          options={r.enumParam.options}
          onChange={(v) => setSel(r.enumParam, v)}
        />
      {:else}
        <div class="gated" title={`${r.spec.label} (${r.spec.name}) — not served: ${r.reason}`}>
          <span class="gl">{r.spec.label}</span>
          <span class="gw">not served on this device — {r.reason}</span>
        </div>
      {/if}
    {/each}
  </div>

  {#if MIDI_REMOTE_GAPS.length}
    <div class="gaps">
      {#each MIDI_REMOTE_GAPS as g (g.label)}
        <div class="gated wide" title={`${g.addressing} — ${g.reason}`}>
          <span class="gl">{g.label}</span>
          <span class="gw">not possible — {g.reason}</span>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .midi {
    flex: none;
    padding: 14px 18px 8px;
    border-bottom: 1px solid var(--border2);
    max-height: 46vh;
    overflow-y: auto;
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
  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 16px 20px;
    align-items: flex-start;
  }
  .gaps {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 14px;
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
  .gated.wide {
    max-width: 420px;
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
</style>
