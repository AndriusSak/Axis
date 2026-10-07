// Data-source SEAM for the editor-backed grid components (SignalGrid / GridMap /
// BlockEditor / ControlSurface / EQGraph / CabPicker). Today every one of them resolves
// the live device-backed `editor` singleton; this indirection lets a later milestone drive
// them from an OFFLINE buffer (an alternative EditorSurface set into Svelte context) without
// touching the components. With no provider set, getEditorSurface() falls back to the singleton
// → behaviourally identical to a direct `import { editor }`.
//
// EditorSurface is the exact subset of the EditorStore that those six components read/call
// (plus cabState, routed off the direct forgefx client). The compile-time guard at the bottom
// of editor.svelte.ts (`_editorSatisfiesSurface`) forces the singleton to satisfy this shape.
import { getContext, hasContext } from 'svelte';
import { editor } from './editor.svelte';
import type { Cell, Layout } from './grid';
import type { NamedParam, EnumParam, DetectResult, DeviceLayout, LiveMonitor, CabState } from './types';
import type { SwipeCtrl } from './layouts';
import type { ChannelClip } from './blockOps';
import type { ParamValueClip } from './paramClipOps';
import type { BlockLibraryEntry } from './blockLibrary';

export const EDITOR_SURFACE_KEY = Symbol('axis.editorSurface');

export interface EditorSurface {
  // ── grid reads ──
  layout: Layout;
  status: 'loading' | 'ready' | 'offline';
  readonly shuntBase: number;
  readonly canGridRoute: boolean;

  // ── selection / editor state ──
  selKey: string | null;
  readonly selected: Cell | null;
  editorOpen: boolean;
  editorH: number;
  sheetState: 'loading' | 'ready' | 'error' | 'nopack';
  blockType: { value: number; name: string } | null;
  blockLayout: DeviceLayout | null;
  linkFrom: Cell | null;
  paletteMode: 'place' | 'retype';
  paletteOpen: boolean;
  placeTarget: { row: number; col: number } | null;
  cabPickerOpen: boolean;
  params: NamedParam[];
  enums: EnumParam[];
  /** Basic/Advanced View mode (the top bar's View widget). Selects which page a block opens on —
   *  see `pageForViewMode` in deviceLayoutBoard. */
  readonly globalMode: 'basic' | 'advanced';

  // ── responsive / mobile grid ──
  readonly isMobile: boolean;
  vw: number;
  vh: number;
  mobCols: number;
  gridPage: number;
  readonly pageCount: number;
  changeCols: (d: number) => void;
  setCols: (n: number) => void;
  colsFit: () => void;
  changePage: (d: number) => void;
  setPage: (p: number) => void;

  // ── grid mutators / editor actions ──
  load: () => Promise<void>;
  openCell: (c: Cell) => Promise<void>;
  closeEditor: () => void;
  move: (src: Cell, row: number, col: number) => Promise<void>;
  // The store returns whether the removal landed (so the caller toasts success only for a landed
  // clear — a refused `{ok:false}` must not be reported as removed); the offline convert editor
  // returns void. Both satisfy the seam.
  removeAt: (row: number, col: number) => Promise<boolean | void>;
  removeSelected: () => Promise<void>;
  connect: (src: Cell, destRow: number, destCol: number) => Promise<void>;
  disconnect: (srcRow: number, srcCol: number, destRow: number) => Promise<void>;
  // FM3-Edit parity grid/structure ops (audit §2.9)
  disconnectAll: (row: number, col: number) => Promise<void>;
  insertShunt: (row: number, col: number) => Promise<void>;
  resetBlock: (cell?: Cell) => Promise<void>;
  resetChannel: (cell?: Cell) => Promise<void>;
  swap: (a: Cell, b: Cell) => Promise<void>;
  copyBlock: (cell?: Cell) => Promise<void>;
  pasteBlock: (row: number, col: number) => Promise<void>;
  /** Move an entire grid row / column one position (audit §2.9 grid border sliders). Bounded by the
   *  decoded device grid shape; refuses off-edge shifts through the planner. */
  shiftRow: (row: number, dir: -1 | 1) => Promise<void>;
  shiftColumn: (col: number, dir: -1 | 1) => Promise<void>;
  armLink: (c: Cell) => void;
  cancelLink: () => void;
  completeLink: (row: number, col: number) => Promise<void>;
  openPaletteAt: (row: number, col: number) => void;
  openRetype: () => void;
  openCabPicker: () => void;
  applyCab: (writes: { paramId: number; value: number }[]) => Promise<void>;
  toggleBypass: (cell?: Cell) => Promise<void>;
  setChannel: (ch: string) => Promise<void>;
  /** Channel clipboard for copy/paste channel (footer channel ops). */
  channelClip: ChannelClip | null;
  copyChannel: () => void;
  pasteChannel: () => Promise<void>;
  /** Parameter-VALUE clipboard (audit §2.11 remainder) — copy/paste ONE served param's value between
   *  blocks, keyed by the device paramId. Surfaced from the control context menu. */
  paramClip: ParamValueClip | null;
  copyParamValue: (paramId: number, continuous: boolean) => void;
  pasteParamValue: () => Promise<void>;
  /** Channel ops that span scenes / blocks (audit §2.10 remainder) — see `channelOps.ts`. */
  readonly sceneCount: number;
  readonly canPasteChannelAcrossBlocks: boolean;
  /** Set the open block's channel in EVERY scene, then return to the origin scene. */
  setChannelAcrossScenes: () => Promise<void>;
  /** Paste the copied channel onto the open block (only when the clip came from a different block). */
  pasteChannelAcrossBlocks: () => Promise<void>;
  /** Toggle the block's served "Scene Ignore" flag. */
  setSceneIgnore: (on: boolean) => Promise<void>;

