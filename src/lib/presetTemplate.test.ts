import { describe, it, expect, vi } from 'vitest';
import {
  AXTPL_FORMAT,
  AXTPL_VERSION,
  AXTPL_EXT,
  TEMPLATE_DIR,
  bytesToB64,
  b64ToBytes,
  captureTemplate,
  templateBytes,
  serializeTemplate,
  parseTemplate,
  templateName,
  renameTemplate,
  upsertTemplate,
  deleteTemplate,
  searchTemplates,
  templateFilename,
  newTemplateId,
  runSaveAsTemplate,
  type PresetTemplate,
  type TemplateSaveSurface
} from './presetTemplate';

const bytes = (arr: number[]) => Uint8Array.from(arr);
// a few hundred bytes so the base64 path is exercised beyond a single char
const syx = bytes([0xf0, 0x00, 0x01, ...Array.from({ length: 300 }, (_, i) => i % 256), 0xf7]);

const mk = (over: Partial<PresetTemplate> = {}): PresetTemplate => ({
  format: AXTPL_FORMAT,
  version: AXTPL_VERSION,
  id: 'tpl:a',
  name: 'Clean DI',
  syx: bytesToB64(syx),
  bytesLen: syx.length,
  path: null,
  device: null,
  createdAt: 1000,
  updatedAt: 1000,
  ...over
});

describe('base64 helpers', () => {
  it('round-trips arbitrary bytes', () => {
    expect([...b64ToBytes(bytesToB64(syx))]).toEqual([...syx]);
  });
  it('handles empty input', () => {
    expect(bytesToB64(bytes([]))).toBe('');
    expect(b64ToBytes('').length).toBe(0);
  });
  it('round-trips a payload larger than the encode chunk', () => {
    const big = Uint8Array.from({ length: 0x8000 * 2 + 7 }, (_, i) => (i * 31) % 256);
    expect([...b64ToBytes(bytesToB64(big))]).toEqual([...big]);
  });
});

describe('captureTemplate', () => {
  it('embeds the .syx as base64 and records its length', () => {
    const t = captureTemplate({ id: 'tpl:1', name: 'My Lead', bytes: syx, now: 42 });
    expect(t.format).toBe(AXTPL_FORMAT);
    expect(t.version).toBe(AXTPL_VERSION);
    expect(t.id).toBe('tpl:1');
    expect(t.name).toBe('My Lead');
    expect(t.bytesLen).toBe(syx.length);
    expect(t.path).toBeNull();
    expect(t.device).toBeNull();
    expect(t.createdAt).toBe(42);
    expect(t.updatedAt).toBe(42);
  });
  it('falls back to a non-empty name', () => {
    expect(captureTemplate({ id: 'tpl:1', name: '   ', bytes: syx }).name).toBe('template');
  });
  it('keeps a supplied mirror path + device', () => {
    const t = captureTemplate({ id: 'tpl:1', name: 'X', bytes: syx, path: 'Templates/X.syx', device: 'FM3' });
    expect(t.path).toBe('Templates/X.syx');
    expect(t.device).toBe('FM3');
  });
});

describe('templateBytes', () => {
  it('decodes the embedded .syx back to the exact bytes', () => {
    const t = captureTemplate({ id: 'tpl:1', name: 'X', bytes: syx });
    expect([...templateBytes(t)]).toEqual([...syx]);
  });
});

describe('serialize / parse', () => {
  it('round-trips a template through the .axtpl.json text', () => {
    const t = mk({ path: 'Templates/Clean DI.syx', device: 'FM3' });
    const back = parseTemplate(serializeTemplate(t));
    expect(back).toEqual(t);
  });
  it('rejects non-JSON, a foreign format, an unknown version and a broken shape', () => {
    expect(parseTemplate('not json')).toBeNull();
    expect(parseTemplate(JSON.stringify({ ...mk(), format: 'fm3-template' }))).toBeNull();
    expect(parseTemplate(JSON.stringify({ ...mk(), version: 99 }))).toBeNull();
    expect(parseTemplate(JSON.stringify({ format: AXTPL_FORMAT, version: AXTPL_VERSION, id: 'x' }))).toBeNull();
  });
  it('rejects a payload whose bytes do not match the recorded length (corrupt/truncated)', () => {
    expect(parseTemplate(JSON.stringify(mk({ bytesLen: syx.length + 5 })))).toBeNull();
  });
  it('rejects a non-base64 payload instead of guessing', () => {
    expect(parseTemplate(JSON.stringify(mk({ syx: '!!! not base64 !!!' })))).toBeNull();
  });
});

