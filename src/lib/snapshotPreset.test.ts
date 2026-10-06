import { describe, it, expect } from 'vitest';
import { runSnapshotToFolder, snapshotFilename, SNAPSHOT_DIR, type SnapshotSurface, type SnapshotCapture } from './snapshotPreset';

const bytes = (n = 3) => new Uint8Array([0xf0, 0x00, 0x01, n, 0xf7]);

function surface(over: Partial<SnapshotSurface> & { capture?: () => Promise<SnapshotCapture | null> } = {}): {
  s: SnapshotSurface;
  calls: { download: [string, Uint8Array][]; folder: [string, Uint8Array, boolean][]; toasts: string[]; confirms: number };
} {
  const calls = {
    download: [] as [string, Uint8Array][],
    folder: [] as [string, Uint8Array, boolean][],
    toasts: [] as string[],
    confirms: 0
  };
  const s: SnapshotSurface = {
    capture: async () => ({ name: 'My Lead', bytes: bytes() }),
    folderReady: () => true,
    saveToFolder: async (name, b, ow) => {
      calls.folder.push([name, b, ow]);
      return { path: `${SNAPSHOT_DIR}/${name}.syx` };
    },
    download: (name, b) => void calls.download.push([name, b]),
    toast: (t) => void calls.toasts.push(t),
    ...over
  };
  return { s, calls };
}

describe('snapshotPreset — one-click snapshot to the Snapshots folder', () => {
  it('snapshotFilename sanitizes to a safe basename + .syx', () => {
    expect(snapshotFilename('My Lead')).toBe('My Lead.syx');
    expect(snapshotFilename('a/b:c*d')).toBe('a_b_c_d.syx');
    expect(snapshotFilename('')).toBe('preset.syx');
    expect(snapshotFilename(null)).toBe('preset.syx');
  });

  it('no preset loaded → noop (no write, no download)', async () => {
    const { s, calls } = surface({ capture: async () => null });
    expect(await runSnapshotToFolder(s)).toEqual({ kind: 'noop', reason: 'no-preset' });
    expect(calls.folder).toHaveLength(0);
    expect(calls.download).toHaveLength(0);
  });

  it('writes into the folder (dir=Snapshots) when it is ready', async () => {
    const { s, calls } = surface();
    expect(await runSnapshotToFolder(s)).toEqual({ kind: 'saved', path: `${SNAPSHOT_DIR}/My Lead.syx` });
    expect(calls.folder).toEqual([['My Lead', expect.any(Uint8Array), false]]);
    expect(calls.folder[0][2]).toBe(false); // first attempt does not overwrite
  });

  it('falls back to a browser download when no folder is configured', async () => {
    const { s, calls } = surface({ folderReady: () => false });
    expect(await runSnapshotToFolder(s)).toEqual({ kind: 'downloaded', name: 'My Lead.syx' });
    expect(calls.download[0][0]).toBe('My Lead.syx');
    expect(calls.folder).toHaveLength(0);
  });

  it('overwrites only when the user confirms an existing name', async () => {
    const existing = surface({
      saveToFolder: async (name, _b, ow) => (ow ? { path: `${SNAPSHOT_DIR}/${name}.syx` } : 'exists'),
      confirmOverwrite: () => true
    });
    expect(await runSnapshotToFolder(existing.s)).toEqual({ kind: 'saved', path: `${SNAPSHOT_DIR}/My Lead.syx` });

    const declined = surface({
      saveToFolder: async () => 'exists',
      confirmOverwrite: () => false
    });
    expect(await runSnapshotToFolder(declined.s)).toEqual({ kind: 'noop', reason: 'exists' });
  });

  it('treats a capture/write failure as failed (toast + no crash)', async () => {
    const boom = surface({ capture: async () => { throw new Error('device offline'); } });
    expect(await runSnapshotToFolder(boom.s)).toEqual({ kind: 'failed', error: expect.any(Error) });
    expect(boom.calls.toasts.some((t) => /failed/i.test(t))).toBe(true);

    const writeFail = surface({ saveToFolder: async () => { throw new Error('disk full'); } });
    expect((await runSnapshotToFolder(writeFail.s)).kind).toBe('failed');
  });
});
