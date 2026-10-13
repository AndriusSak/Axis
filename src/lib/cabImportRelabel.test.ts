// A NAME CHANGE MUST NOT RE-RUN THE CONVERSION.
//
// Found by a post-release review: `setOpt('name', …)` called `stage()` on every keystroke, i.e. the whole
// WAV → mono → resample → min-phase → container pipeline ran on the main thread once per character. A long
// 96 kHz file makes that a frozen UI. The name IS content (the container's close frame is a content XOR), so
// the bytes must still be rebuilt — but by the codec's cheap parse+rebuild (`rewriteName` → `renameCabIrSyx`),
// which touches no samples.
//
// Two halves, failing differently on purpose:
//   • the PROPERTIES of a rename (it preserves everything except the name, and it is a pure function of
//     content+name, so renaming to the same name is byte-identical);
//   • the WIRING — the panel must dispatch the name to the cheap path, and the sample-affecting options must
//     still restage in full. Removing the dispatch is how this regression would come back, and a property test
//     on `rewriteName` would stay green while every keystroke re-converted again.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCabIrSyx } from 'forgefx-midi/devices/gen3/cabIrConvert';
import { DEFAULT_IMPORT_OPTIONS, rewriteName, stageImport } from './cabImport';

/** A minimal but VALID 48 kHz mono 16-bit WAVE — the same shape the import path accepts. */
function tinyWav(frames = 2040): Uint8Array {
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) data.writeInt16LE(Math.round(20000 * Math.exp(-i / 40)), i * 2);
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write('WAVE', 8);
  hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22);
  hdr.writeUInt32LE(48000, 24); hdr.writeUInt32LE(48000 * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34);
  hdr.write('data', 36); hdr.writeUInt32LE(data.length, 40);
  return new Uint8Array(Buffer.concat([hdr, data]));
}

function staged() {
  const s = stageImport(tinyWav(), 'test-ir.wav', { ...DEFAULT_IMPORT_OPTIONS, name: 'ORIGINAL' });
  if (s.kind === 'error') throw new Error(`stageImport failed: ${s.reason}`);
  return s;
}

describe('rewriteName — a rename preserves the container and only changes the name', () => {
  const base = staged();
  const renamed = rewriteName(base.container, 'RENAMED IR');

  it('stores the new name (and trims to the device’s 32-char field)', () => {
    expect(parseCabIrSyx(renamed).name).toBe('RENAMED IR');
    expect(parseCabIrSyx(renamed).nameRaw.length).toBe(32);
  });

  it('preserves the start payload — the destination carrier a rename must not disturb', () => {
    expect([...parseCabIrSyx(renamed).startPayload]).toEqual([...parseCabIrSyx(base.container).startPayload]);
  });

  it('RECOMPUTES the close — the name is content for the XOR, so a rename MUST change it', () => {
    // This assertion started life the other way round ("preserves the end payload") and the test itself
    // refuted it: the 0x7C payload IS the close, and the unit DISCARDS a container whose close does not match
    // its content. A rename that preserved it would produce a container the unit throws away — so the correct
    // property is that it changes, and that a further rename (same content) is stable.
    expect([...parseCabIrSyx(renamed).endPayload]).not.toEqual([...parseCabIrSyx(base.container).endPayload]);
    const again = rewriteName(renamed, parseCabIrSyx(renamed).name);
    expect([...again]).toEqual([...renamed]);
  });

  it('keeps the container the same LENGTH (the name field is fixed-width) and the same frame count', () => {
    expect(renamed.length).toBe(base.container.length);
    expect(parseCabIrSyx(renamed).frames.length).toBe(parseCabIrSyx(base.container).frames.length);
  });

  it('actually rewrites the bytes — a rename is not a no-op, because the name is CONTENT for the close XOR', () => {
    expect([...renamed]).not.toEqual([...base.container]);
    // the frames differ somewhere beyond the header
    expect(parseCabIrSyx(renamed).frames).not.toEqual(parseCabIrSyx(base.container).frames);
  });

  it('is a pure function of content+name: renaming to the SAME name is byte-identical', () => {
    expect([...rewriteName(base.container, base.name)]).toEqual([...base.container]);
  });

  it('round-trips: rename then rename back restores the original bytes exactly', () => {
    const there = rewriteName(base.container, 'SOMETHING ELSE');
    const back = rewriteName(there, base.name);
    expect([...back]).toEqual([...base.container]);
  });
});

describe('the panel must dispatch a name change to the cheap path, not to a re-conversion', () => {
  const root = fileURLToPath(new URL('./', import.meta.url));
  const panel = readFileSync(join(root, 'CabManager.svelte'), 'utf8');

  it('setOpt sends the name to relabel() and everything else to a full stage()', () => {
    expect(panel).toMatch(/if \(k === 'name'\) relabel\(\);/);
    expect(panel).toMatch(/else stage\(\);/);
  });

  it('relabel() rebuilds the container through rewriteName (never through stageImport)', () => {
    const body = panel.slice(panel.indexOf('function relabel'), panel.indexOf('function relabel') + 800);
    expect(body).toMatch(/rewriteName\(staged\.container, name\)/);
    // It may FALL BACK to a full stage when nothing is staged yet — that is stated in its comment — but the
    // container path itself must not go through the WAV pipeline.
    expect(body).not.toMatch(/stageImport\(/);
  });
});
