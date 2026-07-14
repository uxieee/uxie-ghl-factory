// Pure driver for edit-mode: turn a list of edit ops into { templates, diff } over an
// existing workflow's templates[]. No I/O — scripts/edit.mjs does the GET/PUT and passes
// the fresh templates in. Keeping this pure makes the op sequencing + diff-merge testable.
import { appendStep, deleteStep, insertAfter, modifyStep, appendToBranch, moveStep, addBranch, deleteContainer } from './edit.mjs';
import { compile } from './compiler.mjs';

// Compile a single LINEAR step from an IR action node so its attributes/situational
// fields match the catalog (v1 supports linear types only — a container/multipath type
// compiles to >1 template and is rejected). assocGuaranteed keeps the throwaway standalone
// compile from tripping the opportunity-association check; the REAL check runs in
// editCommitBody against the whole workflow graph.
export function compileStep(node, ctx) {
  const out = compile(
    { name: '_edit', triggers: [], graph: [{ ...node, ref: '_edit_step', kind: node.kind ?? 'action', assocGuaranteed: true }] },
    ctx,
  );
  const tpls = out.autoSaveBody.workflowData.templates;
  if (tpls.length !== 1)
    throw new Error(`edit-add supports a single LINEAR step; '${node.type}' compiled to ${tpls.length} templates (containers/multipath are not supported in edit-add yet)`);
  const step = tpls[0];
  // the edit op re-wires graph position; drop the standalone values
  delete step.order; delete step.next; delete step.parentKey; delete step.parent;
  return step;
}

const empty = () => ({ createdSteps: [], modifiedSteps: [], deletedSteps: [] });

export function mergeDiff(a, b) {
  return {
    createdSteps: [...new Set([...a.createdSteps, ...b.createdSteps])],
    modifiedSteps: [...new Set([...a.modifiedSteps, ...b.modifiedSteps])],
    deletedSteps: [...new Set([...a.deletedSteps, ...b.deletedSteps])],
  };
}

// Reconcile a merged diff: a step created then deleted in the same session is a net
// no-op; a step both created and modified stays created; deleted wins over modified.
export function normalizeDiff(d) {
  const created = new Set(d.createdSteps);
  const deleted = new Set(d.deletedSteps);
  const netted = new Set(); // created AND deleted this session → never existed
  for (const id of [...created]) if (deleted.has(id)) { created.delete(id); deleted.delete(id); netted.add(id); }
  const modified = d.modifiedSteps.filter((id) => !created.has(id) && !deleted.has(id) && !netted.has(id));
  return { createdSteps: [...created], modifiedSteps: [...new Set(modified)], deletedSteps: [...deleted] };
}

// Apply one op to templates. ctx (catalog + idGen) is needed to compile new steps;
// idGen mints new branch/step ids for addBranch.
export function applyOp(templates, op, { ctx, idGen }) {
  switch (op.op) {
    case 'appendStep': return appendStep(templates, compileStep(op.step, ctx));
    case 'insertAfter': return insertAfter(templates, compileStep(op.step, ctx), op.afterId);
    case 'appendToBranch': return appendToBranch(templates, op.branchEntryId, compileStep(op.step, ctx));
    case 'deleteStep': return deleteStep(templates, op.stepId);
    case 'modifyStep': return modifyStep(templates, op.stepId, op.attrPatch ?? {});
    case 'moveStep': return moveStep(templates, op.stepId, op.afterId);
    case 'addBranch': return addBranch(templates, op.containerId, { name: op.name, conditions: op.conditions ?? [] }, idGen);
    case 'deleteContainer': return deleteContainer(templates, op.containerId);
    default: throw new Error(`unknown edit op: ${JSON.stringify(op.op)}`);
  }
}

// Apply an ordered list of ops, threading templates and merging diffs.
export function applyOps(templates, ops, { ctx, idGen }) {
  let tpls = templates;
  let diff = empty();
  for (const op of ops ?? []) {
    const r = applyOp(tpls, op, { ctx, idGen });
    tpls = r.templates;
    diff = mergeDiff(diff, r.diff);
  }
  return { templates: tpls, diff: normalizeDiff(diff) };
}
