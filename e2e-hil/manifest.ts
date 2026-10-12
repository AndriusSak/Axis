/**
 * HIL UI verification MANIFEST — FEATURE → the controls it owns → its HIL assertions.
 *
 * This is the contract the skill's "rule for shipping UI" rests on: every UI feature or change adds
 * its row here, naming the control(s) it introduces, the block/page they live on, and the
 * VALUE / NAME / VISIBILITY / PRESENCE assertions that cover them — and the HIL layer (Playwright
 * against the LIVE stack + real device) is run before the change ships. "The suites are green" is not
 * a substitute: say which LAYER ran and what it compared against.
 *
 * A row whose hardware is not attached is reported PENDING by the runner, not passed. A row whose
 * spec is not implemented yet is `implemented: false` and reported PENDING with a reason.
 *
 * The four assertion kinds (a control may pass one and fail another — they are reported separately):
 *   VALUE      — the control's READOUT equals the served value (tolerance for rounding/units).
 *   NAME       — where the server serves a name, the UI shows it; a raw number where a name is served
 *                is a failure, and where NO name is served the fix is an explicit marker, never a bare id.
 *   VISIBILITY — the box lies inside its scrollable pane's visible area, or is reachable by scrolling
 *                THAT pane. DOM-present-but-off-pane is its own outcome.
 *   PRESENCE   — every served control either renders or is REPORTED with a reason (unserved/gap/withheld).
 */

export type AssertionKind = 'VALUE' | 'NAME' | 'VISIBILITY' | 'PRESENCE';

export interface ManifestControl {
  /** Served paramId, where the control binds a block param. */
  paramId?: number;
  /** The control's user-facing label as the device's own editor layout names it. */
  label: string;
  /** How the runner finds it in the DOM (a class or the plan that resolves it). */
  selector: string;
}

export interface ManifestEntry {
  /** Stable feature id (used as the report key). */
  feature: string;
  title: string;
  /** The block / page the feature lives on. */
  area: string;
  controls: ManifestControl[];
  assertions: AssertionKind[];
  /** Oracle the assertion compares against (read through the app's own /api proxy). */
  oracle: string;
  /** Spec file that runs this row, relative to e2e-hil/. */
  spec: string;
  implemented: boolean;
  /** Why it is not implemented (or a caveat), when it is not. */
  note?: string;
}

export const MANIFEST: readonly ManifestEntry[] = [
  {
    feature: 'cab-room-air-readouts',
    title: 'Cab block · Room/Air page readouts match the served payload',
    area: 'Cab block (eid 62) · Room/Air page',
    controls: [
      { paramId: 35, label: 'Room Level', selector: '.card .dialwrap' },
      { paramId: 36, label: 'Room Size', selector: '.card .dialwrap' },
      { paramId: 56, label: 'Room Shape', selector: '.card .onoff' },
      { paramId: 53, label: 'Floor Reflections', selector: '.card .dialwrap' },
      { paramId: 59, label: 'Room Diffusion', selector: '.card .dialwrap' },
      { paramId: 57, label: 'LF Damping', selector: '.card .dialwrap' },
      { paramId: 58, label: 'HF Damping', selector: '.card .dialwrap' },
      { paramId: 37, label: 'Mic Spacing', selector: '.card .dialwrap' },
      { paramId: 54, label: 'Air', selector: '.card .dialwrap' },
      { paramId: 55, label: 'Frequency', selector: '.card .dialwrap' },
      { paramId: 41, label: 'Proximity Frequency', selector: '.card .dialwrap' },
      { paramId: 28, label: 'Level (mixer)', selector: '.card .dialwrap' },
      { paramId: 29, label: 'Balance (mixer)', selector: '.card .dialwrap' },
      { paramId: 42, label: 'Input Mode', selector: '.card .seltxt' },
      { paramId: 30, label: 'Bypass Mode', selector: '.card .onoff' },
      { paramId: 84, label: 'Scene Ignore', selector: '.card .onoff' }
    ],
    assertions: ['VALUE', 'PRESENCE', 'VISIBILITY'],
    oracle: '/preset/blocks/62/params (through the app proxy)',
    spec: 'specs/cab-room-air.spec.ts',
    implemented: true
  },
  {
    feature: 'dynacab-mic-pad',
    title: 'DynaCab mic pad renders AND is reachable in the block pane',
    area: 'Cab block (eid 62) · Cab page (page 0)',
    controls: [
      { label: 'DynaCab mic tile (cab 1)', selector: '.dynabox' },
      { label: 'DynaCab mic tile (cab 2)', selector: '.dynabox' }
    ],
    assertions: ['PRESENCE', 'VISIBILITY', 'NAME'],
    oracle: '/preset/blocks/62/params (dynacab view bindings) + pane geometry',
    spec: 'specs/cab-dynacab-visibility.spec.ts',
    implemented: true
  },
  {
    feature: 'fc-block-naming',
    title: 'FC editor assigned-block field shows a NAME, never a bare id',
    area: 'Footswitches (eid 199) · FC editor value slot (block-typed)',
    controls: [{ label: 'Effect (block-typed) value slot', selector: 'select[title*="placed block"]' }],
    assertions: ['NAME'],
    oracle: '/preset/grid (placed blocks) through the app proxy',
    spec: 'specs/fc-block-naming.spec.ts',
    implemented: true
  },
  {
    feature: 'preset-switch-named-pickers',
    title: 'Per-switch TAP category/function pickers show served NAMES and the served selection',
    area: 'Footswitches (eid 199) · per-switch TAP pickers · Device Tools · Per-Preset Switches',
    controls: [
      { label: 'TAP category picker', selector: 'select (named from /fc/model.categories)' },
      { label: 'TAP function picker', selector: 'select (named from /fc/model.functions[category])' },
      { label: 'Device Tools · per-preset switch table', selector: '.prow .nm / .prow .ids' }
    ],
    assertions: ['NAME', 'VALUE', 'PRESENCE'],
    oracle: '/fc/model + /fc/state + /preset/switches (through the app proxy)',
    spec: 'specs/preset-switch-naming.spec.ts',
    implemented: true,
    note: 'The Device Tools per-preset table is reached through the robust openDeviceTools() helper and reported PENDING with a stated reason when the workbench shell exposes no entry point (it does not today); the FC TAP pickers are the reachable, named surface.'
  }
] as const;

/**
 * A single assertion outcome, as written to the run's JSONL and aggregated into the report.
 *   pass  — the assertion held and was informative.
 *   fail  — the assertion held FALSE (the run goes RED).
 *   weak  — the assertion held but was VACUOUS (0 vs 0, the param default, another control's value):
 *           it does NOT count as a verification. Soft (not RED).
 *   warn  — a real finding that is not a hard failure (e.g. a control visible only after scrolling its
 *           pane — the owner-reported "nowhere to be seen" class). Soft (not RED).
 *   pending — could not run (no device, no served value, no readout); never a pass.
 *   info  — a non-assertion observation (counts, notes).
 */
export interface AssertionRecord {
  feature: string;
  control: string;
  kind: AssertionKind;
  status: 'pass' | 'fail' | 'pending' | 'info' | 'warn' | 'weak';
  expected?: string;
  actual?: string;
  detail?: string;
  source?: string;
}
