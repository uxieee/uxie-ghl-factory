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
// (the "draftcycle", verified live 2026-07-17).
//
// Whether to run that cycle is decided ONCE, from the workflow's status BEFORE the
// cycle starts. It must never be re-derived mid-cycle: the draft leg sets status to
// 'draft', so re-asking "is this published?" between the two legs always answers no
// and strands the workflow in draft with its triggers inactive — i.e. it DOWNGRADES a
// live workflow and silently switches it off. (Live-caught 2026-07-17; the unit test
// missed it because it only ever planned from an already-published object.)
//
// Only a PUBLISHED workflow gets the cycle. Publishing a draft is a separate,
// user-confirmed decision (the skill's draft-first rule) — a trigger edit must never do
// it as a side effect. On a draft, the new trigger activates when the user publishes.
export function shouldActivateTriggers(fresh) {
  return fresh?.status === 'published';
}

// One full-object PUT body targeting `status`, every trigger forced active:true —
// mirroring the builder's real publish (oldTriggers/newTriggers are what wire triggers
// into the live execution bucket; see orchestrate()'s publish step). Call it once per
// leg against a FRESHLY re-GET object: each PUT bumps `version`, and the next PUT must
// send the CURRENT version (version+1 422s "version is outdated").
export function triggerActivationBody(fresh, triggers, status) {
  const live = (triggers ?? []).map((t) => ({ ...t, active: true }));
  return {
    ...fresh, status, version: fresh.version, triggersChanged: false,
    oldTriggers: live, newTriggers: live,
    createdSteps: [], modifiedSteps: [], deletedSteps: [],
  };
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
  // A container's `next` is its BRANCH ARRAY, not a chain pointer. Overwriting it with
  // the new step's id silently orphans every branch and everything under them — the
  // workflow round-trips clean and loses half its graph. A container is terminal in its
  // scope: there is no "after" it to insert into, only a branch to append to.
  if (Array.isArray(anchor.next))
    throw new Error(`insertAfter: '${anchor.name ?? afterId}' is a container — it is terminal in its scope, and inserting after it would orphan its branches. Use appendToBranch with one of its branch ids instead.`);
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

// Append newStep to the tail of a BRANCH scope. `branchEntryId` is the branch-entry step
// id (nodeType branch-yes/branch-no, or a transition step for finder/split containers).
//
// Branch membership is derived by WALKING the scope's `next` chain (scopeChain), not by
// filtering on `parent === branchEntryId`. The `parent` field is not reliable enough to
// decide this: the compiler sets it on seven of its eight container types but NOT on a
// nested if_else, and edit-mode runs on harvested workflows whose shape we don't control.
// When the filter missed a node, this fell through to the "empty branch" path and
// overwrote the branch-entry's `next` — silently orphaning the real branch content
// (which, carrying no id in deletedSteps, then rode along in templates[] as dead data).
// The next-chain is the graph's actual source of truth, so walk that.
export function appendToBranch(templates, branchEntryId, newStep) {
  const step = { ...newStep, next: null };
  return appendSubgraphToBranch(templates, branchEntryId, { entry: step, templates: [step] });
}

// ---------------------------------------------------------------------------
// Container/multipath splicing (edit-add of a subgraph, not a single step)
//
// A container type (find_opportunity, if_else, workflow_split, the multipath waits…)
// compiles to a SUBGRAPH: an entry node whose `next` is an ARRAY of branch-entry ids,
// plus those branch entries (transition / branch-yes / branch-no nodes) and whatever
// the author hung under them. Splicing one in is not `insertAfter` with a fatter step:
// the container is TERMINAL in its scope, so whatever used to follow the anchor has to
// be RE-SCOPED onto one of the container's branches. Which branch is a semantic choice
// the caller must make (`attachTailTo`) — guessing it silently reroutes live traffic.
//
// Everything here re-points pointers and never copies a node: duplicating a shared tail
// is the defect that once produced ~60 dup templates and got rejected by GHL's publish
// validator with a misleading "Wait for reply doesn't reference the step" error.
// ---------------------------------------------------------------------------

// Walk the TOP-LEVEL chain of one scope from `startId`, following scalar `next`.
// Stops AT a container (array next) — a container is terminal in its scope; its
// branch children live in their own scopes and are not part of this chain.
function scopeChain(byId, startId) {
  const out = [];
  const seen = new Set();
  let cur = startId ? byId.get(startId) : null;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    if (Array.isArray(cur.next)) break;
    cur = typeof cur.next === 'string' ? byId.get(cur.next) : null;
  }
  return out;
}

