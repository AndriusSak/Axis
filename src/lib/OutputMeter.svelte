<script lang="ts">
  // The Output block's live output level — the FM3's "Output Level" meters.
  //
  // Source: the Preset Leveling meters (fn 0x19, Output 1 & 2 × L/R) that the server already streams
  // over SSE and `editor.levels` mirrors. They are the SAME reading the front panel shows after the
  // Output block's Level/Pan, and they cost no per-block serial reads — so this meter can stay on
  // permanently, unlike the opt-in per-block METER poll.
  import { editor } from './editor.svelte';

  let { variant = 'editor' }: { variant?: 'editor' | 'widget' } = $props();

  const dbMin = -40;
  const dbMax = 6; // matches FM3_MONITOR_PARAMS (OUTPUT_VUL/VUR, minDb -40 / maxDb +6)
  const io = $derived(editor.levels);
  const out2 = $derived(io && (io.out2L > dbMin + 0.5 || io.out2R > dbMin + 0.5) ? io : null);
  const fill = (db: number) => Math.max(0, Math.min(100, ((db - dbMin) / (dbMax - dbMin)) * 100));
  const color = (db: number) => (db >= -1 ? 'var(--danger)' : db >= -6 ? 'var(--amber)' : 'var(--ok)');
  const fmt = (db: number) => `${db >= 0 ? '+' : ''}${db.toFixed(1)}`;
</script>

<div
  class="outmeter"
  data-testid="output-meter"
  data-variant={variant}
  title={io
    ? `Live output level — FM3 Preset Leveling meters (Output 1${out2 ? ' + 2' : ''}, L/R), −40…+6 dB`
    : 'Output level — waiting for the device meters'}
>
  <div class="row" class:dim={!!io && io.out1L <= dbMin && io.out1R <= dbMin}>
    <span class="lbl mono">OUT 1</span>
    <div class="bars">
      <span class="bar"><span class="fill" style="width:{io ? fill(io.out1L) : 0}%; background:{io ? color(io.out1L) : 'transparent'}"></span></span>
      <span class="bar"><span class="fill" style="width:{io ? fill(io.out1R) : 0}%; background:{io ? color(io.out1R) : 'transparent'}"></span></span>
    </div>
    <span class="db mono">{io ? `${fmt(Math.max(io.out1L, io.out1R))}` : '—'}</span>
  </div>
  {#if out2}
    <div class="row">
      <span class="lbl mono">OUT 2</span>
      <div class="bars">
        <span class="bar"><span class="fill" style="width:{fill(out2.out2L)}%; background:{color(out2.out2L)}"></span></span>
        <span class="bar"><span class="fill" style="width:{fill(out2.out2R)}%; background:{color(out2.out2R)}"></span></span>
      </div>
      <span class="db mono">{fmt(Math.max(out2.out2L, out2.out2R))}</span>
    </div>
  {/if}
</div>

<style>
  .outmeter {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--surface2);
    background: var(--bg);
  }
  .outmeter[data-variant='widget'] {
    padding: 0;
    border: 0;
    background: none;
    gap: 3px;
    width: 100%;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    transition: opacity 160ms ease;
  }
  .row.dim {
    opacity: 0.55;
  }
  .lbl {
    flex: none;
    width: 34px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--text-dim, #8a8a93);
  }
  [data-variant='widget'] .lbl {
    width: 30px;
    font-size: 9px;
  }
  .bars {
    flex: 1 1 auto;
    min-width: 48px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  [data-variant='widget'] .bars {
    min-width: 36px;
  }
  .bar {
    display: block;
    height: 6px;
    border-radius: 3px;
    overflow: hidden;
    background: var(--track, rgba(255, 255, 255, 0.08));
  }
  [data-variant='widget'] .bar {
    height: 4px;
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: 3px;
    transition: width 90ms linear, background-color 120ms linear;
  }
  .db {
    flex: none;
    min-width: 40px;
    text-align: right;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    color: var(--text-dim, #8a8a93);
  }
  [data-variant='widget'] .db {
    min-width: 34px;
    font-size: 9px;
  }
</style>
