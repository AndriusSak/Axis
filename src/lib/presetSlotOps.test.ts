import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  canCopySlots,
  duplicateSlot,
  swapSlots,
  SlotOpError,
  type SlotOpsClient
} from './presetSlotOps';

// ── the copy-by-store sequence over EXISTING endpoints (audit §2.4) ──────────────────────────────
// The FM3 wire protocol has no "copy slot N → M" op, so a duplicate/swap is composed from primitives
// the server already exposes: dump a slot (POST /preset/backup), load those bytes into the EDIT BUFFER
// (POST /preset/load — the driver retargets the dump header to the 0x3FFF edit-buffer sentinel), then
// store the buffer into a slot (POST /preset/store). These tests pin the ORDER and the byte routing of
// that sequence against a recording fake client — the device primitives are hardware-unverified here,
// but the composition is exactly the one the audit prescribes ("dump → load → store").

type Call = { op: 'dump' | 'load' | 'store'; arg: number | Uint8Array };

function recorder(opts?: { storeFail?: number }) {
  const calls: Call[] = [];
  const client: SlotOpsClient = {
    dump: async (n) => { calls.push({ op: 'dump', arg: n }); return { bytes: [0xf0, n, 0xf7] }; },
    load: async (b) => { calls.push({ op: 'load', arg: b }); return { ok: true }; },
    store: async (n) => { calls.push({ op: 'store', arg: n }); return { ok: n !== opts?.storeFail }; }
  };
  return { calls, client };
}

describe('presetSlotOps — capability gate', () => {
  it('requires the dump + edit-buffer-load + store primitives together', () => {
    expect(canCopySlots({ backupDump: true, loadBytes: true, store: true })).toBe(true);
    expect(canCopySlots({ backupDump: false, loadBytes: true, store: true })).toBe(false);
    expect(canCopySlots({ backupDump: true, loadBytes: false, store: true })).toBe(false);
    expect(canCopySlots({ backupDump: true, loadBytes: true, store: false })).toBe(false);
  });
});

describe('presetSlotOps — duplicate (dump → load → store)', () => {
  it('dumps the source, loads its bytes into the buffer, then stores the buffer to the target', async () => {
    const { calls, client } = recorder();
    await duplicateSlot(client, 12, 300);
    expect(calls.map((c) => c.op)).toEqual(['dump', 'load', 'store']);
    expect(calls[0].arg).toBe(12); // dumped the SOURCE
    expect(calls[2].arg).toBe(300); // stored to the TARGET
    expect(Array.from(calls[1].arg as Uint8Array)).toEqual([0xf0, 12, 0xf7]); // the source bytes, retargeted upstream
  });

  it('refuses a same-slot duplicate without touching the device', async () => {
    const { calls, client } = recorder();
    await expect(duplicateSlot(client, 7, 7)).rejects.toBeInstanceOf(SlotOpError);
    expect(calls).toHaveLength(0);
  });

  it('refuses a negative / non-integer slot', async () => {
    const { client } = recorder();
    await expect(duplicateSlot(client, -1, 3)).rejects.toBeInstanceOf(SlotOpError);
    await expect(duplicateSlot(client, 1.5, 3)).rejects.toBeInstanceOf(SlotOpError);
  });

  it('surfaces a rejected store as a SlotOpError', async () => {
    const { client } = recorder({ storeFail: 300 });
    await expect(duplicateSlot(client, 12, 300)).rejects.toBeInstanceOf(SlotOpError);
  });
});

describe('presetSlotOps — swap (dump both → load B/store A → load A/store B)', () => {
  it('swaps by storing each captured dump into the other slot', async () => {
    const { calls, client } = recorder();
    await swapSlots(client, 4, 9);
    expect(calls.map((c) => c.op)).toEqual(['dump', 'dump', 'load', 'store', 'load', 'store']);
    expect(calls[0].arg).toBe(4);
    expect(calls[1].arg).toBe(9);
    // first write: B's bytes → slot A
    expect(Array.from(calls[2].arg as Uint8Array)).toEqual([0xf0, 9, 0xf7]);
    expect(calls[3].arg).toBe(4);
    // second write: A's bytes → slot B
    expect(Array.from(calls[4].arg as Uint8Array)).toEqual([0xf0, 4, 0xf7]);
    expect(calls[5].arg).toBe(9);
  });

  it('refuses a same-slot swap without touching the device', async () => {
    const { calls, client } = recorder();
    await expect(swapSlots(client, 2, 2)).rejects.toBeInstanceOf(SlotOpError);
    expect(calls).toHaveLength(0);
  });
});

// ── component wiring (source guards — .svelte cannot mount in this node-env vitest) ──────────────
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('presetSlotOps — PresetBrowser context-menu wiring', () => {
  const src = read('./PresetBrowser.svelte');

  it('no longer lists duplicate as a do-nothing "soon" item', () => {
    // SOON must not contain 'duplicate' any more (it is wired to the real op below).
    expect(src).not.toMatch(/SOON\s*=\s*new Set\(\[[^\]]*'duplicate'/);
  });

  it('routes the duplicate + swap menu actions to the editor ops', () => {
    expect(src).toMatch(/editor\.duplicateStoredPreset\(/);
    expect(src).toMatch(/editor\.swapStoredPresets\(/);
  });

  it('keeps move/delete as HONEST disabled stubs carrying a reason', () => {
    // The ops with no wire-protocol backing (erase/move a slot) must be disabled AND explain why.
    expect(src).toMatch(/disabled:\s*true/);
    expect(src).toMatch(/reason:/);
    expect(src).toMatch(/no\s+slot[- ]erase|erase\s+primitive|can'?t clear/i);
  });
});

describe('presetSlotOps — editor ops exist', () => {
  const ed = read('./editor.svelte.ts');
  it('editor exposes canCopySlots + duplicateStoredPreset + swapStoredPresets', () => {
    expect(ed).toMatch(/get canCopySlots\(\)/);
    expect(ed).toMatch(/duplicateStoredPreset\s*=/);
    expect(ed).toMatch(/swapStoredPresets\s*=/);
  });
});
