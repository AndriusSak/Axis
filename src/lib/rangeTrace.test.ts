import { describe, it, expect } from 'vitest';
import {
  rangeQuery,
  describeSpan,
  classifyRow,
  isMismatch,
  summarize,
  type RangeTraceRow
} from './rangeTrace';

// The `/diag/ranges` trace (ForgeFX server/src/app.ts:140) answers the "why is this control
// missing?" question the parity audit keeps hitting (§3.6 item 3, §5.1). Per paramId it returns the
// row that actually SERVES the param (merged from the device self-describe walk) and the static
// CATALOGUE row. When the server's allowlist gate (KNOB_UNITS) drops a control, `serving` is null
// while `catalogue` still carries the definition — that difference IS the diagnosis. These helpers
// keep the classification out of the component so it is unit-testable.

const row = (p: Partial<RangeTraceRow>): RangeTraceRow => ({
  pid: 1,
  name: 'X',
  unit: 'Hz',
  serving: null,
  catalogue: null,
  ...p
});

describe('rangeQuery', () => {
  it('builds the family-only query', () => {
    expect(rangeQuery('CABINET')).toBe('/diag/ranges?family=CABINET');
  });
  it('adds pid when given', () => {
    expect(rangeQuery('GLOBAL', 25)).toBe('/diag/ranges?family=GLOBAL&pid=25');
  });
  it('defaults to CABINET and drops an empty family', () => {
    expect(rangeQuery()).toBe('/diag/ranges?family=CABINET');
    expect(rangeQuery('', 0)).toBe('/diag/ranges?family=CABINET&pid=0');
  });
  it('uppercases the family (server does)', () => {
    expect(rangeQuery('cabinet')).toBe('/diag/ranges?family=CABINET');
  });
});

describe('describeSpan', () => {
  it('renders an enum span', () => {
    expect(describeSpan({ kind: 'enum', min: 0, max: 3 })).toBe('enum [0, 3]');
  });
  it('renders a float span', () => {
    expect(describeSpan({ kind: 'float', min: 0, max: 10 })).toBe('float [0, 10]');
  });
  it('renders a missing row as a dash', () => {
    expect(describeSpan(null)).toBe('—');
  });
});

describe('classifyRow', () => {
  it('served when a serving row exists', () => {
    expect(classifyRow(row({ serving: { kind: 'enum', min: 0, max: 3 }, catalogue: { kind: 'enum', min: 0, max: 3 } }))).toBe('served');
  });
  it('dropped when the catalogue has a row but nothing serves it', () => {
    // This is the KNOB_UNITS gate: the definition exists, but the allowlist dropped the row.
    expect(classifyRow(row({ serving: null, catalogue: { kind: 'float', min: 0, max: 10 } }))).toBe('dropped');
  });
  it('absent when neither side has a row', () => {
    expect(classifyRow(row({ serving: null, catalogue: null }))).toBe('absent');
  });
});

describe('isMismatch', () => {
  it('flags a serving/catalogue kind divergence (the cab-2 mute class)', () => {
    expect(isMismatch(row({ serving: { kind: 'float', min: 0, max: 1 }, catalogue: { kind: 'enum', min: 0, max: 1 } }))).toBe(true);
  });
  it('flags a min/max divergence', () => {
    expect(isMismatch(row({ serving: { kind: 'float', min: 0, max: 1 }, catalogue: { kind: 'float', min: 0, max: 100 } }))).toBe(true);
  });
  it('quiet when the two rows agree', () => {
    expect(isMismatch(row({ serving: { kind: 'enum', min: 0, max: 3 }, catalogue: { kind: 'enum', min: 0, max: 3 } }))).toBe(false);
  });
  it('not a mismatch when either side is missing (dropped/absent are their own classes)', () => {
    expect(isMismatch(row({ serving: null, catalogue: { kind: 'float', min: 0, max: 10 } }))).toBe(false);
    expect(isMismatch(row({ serving: { kind: 'float', min: 0, max: 10 }, catalogue: null }))).toBe(false);
  });
});

describe('summarize', () => {
  it('counts each class and the mismatches', () => {
    const s = summarize([
      row({ serving: { kind: 'enum', min: 0, max: 3 }, catalogue: { kind: 'enum', min: 0, max: 3 } }),
      row({ serving: null, catalogue: { kind: 'float', min: 0, max: 10 } }),
      row({ serving: null, catalogue: null }),
      row({ serving: { kind: 'float', min: 0, max: 1 }, catalogue: { kind: 'enum', min: 0, max: 1 } })
    ]);
    expect(s).toEqual({ total: 4, served: 2, dropped: 1, absent: 1, mismatched: 1 });
  });
});
