// Pure driver for edit-mode: turn a list of edit ops into { templates, diff } over an
// existing workflow's templates[]. No I/O — scripts/edit.mjs does the GET/PUT and passes
// the fresh templates in. Keeping this pure makes the op sequencing + diff-merge testable.
import {
  appendStep, deleteStep, insertAfter, modifyStep, appendToBranch, moveStep,
  addBranch, deleteContainer, setStepDisabled, disableStepsByType,
} from './edit.mjs';
import { compile, buildTrigger } from './compiler.mjs';

// Triggers live in a SEPARATE document from workflowData.templates, with their own CRUD
// endpoints — so a trigger op can't be a templates→templates function like the step ops.
// These ops are partitioned out and planned into request intents instead.
export const TRIGGER_OPS = new Set(['addTrigger', 'deleteTrigger', 'modifyTrigger']);

export function partitionOps(ops) {
  const stepOps = [], triggerOps = [];
  for (const op of ops ?? []) (TRIGGER_OPS.has(op.op) ? triggerOps : stepOps).push(op);
  return { stepOps, triggerOps };
}

// Resolve which existing trigger an op targets: an explicit triggerId, or a {name}/{type}
// matcher against the live trigger list. Ambiguity is an ERROR, never a silent pick —
// deleting or rewriting the wrong trigger on a live workflow is unrecoverable from here.
export function resolveTrigger(op, existing) {
  const list = existing ?? [];
  const idOf = (t) => t.id ?? t._id;
  if (op.triggerId) {
    const hit = list.find((t) => idOf(t) === op.triggerId);
    if (!hit) throw new Error(`${op.op}: no trigger ${op.triggerId} on this workflow (have: ${list.map(idOf).join(', ') || 'none'})`);
    return hit;
  }
  if (!op.name && !op.type) throw new Error(`${op.op} needs a triggerId, or a name/type to match on`);
  const hits = list.filter((t) => (op.name == null || t.name === op.name) && (op.type == null || t.type === op.type));
  const what = [op.name && `name '${op.name}'`, op.type && `type '${op.type}'`].filter(Boolean).join(' + ');
  if (!hits.length) throw new Error(`${op.op}: no trigger matching ${what} (have: ${list.map((t) => `${t.name}/${t.type}`).join(', ') || 'none'})`);
  if (hits.length > 1) throw new Error(`${op.op}: ${hits.length} triggers match ${what} — pass an explicit triggerId (${hits.map(idOf).join(', ')})`);
  return hits[0];
}

// Turn trigger ops into ordered { method, path, body } intents. Pure — scripts/edit.mjs
// does the I/O. `existing` is the live GET /workflow/{loc}/trigger?workflowId= list, used
// to resolve name/type matchers and to merge on modify.
export function planTriggerOps(triggerOps, { ctx, wid, uid, existing = [] }) {
  const loc = ctx.loc;
  return (triggerOps ?? []).map((op) => {
    switch (op.op) {
      case 'addTrigger':
        // buildTrigger is the SAME corpus-traced shape the create path posts: the full
        // envelope (schedule_config/masterType/actions/company_age/…) plus expandFilter's
        // condition expansion — including the scalar unwrap that keeps a contact_tag value
        // a plain string. A lean hand-rolled body saves but never attaches.
        return { op: op.op, method: 'POST', path: `/workflow/${loc}/trigger`, body: buildTrigger(op.trigger, ctx, wid) };
      case 'deleteTrigger': {
        const t = resolveTrigger(op, existing);
        // userId is a REQUIRED query param on the delete (docs/03-endpoints.md §3.5).
        return { op: op.op, method: 'DELETE', path: `/workflow/${loc}/trigger/${t.id ?? t._id}?userId=${uid}`, triggerId: t.id ?? t._id };
      }
      case 'modifyTrigger': {
        const t = resolveTrigger(op, existing);
        const tid = t.id ?? t._id;
        // The update PUT wants the FULL trigger object with edits, not a patch. Rebuild
        // through buildTrigger so an edited filter gets the same expansion a fresh create
        // gets, then re-seat the server's identity/envelope fields over the top.
        const merged = buildTrigger(
          { type: op.trigger?.type ?? t.type, name: op.trigger?.name ?? t.name,
            masterType: op.trigger?.masterType ?? t.masterType,
            filters: op.trigger?.filters ?? t.conditions ?? [],
            active: op.trigger?.active ?? true,
            ...(op.trigger?.convTriggerBotId ? { convTriggerBotId: op.trigger.convTriggerBotId } : {}) },
          ctx, wid,
        );
        return { op: op.op, method: 'PUT', path: `/workflow/${loc}/trigger/${tid}`, triggerId: tid,
          body: { ...t, ...merged, id: tid, _id: t._id ?? tid } };
      }
      default: throw new Error(`unknown trigger op: ${JSON.stringify(op.op)}`);
    }
  });
}

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
    case 'setStepDisabled': return setStepDisabled(templates, op.stepId, op.disabled);
    case 'disableStepsByType': return disableStepsByType(templates, op.type, op.disabled);
    case 'moveStep': return moveStep(templates, op.stepId, op.afterId);
    case 'addBranch': return addBranch(templates, op.containerId, { name: op.name, conditions: op.conditions ?? [] }, idGen);
    case 'deleteContainer': return deleteContainer(templates, op.containerId);
    default:
      if (TRIGGER_OPS.has(op.op))
        throw new Error(`'${op.op}' is a TRIGGER op — it edits a separate document, not workflowData.templates. Route it through partitionOps()/planTriggerOps().`);
      throw new Error(`unknown edit op: ${JSON.stringify(op.op)}`);
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
