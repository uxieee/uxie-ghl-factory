// Edit-mode: modify an EXISTING workflow's steps. v1 supports linear append + delete
// at the root scope — the two most common edits — and produces the auto-save diff
// arrays (createdSteps/modifiedSteps/deletedSteps) GHL's builder expects. Pure
// functions over the templates[] array so they're unit-testable; the caller GETs the
// current workflow, applies an op, and PUTs /auto-save.
//
// GHL's incremental save only touches steps named in the diff arrays — sending the
// full templates[] with correct createdSteps/modifiedSteps/deletedSteps is what makes
// an edit apply cleanly without disturbing untouched steps.
import { IRError, REQUIRES_OPPORTUNITY, CREATES_OPPORTUNITY } from './ir.mjs';
import { expandCondition } from './compiler.mjs';

// A trigger added via the API lands `active: false` on the server NO MATTER WHAT the
// POST body said — it only starts firing after a status draft→published round trip
// (the "draftcycle", verified live 2026-07-17). This plans that cycle: two full-object
// PUTs to /workflow/{loc}/{wid}, every trigger forced active:true, mirroring the
// builder's real publish (oldTriggers/newTriggers are what wire triggers into the live
// execution bucket — see orchestrate()'s publish step).
//
// Returns null when the workflow is NOT currently published. Publishing a draft is a
// separate, user-confirmed decision (the skill's draft-first rule) — a trigger edit must
// never do it as a side effect. The new trigger activates when the user publishes.
export function triggerActivationBodies(fresh, triggers) {
  if (fresh?.status !== 'published') return null;
  const live = (triggers ?? []).map((t) => ({ ...t, active: true }));
  // Send the CURRENT version on both PUTs — the server bumps it internally; version+1
  // 422s "version is outdated". The draft PUT bumps it, so the caller must re-GET and
  // re-plan before sending [1], or the published PUT 422s on a stale version.
  const base = {
    ...fresh, version: fresh.version, triggersChanged: false,
    oldTriggers: live, newTriggers: live,
    createdSteps: [], modifiedSteps: [], deletedSteps: [],
  };
  return [{ ...base, status: 'draft' }, { ...base, status: 'published' }];
}

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

// Native GHL per-action pause. The flag lives at the template root (never in
// attributes), and the rest of the step must round-trip byte-for-byte in shape.
function setDisabledWhere(templates, matches, disabled) {
  const desired = disabled === true;
  const changed = [];
  const out = templates.map((t) => {
    if (!matches(t) || Boolean(t.advanceCanvasMeta?.isDisabled) === desired) return t;
    changed.push(t.id);
    return {
      ...t,
      advanceCanvasMeta: { ...(t.advanceCanvasMeta ?? {}), isDisabled: desired },
    };
  });
  if (!changed.length) return { templates, diff: emptyDiff() };
  return {
    templates: out,
    diff: { createdSteps: [], modifiedSteps: changed, deletedSteps: [] },
  };
}

export function setStepDisabled(templates, stepId, disabled) {
  return setDisabledWhere(templates, (t) => t.id === stepId, disabled);
}

