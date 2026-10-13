<script lang="ts">
  // Setup → MIDI / Remote (parity audit §2.8). Renders ONLY the served GLOBAL MIDI params (live from
  // the open block's params/enums — see midiRemote.ts for the verified ground truth) plus honest,
  // disabled rows for the FM3-Edit MIDI features that the served param set cannot represent.
  import { editor } from './editor.svelte';
  import Knob from './Knob.svelte';
  import Dropdown from './Dropdown.svelte';
  import { fmtValue } from './format';
  import { buildMidiRemoteRows, MIDI_REMOTE_GAPS } from './midiRemote';
  import { buildControlSwitchRows, CONTROL_SWITCH_GAPS } from './controlSwitch';
  // FC Config — the served FC-device startup/mirror params (GLOBAL 3602-3604 / 3606-3608). Their only
  // layout refs live in the FC family "Devices" page, so the GLOBAL board never drew them here; this
  // group surfaces them from the served params (fcConfig.ts holds the verified ground truth).
  import { buildFcConfigRows, FC_CONFIG_GAPS } from './fcConfig';
  import type { NamedParam, EnumParam } from './types';

  const rows = $derived(buildMidiRemoteRows(editor.params, editor.enums));
  // Control Switches (CS) group — served GLOBAL CS params that the FM3 editor layouts do NOT reference
  // (see controlSwitch.ts for the verified ground truth), so nothing else draws them on the Setup screen.
  const csRows = $derived(buildControlSwitchRows(editor.params, editor.enums));
  // FC Config group — served GLOBAL FC-device startup + mirror params (see fcConfig.ts).
  const fcRows = $derived(buildFcConfigRows(editor.params, editor.enums));
  const setKnob = (p: NamedParam, n: number) => editor.setParam(p, n);
  const setSel = (e: EnumParam, v: number) => editor.setEnum(e, v);
  // A served GLOBAL param the device could not resolve (server `unresolved` marker, or no position)
  // renders an inert unknown tile, NEVER a knob parked at 0 or a dropdown on a fabricated ordinal.
  const pUnknown = (p: NamedParam) => p.unresolved != null || p.norm == null;
  const eUnknown = (e: EnumParam) => e.unresolved != null || e.value == null;
</script>

<section class="midi">
  <header class="mh">
    <h3>MIDI / Remote</h3>
    <span class="sub">Setup → MIDI / Remote · served from the GLOBAL block (eid 1)</span>
  </header>

  <div class="grid">
    {#each rows as r (r.spec.id)}
      {#if r.status === 'knob'}
        {#if pUnknown(r.param)}
          <div class="gated" title={`${r.param.name} — value unavailable: ${r.param.unresolved ?? 'the device did not resolve it'}`}>
            <span class="gl">{r.param.name}</span>
            <span class="gw">value unavailable — {r.param.unresolved ?? 'the device did not resolve it'}</span>
          </div>
        {:else}
          <Knob
            value={r.param.norm!}
            label={r.param.name}
            valueText={fmtValue(r.param)}
            onInput={(v) => setKnob(r.param, v)}
            onReset={() => setKnob(r.param, 0)}
          />
        {/if}
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

  <div class="subhead">Control Switches</div>
  <div class="grid">
    {#each csRows as r (r.spec.id)}
      {#if r.status === 'knob'}
        {#if pUnknown(r.param)}
          <div class="gated" title={`${r.spec.label} — value unavailable: ${r.param.unresolved ?? 'the device did not resolve it'}`}>
            <span class="gl">{r.spec.label}</span>
            <span class="gw">value unavailable — {r.param.unresolved ?? 'the device did not resolve it'}</span>
          </div>
        {:else}
          <Knob
            value={r.param.norm!}
            label={r.param.name}
            valueText={fmtValue(r.param)}
            onInput={(v) => setKnob(r.param, v)}
            onReset={() => setKnob(r.param, 0)}
          />
        {/if}
      {:else if r.status === 'select'}
        <div class="ctl">
          <Dropdown
            label={r.enumParam.name}
            value={r.enumParam.value}
            options={r.enumParam.options}
            onChange={(v) => setSel(r.enumParam, v)}
          />
          {#if r.ordinalOnly}
            <span class="hint" title={`${r.spec.name} (pid ${r.spec.id})`}>
              no option labels served — ordinal {eUnknown(r.enumParam) ? '—' : r.enumParam.value}
            </span>
          {/if}
        </div>
      {:else}
        <div class="gated" title={`${r.spec.label} (${r.spec.name}) — not served: ${r.reason}`}>
          <span class="gl">{r.spec.label}</span>
          <span class="gw">not served on this device — {r.reason}</span>
        </div>
      {/if}
    {/each}
  </div>

  {#if CONTROL_SWITCH_GAPS.length}
    <div class="gaps">
      {#each CONTROL_SWITCH_GAPS as g (g.label)}
        <div class="gated wide" title={`${g.addressing} — ${g.reason}`}>
          <span class="gl">{g.label}</span>
          <span class="gw">not possible — {g.reason}</span>
        </div>
      {/each}
    </div>
  {/if}

  <div class="subhead">FC Config</div>
  <div class="grid">
    {#each fcRows as r (r.spec.id)}
      {#if r.status === 'select'}
        <!-- The served `name` for these rows is a row/column index ("1 1"), NOT a name — use the
             spec's device-true label, with the raw param name + pid kept in the tooltip. -->
        <div class="ctl">
          <Dropdown
            label={r.spec.label}
            value={r.enumParam.value}
            options={r.enumParam.options}
            onChange={(v) => setSel(r.enumParam, v)}
          />
          {#if r.ordinalOnly}
            <span class="hint" title={`${r.spec.name} (pid ${r.spec.id})`}>
              no option labels served — ordinal {eUnknown(r.enumParam) ? '—' : r.enumParam.value}
            </span>
          {:else}
            <span class="hint" title={`${r.spec.name} (pid ${r.spec.id})`}>{r.spec.name}</span>
          {/if}
        </div>
      {:else if r.status === 'knob'}
        {#if pUnknown(r.param)}
          <div class="gated" title={`${r.spec.label} — value unavailable: ${r.param.unresolved ?? 'the device did not resolve it'}`}>
            <span class="gl">{r.spec.label}</span>
            <span class="gw">value unavailable — {r.param.unresolved ?? 'the device did not resolve it'}</span>
          </div>
        {:else}
          <Knob
            value={r.param.norm!}
            label={r.spec.label}
            valueText={fmtValue(r.param)}
            onInput={(v) => setKnob(r.param, v)}
            onReset={() => setKnob(r.param, 0)}
          />
        {/if}
      {:else}
        <div class="gated" title={`${r.spec.label} (${r.spec.name}) — not served: ${r.reason}`}>
          <span class="gl">{r.spec.label}</span>
          <span class="gw">not served on this device — {r.reason}</span>
        </div>
      {/if}
    {/each}
  </div>

  {#if FC_CONFIG_GAPS.length}
    <div class="gaps">
      {#each FC_CONFIG_GAPS as g (g.label)}
        <div class="gated wide" title={`${g.addressing} — ${g.reason}`}>
          <span class="gl">{g.label}</span>
          <span class="gw">not possible — {g.reason}</span>
        </div>
      {/each}
    </div>
  {/if}

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
  .subhead {
    margin: 16px 0 12px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text2);
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
