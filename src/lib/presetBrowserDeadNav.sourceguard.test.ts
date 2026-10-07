import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Source guard for the R28 dead-nav fix in the monolith preset browser (parity audit §2.4/§3.4). The
// .svelte component cannot be mounted in this repo's node-env vitest, so — like listCaps.test.ts and
// blockOps.test.ts — we scan the source to prove the non-device rows no longer fall through to a
// no-op "Coming soon" toast and instead render DISABLED with an honest reason, the same treatment the
// DEVICE rows already use (no-dead-nav rule, 01-shell §9).
const src = readFileSync(fileURLToPath(new URL('./PresetBrowser.svelte', import.meta.url)), 'utf8');

describe('PresetBrowser — no dishonest "Coming soon" stubs (R28)', () => {
  it('drops the SOON set and its toast fallback entirely', () => {
    expect(src).not.toMatch(/SOON/);
    expect(src).not.toMatch(/Coming soon/i);
    expect(src).not.toMatch(/showToast\('Coming soon'/);
  });

  it('renders "Delete everywhere" DISABLED with an honest reason for non-device rows', () => {
    // the item carries the gate (no bare no-op button)
    expect(src).toMatch(/label: 'Delete everywhere'[\s\S]*?\.\.\.deleteGate\(\)/);
    // a local-folder entry has no delete op → disabled + reason, never a toast
    expect(src).toMatch(/LOCAL_NO_DELETE_REASON = 'Not available/);
    expect(src).toMatch(/disabled: true, reason: LOCAL_NO_DELETE_REASON/);
  });

  it('keeps the device-row honest treatment (no slot-erase op) intact', () => {
    expect(src).toMatch(/NO_ERASE_REASON = 'Not available/);
    expect(src).toMatch(/disabled: true, reason: NO_ERASE_REASON/);
  });

  it('has no fallthrough after the wired delete handlers', () => {
    // the converted/file deletes stay wired; nothing toasts afterwards
    expect(src).toMatch(/act === 'delete' && e\.source === 'converted'/);
    expect(src).toMatch(/act === 'delete' && e\.source === 'file'/);
  });
});
