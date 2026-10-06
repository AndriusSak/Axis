<script lang="ts">
  // Preset Templates modal (audit §2.7 remainder) — Save as Template / New from Template.
  //
  // Format honesty: a template is an Axis-LOCAL `.axtpl.json` document that EMBEDS the captured `.syx`
  // bytes — deliberately NOT byte-compatible with FM3-Edit's template format. Templates are LOCAL-ONLY
  // and are NEVER written to the device. The registry lives in this browser's localStorage; "Load" brings
  // the embedded preset back into the edit buffer through the existing imported-file load path. When a
  // Presets folder is configured a `.syx` mirror is also written to Presets/Templates/ (the local write
  // route only accepts .syx); otherwise the `.axtpl.json` is exported via browser download.
  import { editor } from './editor.svelte';
  import { presetTemplates } from './presetTemplates.svelte';
  import { AXTPL_EXT, templateFilename, type PresetTemplate } from './presetTemplate';

  let saveName = $state('');
  let renameId = $state<string | null>(null);
  let renameText = $state('');
  let fileInput: HTMLInputElement | undefined = $state();

  function close() {
    editor.presetTemplatesOpen = false;
    renameId = null;
  }

  async function saveTemplate() {
    await editor.saveAsTemplate(saveName || undefined);
    saveName = '';
  }

  function startRename(t: PresetTemplate) {
    renameId = t.id;
    renameText = t.name;
  }
  function commitRename() {
    if (renameId) presetTemplates.rename(renameId, renameText);
    renameId = null;
  }

  function remove(t: PresetTemplate) {
    presetTemplates.remove(t.id);
    editor.showToast(`Deleted template “${t.name}”`, '#d6543f');
  }

  async function load(t: PresetTemplate) {
    await editor.loadPresetTemplate(t);
  }

  function exportTemplate(t: PresetTemplate) {
    const ex = presetTemplates.exportText(t.id);
    if (!ex) return;
    const blob = new Blob([ex.text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = ex.filename;
    a.click();
    URL.revokeObjectURL(a.href);
    editor.showToast(`Exported ${ex.filename}`, '#35c9d6');
  }

  async function importFile(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const text = await f.text();
    const r = presetTemplates.importText(text);
    editor.showToast(r.ok ? `Imported template “${r.entry?.name}”` : (r.error ?? 'Import failed'), r.ok ? '#33c46b' : '#d6543f');
    if (fileInput) fileInput.value = '';
  }

  const fmtBytes = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
  const fmtDate = (ms: number) => new Date(ms).toLocaleString();
</script>

{#if editor.presetTemplatesOpen}
  <div class="bg" role="presentation" onclick={close}>
    <div class="card" role="dialog" tabindex="-1" onclick={(ev) => ev.stopPropagation()} onkeydown={() => {}}>
      <div class="head">
        <span class="dot"></span>
        <span class="title">Preset Templates</span>
        <span class="count mono">{presetTemplates.count} saved</span>
        <button class="x" onclick={close} title="Close">×</button>
      </div>

      <p class="note">
        Save the <b>current preset</b> as a reusable template, then start a new edit from one. Templates are
        <b>Axis-local ({AXTPL_EXT})</b> — self-contained (the preset <span class="mono">.syx</span> is embedded),
        <b>local-only</b> and <b>never written to the device</b>. Not byte-compatible with FM3-Edit's template format.
        {#if editor.local.configured && editor.local.exists}
          Saving also mirrors a <span class="mono">.syx</span> copy into <span class="mono">Presets/Templates/</span>.
        {:else}
          No Presets folder is configured — saving keeps the template here and exports an <span class="mono">{AXTPL_EXT}</span> download.
        {/if}
      </p>

      <div class="actions">
        <input class="nameInput" type="text" placeholder="Template name (defaults to the preset name)" bind:value={saveName} />
        <button class="btn save" onclick={saveTemplate}>＋ Save as Template</button>
        <button class="btn imp" onclick={() => fileInput?.click()}>⤓ Import {AXTPL_EXT}</button>
        <input bind:this={fileInput} type="file" accept={AXTPL_EXT} class="hidden" onchange={importFile} />
      </div>

      <input class="search" type="text" placeholder="Search templates…" bind:value={presetTemplates.query} />

      {#if presetTemplates.filtered.length === 0}
        <p class="empty">
          {presetTemplates.count === 0 ? 'No templates yet — “Save as Template” stores the current preset here.' : 'No templates match that search.'}
        </p>
      {:else}
        <ul class="list">
          {#each presetTemplates.filtered as t (t.id)}
            <li class="row">
              {#if renameId === t.id}
                <input
                  class="rn"
                  bind:value={renameText}
                  onkeydown={(ev) => { if (ev.key === 'Enter') commitRename(); if (ev.key === 'Escape') (renameId = null); }}
                />
                <button class="mini ok" onclick={commitRename}>✓</button>
              {:else}
                <div class="meta">
                  <div class="name">{t.name}</div>
                  <div class="sub mono">{fmtBytes(t.bytesLen)}{t.device ? ` · ${t.device}` : ''} · {fmtDate(t.createdAt)}</div>
                </div>
                <button class="mini" onclick={() => load(t)} title="Start a new edit from this template (loads into the edit buffer)">↩ New from Template</button>
                <button class="mini" onclick={() => startRename(t)} title="Rename">✎</button>
                <button class="mini" onclick={() => exportTemplate(t)} title={`Export ${templateFilename(t)}`}>⤓</button>
                <button class="mini del" onclick={() => remove(t)} title="Delete">🗑</button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}

<style>
  .bg {
    position: absolute;
    inset: 0;
    z-index: 216;
    background: rgba(6, 6, 8, 0.66);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .card {
    width: min(640px, 100%);
    max-height: min(560px, 90vh);
    display: flex;
    flex-direction: column;
    background: var(--bg2, #16171b);
    border: 1px solid var(--border-2, #2a2c33);
    border-radius: 14px;
    padding: 18px;
    color: var(--text, #e6e6ea);
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent, #35c9d6);
  }
  .title {
    font-weight: 800;
    font-size: 15px;
  }
  .count {
    font-size: 11px;
    color: var(--text-mut, #8a8a93);
  }
  .x {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--text-dim, #9a9aa3);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
  }
  .note {
    font-size: 11px;
    line-height: 1.5;
    color: var(--text-dim, #9a9aa3);
    margin: 0 0 12px;
  }
  .mono {
    font-family: var(--mono, ui-monospace, monospace);
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
  }
  .btn {
    height: 34px;
    padding: 0 12px;
    border-radius: 9px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    background: var(--surface2, #1d1f26);
    border: 1px solid var(--border-2, #2a2c33);
    color: var(--text, #e6e6ea);
    white-space: nowrap;
  }
  .btn.save {
    border-color: var(--accent-border, #2f6d70);
    color: var(--accent, #8fe3ea);
  }
  .nameInput {
    flex: 1;
    min-width: 0;
    height: 34px;
    border-radius: 9px;
    padding: 0 10px;
    background: var(--surface, #101014);
    border: 1px solid var(--border-2, #2a2c33);
    color: var(--text, #e6e6ea);
    font-size: 12px;
  }
  .hidden {
    display: none;
  }
  .search {
    height: 34px;
    border-radius: 9px;
    padding: 0 10px;
    margin-bottom: 10px;
    background: var(--surface, #101014);
    border: 1px solid var(--border-2, #2a2c33);
    color: var(--text, #e6e6ea);
    font-size: 12px;
  }
  .empty {
    font-size: 12px;
    color: var(--text-mut, #8a8a93);
    padding: 18px 4px;
    text-align: center;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--surface, #101014);
    border: 1px solid var(--border-2, #2a2c33);
  }
  .meta {
    flex: 1;
    min-width: 0;
  }
  .name {
    font-size: 13px;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: 10px;
    color: var(--text-mut, #8a8a93);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rn {
    flex: 1;
    height: 30px;
    padding: 0 8px;
    border-radius: 7px;
    background: var(--bg, #0d0e11);
    border: 1px solid var(--accent-border, #2f6d70);
    color: var(--text, #e6e6ea);
  }
  .mini {
    height: 28px;
    padding: 0 8px;
    border-radius: 7px;
    font-size: 11px;
    cursor: pointer;
    background: var(--surface2, #1d1f26);
    border: 1px solid var(--border-2, #2a2c33);
    color: var(--text-dim, #9a9aa3);
    white-space: nowrap;
  }
  .mini:hover {
    color: var(--text, #e6e6ea);
  }
  .mini.del:hover {
    color: #d6543f;
    border-color: #d6543f;
  }
  .mini.ok {
    color: #33c46b;
  }
</style>
