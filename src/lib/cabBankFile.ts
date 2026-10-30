// A CAB BANK FILE of Axis's own — the one thing FM3-Edit's "Transmit All Cab Banks File" does that Axis
// could not: move a whole bank of IRs between machines without re-picking files one at a time.
//
// WHAT IT IS, AND WHAT IT IS NOT. The unit serves no slot-data READ (the IR download family is not sent —
// see the destructive-verb guard in device-hardware-probes.md), so Axis can only archive IRs whose bytes
// it already holds: those it uploaded, kept in the server-side cab library. A slot whose IR came from
// elsewhere is archived as ABSENT, with its name, rather than silently dropped or faked. That is why the
// archive carries an explicit `held: false` per slot instead of pretending a bank is complete.
//
// FORMAT. JSON, self-describing, versioned, and refused when it is not ours — an archive that half-parses
// is worse than an import that refuses.
//
// Pure module: no Svelte, no fetch, so the rules are unit-testable.

export const CAB_BANK_FILE_KIND = 'axis.cabset';
export const CAB_BANK_FILE_VERSION = 1;

/** One slot of an archive. `bytes` is base64 of the `.syx` container Axis uploaded; null = not held. */
export interface CabBankFileSlot {
  /** Axis user slot, 1..512 (the editor's numbering, not the bank-local index). */
  user: number;
  name: string;
  bytes: string | null;
}

export interface CabBankFile {
  kind: typeof CAB_BANK_FILE_KIND;
  version: number;
  /** ISO timestamp — informational; the importer never depends on it. */
  createdAt: string;
  /** Device the archive was taken from ("FM3"). Advisory: an archive is importable elsewhere, the IR
   *  container is what carries the codec. */
  device: string;
  /** Human label of the source bank ("User Bank 1"), advisory. */
  bank: string;
  slots: CabBankFileSlot[];
}

// ── base64 (no Buffer, no atob assumption: both targets are exercised by the tests) ──────────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : B64[b2 & 63];
  }
  return out;
}

/** Strict decode: throws on any character outside the alphabet, so a corrupted archive cannot import as
 *  a truncated IR. */
export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '');
  if (clean.length % 4 !== 0) throw new Error('base64 length is not a multiple of 4');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const chunk = clean.slice(i, i + 4);
    const vals = [...chunk].map((c) => (c === '=' ? 0 : B64.indexOf(c)));
    if (vals.some((v) => v < 0)) throw new Error('base64 contains a character outside the alphabet');
    const b0 = (vals[0]! << 2) | (vals[1]! >> 4);
    out.push(b0 & 0xff);
    if (chunk[2] !== '=') out.push(((vals[1]! & 15) << 4) | (vals[2]! >> 2));
    if (chunk[3] !== '=') out.push(((vals[2]! & 3) << 6) | vals[3]!);
  }
  return new Uint8Array(out);
}

// ── build ─────────────────────────────────────────────────────────────────────────────────────────
export interface CabBankSourceSlot {
  user: number;
  name: string;
  /** The `.syx` bytes Axis holds for this slot, or null when it holds none. */
  bytes: Uint8Array | null;
  /** When the copy was saved (ISO). The server keeps EVERY upload of a slot, so the same user number
   *  appears more than once in the library; the archive must carry exactly one copy per slot. */
  savedAt?: string;
}

/** Build the archive. Slots are sorted by user number so two exports of the same bank compare equal. */
export function buildCabBankFile(args: {
  device: string;
  bank: string;
  slots: readonly CabBankSourceSlot[];
  now?: string;
}): CabBankFile {
  // ONE COPY PER SLOT, newest wins. The library keeps every upload of a slot, so a naive map would
  // archive the same user number twice and the strict parser would (rightly) refuse the file.
  const newest = new Map<number, CabBankSourceSlot>();
  for (const s of args.slots) {
    const prev = newest.get(s.user);
    if (!prev) {
      newest.set(s.user, s);
      continue;
    }
    const prevAt = prev.savedAt ?? '';
    const thisAt = s.savedAt ?? '';
    // an entry with bytes beats one without, then the later timestamp wins
    const prevHas = !!prev.bytes?.length;
    const thisHas = !!s.bytes?.length;
    if (thisHas !== prevHas ? thisHas : thisAt >= prevAt) newest.set(s.user, s);
  }
  const slots: CabBankFileSlot[] = [...newest.values()]
    .sort((a, b) => a.user - b.user)
    .map((s) => ({
      user: s.user,
      name: s.name,
      bytes: s.bytes && s.bytes.length ? bytesToBase64(s.bytes) : null
    }));
  return {
    kind: CAB_BANK_FILE_KIND,
    version: CAB_BANK_FILE_VERSION,
    createdAt: args.now ?? new Date().toISOString(),
    device: args.device,
    bank: args.bank,
    slots
  };
}

export function serializeCabBankFile(file: CabBankFile): string {
  return JSON.stringify(file, null, 2);
}

// ── parse ─────────────────────────────────────────────────────────────────────────────────────────
export type ParseResult = { ok: true; file: CabBankFile } | { ok: false; error: string };