  // ── Block Library (audit §2.6) ──
  blockLibraryOpen: boolean;
  openBlockLibrary: () => void;
  /** Save the selected block's model + active-channel values as a named library entry. */
  saveBlockToLibrary: (name?: string) => Promise<void>;
  /** Recall a library entry into a block (defaults to the selected one). */
  recallBlockEntry: (entry: BlockLibraryEntry, cell?: Cell) => Promise<void>;

  // ── block / params mutators (incl. device-only cabState, routed through the surface) ──
  setParam: (p: NamedParam, v: number) => void;
  setEnum: (e: EnumParam, value: number) => void;
  /** Select the open block's current parameter — the ↑/↓ nudge target (parity §2.12). */
  selectParam: (id: number) => void;
  cabState: (eid: number) => Promise<CabState>;

  // ── telemetry / meters / swipe controls ──
  levels: { out1L: number; out1R: number; out2L: number; out2R: number } | null;
  looperWave: { wave: number[]; position: number | null; level: number | null } | null;
  looperControl: (action: string, on: boolean) => Promise<void>;
  typeNameFor: (effectId: number) => string;
  monitorFor: (effectId: number) => LiveMonitor | null;
  monitorsFor: (effectId: number) => LiveMonitor[];
  controlsFor: (cell: Cell) => SwipeCtrl[];
  meterFor: (cell: Cell) => {
    norm: number;
    value: number;
    unit?: string;
    min?: number;
    max?: number;
    log?: boolean;
    count: number;
    active: number;
    name: string;
  } | null;
  cycleControl: (cell: Cell, dir: number) => void;
  adjustSwipe: (cell: Cell, deltaNorm: number) => void;
  isSwipeControl: (paramId: number) => boolean;
  toggleSwipeControl: (p: NamedParam) => void;

  // ── device-mirror ──
  detected: DetectResult | null;
  selectCellOnDevice: (row: number, col: number) => void;

  // ── hints / toasts ──
  hint: string | null;
  setHint: (text: string) => void;
  clearHint: () => void;
  showToast: (text: string, accent?: string) => void;
}

/** Resolve the active editor surface for the calling component: a context-provided surface
 *  (offline buffer, later milestone) when one is set, else the live device-backed singleton.
 *  Call once at component init (script top) — components mount inside a stable context.
 *  Defensive: Svelte's hasContext/getContext throw when called outside component init (e.g. a
 *  node unit test), so any failure falls back to the singleton — the pre-seam behaviour. */
export function getEditorSurface(): EditorSurface {
  try {
    if (hasContext(EDITOR_SURFACE_KEY)) return getContext<EditorSurface>(EDITOR_SURFACE_KEY);
  } catch {
    /* called outside a component context — use the live singleton */
  }
  return editor;
}
