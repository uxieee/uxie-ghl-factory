// Rules that need the WHOLE template list, not one node's attributes.
//
// The coupled-field layer in required-fields.mjs sees a single node's attributes and nothing
// else, which is right for most of GHL's validators. These two cannot live there: one needs the
// node's PARENT, the other needs every other step of the same type. Both are result:'warning' in
// GHL, so both warn here.
//
// They run after compile, on the emitted templates, so they see exactly what will be sent.

/** GHL: gotoValidator, internal-action-validators.ts:69-75. `parentNode?.next` truthy → warning. */
function gotoPlacement(templates) {
  const out = [];
  const byId = new Map(templates.map((t) => [t.id, t]));

  for (const t of templates) {
    if (t.type !== 'goto') continue;
    // A goto ends a branch. GHL asks whether the node ABOVE it still points onward — if it does,
    // there is a step after the goto that can never run, because the goto has already jumped.
    // `next` is a scalar on a linear step and an array on a branch container; only the scalar
    // case can strand a sibling.
    const parent = [...byId.values()].find((p) => p.next === t.id);
    if (!parent) continue;
    if (typeof t.next === 'string' && t.next) {
      out.push(`goto '${t.name ?? t.id}' has a step after it. A goto jumps away, so anything `
        + `below it in the same branch is unreachable — move it to the end of the branch.`);
    }
  }
  return out;
}

/**
 * GHL: mathOperationValidator + getMathOperationSourceTypeFromTemplates,
 * additional-action-validators.ts:320-345 and :362-382.
 *
 * A math step can take its input from an earlier math step's result via the merge tag
 * `{{math_operation.N.result}}`. Two things go wrong and neither is visible on the node itself:
 *
 *   the upstream step was DELETED       → the reference resolves to nothing at runtime
 *   the upstream step's TYPE changed    → e.g. the first op was switched to `date` while this
 *                                         one still declares `numerical`
 *
 * GHL resolves N by `stepIndex` when present and falls back to the N-th math step in template
 * order — reproduced exactly, because the two disagree in the tree view where stepIndex is unset.
 */
function mathUpstreamRefs(templates) {
  const out = [];
  const mathOps = templates.filter((t) => t.type === 'math_operation' && t.attributes);

  const sourceTypeFor = (selectField) => {
    const m = String(selectField ?? '').match(/\{\{math_operation\.(\d+)\.result\}\}/);
    if (!m || !mathOps.length) return null;
    const n = parseInt(m[1], 10);
    const byStepIndex = mathOps.find((t) => (t.stepIndex ?? 0) === n);
    if (byStepIndex?.attributes) return byStepIndex.attributes.selectFieldtype || 'numerical';
    const byOrder = mathOps[n];
    if (!byOrder?.attributes) return null;
    return byOrder.attributes.selectFieldtype || 'numerical';
  };

  for (const t of mathOps) {
    const selectField = t.attributes?.selectField;
    const isRef = /\{\{math_operation\.\d+\.result\}\}/.test(String(selectField ?? ''));
    const sourceType = sourceTypeFor(selectField);
    const ref = t.name ?? t.id;

    if (isRef && !sourceType) {
      out.push(`math_operation '${ref}' reads {{math_operation.N.result}} from a step that does `
        + `not exist — the upstream math step was deleted, so this computes from nothing.`);
      continue;
    }
    if (sourceType && t.attributes?.selectFieldtype !== sourceType) {
      out.push(`math_operation '${ref}' declares selectFieldtype `
        + `'${t.attributes?.selectFieldtype}' but its upstream math step now produces `
        + `'${sourceType}' — the types drifted apart.`);
    }
  }
  return out;
}

/**
 * Run every graph-context rule and hand each finding to `warn`. Never throws: both mirrored rules
 * are result:'warning' in GHL, and promoting one would refuse a document the builder opens.
 * Returns the findings so a caller can assert on them.
 */
export function checkGraphContextRules(templates, { warn, skipGraphContextRules } = {}) {
  if (skipGraphContextRules === true) return [];
  const list = Array.isArray(templates) ? templates : [];
  const findings = [...gotoPlacement(list), ...mathUpstreamRefs(list)];
  for (const f of findings) warn?.(`GRAPH_CONTEXT: ${f}`);
  return findings;
}