/** Parse an archive. Refuses anything it cannot fully validate — never a partial import. */
export function parseCabBankFile(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not JSON' };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not an object' };
  const o = raw as Record<string, unknown>;
  if (o.kind !== CAB_BANK_FILE_KIND) return { ok: false, error: `not an ${CAB_BANK_FILE_KIND} file` };
  if (o.version !== CAB_BANK_FILE_VERSION) return { ok: false, error: `unsupported version ${String(o.version)}` };
  if (!Array.isArray(o.slots)) return { ok: false, error: 'slots is not an array' };
  const slots: CabBankFileSlot[] = [];
  const seen = new Set<number>();
  for (const [i, s] of (o.slots as unknown[]).entries()) {
    if (!s || typeof s !== 'object') return { ok: false, error: `slot ${i} is not an object` };
    const r = s as Record<string, unknown>;
    if (!Number.isInteger(r.user) || (r.user as number) < 1 || (r.user as number) > 512) {
      return { ok: false, error: `slot ${i} has an invalid user number` };
    }
    if (seen.has(r.user as number)) return { ok: false, error: `slot ${r.user} appears twice` };
    seen.add(r.user as number);
    if (typeof r.name !== 'string') return { ok: false, error: `slot ${r.user} has no name` };
    if (r.bytes !== null && typeof r.bytes !== 'string') return { ok: false, error: `slot ${r.user} has no bytes field` };
    if (typeof r.bytes === 'string') {
      try {
        const b = base64ToBytes(r.bytes);
        if (!b.length) return { ok: false, error: `slot ${r.user} has an empty payload` };
      } catch (e) {
        return { ok: false, error: `slot ${r.user}: ${(e as Error).message}` };
      }
    }
    slots.push({ user: r.user as number, name: r.name, bytes: (r.bytes as string | null) ?? null });
  }
  return {
    ok: true,
    file: {
      kind: CAB_BANK_FILE_KIND,
      version: CAB_BANK_FILE_VERSION,
      createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
      device: typeof o.device === 'string' ? o.device : '',
      bank: typeof o.bank === 'string' ? o.bank : '',
      slots
    }
  };
}

// ── import plan ──────────────────────────────────────────────────────────────────────────────────
export type ImportAction = 'upload' | 'overwrite' | 'skip-occupied' | 'skip-not-held';

export interface ImportPlanRow {
  /** Slot in the archive. */
  source: number;
  /** Slot that would be written. */
  dest: number;
  name: string;
  action: ImportAction;
  /** Payload bytes, absent for the skip rows. */
  bytes: Uint8Array | null;
  /** Why a row is skipped — rendered verbatim. */
  reason?: string;
}

/**
 * Plan an import into consecutive destinations starting at `destStart` (or keeping the archive's own
 * numbering when `keepSlots`). NOTHING is written here.
 *
 * Overwriting is opt-in: with `overwrite: false` a row whose destination is occupied is skipped, and the
 * plan says so. A slot the archive does not hold the bytes for is ALWAYS skipped — there is nothing to
 * write, and inventing silence is exactly the failure the IR work spent two days removing.
 */
export function planBankImport(
  file: CabBankFile,
  opts: { occupied: Iterable<number>; keepSlots?: boolean; destStart?: number; overwrite?: boolean }
): ImportPlanRow[] {
  const occupied = new Set(opts.occupied);
  const keep = opts.keepSlots ?? false;
  let next = opts.destStart ?? 1;
  const rows: ImportPlanRow[] = [];
  for (const s of [...file.slots].sort((a, b) => a.user - b.user)) {
    const dest = keep ? s.user : next++;
    if (dest < 1 || dest > 512) {
      rows.push({ source: s.user, dest, name: s.name, action: 'skip-occupied', bytes: null, reason: `destination ${dest} is outside the user bank` });
      continue;
    }
    if (s.bytes === null) {
      rows.push({ source: s.user, dest, name: s.name, action: 'skip-not-held', bytes: null, reason: 'Axis holds no bytes for this slot — the unit cannot be read back' });
      continue;
    }
    const bytes = base64ToBytes(s.bytes);
    if (occupied.has(dest) && !opts.overwrite) {
      rows.push({ source: s.user, dest, name: s.name, action: 'skip-occupied', bytes, reason: `slot ${dest} already holds an IR` });
      continue;
    }
    rows.push({ source: s.user, dest, name: s.name, action: occupied.has(dest) ? 'overwrite' : 'upload', bytes });
  }
  return rows;
}

/** One line describing what a plan would do — for the confirm step and the log. */
export function describeImportPlan(rows: readonly ImportPlanRow[]): string {
  const count = (a: ImportAction) => rows.filter((r) => r.action === a).length;
  const upload = count('upload');
  const over = count('overwrite');
  const skip = rows.length - upload - over;
  const parts = [`${upload} to empty slot${upload === 1 ? '' : 's'}`];
  if (over) parts.push(`${over} overwriting`);
  if (skip) parts.push(`${skip} skipped`);
  return parts.join(', ');
}
