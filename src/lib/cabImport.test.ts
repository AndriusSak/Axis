import { describe, it, expect } from 'vitest';
import { buildCabIrContainerFromWords, cabIrUserSlot, CAB_IR_SAMPLE_SLOTS, parseCabIrSyx } from 'forgefx-midi/devices/gen3';
import { DEFAULT_IMPORT_OPTIONS, IR_EXTENSION_REASON, detectImportKind, rewriteName, stageImport } from './cabImport';

// a tiny 48 kHz mono float32 WAV: an impulse of 0.5 at sample 3
function wav(samples: number[], rate = 48000): Uint8Array {
  const data = new DataView(new ArrayBuffer(samples.length * 4));
  samples.forEach((v, i) => data.setFloat32(i * 4, v, true));
  const hdr = new DataView(new ArrayBuffer(44));
  const w = (o: number, s: string) => [...s].forEach((c, i) => hdr.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); hdr.setUint32(4, 36 + data.byteLength, true); w(8, 'WAVE'); w(12, 'fmt ');
  hdr.setUint32(16, 16, true); hdr.setUint16(20, 3, true); hdr.setUint16(22, 1, true);
  hdr.setUint32(24, rate, true); hdr.setUint32(28, rate * 4, true); hdr.setUint16(32, 4, true); hdr.setUint16(34, 32, true);
  w(36, 'data'); hdr.setUint32(40, data.byteLength, true);
  return Uint8Array.from([...new Uint8Array(hdr.buffer), ...new Uint8Array(data.buffer)]);
}
const impulse = () => wav([0, 0, 0, 0.5, 0, 0]);
const syx = () => Uint8Array.from(buildCabIrContainerFromWords(0x11, cabIrUserSlot(1), 'Held IR', Array.from({ length: CAB_IR_SAMPLE_SLOTS }, (_, i) => i)));

describe('detectImportKind', () => {
  it('sniffs by bytes, with the extension only deciding what an unrecognised .ir is', () => {
    expect(detectImportKind(syx(), 'a.syx')).toBe('syx');
    expect(detectImportKind(impulse(), 'a.wav')).toBe('wav');
    expect(detectImportKind(impulse(), 'a.ir')).toBe('wav-as-ir');
    expect(detectImportKind(Uint8Array.from([1, 2, 3]), 'a.ir')).toBe('ir-unknown');
    expect(detectImportKind(Uint8Array.from([1, 2, 3]), 'a.mp3')).toBe('unknown');
  });
});

describe('stageImport', () => {
  it('.wav → a container the codec parses strictly (2040 slots, the file name as the name), reported as MEASURED', () => {
    const s = stageImport(impulse(), 'Mesa 4x12.wav', DEFAULT_IMPORT_OPTIONS);
    expect(s.kind).toBe('wav');
    if (s.kind !== 'wav') return;
    expect(s.unvalidated).toBe(true);
    expect(s.name).toBe('Mesa 4x12');
    const parsed = parseCabIrSyx(s.container);
    expect(parsed.sampleSlots).toBe(2040);
    expect(parsed.name).toBe('Mesa 4x12');
    // 2026-10-30: the codec was DECODED against a known input (FM3-Edit Standard export = 2040 little-endian
    // IEEE-754 float32) and a container built here was auditioned from a cab slot on the unit. The report
    // therefore says MEASURED, and the encoding is no longer an assumption. `unvalidated` (asserted above)
    // stays the flag the acknowledgement gate reads: it tracks whether THIS container was auditioned.
    expect(s.report.status).toMatch(/^MEASURED/);
    expect(s.report.status).toMatch(/float32/);
    expect(s.report.status).toMatch(/UltraRes.*not writable|NOT writable/i);
    expect(s.report.encoding.assumed).toBe(false);
  });
  it('the conversion options reach the pipeline (MPT + auto-trim show in the report steps)', () => {
    const s = stageImport(impulse(), 'x.wav', { ...DEFAULT_IMPORT_OPTIONS, minimumPhase: true, autoTrim: true, name: 'Custom' });
    if (s.kind !== 'wav') throw new Error('expected wav');
    expect(s.name).toBe('Custom');
    expect(s.report.minimumPhase).toBe(true);
    // MPT runs first and already removes a pure delay, so nothing is left for auto-trim to strip
    expect(s.report.autoTrim).toMatchObject({ applied: true, leadingRemoved: 0 });
    const t = stageImport(impulse(), 'x.wav', { ...DEFAULT_IMPORT_OPTIONS, autoTrim: true });
    if (t.kind !== 'wav') throw new Error('expected wav');
    expect(t.report.autoTrim).toMatchObject({ applied: true, leadingRemoved: 3 }); // trim alone strips the 3 leading zeros
    expect(s.report.steps.join('|')).toMatch(/minimum-phase.*auto-trim/);
  });
  it('an unavailable output format is an error with the reason (UltraRes is not guessed)', () => {
    const s = stageImport(impulse(), 'x.wav', { ...DEFAULT_IMPORT_OPTIONS, outputFormat: 'ultrares' });
    expect(s).toMatchObject({ kind: 'error' });
    if (s.kind === 'error') expect(s.reason).toMatch(/No UltraRes container exists/);
  });
  it('an unmeasured device model is refused rather than producing a container', () => {
    const s = stageImport(impulse(), 'x.wav', { ...DEFAULT_IMPORT_OPTIONS, model: 0x07 });
    expect(s).toMatchObject({ kind: 'error' });
  });
  it('.syx is kept byte-for-byte (validated: false for conversion only), strict-parsed; rename recomputes the close', () => {
    const bytes = syx();
    const keep = stageImport(bytes, 'held.syx', DEFAULT_IMPORT_OPTIONS);
    if (keep.kind !== 'syx') throw new Error('expected syx');
    expect(keep.unvalidated).toBe(false);
    expect(Array.from(keep.container)).toEqual(Array.from(bytes));
    expect(keep.name).toBe('Held IR');
    const ren = stageImport(bytes, 'held.syx', { ...DEFAULT_IMPORT_OPTIONS, name: 'Renamed' });
    if (ren.kind !== 'syx') throw new Error('expected syx');
    expect(parseCabIrSyx(ren.container).name).toBe('Renamed');
    expect(ren.notes.join(' ')).toMatch(/close value was recomputed/);
  });
  it('a corrupt .syx is an error (the codec is strict), not a half-understood upload', () => {
    const bad = syx().slice(0, 500);
    expect(stageImport(bad, 'bad.syx', DEFAULT_IMPORT_OPTIONS).kind).toBe('error');
  });
  it('.ir: refused with the documented reason unless the bytes are a RIFF/WAVE (then read as WAV and said so)', () => {
    const no = stageImport(Uint8Array.from([1, 2, 3, 4]), 'cab.ir', DEFAULT_IMPORT_OPTIONS);
    expect(no).toEqual({ kind: 'error', filename: 'cab.ir', reason: IR_EXTENSION_REASON });
    const yes = stageImport(impulse(), 'cab.ir', DEFAULT_IMPORT_OPTIONS);
    if (yes.kind !== 'wav') throw new Error('expected wav');
    expect(yes.notes.join(' ')).toMatch(/RIFF\/WAVE header/);
  });
  it('rewriteName uses the codec rename (close recomputed)', () => {
    const out = rewriteName(syx(), 'Again');
    expect(parseCabIrSyx(out).name).toBe('Again');
  });
});
