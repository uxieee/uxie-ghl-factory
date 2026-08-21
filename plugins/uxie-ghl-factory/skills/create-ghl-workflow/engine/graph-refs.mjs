// Intra-workflow STEP-reference integrity — the third check class, after field enforcement
// (enforce.mjs) and account-asset references (asset-preflight.mjs).
//
// WHY (Xander's screenshot, 2026-08-21): a real workflow showed two Go To steps with broken-link
// icons under a panel reading "0 Errors — You are all good to go". GHL grades a dangling
// `goto.targetNodeId` as a WARNING (`!targetExists`, gotoValidator), so its error panel stays
// green while the runtime has nowhere to send the contact. The builder's panel is a NECESSARY
// oracle, never a SUFFICIENT one.
//
// Corpus: 0 dangling step-refs across all 187 published workflows (33 gotos, 7 reply-waits) —
// a hard check rejects nothing real. And the engine could produce the broken shape itself:
// the goto emit resolved an unknown ref to `undefined` without a throw, and deleteStep rewired
// only next/parentKey, leaving any step that REFERENCED the victim pointing at a ghost.
//
// The registry below lists every attribute that holds STEP IDS of the same workflow. Grounded in
// GHL's own validators (gotoValidator `!targetExists`; workflow_goal `invalidSteps`/`stepIdx`)
// and the wait model (reply/emailEventSteps are step-id arrays; appointmentSpecificStep is the
// 'specific-step' target). `next`/`parentKey`/branch wiring are NOT here — they have their own
// invariants (danglingParentKeys, container ops).

/** attribute paths that hold same-workflow step ids: [type, path, 'single'|'array'].
 *  `[]` in a path expands over an array level — workflow_goal refs live at
 *  segments[].conditions[].extras.stepIds (goal-action-validator.ts walks segments→conditions and
 *  reads condition.extras), NOT at a flat attributes.stepIds. The first cut of this registry used
 *  the flat path, which exists on NO real goal step (corpus-verified 2026-08-22) — the goal checks
 *  were scanning a path that never exists, so "0 dangling" was vacuously true for goals. */
export const STEP_REF_FIELDS = [
  ['goto', 'targetNodeId', 'single'],
  ['wait', 'appointmentSpecificStep', 'single'],
  ['wait', 'reply', 'array'],
  ['wait', 'emailEventSteps', 'array'],
  ['workflow_goal', 'segments[].conditions[].extras.stepIds', 'array'],
  ['workflow_goal', 'segments[].conditions[].extras.invoiceStepId', 'single'],
];

const get = (o, p) => p.split('.').reduce((a, k) => a == null ? undefined : a[k], o);
/** resolve a path with `[]` array expansions to EVERY value it reaches */
const getAll = (o, path) => {
  let cur = [o];
  for (const seg of path.split('.')) {
    if (seg.endsWith('[]')) {
      const k = seg.slice(0, -2);
      cur = cur.flatMap((x) => { const v = x == null ? undefined : x[k]; return Array.isArray(v) ? v : []; });
    } else {
      cur = cur.map((x) => x == null ? undefined : x[seg]);
    }
  }
  return cur.filter((v) => v != null);
};

/** Every reference held by `t` (typed step template), as [{path, id}]. Empty values are not refs. */
export function stepRefsOf(t) {
  const out = [];
  for (const [type, path, kind] of STEP_REF_FIELDS) {
    if (t.type !== type) continue;
    const vals = path.includes('[]') ? getAll(t.attributes ?? {}, path) : [get(t.attributes ?? {}, path)];
    for (const v of vals) {
      if (v == null || v === '') continue;
      for (const id of (kind === 'array' ? (Array.isArray(v) ? v : []) : [v])) {
        if (typeof id === 'string' && id) out.push({ path, id });
      }
    }
  }
  return out;
}

/** All dangling references in a template set: [{id, name, type, path, missing}]. Pure. */
export function danglingStepRefs(templates) {
  const ids = new Set((templates ?? []).map((t) => t.id));
  const out = [];
  for (const t of templates ?? []) {
    for (const { path, id } of stepRefsOf(t)) {
      if (!ids.has(id)) out.push({ id: t.id, name: t.name, type: t.type, path, missing: id });
    }
  }
  return out;
}

/**
 * Compile-chokepoint sweep: refuse a build whose emitted templates hold a step reference that
 * resolves to nothing. Runs beside enforceTemplates() so no construction path can bypass it.
 * `errCtor` lets the compiler pass its IRError class without a circular import.
 */
export function checkStepRefs(templates, errCtor = null) {
  const bad = danglingStepRefs(templates);
  if (!bad.length) return;
  const lines = bad.map((b) => `  - '${b.name ?? b.id}' (${b.type}) ${b.path} → '${b.missing}' does not exist in this workflow`);
  const msg = `REF_DANGLING: ${bad.length} step reference(s) point at steps that do not exist:\n${lines.join('\n')}\n` +
    `GHL grades this a WARNING — the builder's panel shows "0 Errors" while the step renders a broken link ` +
    `and the runtime has nowhere to go. Fix the reference or remove the step.`;
  // errCtor is the compiler's two-arg IRError(code, message); plain Error takes only (message) —
  // `new Error('REF_DANGLING', msg)` silently DISCARDS the details, which is how this module's
  // own first test shipped asserting a message that could never exist.
  throw errCtor ? new errCtor('REF_DANGLING', msg) : Object.assign(new Error(msg), { code: 'REF_DANGLING' });
}