// The branches a compiled container offers a tail, in `next[]` order. Names come from
// the branch-entry nodes; the stable `__branchKey__` (find_opportunity's
// 'predefined_Opportunity Found') comes from the container's transitions[] and survives
// rename/localization, so it's the durable way to name a branch.
export function branchTargets(entry, templates) {
  const ids = Array.isArray(entry.next) ? entry.next : [];
  const trs = entry.attributes?.transitions ?? [];
  const byId = new Map(templates.map((t) => [t.id, t]));
  return ids.map((id, i) => {
    const node = byId.get(id);
    const tr = trs.find((t) => t.id === id) ?? trs[i];
    return { id, name: node?.name ?? tr?.name ?? null, key: tr?.meta?.__branchKey__ ?? null, nodeType: node?.nodeType ?? null };
  });
}

// Resolve which branch a tail belongs on. Matches an explicit branch id, a
// `__branchKey__`, or a display name. NEVER guesses between multiple branches: on
// find_opportunity the tail belongs on "Opportunity Found" ~always, but "~always" is
// exactly the kind of default that silently sends contacts down Not-Found in the
// exception case. Ambiguity and absence are both errors.
export function resolveBranchTarget(entry, templates, attachTailTo, opLabel = 'insertAfter') {
  const targets = branchTargets(entry, templates);
  const list = () => targets.map((t) => `'${t.name}'`).join(', ');
  if (!targets.length) throw new Error(`${opLabel}: '${entry.type}' compiled with no branches to attach the following steps to`);
  if (attachTailTo == null) {
    if (targets.length === 1) return targets[0];
    throw new Error(
      `${opLabel}: '${entry.type}' has ${targets.length} branches and there are steps after '${entry.name ?? entry.id}' that must land on ONE of them — `
      + `pass attachTailTo (options: ${list()}). For find_opportunity that is almost always 'Opportunity Found'.`);
  }
  const hits = targets.filter((t) => t.id === attachTailTo || t.key === attachTailTo || t.name === attachTailTo);
  if (!hits.length) throw new Error(`${opLabel}: no branch '${attachTailTo}' on '${entry.type}' (options: ${list()})`);
  if (hits.length > 1) throw new Error(`${opLabel}: '${attachTailTo}' matches ${hits.length} branches on '${entry.type}' — pass an explicit branch id (${hits.map((h) => h.id).join(', ')})`);
  return hits[0];
}

// Re-scope an existing chain (`tailId` and everything after it in its old scope) onto
// the end of `branchEntryId`'s scope. Pointers only — the nodes keep their ids and are
// never cloned. Their `parent` moves to the branch scope and `order` is renumbered to
// continue the branch's existing chain, which is what flattenGraph would have emitted
// had the author built this shape fresh.
function reScopeTailOntoBranch(templates, branchEntryId, tailId, modified) {
  const byId = new Map(templates.map((t) => [t.id, t]));
  const branchEntry = byId.get(branchEntryId);
  const existing = scopeChain(byId, typeof branchEntry.next === 'string' ? branchEntry.next : null);
  const last = existing[existing.length - 1] ?? null;
  if (last && Array.isArray(last.next))
    throw new Error(
      `insertAfter: branch '${branchEntry.name ?? branchEntryId}' already ends in the container '${last.name ?? last.id}', which is terminal in its scope — `
      + `the following steps cannot chain after it. Attach them to a branch of that inner container instead.`);
  const patch = new Map();
  const anchorId = last ? last.id : branchEntryId;
  patch.set(anchorId, { next: tailId });
  modified.add(anchorId);
  let order = existing.length;
  scopeChain(byId, tailId).forEach((n, i) => {
    const p = { ...(patch.get(n.id) ?? {}), parent: branchEntryId, order: order++ };
    if (i === 0) p.parentKey = anchorId;
    patch.set(n.id, p);
    modified.add(n.id);
  });
  return templates.map((t) => (patch.has(t.id) ? { ...t, ...patch.get(t.id) } : t));
}

// Merge a compiled subgraph's nodes in after re-seating its entry into `position`.
function spliceSubgraph(templates, sub, anchorId, position) {
  const entry = { ...sub.entry, ...position };
  if (position.parent == null) delete entry.parent;
  const rest = sub.templates.filter((t) => t.id !== sub.entry.id);
  const out = [
    ...templates.map((t) => (anchorId && t.id === anchorId ? { ...t, next: entry.id } : t)),
    entry, ...rest,
  ];
  return { out, entry, created: [entry.id, ...rest.map((t) => t.id)] };
}

