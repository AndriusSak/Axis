import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Source-guard for the Block Library wiring (audit §2.6). The pure format + logic live in
// blockLibrary.ts and are unit-tested in blockLibrary.test.ts; the components/stores here cannot be
// compiled by this repo's node-env vitest, so these guards pin the thin bindings — exactly as
// listCaps.test.ts / blockOps.test.ts do for their components.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('Block Library wiring', () => {
  const panel = read('./BlockLibraryPanel.svelte');
  const editor = read('./editor.svelte.ts');
  const store = read('./blockLibrary.svelte.ts');
  const blockEditor = read('./BlockEditor.svelte');
  const app = read('../routes/+page.svelte');

  it('mounts the panel in the app shell', () => {
    expect(app).toContain('BlockLibraryPanel');
    expect(app).toMatch(/<BlockLibraryPanel\s*\/>/);
  });

  it('the block editor offers Save-to-Library and open-Library', () => {
    expect(blockEditor).toMatch(/editor\.saveBlockToLibrary\(\)/);
    expect(blockEditor).toMatch(/editor\.openBlockLibrary\(\)/);
  });

  it('the editor saves via blockParams and recalls via the existing write path', () => {
    expect(editor).toMatch(/saveBlockToLibrary\s*=/);
    expect(editor).toMatch(/recallBlockEntry\s*=/);
    expect(editor).toMatch(/forgefx\.blockParams\(/); // capture source
    expect(editor).toMatch(/recallWrites\(/); // reuse the write planner
    expect(editor).toMatch(/forgefx\.setParam\(/); // recall = existing per-block writes
  });

  it('persists entries through the /store backend collection + a local cache', () => {
    expect(store).toMatch(/putDoc\(STORE_COLLECTION/);
    expect(store).toMatch(/listDocs<unknown>\(STORE_COLLECTION\)/);
    expect(store).toMatch(/deleteDoc\(STORE_COLLECTION/);
    expect(store).toMatch(/collection\b|STORE_COLLECTION = 'blockLib'/);
  });

  it('the panel supports save, search, rename, delete, recall, export and import', () => {
    expect(panel).toMatch(/saveBlockToLibrary/);
    expect(panel).toMatch(/blockLibrary\.query/);
    expect(panel).toMatch(/blockLibrary\.rename\(/);
    expect(panel).toMatch(/blockLibrary\.remove\(/);
    expect(panel).toMatch(/recallBlockEntry\(/);
    expect(panel).toMatch(/blockLibrary\.exportText\(/);
    expect(panel).toMatch(/blockLibrary\.importText\(/);
  });

  it('discloses the Axis-local format (not FM3-Edit .blk) in the UI + module docstring', () => {
    expect(panel).toMatch(/not\s+byte-compatible with FM3-Edit/i);
    expect(read('./blockLibrary.ts')).toMatch(/NOT[^]{0,12}byte-compatible with FM3-Edit/i);
  });

  it('labels entries with the captured channel (active channel only)', () => {
    expect(panel).toMatch(/active channel/i);
    expect(read('./blockLibrary.ts')).toMatch(/active channel/i);
  });
});
