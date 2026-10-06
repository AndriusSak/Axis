<script lang="ts">
  // Scene Manager (parity audit §2.1) — the real Scenes page, replacing the placeholder.
  //
  // 8 named scene cards with copy / paste / swap (within the preset) and bulk engage-all / bypass-all,
  // plus a per-scene bypass+channel matrix sourced from GET /preset/scene-state.
  //
  // All device work is a CLIENT-SIDE SEQUENCE over the existing endpoints (no scene-copy wire op
  // exists — audit §6.3): the planning/sequencing lives in `sceneOps.ts` (unit-tested); this component
  // only wires it to `forgefx` + the editor store.
  import { editor } from '../../editor.svelte';
  import { forgefx } from '../../forgefx';
  import {
    applySceneTo,
    bulkBypass,
    captureScene,
    scanSceneMatrix,
    sceneCards,
    swapScenes,
    type SceneIo,
    type SceneMatrix,
    type SceneStateBlock,
    type WriteResult
  } from '../../sceneOps';

  const count = $derived(editor.sceneCount);
  const cards = $derived(sceneCards(count, editor.sceneNames));
  const blocks = $derived(editor.layout.cells);
  const active = $derived(editor.scene);

  let matrix = $state<SceneMatrix | null>(null);
  let scanning = $state(false);
  let busy = $state(false);
  let status = $state('');
  let clipboard = $state<{ label: string; states: SceneStateBlock[] } | null>(null);
  /** When set, the next Swap click completes a swap with this scene index (modal-free arming). */
  let swapFrom = $state<number | null>(null);

  const io: SceneIo = {
    setScene: (i) => forgefx.setScene(i),
    sceneState: () => forgefx.sceneState(),
    setBypass: (eid, b) => forgefx.setBypass(eid, b),
    setChannel: (eid, ch) => forgefx.setChannel(eid, ch)
  };

  function label(index: number): string {
    return cards[index]?.label ?? `Scene ${index + 1}`;
  }

  function stateFor(sceneIndex: number, effectId: number): SceneStateBlock | undefined {
    return matrix?.[sceneIndex]?.find((s) => s.effectId === effectId);
  }

  function cellClass(sceneIndex: number, effectId: number): string {
    const st = stateFor(sceneIndex, effectId);
    if (!st || st.bypassed === null) return 'unknown';
    return st.bypassed ? 'off' : 'on';
  }

  function cellText(sceneIndex: number, effectId: number): string {
    const st = stateFor(sceneIndex, effectId);
    const mark = !st || st.bypassed === null ? '·' : st.bypassed ? '○' : '●';
    return st?.channel ? `${mark}${st.channel}` : mark;
  }

  async function run(labelText: string, fn: () => Promise<WriteResult>, affected: number[], focus: number) {
    if (busy) return;
    busy = true;
    status = `${labelText}…`;
    try {
      const res = await fn();
      // Re-read the affected rows (capture switches scenes), then leave the editor on `focus` so the
      // grid badges match what just changed.
      if (matrix) {
        for (const s of affected) {
          try {
            matrix = { ...matrix, [s]: await captureScene(s, io) };
          } catch {
            /* leave the stale row rather than blank it */
          }
        }
      }
      if (editor.scene !== focus + 1) await editor.selectScene(focus + 1);
      editor.reflectSceneState();
      status = res.failed
        ? `${labelText}: ${res.ok} written, ${res.failed} failed`
        : `${labelText}: ${res.ok} ${res.ok === 1 ? 'block' : 'blocks'} written`;
    } catch (e) {
      status = `${labelText} failed: ${(e as Error).message}`;
    } finally {
      busy = false;
    }
  }

  async function scan() {
    if (scanning || busy) return;
    scanning = true;
    status = 'Scanning scenes…';
    const restore = editor.scene;
    try {
      matrix = await scanSceneMatrix(count, io);
      status = `Scanned ${count} scenes × ${blocks.length} blocks`;
    } catch (e) {
      status = `Scan failed: ${(e as Error).message}`;
    } finally {
      // scanSceneMatrix switches the device through every scene — put it back where the user was.
      try {
        await forgefx.setScene(restore - 1);
      } catch {
        /* best effort */
      }
      // An SSE scene echo during the scan may have moved the editor's badge — re-sync it.
      if (editor.scene !== restore) await editor.selectScene(restore);
      editor.reflectSceneState();
      scanning = false;
    }
  }

  function select(index: number) {
    void editor.selectScene(index + 1);
  }

  async function copy(index: number) {
    let states = matrix?.[index];
    if (!states || !states.length) {
      // No scan yet (or this scene's read failed) — capture it live so Copy always works.
      try {
        states = await captureScene(index, io);
        if (matrix && states.length) matrix = { ...matrix, [index]: states };
      } catch {
        states = [];
      }
    }
    if (!states || !states.length) {
      status = `Copy: could not read ${label(index)} (device read failed)`;
      return;
    }
    clipboard = { label: label(index), states };
    swapFrom = null;
    status = `Copied ${label(index)} (${states.length} blocks)`;
  }

  function paste(index: number) {
    const clip = clipboard;
    if (!clip) return;
    void run(`Pasted ${clip.label} → ${label(index)}`, () => applySceneTo(index, clip.states, io), [index], index);
  }

  function swap(index: number) {
    if (swapFrom === null) {
      swapFrom = index;
      status = `Swap: now pick the other scene for ${label(index)}`;
      return;
    }
    if (swapFrom === index) {
      swapFrom = null;
      status = 'Swap cancelled';
      return;
    }
    const from = swapFrom;
    swapFrom = null;
    void run(`Swapped ${label(from)} ⇄ ${label(index)}`, () => swapScenes(from, index, io), [from, index], index);
  }

  function engageAll(index: number) {
    void run(`Engaged all in ${label(index)}`, () => bulkBypass(index, false, io), [index], index);
  }

  function bypassAll(index: number) {
    void run(`Bypassed all in ${label(index)}`, () => bulkBypass(index, true, io), [index], index);
  }

  function rename(index: number, name: string) {
    void editor.renameScene(index + 1, name);
  }

  function onRenameKey(ev: KeyboardEvent, index: number) {
    if (ev.key === 'Enter') (ev.currentTarget as HTMLInputElement).blur();
  }
