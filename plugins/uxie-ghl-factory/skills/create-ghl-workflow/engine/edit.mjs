// Edit-mode: modify an EXISTING workflow's steps. v1 supports linear append + delete
// at the root scope — the two most common edits — and produces the auto-save diff
// arrays (createdSteps/modifiedSteps/deletedSteps) GHL's builder expects. Pure
// functions over the templates[] array so they're unit-testable; the caller GETs the
// current workflow, applies an op, and PUTs /auto-save.
//
// GHL's incremental save only touches steps named in the diff arrays — sending the
// full templates[] with correct createdSteps/modifiedSteps/deletedSteps is what makes
// an edit apply cleanly without disturbing untouched steps.

// Find the root-scope tail: start at the head (parentKey null) and follow scalar
// `next` pointers until one is null (or a branch container, whose next is an array).
function rootTail(templates) {
  const byId = new Map(templates.map((t) => [t.id, t]));
  let cur = templates.find((t) => t.parentKey === null || t.parentKey === undefined);
  if (!cur) return templates[templates.length - 1] ?? null;
  const seen = new Set();
  while (cur && typeof cur.next === 'string' && byId.has(cur.next) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.next);
  }
  return cur;
}

// Append newStep to the end of the root chain. Returns { templates, diff }.
export function appendStep(templates, newStep) {
  const tail = rootTail(templates);
  const step = { ...newStep, next: null, parentKey: tail ? tail.id : null, order: templates.length };
  const out = templates.map((t) => (tail && t.id === tail.id ? { ...t, next: step.id } : t));
  out.push(step);
  return { templates: out, diff: { createdSteps: [step.id], modifiedSteps: tail ? [tail.id] : [], deletedSteps: [] } };
}

// Delete a step by id, rewiring its predecessor's next to the deleted step's next.
export function deleteStep(templates, stepId) {
  const victim = templates.find((t) => t.id === stepId);
  if (!victim) return { templates, diff: { createdSteps: [], modifiedSteps: [], deletedSteps: [] } };
  const pred = templates.find((t) => t.next === stepId);
  const out = templates
    .filter((t) => t.id !== stepId)
    .map((t) => (pred && t.id === pred.id ? { ...t, next: victim.next ?? null } : t));
  return { templates: out, diff: { createdSteps: [], modifiedSteps: pred ? [pred.id] : [], deletedSteps: [stepId] } };
}

const emptyDiff = () => ({ createdSteps: [], modifiedSteps: [], deletedSteps: [] });

// Insert newStep immediately AFTER `afterId`, anywhere in the graph. The new step
// inherits afterId's scope (its `parent`), so this works mid-chain in the root trunk
// OR mid-chain inside a branch. Rewires afterId.next → newStep → (afterId's old next).
export function insertAfter(templates, newStep, afterId) {
  const anchor = templates.find((t) => t.id === afterId);
  if (!anchor) return { templates, diff: emptyDiff() };
  const step = { ...newStep, next: (typeof anchor.next === 'string' ? anchor.next : null), parentKey: anchor.id, order: 0 };
  if (anchor.parent != null) step.parent = anchor.parent; // same scope as the anchor
  const out = templates.map((t) => (t.id === afterId ? { ...t, next: step.id } : t));
  out.push(step);
  return { templates: out, diff: { createdSteps: [step.id], modifiedSteps: [anchor.id], deletedSteps: [] } };
}

// Modify an existing step's attributes in place (shallow-merge the patch). Emits the
// step in modifiedSteps so the server re-persists just that step.
export function modifyStep(templates, stepId, attrPatch) {
  const found = templates.find((t) => t.id === stepId);
  if (!found) return { templates, diff: emptyDiff() };
  const out = templates.map((t) => (t.id === stepId ? { ...t, attributes: { ...t.attributes, ...attrPatch } } : t));
  return { templates: out, diff: { createdSteps: [], modifiedSteps: [stepId], deletedSteps: [] } };
}

// Append newStep to the tail of a BRANCH scope (the steps whose parent === branchEntryId).
// Handles an empty branch (wire the branch-entry's next) and a non-empty branch (find its
// tail and chain on). `branchEntryId` is the branch-entry step id (nodeType branch-yes/no,
// or a transition step for finder/split containers).
export function appendToBranch(templates, branchEntryId, newStep) {
  const entry = templates.find((t) => t.id === branchEntryId);
  if (!entry) return { templates, diff: emptyDiff() };
  const byId = new Map(templates.map((t) => [t.id, t]));
  const members = templates.filter((t) => t.parent === branchEntryId);
  const step = { ...newStep, parent: branchEntryId, next: null, order: members.length };
  if (members.length === 0) {
    step.parentKey = branchEntryId;
    const out = templates.map((t) => (t.id === branchEntryId ? { ...t, next: step.id } : t));
    out.push(step);
    return { templates: out, diff: { createdSteps: [step.id], modifiedSteps: [branchEntryId], deletedSteps: [] } };
  }
  const pointed = new Set(members.map((m) => m.next).filter((x) => typeof x === 'string'));
  let cur = members.find((m) => !pointed.has(m.id)) ?? members[0];
  const seen = new Set();
  while (cur && typeof cur.next === 'string' && byId.get(cur.next)?.parent === branchEntryId && !seen.has(cur.id)) {
    seen.add(cur.id); cur = byId.get(cur.next);
  }
  step.parentKey = cur.id;
  const out = templates.map((t) => (t.id === cur.id ? { ...t, next: step.id } : t));
  out.push(step);
  return { templates: out, diff: { createdSteps: [step.id], modifiedSteps: [cur.id], deletedSteps: [] } };
}

// Build the COMMIT body for an edit. Edits must go through the plain PUT
// /workflow/{loc}/{wid} (the commit path, same as publish) — NOT /auto-save. An
// auto-save on a freshly-built workflow 422s "previous changes were not committed"
// because the build's auto-save session is still pending. The plain PUT with the
// whole GET-back object + edited workflowData + diff arrays commits directly.
// (verified 2026-07-11). Keep the server envelope (version/filePath/etc.) intact.
export function editCommitBody(fresh, newTemplates, diff, uid) {
  return {
    ...fresh,
    updatedBy: uid,
    status: fresh.status ?? 'draft',
    version: fresh.version,
    triggersChanged: false,
    workflowData: { templates: newTemplates },
    createdSteps: diff.createdSteps, modifiedSteps: diff.modifiedSteps, deletedSteps: diff.deletedSteps,
  };
}
