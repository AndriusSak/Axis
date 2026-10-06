<script lang="ts">
  // Performance / Live page (parity audit §2.2) — the real Live workbench panel, replacing the
  // `axis.placeholder` stub.
  //
  // A full-screen view of LARGE tap targets bound to chosen parameters. The page definition is an
  // ORDERED list of (family, paramId) bindings, edited in Edit mode (add the open block's controls,
  // reorder, remove) and persisted LOCALLY on this device (`performancePage.ts` → localStorage).
  //
  // HONESTY: whether the FM3 stores performance pages in the preset binary or in system memory is
  // UNKNOWN (audit §6.5, unverified) — this page is never written to the device, and the UI says so.
  // The model + persistence + resolution live in `performancePage.ts` (unit-tested, pure); this
  // component only wires them to the editor store, which in turn drives ForgeFX.
  import { editor } from '../../editor.svelte';
  import {
    addPerformanceBinding,
    bindingsFromParams,
    createPerformancePage,
    loadPerformancePage,
    movePerformanceBinding,
    removePerformanceBinding,
    savePerformancePage,
    type PerformancePage
  } from '../../performancePage';
  import PerformanceTile from './PerformanceTile.svelte';

  let page = $state<PerformancePage>(loadPerformancePage());
  let editMode = $state(false);
  let status = $state('');

  const sceneCount = $derived(Math.max(0, editor.sceneCount));
  const scenes = $derived(
    Array.from({ length: sceneCount }, (_, index) => ({ index, number: index + 1, label: editor.sceneName(index + 1) }))
  );
  const presetLabel = $derived(
    editor.preset ? `${String(editor.preset.number).padStart(3, '0')} · ${editor.preset.name || '(unnamed)'}` : 'No preset'
  );

  function commit(next: PerformancePage) {
    page = next;
    savePerformancePage(page);
  }

  function addOpenBlock() {
    const selected = editor.selected;
    if (!selected || selected.effectId == null) {
      status = 'Open a block in the Grid first — its controls are added to the page.';
      return;
    }
    const params = [...editor.params, ...editor.enums].map((param) => ({ id: param.id, name: param.name }));
    const bindings = bindingsFromParams(selected.pack ?? '', selected.effectId, selected.display, params);
    if (!bindings.length) {
      status = 'No addressable parameters on the open block.';
      return;
    }
    let next = page;
    for (const binding of bindings) next = addPerformanceBinding(next, binding);
    commit(next);
    status = `Added ${bindings.length} controls from ${selected.display}.`;
  }

  function removeAt(index: number) {
    commit(removePerformanceBinding(page, index));
  }

  function moveAt(index: number, dir: number) {
    commit(movePerformanceBinding(page, index, index + dir));
  }

  function clearAll() {
    commit(createPerformancePage(page.label));
    status = 'Cleared the performance page.';
  }

  function rename(label: string) {
    commit({ ...page, label: label.trim() || 'Performance' });
  }
</script>