</script>

<section class="scene-mgr">
  <header>
    <div class="titles">
      <h2>Scene Manager</h2>
      <p>
        {editor.preset ? `${String(editor.preset.number).padStart(3, '0')} · ${editor.preset.name || '(unnamed)'}` : 'No preset'}
        {#if count}· {count} scenes{/if}
      </p>
    </div>
    <button class="btn" onclick={scan} disabled={scanning || busy || count === 0}>
      {scanning ? 'Scanning…' : 'Scan matrix'}
    </button>
  </header>

  {#if clipboard}
    <div class="clip">
      Clipboard: <strong>{clipboard.label}</strong> ({clipboard.states.length} blocks) — Paste onto any scene.
      <button class="mini" onclick={() => (clipboard = null)}>Clear</button>
    </div>
  {/if}

  {#if status}<div class="status">{status}</div>{/if}

  {#if count === 0}
    <div class="empty">Scenes are unavailable on this device (or the device is not connected).</div>
  {:else}
    <div class="cards">
      {#each cards as card (card.index)}
        <article class="card" class:active={active === card.number} class:armed={swapFrom === card.index}>
          <div class="card-head">
            <button class="num" title={`Select ${card.label}`} onclick={() => select(card.index)}>{card.number}</button>
            {#if editor.canRenameScenes}
              <input
                class="name"
                value={card.named ? card.label : ''}
                placeholder={`Scene ${card.number}`}
                spellcheck="false"
                onkeydown={(ev) => onRenameKey(ev, card.index)}
                onblur={(ev) => rename(card.index, (ev.currentTarget as HTMLInputElement).value)}
              />
            {:else}
              <span class="name ro">{card.label}</span>
            {/if}
          </div>

          <div class="ops">
            <button class="mini" onclick={() => void copy(card.index)} title="Copy this scene's block states">Copy</button>
            <button class="mini" onclick={() => paste(card.index)} disabled={!clipboard} title="Paste the copied scene here">Paste</button>
            <button class="mini" class:on={swapFrom === card.index} onclick={() => swap(card.index)} title="Swap with another scene">
              {swapFrom === card.index ? 'Swap…' : 'Swap'}
            </button>
          </div>
          <div class="ops">
            <button class="mini ok" onclick={() => engageAll(card.index)} disabled={busy} title="Engage every block in this scene">Engage all</button>
            <button class="mini warn" onclick={() => bypassAll(card.index)} disabled={busy} title="Bypass every block in this scene">Bypass all</button>
          </div>
        </article>
      {/each}
    </div>

    {#if matrix}
      <div class="matrix-wrap">
        <div class="matrix-head">Per-scene bypass / channel (● engaged · ○ bypassed · letter = channel)</div>
        <div class="matrix-scroll">
          <table class="matrix">
            <thead>
              <tr>
                <th class="corner">Scene</th>
                {#each blocks as block (block.effectId)}
                  <th title={block.display}>{block.display}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each cards as card (card.index)}
                <tr class:active={active === card.number}>
                  <th class="rowlabel">{card.number}. {card.label}</th>
                  {#each blocks as block (block.effectId)}
                    <td class={cellClass(card.index, block.effectId)}>{cellText(card.index, block.effectId)}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {:else}
      <div class="hint">Press <strong>Scan matrix</strong> to read each scene's per-block bypass / channel from the device.</div>
    {/if}
  {/if}
</section>

<style>
  .scene-mgr {
    position: absolute;
    inset: 0;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
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
  .btn:disabled,
  .mini:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .clip,
  .status {
    flex: none;
    padding: 7px 12px;
    font-size: 11.5px;
    border-bottom: 1px solid var(--border);
    color: var(--text2);
  }
  .status {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--textdim);
  }
  .mini {
    height: 26px;
    padding: 0 9px;
    border: 1px solid var(--border2);
    border-radius: 7px;
    background: var(--surface);
    color: var(--text2);
    font-size: 11px;
    cursor: pointer;
  }
  .mini.ok {
    color: var(--ok, #5fc46b);
    border-color: var(--ok-border, var(--border2));
  }
  .mini.warn {
    color: var(--amber, #d6a43f);
    border-color: var(--amber-border, var(--border2));
  }
  .mini.on {
    background: var(--accent-tint, var(--surface2));
    border-color: var(--accent);
    color: var(--accent);
  }
  .cards {
    flex: none;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 8px;
    padding: 12px;
    overflow: auto;
    max-height: 46%;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 9px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }
  .card.active {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent-tint, transparent);
  }
  .card.armed {
    border-color: var(--amber, #d6a43f);
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .num {
    flex: none;
    width: 24px;
    height: 24px;
    border-radius: 7px;
    border: 1px solid var(--border2);
    background: var(--surface2);
    color: var(--text2);
    font-weight: 800;
    font-size: 12px;
    cursor: pointer;
  }
  .card.active .num {
    background: var(--accent);
    color: var(--accentink, #fff);
    border-color: var(--accent);
  }
  .name {
    flex: 1;
    min-width: 0;
    height: 24px;
    padding: 0 6px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--input, var(--bg2));
    color: var(--text);
    font-size: 12px;
  }
  .name.ro {
    display: flex;
    align-items: center;
    border-color: transparent;
  }
  .ops {
    display: flex;
    gap: 5px;
  }
  .ops .mini {
    flex: 1;
  }
  .empty,
  .hint {
    padding: 18px;
    color: var(--textdim);
    font-size: 12.5px;
  }
  .matrix-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border);
  }
  .matrix-head {
    flex: none;
    padding: 8px 12px 4px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--textmuted, var(--textdim));
  }
  .matrix-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0 12px 12px;
  }
  table.matrix {
    border-collapse: collapse;
    font-size: 11px;
  }
  .matrix th,
  .matrix td {
    border: 1px solid var(--border);
    padding: 3px 5px;
    text-align: center;
    white-space: nowrap;
  }
  .matrix thead th {
    position: sticky;
    top: 0;
    background: var(--surface2);
    color: var(--text2);
    font-weight: 700;
  }
  .matrix .corner,
  .matrix .rowlabel {
    text-align: left;
    background: var(--surface);
    color: var(--text2);
    position: sticky;
    left: 0;
    z-index: 1;
  }
  .matrix tbody tr.active .rowlabel {
    color: var(--accent);
  }
  .matrix td {
    font-family: var(--font-mono);
    color: var(--textdim);
  }
  .matrix td.on {
    color: var(--ok, #5fc46b);
  }
  .matrix td.off {
    color: var(--amber, #d6a43f);
  }
  .matrix td.unknown {
    color: var(--textfaint, var(--textdim));
    opacity: 0.6;
  }
</style>