describe('templateName', () => {
  it('trims and falls back when blank', () => {
    expect(templateName('  Lead  ')).toBe('Lead');
    expect(templateName('', 'fallback')).toBe('fallback');
    expect(templateName(null)).toBe('template');
  });
});

describe('searchTemplates', () => {
  const list = [mk({ id: 'a', name: 'Clean DI' }), mk({ id: 'b', name: 'High Gain Lead' })];
  it('matches the name case-insensitively', () => {
    expect(searchTemplates(list, 'lead').map((t) => t.id)).toEqual(['b']);
  });
  it('returns the list unchanged for an empty query', () => {
    expect(searchTemplates(list, '  ')).toBe(list);
  });
});

describe('renameTemplate', () => {
  it('trims and bumps updatedAt, keeping createdAt', () => {
    const t = renameTemplate(mk(), '  Solo Boost  ', 5000);
    expect(t.name).toBe('Solo Boost');
    expect(t.updatedAt).toBe(5000);
    expect(t.createdAt).toBe(1000);
  });
  it('keeps the old template on an empty or unchanged rename', () => {
    const t = mk();
    expect(renameTemplate(t, '   ', 5000)).toBe(t);
    expect(renameTemplate(t, 'Clean DI', 5000)).toBe(t);
  });
});

describe('upsertTemplate / deleteTemplate', () => {
  it('replaces by id and sorts newest-first', () => {
    const a = mk({ id: 'a', updatedAt: 10, createdAt: 10 });
    const b = mk({ id: 'b', updatedAt: 20, createdAt: 20 });
    const list = upsertTemplate(upsertTemplate([], a), b);
    expect(list.map((t) => t.id)).toEqual(['b', 'a']);
    const updated = upsertTemplate(list, { ...a, updatedAt: 30 });
    expect(updated.map((t) => t.id)).toEqual(['a', 'b']);
    expect(updated.length).toBe(2);
  });
  it('deletes by id', () => {
    expect(deleteTemplate([mk({ id: 'a' }), mk({ id: 'b' })], 'a').map((t) => t.id)).toEqual(['b']);
  });
});

describe('templateFilename / newTemplateId', () => {
  it('sanitises the name into an .axtpl.json filename', () => {
    expect(templateFilename(mk({ name: 'My Lead / V2' }))).toBe('My_Lead_V2.axtpl.json');
    expect(templateFilename(mk({ name: '   ' }))).toBe(`template${AXTPL_EXT}`);
  });
  it('mints a tpl:-prefixed id', () => {
    expect(newTemplateId(1000)).toMatch(/^tpl:/);
  });
});

// ── runSaveAsTemplate: the flow + the honest degrade ──────────────────────────────────────────────

function surface(over: Partial<TemplateSaveSurface> = {}): TemplateSaveSurface & { stored: PresetTemplate[]; toasts: string[] } {
  const stored: PresetTemplate[] = [];
  const toasts: string[] = [];
  return {
    capture: async () => ({ name: 'Clean DI', bytes: syx }),
    folderReady: () => false,
    mirrorToFolder: async () => ({ path: `${TEMPLATE_DIR}/Clean DI.syx` }),
    download: () => {},
    store: (e) => void stored.push(e),
    toast: (t) => void toasts.push(t),
    stored,
    toasts,
    ...over
  };
}

