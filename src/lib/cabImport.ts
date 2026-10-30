// Manage Cabs — IR import staging: a picked file becomes an uploadable container, or an honest refusal.
//
//   .syx  → strict-parsed (the codec throws on anything it does not understand) and kept byte-for-byte,
//           optionally renamed through the codec (which recomputes the close value);
//   .wav  → converted by the codec's pure pipeline (resample → [MPT] → [auto-trim] → fit → encode);
//   .ir   → NO format for it is documented in this stack. A file that carries a RIFF/WAVE header is read as
//           WAV (a statement about its bytes, shown to the user); anything else is refused with that reason.
//
// ✅ CONVERTED CONTAINERS PLAY — measured 2026-10-30. The codec was decoded from a known input: a ruler WAV
// imported by FM3-Edit with IR Output Format = **Standard** exports 2040 little-endian IEEE-754 float32
// samples, which reproduce bit-for-bit what this converter writes. A container built here was uploaded to an
// empty FM3 user slot and auditioned — it plays, louder only because the editor normalises on import.
// Two rules the first attempts broke: the 32nd name slot is a NUL terminator (0x80 with its flag — 0xA0
// marks UltraRes), and the payload must be the Standard form. UltraRes payloads are opaque (7.98 bits/byte,
// no standard codec decodes them) and are NOT written here.
// Historical note (kept because it was the standing wording): One
// converted container HAS been auditioned on the unit: it was accepted by the unit's close check and sounded
// transparent, which proves the transport, the name round-trip and end-to-end acceptance. What that does NOT
// prove is the sample ENCODING: an impulse reads the same whether its words are IEEE-754 float32 or int32 Q31,
// so the audition cannot discriminate them — see forgefx-midi `cabIrConvert.ts`. The close check proves the
// bytes arrived intact; it cannot tell whether the sample WORDS are encoded the way the unit reads them.
// Everything staged from a .wav carries `unvalidated: true` (the flag the acknowledgement gate reads) and the
// UI must keep saying so.
//
// Browser-safe: imports ONLY the self-contained codec subpath (never the barrel).
import {
  CAB_IR_OUTPUT_FORMATS,
  CAB_IR_SAMPLE_SLOTS,
  cabIrNameFromFilename,
  cabIrUserSlot,
  convertWavToCabIr,
  parseCabIrSyx,
  renameCabIrSyx,
  type CabIrConvertReport
} from 'forgefx-midi/devices/gen3/cabIrConvert';

export { CAB_IR_OUTPUT_FORMATS };

export type ImportKind = 'syx' | 'wav' | 'wav-as-ir' | 'ir-unknown' | 'unknown';

export interface ImportOptions {
  minimumPhase: boolean;
  autoTrim: boolean;
  /** An `available` id of `CAB_IR_OUTPUT_FORMATS`. */
  outputFormat: string;
  /** Container name; '' = keep (.syx) / derive from the file name (.wav). */
  name: string;
  /** SysEx model byte of the connected unit (default FM3 0x11). */
  model?: number;
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  minimumPhase: false,
  autoTrim: false,
  outputFormat: 'std-2040',
  name: ''
};

/** What each conversion option does — rendered next to its control. */
export const IMPORT_OPTION_HELP = {
  minimumPhase:
    'Minimum-phase transform: keeps the magnitude response, moves the energy as early as it can be (removes pre-ringing and latency).',
  autoTrim:
    'Auto-trim: strips leading silence (below −60 dB of the file’s peak) and normalises the peak to full scale.',
  outputFormat: 'Container geometry. Only the geometry measured on this unit family can be written; the others are listed with why not.'
} as const;

export const IR_EXTENSION_REASON =
  'The .ir file format is not documented anywhere in this stack and no specimen exists to read it from, so it is not guessed. Export the impulse response as a .wav (or use the unit’s .syx) instead.';

export function detectImportKind(bytes: Uint8Array, filename: string): ImportKind {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  const riff = bytes.length >= 12 && String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) === 'RIFF' && String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!) === 'WAVE';
  if (bytes.length > 0 && bytes[0] === 0xf0) return 'syx';
  if (riff) return ext === 'ir' ? 'wav-as-ir' : 'wav';
  if (ext === 'ir') return 'ir-unknown';
  return 'unknown';
}

export type StagedImport =
  | {
      kind: 'syx';
      filename: string;
      name: string;
      container: Uint8Array;
      sampleSlots: number;
      unvalidated: false;
      notes: string[];
    }
  | {
      kind: 'wav';
      filename: string;
      name: string;
      container: Uint8Array;
      sampleSlots: number;
      /** Always true: no converted container has been auditioned on a unit. */
      unvalidated: true;
      report: CabIrConvertReport;
      samples: Float64Array;
      notes: string[];
    }
  | { kind: 'error'; filename: string; reason: string };

/** Stage a picked file. Never throws: a refusal is a `kind: 'error'` with the exact reason. */
export function stageImport(bytes: Uint8Array, filename: string, opts: ImportOptions): StagedImport {
  const kind = detectImportKind(bytes, filename);
  try {
    if (kind === 'ir-unknown') return { kind: 'error', filename, reason: IR_EXTENSION_REASON };
    if (kind === 'unknown') {
      return { kind: 'error', filename, reason: 'Unrecognised file: expected a .syx IR container or a .wav (a RIFF/WAVE file).' };
    }
    if (kind === 'syx') {
      const parsed = parseCabIrSyx(bytes); // strict
      const wanted = opts.name.trim();
      const renamed = wanted !== '' && wanted !== parsed.name;
      const container = renamed ? Uint8Array.from(renameCabIrSyx(bytes, wanted)) : bytes;
      return {
        kind: 'syx',
        filename,
        name: renamed ? wanted : parsed.name,
        container,
        sampleSlots: parsed.sampleSlots,
        unvalidated: false,
        notes: renamed ? ['Renamed inside the container; its close value was recomputed.'] : []
      };
    }
    const notes: string[] = [];
    if (kind === 'wav-as-ir') notes.push('This .ir file carries a RIFF/WAVE header, so it was read as a WAV.');
    const conv = convertWavToCabIr(bytes, {
      // the start frame's destination is overwritten server-side (?user=N); any valid slot works here
      dest: cabIrUserSlot(1),
      name: opts.name.trim() === '' ? cabIrNameFromFilename(filename) : opts.name.trim(),
      model: opts.model,
      minimumPhase: opts.minimumPhase,
      autoTrim: opts.autoTrim,
      outputFormat: opts.outputFormat
    });
    return {
      kind: 'wav',
      filename,
      name: conv.report.name,
      container: Uint8Array.from(conv.container),
      sampleSlots: CAB_IR_SAMPLE_SLOTS,
      unvalidated: true,
      report: conv.report,
      samples: conv.samples,
      notes
    };
  } catch (e) {
    return { kind: 'error', filename, reason: (e as Error).message };
  }
}

/** Rewrite a held container's name (the codec's own helper — close value recomputed). */
export function rewriteName(bytes: Uint8Array, name: string): Uint8Array {
  return Uint8Array.from(renameCabIrSyx(bytes, name));
}