// Insert a CONTAINER subgraph immediately after `afterId`, re-scoping whatever followed
// the anchor onto the container's `attachTailTo` branch.
export function insertSubgraphAfter(templates, sub, afterId, attachTailTo) {
  const anchor = templates.find((t) => t.id === afterId);
  if (!anchor) return { templates, diff: emptyDiff() };
  if (Array.isArray(anchor.next))
    throw new Error(`insertAfter: '${anchor.name ?? afterId}' is a container — it is terminal in its scope. Use appendToBranch with one of its branch ids instead.`);
  const tailId = typeof anchor.next === 'string' ? anchor.next : null;
  const { out, entry, created } = spliceSubgraph(templates, sub, afterId, {
    parentKey: afterId, order: (anchor.order ?? 0) + 1, parent: anchor.parent ?? null,
  });
  const modified = new Set([afterId]);
  const templatesOut = tailId
    ? reScopeTailOntoBranch(out, resolveBranchTarget(entry, out, attachTailTo, 'insertAfter').id, tailId, modified)
    : out;
  return { templates: templatesOut, diff: { createdSteps: created, modifiedSteps: [...modified], deletedSteps: [] } };
}

// Append a CONTAINER subgraph to the end of the root chain. Nothing follows the root
// tail by definition, so there is no tail to re-scope and attachTailTo is moot.
export function appendSubgraph(templates, sub) {
  const tail = rootTail(templates);
  if (tail && Array.isArray(tail.next))
    throw new Error(`appendStep: the workflow's last step '${tail.name ?? tail.id}' is a container and is terminal in its scope. Use appendToBranch with one of its branch ids instead.`);
  const { out, created } = spliceSubgraph(templates, sub, tail?.id ?? null, {
    parentKey: tail ? tail.id : null, order: tail ? (tail.order ?? 0) + 1 : 0, parent: null,
  });
  return { templates: out, diff: { createdSteps: created, modifiedSteps: tail ? [tail.id] : [], deletedSteps: [] } };
}

// Append a CONTAINER subgraph to the tail of a branch scope. Again nothing follows a
// scope's tail, so there is no tail to re-scope.
export function appendSubgraphToBranch(templates, branchEntryId, sub) {
  const branchEntry = templates.find((t) => t.id === branchEntryId);
  if (!branchEntry) return { templates, diff: emptyDiff() };
  const byId = new Map(templates.map((t) => [t.id, t]));
  const existing = scopeChain(byId, typeof branchEntry.next === 'string' ? branchEntry.next : null);
  const last = existing[existing.length - 1] ?? null;
  if (last && Array.isArray(last.next))
    throw new Error(`appendToBranch: branch '${branchEntry.name ?? branchEntryId}' already ends in the container '${last.name ?? last.id}', which is terminal in its scope. Append to one of ITS branches instead.`);
  const anchorId = last ? last.id : branchEntryId;
  const { out, created } = spliceSubgraph(templates, sub, anchorId, {
    parent: branchEntryId, parentKey: anchorId, order: existing.length,
  });
  return { templates: out, diff: { createdSteps: created, modifiedSteps: [anchorId], deletedSteps: [] } };
}

// Move an existing step to sit immediately AFTER `afterId` (reorder). Detaches it from
// its current position (rewiring its predecessor to its old next), then splices it in
// after the anchor, inheriting the anchor's scope. Everything is a modifiedStep (no
// create/delete — the step keeps its id).
export function moveStep(templates, stepId, afterId) {
  const step = templates.find((t) => t.id === stepId);
  const anchor = templates.find((t) => t.id === afterId);
  if (!step || !anchor || stepId === afterId || anchor.next === stepId) return { templates, diff: emptyDiff() };
  // Same trap as insertAfter: a container's `next` is its BRANCH ARRAY. Moving a step
  // "after" one would overwrite that array with a scalar id and orphan every branch —
  // silently, since the orphans carry no id in deletedSteps and just ride along in
  // templates[] as dead data. A container is terminal in its scope.
  if (Array.isArray(anchor.next))
    throw new Error(`moveStep: '${anchor.name ?? afterId}' is a container — it is terminal in its scope, and moving a step after it would orphan its branches. Move the step into one of its branches instead.`);
  if (Array.isArray(step.next))
    throw new Error(`moveStep: '${step.name ?? stepId}' is a container — moving a whole container subgraph is not supported (its branch children would keep pointing into the old scope). Rebuild it at the new position instead.`);
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