describe('runSaveAsTemplate', () => {
  it('noops with a toast when nothing is loaded', async () => {
    const s = surface({ capture: async () => null });
    const r = await runSaveAsTemplate(s);
    expect(r).toEqual({ kind: 'noop', reason: 'no-preset' });
    expect(s.stored).toHaveLength(0);
    expect(s.toasts[0]).toMatch(/no preset/i);
  });

  it('fails cleanly when capture throws (device offline)', async () => {
    const s = surface({ capture: async () => { throw new Error('offline'); } });
    const r = await runSaveAsTemplate(s);
    expect(r.kind).toBe('failed');
    expect(s.stored).toHaveLength(0);
  });

  it('without a Presets folder: stores locally AND exports the .axtpl.json download', async () => {
    const downloads: { filename: string; text: string }[] = [];
    const s = surface({ folderReady: () => false, download: (filename, text) => void downloads.push({ filename, text }) });
    const r = await runSaveAsTemplate(s);
    expect(r).toMatchObject({ kind: 'saved', path: null, exported: true });
    expect(s.stored).toHaveLength(1);
    expect(downloads).toHaveLength(1);
    expect(downloads[0].filename).toBe(`Clean_DI${AXTPL_EXT}`);
    // the exported text is a real, re-importable template
    expect(parseTemplate(downloads[0].text)?.name).toBe('Clean DI');
    expect(s.toasts.some((t) => /no Presets folder configured/i.test(t))).toBe(true);
  });

  it('with a Presets folder: mirrors a .syx into Templates/ and records the path', async () => {
    const calls: { name: string; overwrite: boolean }[] = [];
    const s = surface({
      folderReady: () => true,
      mirrorToFolder: async (name, _bytes, overwrite) => { calls.push({ name, overwrite }); return { path: `${TEMPLATE_DIR}/Clean DI.syx` }; }
    });
    const r = await runSaveAsTemplate(s);
    expect(r).toMatchObject({ kind: 'saved', path: `${TEMPLATE_DIR}/Clean DI.syx`, exported: false });
    expect(calls).toEqual([{ name: 'Clean DI', overwrite: false }]);
    expect(s.stored.at(-1)?.path).toBe(`${TEMPLATE_DIR}/Clean DI.syx`);
  });

  it('overwrites a mirror only after the user confirms', async () => {
    const calls: boolean[] = [];
    const s = surface({
      folderReady: () => true,
      confirmOverwrite: () => true,
      mirrorToFolder: async (_n, _b, overwrite) => { calls.push(overwrite); return overwrite ? { path: `${TEMPLATE_DIR}/Clean DI.syx` } : 'exists'; }
    });
    const r = await runSaveAsTemplate(s);
    expect(calls).toEqual([false, true]);
    expect(r).toMatchObject({ kind: 'saved', path: `${TEMPLATE_DIR}/Clean DI.syx` });
  });

  it('keeps the registry copy but skips the mirror when overwrite is declined', async () => {
    const s = surface({
      folderReady: () => true,
      confirmOverwrite: () => false,
      mirrorToFolder: async () => 'exists'
    });
    const r = await runSaveAsTemplate(s);
    expect(r).toMatchObject({ kind: 'saved', path: null, exported: false });
    expect(s.stored).toHaveLength(1); // never lost
    expect(s.toasts.some((t) => /disk mirror skipped/i.test(t))).toBe(true);
  });

  it('keeps the registry copy when the disk mirror fails', async () => {
    const s = surface({ folderReady: () => true, mirrorToFolder: async () => { throw new Error('EACCES'); } });
    const r = await runSaveAsTemplate(s);
    expect(r).toMatchObject({ kind: 'saved', path: null });
    expect(s.stored).toHaveLength(1);
    expect(s.toasts.some((t) => /disk mirror failed/i.test(t))).toBe(true);
  });

  it('stores the registry entry BEFORE attempting any disk/download side effect', async () => {
    const order: string[] = [];
    const s = surface({
      folderReady: () => true,
      store: () => void order.push('store'),
      mirrorToFolder: async () => { order.push('mirror'); return { path: 'Templates/x.syx' }; }
    });
    await runSaveAsTemplate(s);
    expect(order[0]).toBe('store');
  });

  it('uses the capture name for the entry id prefix', async () => {
    const s = surface();
    const r = await runSaveAsTemplate(s);
    if (r.kind !== 'saved') throw new Error('expected saved');
    expect(r.entry.id).toMatch(/^tpl:/);
    expect(r.entry.bytesLen).toBe(syx.length);
  });
});
