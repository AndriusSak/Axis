import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// DeviceTools cannot be mounted in this repo's node-env vitest, so this guard pins the component
// source to the wiring the range-trace panel must keep. It exists to catch a regression that would
// silently disconnect the UI from the server's `/diag/ranges` trace (parity audit §3.6 item 3) —
// the panel is only useful if it still calls the client method and renders BOTH rows.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('DeviceTools range-trace panel wiring', () => {
  const src = read('./DeviceTools.svelte');

  it('fetches the trace through the typed client (no hand-rolled URL)', () => {
    expect(src).toMatch(/forgefx\.diagRanges\(/);
  });

  it('lets the user scope the trace by family and pid', () => {
    expect(src).toMatch(/bind:value=\{traceFamily\}/);
    expect(src).toMatch(/bind:value=\{tracePid\}/);
  });

  it('renders the serving row AND the catalogue row per paramId', () => {
    expect(src).toMatch(/describeSpan\(r\.serving\)/);
    expect(src).toMatch(/describeSpan\(r\.catalogue\)/);
  });

  it('classifies rows with the tested helpers rather than inline guessing', () => {
    expect(src).toMatch(/classifyRow\(r\)/);
    expect(src).toMatch(/isMismatch\(r\)/);
    expect(src).toMatch(/summarize\(trace\.rows\)/);
  });
});
