<script lang="ts">
  // The Connection picker: auto-detect, every serial/MIDI port, manual override.
  //
  // It used to live INSIDE ToolRail.svelte, which meant the workbench shell (which renders its own
  // rail and not ToolRail) had a connection widget whose click set `portsOpen` and opened nothing —
  // the LED was dead there. Rendered once from +page.svelte instead, so both shells share it.
  import { editor } from './editor.svelte';

  // USB-MIDI units (Axe-Fx III / FM9) expose In + Out as separate ports — pick one and pair the
  // matching opposite-direction port by name stem (e.g. "Axe-Fx III MIDI In" ⇄ "… MIDI Out").
  const stem = (s: string) =>
    s.toLowerCase().replace(/\b(midi|usb)\b/g, '').replace(/\b(in|out|input|output|rx|tx)\b/g, '').replace(/\s+/g, ' ').trim();
  type Port = { transport: 'serial' | 'midi'; id: string; dir?: 'input' | 'output' };
  function pickConn(p: Port) {
    if (p.transport !== 'midi') {
      editor.pickPort({ transport: 'serial', id: p.id });
      return;
    }
    const opp = editor.ports.filter((o) => o.transport === 'midi' && o.dir !== p.dir);
    const mate = opp.find((o) => stem(o.id) === stem(p.id)) ?? opp[0];
    const inId = p.dir === 'input' ? p.id : (mate?.id ?? p.id); // ForgeFX receives here (device's "Out")
    const outId = p.dir === 'output' ? p.id : (mate?.id ?? p.id); // ForgeFX sends here (device's "In")
    editor.pickPort({ transport: 'midi', id: p.id, inId, outId });
  }
  const rowSel = (p: Port) => {
    const c = editor.portChosen;
    return !!c && c.transport === p.transport && (c.id === p.id || c.inId === p.id || c.outId === p.id);
  };
  // Refresh on open. `ports` was only fetched at startup / on the Device tab, so a unit that enumerated
  // after launch left the picker saying "No ports found" while the app was demonstrably connected.
  let wasOpen = false;
  $effect(() => {
    if (editor.portsOpen && !wasOpen) void editor.loadPorts();
    wasOpen = editor.portsOpen;
  });
</script>

{#if editor.portsOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div class="ppbg" onclick={() => (editor.portsOpen = false)}></div>
  <div class="pp" role="dialog" aria-label="Connection">
    <div class="pp-h">
      <span>Connection</span>
      <button class="pp-x" aria-label="Close" onclick={() => (editor.portsOpen = false)}>✕</button>
    </div>
    <div class="pp-note">Auto-detect picks a Fractal device. Override here if it grabs the wrong port — or for a USB-MIDI unit (Axe-Fx III).</div>
    <button class="pp-auto" class:on={!editor.portOverride} onclick={() => editor.pickPort(null)}>✦ Auto-detect</button>
    <div class="pp-list">
      {#each editor.ports as p (p.transport + ':' + (p.dir ?? '') + ':' + p.id)}
        {@const sel = rowSel(p)}
        <button class="pp-row" class:on={sel} class:fr={p.fractal} onclick={() => pickConn(p)}>
          <span class="pp-kind" class:midi={p.transport === 'midi'}>{p.transport === 'midi' ? (p.dir === 'output' ? 'M·OUT' : 'M·IN') : 'SER'}</span>
          <span class="pp-label">{p.label}</span>
          {#if p.fractal}<span class="pp-star" title="Fractal device">★</span>{/if}
          {#if sel}<span class="pp-dot">●</span>{/if}
        </button>
      {/each}
      {#if editor.ports.length === 0}<div class="pp-empty">No ports found — connect the unit.</div>{/if}
    </div>
    <button class="pp-adv" onclick={() => { editor.portsOpen = false; editor.openAxis('device'); }}>Advanced — force device profile &amp; MIDI in/out →</button>
  </div>
{/if}

<style>
  /* connection picker popover */
  .ppbg {
    position: fixed;
    inset: 0;
    z-index: 300;
  }
  .pp {
    position: fixed;
    /* Anchored inside the rail strip, but tolerant of which shell owns the rail: the classic
       ToolRail uses --rail-w, the workbench rail is narrower. */
    left: calc(var(--rail-w, 66px) + 8px);
    bottom: 12px;
    z-index: 301;
    width: 340px;
    max-width: calc(100vw - 24px);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border2);
    border-radius: 14px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
    padding: 12px;
    animation: axsPalette 0.14s ease;
  }
  .pp-h {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 14px;
    font-weight: 700;
    color: var(--text);
    margin-bottom: 6px;
  }
  .pp-x {
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--text-mut);
    cursor: pointer;
    font-size: 13px;
  }
  .pp-x:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .pp-note {
    font-size: 11px;
    line-height: 1.4;
    color: var(--text-mut);
    margin-bottom: 10px;
  }
  .pp-auto {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 9px 11px;
    margin-bottom: 8px;
    border-radius: 9px;
    border: 1px solid var(--surface-3);
    background: var(--panel-2);
    color: var(--text2);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .pp-auto.on {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-tint);
  }
  .pp-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow-y: auto;
  }
  .pp-row {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 9px 11px;
    border-radius: 9px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text2);
    cursor: pointer;
    text-align: left;
  }
  .pp-row:hover {
    background: var(--surface-2);
  }
  .pp-row.on {
    border-color: var(--accent);
    background: var(--accent-tint);
  }
  .pp-row.fr {
    color: var(--text);
  }
  .pp-kind {
    flex: none;
    font: 700 8px/1 var(--font-mono);
    letter-spacing: 0.06em;
    color: var(--textfaint);
    background: var(--surface2);
    border: 1px solid var(--border-2);
    border-radius: 5px;
    padding: 4px 5px;
  }
  .pp-kind.midi {
    color: #9b6ef5;
    border-color: #3a2c5a;
  }
  .pp-label {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pp-star {
    flex: none;
    color: var(--amber);
    font-size: 11px;
  }
  .pp-dot {
    flex: none;
    color: var(--accent);
    font-size: 10px;
  }
  .pp-empty {
    padding: 18px 8px;
    text-align: center;
    color: var(--text-faint);
    font-size: 12px;
  }
  .pp-adv {
    margin-top: 8px;
    width: 100%;
    padding: 8px;
    background: none;
    border: none;
    border-top: 1px solid var(--border-2, var(--border2));
    color: var(--accent);
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    text-align: center;
  }
  .pp-adv:hover {
    filter: brightness(1.15);
  }
  /* on phones the connection popover is centered near the bottom, not anchored to the (hidden) rail */
  @media (max-width: 760px) {
    .pp {
      left: 12px;
      right: 12px;
      width: auto;
    }
  }
</style>
