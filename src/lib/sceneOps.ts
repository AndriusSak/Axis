// Scene Manager operations (parity audit §2.1).
//
// There is NO wire op for scene copy / paste / swap — the ForgeFX write protocol has no scene op
// beyond set-scene, and `setScene` is deliberately fire-and-forget (BACKLOG W1.1; audit §6.3). A
// preset-binary parser (the other route §6.3 floats) does not exist either. So every scene operation
// here is a CLIENT-SIDE SEQUENCE over the endpoints that DO exist:
//
//   POST /scene                        — switch the active scene (0-based)
//   GET  /preset/scene-state           — read the ACTIVE scene's per-block bypass + channel
//   POST /preset/blocks/:eid/bypass    — write one block's bypass in the active scene
//   POST /preset/blocks/:eid/channel   — write one block's channel in the active scene
//
// On Fractal hardware a scene IS a per-block bypass + channel (X/Y) map (plus scene-controller values,
// handled by the Controllers surface), so a copy/swap expressed as per-block bypass/channel writes onto
// the target scene is faithful — no new endpoint needed.
//
// Extracted into a plain module because this repo's node-env vitest cannot mount .svelte components;
// the panel (AxisSceneManagerPanel.svelte) only wires these functions to `forgefx` + the editor store.

export interface SceneStateBlock {
  effectId: number;
  bypassed: boolean | null;
  channel: string | null;
}

/** Per-scene state map: scene index (0-based) → that scene's per-block bypass/channel. */
export type SceneMatrix = Record<number, SceneStateBlock[]>;

/** One per-block write. `bypassed` / `channel` are omitted when that field must not be touched. */
export interface SceneWrite {
  effectId: number;
  bypassed?: boolean;
  channel?: string;
}

/** The four device operations the sequences below compose. Backed by `forgefx` in the panel. */
export interface SceneIo {
  /** Switch the active scene (0-based). */
  setScene(index: number): Promise<unknown>;
  /** Read the ACTIVE scene's per-block bypass + channel (GET /preset/scene-state). */
  sceneState(): Promise<SceneStateBlock[]>;
  setBypass(effectId: number, bypassed: boolean): Promise<unknown>;
  setChannel(effectId: number, channel: string): Promise<unknown>;
}

export interface WriteResult {
  ok: number;
  failed: number;
}

export interface SceneCard {
  /** 0-based device index. */
  index: number;
  /** 1-based number shown to the user. */
  number: number;
  label: string;
  named: boolean;
}

/**
 * One card per scene — COMPLETE, never capped (a rendered list is either complete or discloses its cap,
 * audit §5.1; the scene count is tiny so there is nothing to disclose). Unnamed scenes fall back to
 * "Scene N".
 */
export function sceneCards(count: number, names: string[]): SceneCard[] {
  const n = Math.max(0, Math.floor(count));
  return Array.from({ length: n }, (_, index) => {
    const name = (names[index] ?? '').trim();
    return { index, number: index + 1, label: name || `Scene ${index + 1}`, named: name.length > 0 };
  });
}

/**
 * The writes needed to make the target scene carry the source scene's per-block bypass/channel.
 * Only blocks present in the target are written (a block in the source that is not in the target
 * cannot be addressed), and a null/unknown source field is never written (a failed read must not blank
 * the target).
 */
export function planSceneApply(source: SceneStateBlock[], target: SceneStateBlock[]): SceneWrite[] {
  const targetById = new Map(target.map((b) => [b.effectId, b]));
  const writes: SceneWrite[] = [];
  for (const s of source) {
    const t = targetById.get(s.effectId);
    if (!t) continue;
    const w: SceneWrite = { effectId: s.effectId };
    if (s.bypassed != null && s.bypassed !== t.bypassed) w.bypassed = s.bypassed;
    if (s.channel != null && s.channel !== t.channel) w.channel = s.channel;
    if (w.bypassed !== undefined || w.channel !== undefined) writes.push(w);
  }
  return writes;
}

