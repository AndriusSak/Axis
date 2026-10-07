// Grid/routing op undo fidelity — a structural op must not be recorded as an undoable step when one
// of its device writes was REFUSED.
//
// The grid/routing ops (`place`, `removeAt`, `move`, `connect`, `replaceShunt`, `disconnect`,
// `#runPlan`) execute a sequence of discrete device writes (`forgefx.placeCell` / `clearCell` /
// `cable`), each of which returns `Promise<{ ok: boolean }>`. ForgeFX answers a device refusal with
// HTTP 200 `{ok:false}` — `req()` in `forgefx.ts` only throws on a non-2xx status — so a refusal
// RESOLVES, it does not throw. The old wiring `for (const op of plan.ops) await this.#runOp(op)`
// then `history.recordComposite(...)` discarded every resolved value: it recorded an undoable step
// for an operation whose writes never landed. `load()` reconciles the DISPLAY from the device
// afterwards, so the visual state self-corrects — but the history entry stayed, so undo then
// "restored" a state the device never left.
//
// `decideGridOpOutcome` is the pure decision over the op's settled write results: record the single
// composite/undoable step ONLY when EVERY write of the op landed (`settleWriteSet`'s `allLanded`),
// and otherwise surface the honest refusal/partial toast. It deliberately reuses the project's
// write-outcome module (`paramWriteOutcome.ts`) rather than minting a second toast vocabulary. Pure:
// no device, no store — provable with no hardware and no Svelte compiler in the node-env vitest
// harness (the editor is a runes module that throws on import there; the wiring is pinned by
// `gridOpOutcomeWiring.sourceguard.test.ts`, the established pattern).

import { settleWriteSet, type WriteSettlement } from './paramWriteOutcome';

export interface GridOpOutcome {
  /** Record the op's undo entry (single op or one composite step)? ONLY when every write landed. */
  recordHistory: boolean;
  /** Honest toast to show — the refusal (nothing landed) or partial wording — or null when every
   *  write landed (the caller shows its own success line in that case). */
  toast: { text: string; accent: string } | null;
}

/**
 * Decide what a grid/routing op must do after its device writes settle. Every write landed → record
 * the op and say nothing (the caller owns the success toast). Any refusal or transport error → the
 * op did not land as a whole, so DO NOT record an undoable step (undo must never restore a state the
 * device never reached) and surface what actually happened via the shared write-set wording.
 */
export function decideGridOpOutcome(results: WriteSettlement[], label: string): GridOpOutcome {
  const report = settleWriteSet(results, { subject: label, successToast: false });
  return { recordHistory: report.allLanded, toast: report.toast };
}