<section class="perf">
  <header>
    <div class="titles">
      <h2>{page.label}</h2>
      <p>{presetLabel} · {page.bindings.length} {page.bindings.length === 1 ? 'control' : 'controls'} · stored locally on this device</p>
    </div>
    <button class="btn" class:on={editMode} onclick={() => (editMode = !editMode)}>{editMode ? 'Done' : 'Edit'}</button>
  </header>

  {#if editMode}
    <div class="edit-bar">
      <input
        class="name-input"
        value={page.label}
        aria-label="Performance page name"
        spellcheck="false"
        onchange={(event) => rename((event.currentTarget as HTMLInputElement).value)}
      />
      <button class="btn" onclick={addOpenBlock} disabled={!editor.selected}>Add open block</button>
      <button class="btn ghost" onclick={clearAll} disabled={!page.bindings.length}>Clear</button>
    </div>
  {/if}

  {#if status}<div class="status">{status}</div>{/if}

  <div class="quick">
    <div class="quick-group scenes">
      {#if sceneCount > 0}
        {#each scenes as scene (scene.index)}
          <button
            class="scene"
            class:active={editor.scene === scene.number}
            title={scene.label}
            onclick={() => void editor.selectScene(scene.number)}
          >
            <span class="scene-n">{scene.number}</span>
          </button>
        {/each}
      {:else}
        <span class="na">Scenes unavailable</span>
      {/if}
    </div>

    <div class="quick-group device">
      <button class="qbtn" title="Previous preset" onclick={() => void editor.stepPreset(-1)}>‹</button>
      <button class="qbtn wide" title="Open the preset browser" onclick={() => editor.openLibrary()}>{presetLabel}</button>
      <button class="qbtn" title="Next preset" onclick={() => void editor.stepPreset(1)}>›</button>
      <button class="qbtn" class:on={editor.tuner.active} title="Tuner" onclick={() => void editor.toggleTuner()}>TUNER</button>
      <button class="qbtn tempo" title="Tap tempo" onclick={() => void editor.tapTempo()}>
        <span class="bpm">{editor.bpm}</span><span class="unit">BPM</span>
      </button>
    </div>
  </div>

  {#if editMode && editor.selected}
    <div class="hint">Tap a <strong>+</strong> next to any open-block control to add just that one — or <strong>Add open block</strong> for all of them.</div>
  {/if}

  {#if page.bindings.length}
    <div class="grid" class:editing={editMode}>
      {#each page.bindings as binding, index (binding.family + ':' + binding.paramId)}
        <PerformanceTile
          {binding}
          {index}
          count={page.bindings.length}
          {editMode}
          onremove={removeAt}
          onmove={moveAt}
        />
      {/each}
    </div>
  {:else}
    <div class="empty">
      <span class="glyph" aria-hidden="true">⏺</span>
      <p>No controls on the performance page yet.</p>
      <p>Open a block in the Grid, then <strong>Edit → Add open block</strong> to drop its controls here as large tap targets.</p>
    </div>
  {/if}

  <footer class="note">
    Stored locally on this device only — not written to the FM3. Whether the device stores performance
    pages itself is unverified, so Axis makes no device-persistence claim.
  </footer>
</section>

<style>
  .perf {
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
    padding: 10px 12px;
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
    height: 34px;
    padding: 0 14px;
    border: 1px solid var(--accent-border, var(--border2));
    border-radius: 8px;
    background: var(--accent-tint, var(--surface));
    color: var(--accent);
    font-weight: 700;
    cursor: pointer;
  }
  .btn.ghost {
    border-color: var(--border2);
    background: var(--surface);
    color: var(--text2);
  }
  .btn.on {
    background: var(--accent);
    color: var(--accentink, #fff);
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .edit-bar {
    flex: none;
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }
  .name-input {
    flex: 1;
    min-width: 0;
    height: 34px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--input, var(--bg2));
    color: var(--text);
    font-size: 13px;
  }
  .status,
  .hint {
    flex: none;
    padding: 6px 12px;
    font-size: 11.5px;
    color: var(--textdim);
    border-bottom: 1px solid var(--border);
  }
  .quick {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg2);
  }
  .quick-group {
    display: flex;
    align-items: stretch;
    gap: 5px;
  }
  .quick-group.scenes {
    flex-wrap: wrap;
  }
  .quick-group.device {
    margin-left: auto;
  }
  .na {
    font-size: 11px;
    color: var(--textdim);
  }
  .scene {
    width: 46px;
    height: 46px;
    border: 1px solid var(--border2);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text2);
    font-weight: 800;
    font-size: 15px;
    cursor: pointer;
    touch-action: manipulation;
  }
  .scene.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accentink, #fff);
  }
  .qbtn {
    min-height: 46px;
    padding: 0 14px;
    border: 1px solid var(--border2);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    font-weight: 700;
    font-size: 13px;
    cursor: pointer;
    touch-action: manipulation;
  }
  .qbtn.wide {
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .qbtn.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accentink, #fff);
  }
  .qbtn.tempo {
    display: flex;
    align-items: baseline;
    gap: 4px;
  }
  .bpm {
    font-family: var(--font-mono);
    font-size: 18px;
  }
  .unit {
    font-size: 9px;
    letter-spacing: 0.1em;
    color: var(--textdim);
  }
  .qbtn.tempo .unit {
    color: inherit;
    opacity: 0.7;
  }
  .grid {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    grid-auto-rows: min-content;
    gap: 10px;
    padding: 12px;
    overflow: auto;
  }
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 24px;
    text-align: center;
    color: var(--textdim);
  }
  .empty .glyph {
    font-size: 32px;
    color: var(--textfaint, var(--textdim));
  }
  .empty p {
    max-width: 420px;
    font-size: 12.5px;
    line-height: 1.6;
  }
  .note {
    flex: none;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    font-size: 10.5px;
    color: var(--textmuted, var(--textdim));
  }
</style>
