// A GOTO THAT CLOSES A CYCLE IS NOT A LEGAL FLOW SHAPE.
//
// GHL's backend runs its own loop detection and stamps `loopIdentified`. Two different keys,
// both backend-written, neither ours to set (corpus: ACTION-DRAWERS-2.md:1654,1675, from
// recovered source):
//   - attributes.loopIdentified on the goto STEP — read-only, renders the node "loop locked"
//     (useNodeContainerClasses.ts:43-46, ActionNode.vue:295);
//   - loopIdentified on the WORKFLOW — an ISO date string that forces status -> 'draft'
//     (states/workflow.ts:1614-1618) and pops "This Workflow has been locked in Draft status
//     because it is causing a loop." (hooks/use-get-workflow-data.ts:106-116).
// So the cost of authoring one is not a warning — it is the workflow being demoted to draft by
// the platform after the fact, which for a published client flow means it silently stops.
//
// The `loop` STEP TYPE is a different thing and stays legal: it is a first-class gated step with
// its own body and its own validators (graph-rules.mjs). This module is only about goto edges.

/** Every goto whose target can reach the goto again — i.e. the goto closes a cycle.
 *  A goto naming a step that does not exist is NOT reported: REF_DANGLING already owns that
 *  case in the compiler, and reporting it twice would bury the more actionable message. */
export function gotoLoops(templates) {
  if (!Array.isArray(templates)) return [];
  const byId = new Map(templates.filter((t) => t && t.id).map((t) => [t.id, t]));
  const successors = (step) => {
    // A goto's forward edge is its JUMP, not `next` — it is emitted with no `next` key at all.
    // Without this, a walk passing through a second goto stops dead and a mutual two-goto cycle
    // (A→B→g2→C, C→g1→A) goes unreported, which is exactly the shape GHL locks.
    if (step?.type === 'goto') {
      const t = step.attributes?.targetNodeId;
      return typeof t === 'string' ? [t] : [];
    }
    const n = step?.next;
    if (Array.isArray(n)) return n.filter((x) => typeof x === 'string');
    return typeof n === 'string' ? [n] : [];
  };
  const out = [];
  for (const g of templates) {
    if (g?.type !== 'goto') continue;
    const target = g.attributes?.targetNodeId;
    if (!target || !byId.has(target)) continue;
    // Walk forward from the target via `successors()` — which follows a plain step's `next`
    // AND a goto step's jump edge (its targetNodeId), not `next` alone. Reaching the original
    // goto again means its own jump closes the cycle. Self-reference is the degenerate case
    // and is caught first.
    //
    // KNOWN FALSE NEGATIVE (edit path): a *stored* legacy goto can carry both a targetNodeId
    // AND a stale `next` key left over from before it was retyped to goto. successors() reads
    // only targetNodeId for a goto step, so that stale `next` chain is never walked — a cycle
    // reachable solely through it would go unreported. Accepted: the compiler never emits a
    // goto with `next` (terminals.mjs strips terminal `next`, and a goto is never a terminal
    // author-side), so this can only arise from harvested legacy data, and the edit-path guard
    // is already scoped to touched steps for the same "don't brick a legacy workflow" reason.
    const seen = new Set();
    const stack = [target];
    let loops = false;
    while (stack.length) {
      const id = stack.pop();
      if (id === g.id) { loops = true; break; }
      if (seen.has(id)) continue;
      seen.add(id);
      for (const s of successors(byId.get(id))) stack.push(s);
    }
    if (loops) {
      out.push({
        id: g.id,
        name: g.name ?? null,
        target,
        targetName: byId.get(target)?.name ?? null,
      });
    }
  }
  return out;
}