export function disableStepsByType(templates, type, disabled) {
  return setDisabledWhere(templates, (t) => t.type === type, disabled);
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

// Move an existing step to sit immediately AFTER `afterId` (reorder). Detaches it from
// its current position (rewiring its predecessor to its old next), then splices it in
// after the anchor, inheriting the anchor's scope. Everything is a modifiedStep (no
// create/delete — the step keeps its id).
export function moveStep(templates, stepId, afterId) {
  const step = templates.find((t) => t.id === stepId);
  const anchor = templates.find((t) => t.id === afterId);
  if (!step || !anchor || stepId === afterId || anchor.next === stepId) return { templates, diff: emptyDiff() };
  const oldPred = templates.find((t) => t.next === stepId);
  const stepOldNext = typeof step.next === 'string' ? step.next : null;
  const anchorOldNext = typeof anchor.next === 'string' ? anchor.next : null;
  const modified = new Set();
  const out = templates.map((t) => {
    if (oldPred && t.id === oldPred.id) { modified.add(t.id); t = { ...t, next: stepOldNext }; }
    if (t.id === afterId) { modified.add(t.id); t = { ...t, next: stepId }; }
    if (t.id === stepId) {
      modified.add(t.id);
      t = { ...t, next: anchorOldNext, parentKey: afterId };
      if (anchor.parent != null) t.parent = anchor.parent; else delete t.parent;
    }
    return t;
  });
  return { templates: out, diff: { createdSteps: [], modifiedSteps: [...modified], deletedSteps: [] } };
}

// Add a new conditional branch to an existing if_else container. Mirrors the compiler's
// branch shape: a new branch-entry step (nodeType branch-yes), inserted into the
// container's next[] and attributes.branches[] BEFORE the else (which stays last), with
// every branch-entry's sibling[]/order kept in sync. `idGen` mints the new step id.
export function addBranch(templates, containerId, { name, conditions = [] }, idGen) {
  const container = templates.find((t) => t.id === containerId && t.nodeType === 'condition-node');
  if (!container || !Array.isArray(container.next)) return { templates, diff: emptyDiff() };
  const newId = idGen();
  const next = [...container.next];
  const branches = [...(container.attributes?.branches || [])];
  const elseIdx = next.length - 1;                 // the else/branch-no (None) is always last
  next.splice(elseIdx, 0, newId);                  // insert the conditioned branch before None
  // Mirror the compiler's runtime-correct branch shape: a segment with a generated
  // __segmentId + fully-enriched conditions (not the bare authored tuple).
  branches.splice(elseIdx, 0, {
    id: newId, name,
    segments: conditions.length ? [{ __segmentId: idGen(), operator: 'and', conditions: conditions.map((c) => expandCondition(c, { idGen })) }] : [],
    operator: 'and',
    showErrors: false, branchNameError: 'Branch name cannot be empty!',
  });
  const allIds = next;
  const newEntry = {
    id: newId, type: 'if_else', name, order: next.indexOf(newId),
    parent: containerId, parentKey: containerId, cat: 'conditions', comments: [],
    sibling: allIds.filter((x) => x !== newId), nodeType: 'branch-yes',
    // the editor needs the real non-empty branch-yes attributes, NOT `{}`
    attributes: { if: false, conditionName: 'Condition', operator: 'and', branches: [] }, next: null,
  };
  const modified = [containerId];
  const out = templates.map((t) => {
    if (t.id === containerId) return { ...t, next, attributes: { ...t.attributes, branches } };
    if (t.parent === containerId && allIds.includes(t.id)) {
      modified.push(t.id);
      return { ...t, sibling: allIds.filter((x) => x !== t.id), order: next.indexOf(t.id) };
    }
    return t;
  });
  out.push(newEntry);
  return { templates: out, diff: { createdSteps: [newId], modifiedSteps: modified, deletedSteps: [] } };
}

// Delete a whole container (if_else / workflow_split / finder) and EVERYTHING under it —
// all branch-entries, their children, and any nested containers. Rewires the container's
// predecessor to null (a container is terminal in its scope — branches don't re-merge).
// Everything removed goes in deletedSteps.
export function deleteContainer(templates, containerId) {
  const byId = new Map(templates.map((t) => [t.id, t]));
  if (!byId.has(containerId)) return { templates, diff: emptyDiff() };
  const remove = new Set([containerId]);
  const queue = [containerId];
  while (queue.length) {
    const cur = byId.get(queue.shift());
    if (!cur) continue;
    const nexts = Array.isArray(cur.next) ? cur.next : (typeof cur.next === 'string' ? [cur.next] : []);
    for (const n of nexts) if (byId.has(n) && !remove.has(n)) { remove.add(n); queue.push(n); }
    for (const t of templates) if (t.parent === cur.id && !remove.has(t.id)) { remove.add(t.id); queue.push(t.id); }
  }
  const pred = templates.find((t) => t.next === containerId);
  const out = templates.filter((t) => !remove.has(t.id)).map((t) => (pred && t.id === pred.id ? { ...t, next: null } : t));
  return { templates: out, diff: { createdSteps: [], modifiedSteps: pred ? [pred.id] : [], deletedSteps: [...remove] } };
}

// The opportunity-association invariant on the EDIT path (compile()'s
// checkOpportunityAssociation never sees edits — edit-mode mutates compiled
// templates directly). Same rule, template-graph flavor: an opportunity-requiring
// step is only legal where an opportunity is guaranteed — rootAssoc (the caller
// verified ALL the workflow's triggers are opportunity-based), a create step
// earlier on the chain, or a find_opportunity "Opportunity Found" scope. Lexical
// per scope like the IR checker: goto edges don't propagate, containers are
// terminal in their scope (branches don't re-merge).
export function checkOpportunityAssociationTemplates(templates, rootAssoc = false) {
  const byId = new Map(templates.map((t) => [t.id, t]));
  const walkChain = (startId, assoc) => {
    let cur = startId != null ? byId.get(startId) : null;
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (REQUIRES_OPPORTUNITY.has(cur.type) && !assoc)
        throw new IRError('OPP_UNASSOCIATED',
          `step '${cur.name ?? cur.id}' (${cur.id}) updates an opportunity but none is associated on its path — ` +
          `add a create step or a find_opportunity Found scope before it, or pass assumeAssociated:true ` +
          `if ALL the workflow's triggers are opportunity-based.`);
      if (CREATES_OPPORTUNITY.has(cur.type)) assoc = true;
      if (Array.isArray(cur.next)) {
        // container: recurse into each branch-entry/transition scope. Only
        // find_opportunity's "Opportunity Found" scope guarantees an opportunity.
        const trs = cur.attributes?.transitions ?? [];
        // stable pre-defined key first (survives rename/localization in harvested
        // workflows), then display name, then position (Found is always first).
        const foundId = cur.type === 'find_opportunity'
          ? (trs.find((t) => t.meta?.__branchKey__ === 'predefined_Opportunity Found')
             ?? trs.find((t) => t.name === 'Opportunity Found') ?? trs[0])?.id ?? null : null;
        for (const bid of cur.next) {
          const entry = byId.get(bid);
          if (!entry) continue;
          walkChain(typeof entry.next === 'string' ? entry.next : null, bid === foundId ? true : assoc);
        }
        return; // terminal in this scope
      }
      cur = typeof cur.next === 'string' ? byId.get(cur.next) : null;
    }
  };
  const head = templates.find((t) => (t.parentKey === null || t.parentKey === undefined) && t.parent == null);
  // Fail CLOSED: edit-mode runs on harvested workflows whose head shape isn't
  // guaranteed. If we can't find the root, we can't prove association — refuse
  // rather than silently pass an unassociated update (the exact bug class this
  // check exists to prevent).
  if (!head) {
    if (templates.some((t) => REQUIRES_OPPORTUNITY.has(t.type)))
      throw new IRError('OPP_UNASSOCIATED',
        'cannot locate the workflow head step (parentKey null, no parent) — unable to prove opportunity '
        + 'association for the update step(s) present. Fix the graph or pass assumeAssociated:true.');
    return;
  }
  walkChain(head.id, rootAssoc);
}

