import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Two dead ends reported from the workbench, both of the same shape: the UI set state that nothing
// rendered, or offered no control at all. These pin the wiring so it cannot silently regress.

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the library is reachable from the workbench shell', () => {
  const shell = read('./axis-workbench/AxisWorkbenchShell.svelte');

  it('renders PresetBrowser when editor.inLibrary is set', () => {
    // The classic shell has always done this; the workbench shell dropped the flag, so the Search
    // widget (and the tool rail, and ⌘K) changed state and nothing appeared.
    expect(shell).toMatch(/import PresetBrowser from '\.\.\/PresetBrowser\.svelte'/);
    expect(shell).toMatch(/\{#if editor\.inLibrary\}/);
    expect(shell).toMatch(/<PresetBrowser \/>/);
  });

  it('keeps the workbench mounted in the else branch, so returning from the library restores it', () => {
    expect(shell).toMatch(/\{:else\}\s*<WorkbenchHost/);
  });
});

describe('a preset can be named while saving', () => {
  const dlg = read('./SaveDialog.svelte');

  it('offers a NAME field bound to the buffer name', () => {
    expect(dlg).toMatch(/<span class="lbl mono">NAME<\/span>/);
    expect(dlg).toMatch(/bind:value=\{name\}/);
    expect(dlg).toMatch(/maxlength="32"/);
  });

  it('renames the edit buffer BEFORE storing, and aborts the store if the rename failed', () => {
    const commit = dlg.slice(dlg.indexOf('async function commit()'), dlg.indexOf('const maxSlot'));
    const renameAt = commit.indexOf('editor.renamePreset(clean)');
    const saveAt = commit.indexOf('editor.save(target)');
    expect(renameAt).toBeGreaterThan(-1);
    expect(saveAt).toBeGreaterThan(renameAt);
    // renamePreset reverts + toasts on failure; storing anyway would write the OLD name to the slot.
    expect(commit).toMatch(/if \(\(editor\.preset\?\.name \?\? ''\) !== clean\) return;/);
  });

  it('prefills the name once per open, so the poll cannot wipe what is being typed', () => {
    // The editor's poll replaces `editor.preset` every few seconds, so an effect that reads the preset
    // name re-ran mid-typing and reset the field to the device's name (reported 2026-11-02: "it reverts
    // to the old name before I even finish typing"). The prefill must fire on the open transition only,
    // and the preset read must be untracked so a poll cannot re-trigger it.
    const eff = dlg.slice(dlg.indexOf('$effect(() => {'), dlg.indexOf('const renameCapable'));
    expect(eff).toMatch(/if \(open && !wasOpen\)/);
    expect(eff).toMatch(/untrack\(\(\) => editor\.preset\?\.name/);
    expect(eff).toMatch(/wasOpen = open;/);
    expect(dlg).toMatch(/import \{ untrack \} from 'svelte';/);
  });

  it('only shows the field on a device that can rename', () => {
    expect(dlg).toMatch(/const renameCapable = \$derived\(editor\.canRenamePresets/);
    expect(dlg).toMatch(/\{#if renameCapable\}/);
  });

  it('never guesses slot 0 when the loaded preset is unknown', () => {
    // A save dialog opened before the first preset poll used to default the target to slot 0 and
    // storing overwrites it (measured: factory preset 0 was overwritten on 2026-11-02).
    const ed = read('./editor.svelte.ts');
    const openSave = ed.slice(ed.indexOf('openSave = () =>'), ed.indexOf('save = async (n: number)'));
    expect(openSave).toContain('?? -1');
    expect(openSave).not.toMatch(/\?\?\s*0;/);

    expect(dlg).toMatch(/const targetValid = \$derived\(Number\.isInteger\(target\) && target >= 0/);
    expect(dlg).toMatch(/disabled=\{busy \|\| !targetValid\}/);
    expect(dlg).toMatch(/if \(busy \|\| !targetValid\) return;/);
    // and the state write itself refuses a negative slot
    expect(ed).toMatch(/if \(!Number\.isInteger\(n\) \|\| n < 0\) return;/);
  });
});
