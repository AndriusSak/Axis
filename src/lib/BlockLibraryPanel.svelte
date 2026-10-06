<script lang="ts">
  // Block Library modal (audit §2.6) — save a placed block's model + values as a named local entry,
  // list / search / rename / delete, recall an entry into the selected block, export/import a file.
  //
  // Format honesty: entries are Axis-LOCAL `.axblk` JSON, deliberately NOT byte-compatible with
  // FM3-Edit's `.blk`. Only the ACTIVE channel of the source block is captured (blockParams serves
  // one channel at a time) — the channel is shown on each row and recall writes onto the active
  // channel. Recall goes through the existing per-block write path (setType → setParam).
  import { editor } from './editor.svelte';
  import { blockLibrary } from './blockLibrary.svelte';
  import { BLOCK_LIB_EXT, entryFilename, type BlockLibraryEntry } from './blockLibrary';

  let renameId = $state<string | null>(null);
  let renameText = $state('');
  let fileInput: HTMLInputElement | undefined = $state();

  function close() {
    editor.blockLibraryOpen = false;
    renameId = null;
  }

  function startRename(e: BlockLibraryEntry) {
    renameId = e.id;
    renameText = e.name;
  }
  function commitRename() {
    if (renameId) blockLibrary.rename(renameId, renameText);
    renameId = null;
  }

  async function remove(e: BlockLibraryEntry) {
    await blockLibrary.remove(e.id);
    editor.showToast(`Deleted “${e.name}”`, '#d6543f');
  }

  async function recall(e: BlockLibraryEntry) {
    await editor.recallBlockEntry(e);
  }

  function exportEntry(e: BlockLibraryEntry) {
    const ex = blockLibrary.exportText(e.id);
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
    const r = blockLibrary.importText(text);
    editor.showToast(r.ok ? `Imported “${r.entry?.name}”` : (r.error ?? 'Import failed'), r.ok ? '#33c46b' : '#d6543f');
    if (fileInput) fileInput.value = '';
  }

  const valueCount = (e: BlockLibraryEntry) => e.params.length;
</script>

{#if editor.blockLibraryOpen}
  <div class="bg" role="presentation" onclick={close}>
    <div class="card" role="dialog" tabindex="-1" onclick={(ev) => ev.stopPropagation()} onkeydown={() => {}}>
      <div class="head">
        <span class="dot"></span>
        <span class="title">Block Library</span>
        <span class="count mono">{blockLibrary.count} saved</span>
        <button class="x" onclick={close} title="Close">×</button>
      </div>

      <p class="note">
        Save a block's model + its <b>active channel</b>'s values as a named entry, then recall it into
        any block (another position or preset). <b>Axis-local format (.axblk JSON)</b> — not
        byte-compatible with FM3-Edit's <span class="mono">.blk</span>.
      </p>

      <div class="actions">
        <button class="btn save" onclick={() => editor.saveBlockToLibrary()}>＋ Save current block</button>
        <button class="btn imp" onclick={() => fileInput?.click()}>⤓ Import {BLOCK_LIB_EXT}</button>
        <input bind:this={fileInput} type="file" accept={BLOCK_LIB_EXT} class="hidden" onchange={importFile} />
      </div>

      <input class="search" type="text" placeholder="Search name, block, model, param…" bind:value={blockLibrary.query} />

      {#if blockLibrary.filtered.length === 0}
        <p class="empty">
          {blockLibrary.count === 0 ? 'No saved blocks yet — open a block and “Save current block”.' : 'No entries match that search.'}
        </p>
      {:else}
        <ul class="list">
          {#each blockLibrary.filtered as e (e.id)}
            <li class="row">
              {#if renameId === e.id}
                <input
                  class="rn"
                  bind:value={renameText}
                  onkeydown={(ev) => { if (ev.key === 'Enter') commitRename(); if (ev.key === 'Escape') (renameId = null); }}
                />
                <button class="mini ok" onclick={commitRename}>✓</button>
              {:else}
                <div class="meta">
                  <div class="name">{e.name}</div>
                  <div class="sub mono">
                    {e.block}{e.type ? ` · ${e.type.name}` : ''}{e.channel ? ` · CH ${e.channel}` : ''} · {valueCount(e)} values
                  </div>
                </div>
                <button class="mini" onclick={() => recall(e)} title="Recall into the selected block">↩ Recall</button>
                <button class="mini" onclick={() => startRename(e)} title="Rename">✎</button>
                <button class="mini" onclick={() => exportEntry(e)} title={`Export ${entryFilename(e)}`}>⤓</button>
                <button class="mini del" onclick={() => remove(e)} title="Delete">🗑</button>
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
    z-index: 215;
    background: rgba(6, 6, 8, 0.66);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .card {
    width: min(620px, 100%);
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
  }
  .btn.save {
    border-color: var(--accent-border, #2f6d70);
    color: var(--accent, #8fe3ea);
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