// Build the COMMIT body for an edit. Edits must go through the plain PUT
// /workflow/{loc}/{wid} (the commit path, same as publish) — NOT /auto-save. An
// auto-save on a freshly-built workflow 422s "previous changes were not committed"
// because the build's auto-save session is still pending. The plain PUT with the
// whole GET-back object + edited workflowData + diff arrays commits directly.
// (verified 2026-07-11). Keep the server envelope (version/filePath/etc.) intact.
export function editCommitBody(fresh, newTemplates, diff, uid, opts = {}) {
  // Enforce the opportunity invariant only when THIS edit CREATES an
  // opportunity-requiring step (append/insert) — the real bug class. Gating on
  // modifiedSteps would brick unrelated edits: appending anything after an
  // existing update step marks it modified (wiring), and a legacy workflow's
  // pre-existing violation would then block every edit near it. opts.assumeAssociated
  // skips the check (edit-path analog of the IR's assocGuaranteed). NOT covered:
  // moving an existing update out of a Found scope, or deleting the create step a
  // downstream update depends on (a diff carries only ids, not intent).
  const created = new Set(diff.createdSteps ?? []);
  if (opts.assumeAssociated !== true
      && newTemplates.some((t) => created.has(t.id) && REQUIRES_OPPORTUNITY.has(t.type)))
    checkOpportunityAssociationTemplates(newTemplates, false);
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