/** Engage-all (bypassed=false) / bypass-all (bypassed=true): write every block not already in that state. */
export function planBulkBypass(states: SceneStateBlock[], bypassed: boolean): SceneWrite[] {
  return states.filter((s) => s.bypassed !== bypassed).map((s) => ({ effectId: s.effectId, bypassed }));
}

/**
 * Execute per-block writes against the ACTIVE scene. A per-block failure (e.g. the server 501s
 * /preset/blocks/:eid/channel on a device without channel writes) is counted, never fatal — the rest of
 * the scene still applies.
 */
export async function applySceneWrites(writes: SceneWrite[], io: SceneIo): Promise<WriteResult> {
  let ok = 0;
  let failed = 0;
  for (const w of writes) {
    try {
      if (w.bypassed !== undefined) await io.setBypass(w.effectId, w.bypassed);
      if (w.channel !== undefined) await io.setChannel(w.effectId, w.channel);
      ok++;
    } catch {
      failed++;
    }
  }
  return { ok, failed };
}

/** Switch to a scene and read its per-block bypass/channel. */
export async function captureScene(index: number, io: SceneIo): Promise<SceneStateBlock[]> {
  await io.setScene(index);
  return io.sceneState();
}

/**
 * Apply a captured source state onto the target scene: switch there, read the target to diff, write the
 * differences. If the target read fails we cannot diff, so write every source block best-effort.
 */
export async function applySceneTo(target: number, source: SceneStateBlock[], io: SceneIo): Promise<WriteResult> {
  await io.setScene(target);
  let current: SceneStateBlock[] | null = null;
  try {
    current = await io.sceneState();
  } catch {
    current = null;
  }
  const writes =
    current && current.length
      ? planSceneApply(source, current)
      : source.flatMap((s) => {
          const w: SceneWrite = { effectId: s.effectId };
          if (s.bypassed != null) w.bypassed = s.bypassed;
          if (s.channel != null) w.channel = s.channel;
          return w.bypassed !== undefined || w.channel !== undefined ? [w] : [];
        });
  return applySceneWrites(writes, io);
}

/** Copy scene `from` onto scene `to` (within the preset). */
export async function copyScene(from: number, to: number, io: SceneIo): Promise<WriteResult> {
  if (from === to) return { ok: 0, failed: 0 };
  const source = await captureScene(from, io);
  return applySceneTo(to, source, io);
}

/** Swap scenes `a` and `b` (capture both, then write each captured state onto the other). */
export async function swapScenes(a: number, b: number, io: SceneIo): Promise<WriteResult> {
  if (a === b) return { ok: 0, failed: 0 };
  const aStates = await captureScene(a, io);
  const bStates = await captureScene(b, io);
  const r1 = await applySceneTo(b, aStates, io);
  const r2 = await applySceneTo(a, bStates, io);
  return { ok: r1.ok + r2.ok, failed: r1.failed + r2.failed };
}

/** Engage-all / bypass-all every block in one scene. */
export async function bulkBypass(scene: number, bypassed: boolean, io: SceneIo): Promise<WriteResult> {
  await io.setScene(scene);
  let current: SceneStateBlock[] = [];
  try {
    current = await io.sceneState();
  } catch {
    current = [];
  }
  return applySceneWrites(planBulkBypass(current, bypassed), io);
}

/**
 * Build the per-scene bypass/channel matrix by walking every scene in order. Because /preset/scene-state
 * only reports the ACTIVE scene, this necessarily switches the device through each scene — the caller
 * restores the previously-active scene afterwards. A scene whose read fails is recorded as an empty list
 * rather than dropped, so the matrix stays aligned with the scene count.
 */
export async function scanSceneMatrix(count: number, io: SceneIo): Promise<SceneMatrix> {
  const n = Math.max(0, Math.floor(count));
  const matrix: SceneMatrix = {};
  for (let i = 0; i < n; i++) {
    await io.setScene(i);
    try {
      matrix[i] = await io.sceneState();
    } catch {
      matrix[i] = [];
    }
  }
  return matrix;
}
