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
import { normalizeSettings, KNOWN_SETTINGS_KEYS } from './settings.mjs';
import { stripNullNext, fillInputTriggerParams } from './terminals.mjs';
import { stepNoteRecord } from './step-notes.mjs';
import { expandCondition } from './compiler.mjs';
import { stepRefsOf, danglingStepRefs } from './graph-refs.mjs';
import { enforceTemplates } from './enforce.mjs';
import { gotoLoops } from './goto-loops.mjs';

// A trigger added via the API lands `active: false` on the server NO MATTER WHAT the
// POST body said.
//
// Two write rails were tried here and retired, in order — kept as history so neither gets
// re-proposed:
//   1. RETIRED 2026-08-27 (Task 9, workflow save-correctness): this module used to export
//      shouldActivateTriggers()/triggerActivationBody(), which drove a status
//      draft→published double full-document PUT — every trigger forced active:true onto
//      that PUT's oldTriggers/newTriggers roster ("mirroring the builder's real publish",
//      or so it was believed). Live-proven INERT: the PUT is accepted, `version` bumps, and
//      the stored trigger's `active` flag never moves — the same shape as the reported
//      "every generic write path for workflow trigger conditions returns 200 and changes
//      nothing" defect.
//   2. RETIRED 2026-08-28: what replaced it was a per-trigger PUT
//      /workflow/{loc}/trigger/{triggerId} carrying the WHOLE trigger record with
//      active:true (planTriggerActivation(), formerly in edit-driver.mjs). That rail is
//      genuinely live-proven for trigger CONTENT — conditions, name, targetActionId all
//      land and persist — so it stayed in use for modifyTrigger. For `active` specifically
//      it was retracted to "unproven" the same day it shipped (a probe read it back
//      unchanged), and then fully DISPROVED on 2026-08-28 by three measurements
//      (throwaway probes on the designated test sub-account): a publish with ZERO trigger
//      writes still activates every trigger, sub-second after the publish PUT returns; a
//      per-trigger PUT with active:false against a published workflow returns 200 and the
//      trigger stays active:true; and the sub-second publish-to-active convergence is what
//      actually explained the earlier "read back unchanged" result, not an unsettled value.
//      `active` is a SERVER-MANAGED PROJECTION of the workflow's publish state — this
//      endpoint accepts the field and silently ignores it, in both directions. The write
//      was a 200 that changed nothing: exactly the defect class Task 9 existed to
//      eliminate. It was removed rather than kept "best effort".
//
// Nothing replaced it. There is no known write that activates a trigger against an
// ALREADY-published workflow — publishing (or re-publishing) is the only known way `active`
// moves, because it is a side effect of the publish transition itself. Whether to even
// check is still decided from the workflow's status (only a PUBLISHED workflow gets a
// post-edit activation check — publishing a draft is a separate, user-confirmed decision,
// never a side effect of a trigger edit); when it does run, it can only read the truth back
// and report it loudly (scripts/edit.mjs's exitCode:2), never claim to fix it.

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
//
// `parentKey` matters here. GHL's RUNTIME walks `next` (proven live 2026-07-17f: a chase
// was driven straight through four dangling-parentKey steps and every one executed), so a
// stale parentKey does not corrupt execution — but it IS builder hygiene the validator may
// stop tolerating, and a parentKey pointing at a deleted id makes the graph unreadable.
// Rewiring only `next` (the old behavior) left the victim's successor pointing its
// parentKey at the now-gone victim — the origin of the "residue" dangling parentKeys seen
// in client workflows. Re-point that orphan at the victim's own inbound source (pred), or
// null if the victim was the head, and mark it modified so GHL re-persists the change.

// An op naming a step that does not exist is a CALLER BUG, and returning an empty diff makes it
// indistinguishable from success: the tool reports ok, stepCount unchanged, createdSteps []. That
// no-op has been mistaken for a completed edit more than once (findings item 12, re-confirmed as
// D27 on 2026-08-27 with a truncated id). Fail closed, and name the id so the typo is visible.
// addStepNote and duplicateStep already did this; these five did not.
function requireStep(templates, stepId, op) {
  const found = templates.find((t) => t.id === stepId);
  if (!found) throw new Error(`${op}: no step with id '${stepId}'`);
  return found;
}

export function deleteStep(templates, stepId) {
  const victim = requireStep(templates, stepId, 'deleteStep');
  // Refuse to orphan a REFERENCE. Deleting only rewires next/parentKey; a goto/wait/goal that
  // POINTS at the victim would keep its id and become the broken-link node GHL's panel calls
  // "0 Errors" (gotoValidator grades !targetExists warning-level). The holder must be repointed
  // or deleted first — guessing intent here is how silent no-ops are made.
  const holders = templates.filter((t) => t.id !== stepId && stepRefsOf(t).some((r) => r.id === stepId));
  if (holders.length)
    throw new Error(`deleteStep: '${victim.name ?? stepId}' is still referenced by ` +
      holders.map((h) => `'${h.name ?? h.id}' (${h.type})`).join(', ') +
      ` — repoint or delete the referencing step(s) first (GHL would render a broken link and report 0 errors).`);
  const pred = templates.find((t) => t.next === stepId);
  const newParent = pred ? pred.id : null;
  const modified = new Set(pred ? [pred.id] : []);
  const out = templates
    .filter((t) => t.id !== stepId)
    .map((t) => {
      let n = t;
      if (pred && n.id === pred.id) n = { ...n, next: victim.next ?? null };
      if (n.parentKey === stepId) { n = { ...n, parentKey: newParent }; modified.add(n.id); }
      return n;
    });
  return { templates: out, diff: { createdSteps: [], modifiedSteps: [...modified], deletedSteps: [stepId] } };
}

// Scan for DANGLING parentKeys: a step whose parentKey references an id that isn't in the
// graph (usually a step deleted by an op that only rewired `next`). Returns [{id, name,
// parentKey}]. A parentKey that points at a real-but-not-inbound step is stale-not-dangling
// and is NOT reported here — only broken references, the class the round-trip verifier
// should fail on the way it fails on duplicate ids.
export function danglingParentKeys(templates) {
  const ids = new Set(templates.map((t) => t.id));
  return templates
    .filter((t) => t.parentKey != null && !ids.has(t.parentKey))
    .map((t) => ({ id: t.id, name: t.name ?? null, parentKey: t.parentKey }));
}

// Repair dangling parentKeys in place: re-point each orphan at its true inbound `next`
// source. This is the graph-truth repair the reference fix-parentkeys.mjs did by hand.
// An orphan with exactly one inbound edge is repaired to that source; zero inbound (it is
// now the head) becomes null; >1 inbound is AMBIGUOUS and left untouched (reported in the
// returned `ambiguous` list) — guessing a parent for a step two edges point at would be an
// invention, and the graph still runs via `next` regardless.
export function repairParentKeys(templates) {
  const ids = new Set(templates.map((t) => t.id));
  const inbound = new Map();
  for (const t of templates) {
    const nexts = Array.isArray(t.next) ? t.next : (typeof t.next === 'string' ? [t.next] : []);
    for (const n of nexts) { if (!inbound.has(n)) inbound.set(n, []); inbound.get(n).push(t.id); }
  }
  const modified = [];
  const ambiguous = [];
  const out = templates.map((t) => {
    if (t.parentKey == null || ids.has(t.parentKey)) return t;
    const ins = inbound.get(t.id) ?? [];
    if (ins.length > 1) { ambiguous.push({ id: t.id, name: t.name ?? null, inbound: ins }); return t; }
    modified.push(t.id);
    return { ...t, parentKey: ins.length === 1 ? ins[0] : null };
  });
  return { templates: out, diff: { createdSteps: [], modifiedSteps: modified, deletedSteps: [] }, ambiguous };
}

const emptyDiff = () => ({ createdSteps: [], modifiedSteps: [], deletedSteps: [] });

// Insert newStep immediately AFTER `afterId`, anywhere in the graph. The new step
// inherits afterId's scope (its `parent`), so this works mid-chain in the root trunk
// OR mid-chain inside a branch. Rewires afterId.next → newStep → (afterId's old next).
export function insertAfter(templates, newStep, afterId) {
  const anchor = requireStep(templates, afterId, 'insertAfter');
  // A container's `next` is its BRANCH ARRAY, not a chain pointer. Overwriting it with
  // the new step's id silently orphans every branch and everything under them — the
  // workflow round-trips clean and loses half its graph. A container is terminal in its
  // scope: there is no "after" it to insert into, only a branch to append to.
  if (Array.isArray(anchor.next))
    throw new Error(`insertAfter: '${anchor.name ?? afterId}' is a container — it is terminal in its scope, and inserting after it would orphan its branches. Use appendToBranch with one of its branch ids instead.`);
  const oldNext = (typeof anchor.next === 'string' ? anchor.next : null);
  const step = { ...newStep, next: oldNext, parentKey: anchor.id, order: 0 };
  if (anchor.parent != null) step.parent = anchor.parent; // same scope as the anchor
  const modified = new Set([anchor.id]);
  const out = templates.map((t) => {
    if (t.id === afterId) return { ...t, next: step.id };
    // The displaced successor's inbound edge is now the new step — keep its parentKey
    // truthful so the round-trip matches a fresh build (parentKey = immediate predecessor
    // for a linear step). Leaving it pointing at the anchor is stale, not dangling, but a
    // deliberately-wrong parentKey is exactly the hygiene the compiler never emits.
    if (oldNext && t.id === oldNext) { modified.add(t.id); return { ...t, parentKey: step.id }; }
    return t;
  });
  out.push(step);
  return { templates: out, diff: { createdSteps: [step.id], modifiedSteps: [...modified], deletedSteps: [] } };
}

// Fields that ARE the graph. They have dedicated ops (moveStep/insertAfter/deleteStep/
// repairParentKeys) which maintain the invariants — pointers, scope, ordering — that a
// blind shallow-merge would quietly break. A top-level patch is a door to a step's LABEL,
// not to its wiring, so it refuses these outright rather than trusting the caller.
export const PROTECTED_STEP_FIELDS = new Set(['id', 'type', 'parent', 'parentKey', 'next', 'order']);

function assertPatchableFields(stepPatch, opLabel) {
  const bad = Object.keys(stepPatch ?? {}).filter((k) => PROTECTED_STEP_FIELDS.has(k));
  if (bad.length)
    throw new Error(
      `${opLabel}: refusing to patch graph field(s) ${bad.map((k) => `'${k}'`).join(', ')} — `
      + `those are the step's wiring, not its content. Use moveStep/insertAfter/insertBefore/deleteStep/`
      + `repairParentKeys, which keep the graph consistent.`);
}

// Modify an existing step's attributes in place (shallow-merge the patch). Emits the
// step in modifiedSteps so the server re-persists just that step.
//
// `stepPatch` is the optional TOP-LEVEL merge. It exists because a step's `name` is a
// SIBLING of `attributes`, not a member of it — so for a long time no op in the whole
// vocabulary could rename a step, and an edit that repointed an "Update opportunity,
// Signed Won" step at a different stage could not fix the now-lying label it left behind.
// Graph fields are refused (see PROTECTED_STEP_FIELDS); everything else merges shallowly.
export function modifyStep(templates, stepId, attrPatch, stepPatch) {
  requireStep(templates, stepId, 'modifyStep');
  assertPatchableFields(stepPatch, 'modifyStep');
  const out = templates.map((t) => (t.id === stepId
    ? { ...t, ...(stepPatch ?? {}), attributes: { ...t.attributes, ...attrPatch } }
    : t));
  return { templates: out, diff: { createdSteps: [], modifiedSteps: [stepId], deletedSteps: [] } };
}

// Graph fields a RETYPE preserves byte-for-byte. This list is the whole safety argument
// for the op: a retype changes what a step DOES, never where it sits, so there is zero
// graph churn — no delete-and-reinsert, no rewiring, no re-parenting. Anything that
// walked into this workflow before the edit walks the identical path after it.
export const RETYPE_PRESERVED_FIELDS = ['id', 'order', 'next', 'parent', 'parentKey'];

// Retype an existing step IN PLACE: swap its `type` and its ENTIRE `attributes` object,
// keeping the five graph fields above untouched.
//
// Why this is a dedicated op and not a relaxation of modifyStep's PROTECTED_STEP_FIELDS:
// `type` sits in that set because changing it WITHOUT replacing `attributes` in the same
// operation leaves an invalid step — the old type's attribute keys stranded under a new
// type that has no idea what they mean. A dedicated op can REQUIRE the replacement (the
// driver refuses a retypeStep with no `attributes`), so the hazard cannot occur; loosening
// modifyStep would have made a fail-closed guard conditional, which is how such guards
// stop being ones. It also reads as what it is in a preview and a diff.
//
// `compiledEntry` is a freshly compiled step for the NEW type — the same compile() output
// an add op splices in, so a retyped step is byte-identical to a newly built one of that
// type (marketplace resolution, required-input enforcement, envelope keys and all).
//
// ATTRIBUTES ARE REPLACED, NEVER MERGED — that is the point. A merge leaves the old type's
// keys behind: converting an `sms` to a WhatsApp marketplace step with a merge strands a
// stale `body` next to the new `message`, and the builder renders whichever it finds.
// The same argument applies one level up, at the step's TOP level: the base here is the
// compiled entry, not the old step, so a structural field the OLD type carried and the new
// one does not (`workflowsActionType`, a native `stepIndex`) is dropped rather than
// inherited. The one deliberate carry-over is `advanceCanvasMeta` — the native pause flag
// is orthogonal to type, and a disabled step must not silently switch itself back on.
export function retypeStep(templates, stepId, compiledEntry) {
  const old = templates.find((t) => t.id === stepId);
  if (!old) return { templates, diff: emptyDiff() };
  // A container's `next` is its BRANCH ARRAY. Retyping one would either strand its branch
  // entries under a type that has no branches, or overwrite the array outright — the same
  // orphan-the-subgraph failure insertAfter refuses.
  if (Array.isArray(old.next))
    throw new Error(`retypeStep: '${old.name ?? stepId}' is a container — its next[] is branch wiring, `
      + `not content, and no retype can carry a branch set across types. Delete and rebuild it instead.`);
  const next = { ...compiledEntry };
  for (const k of RETYPE_PRESERVED_FIELDS) {
    if (k in old) next[k] = old[k]; else delete next[k];
  }
  if (old.advanceCanvasMeta !== undefined) next.advanceCanvasMeta = old.advanceCanvasMeta;
  // Fail CLOSED on the invariant rather than merely intending it. This is the check the
  // hand-rolled migration script ran before it would commit, kept here so the engine can
  // never quietly acquire a code path that moves a step while claiming to retype it.
  const drifted = RETYPE_PRESERVED_FIELDS
    .filter((k) => JSON.stringify(old[k] ?? null) !== JSON.stringify(next[k] ?? null));
  if (drifted.length)
    throw new Error(`retypeStep: graph field(s) ${drifted.map((k) => `'${k}'`).join(', ')} changed on `
      + `'${old.name ?? stepId}' — a retype must leave the graph byte-identical. Refusing to commit.`);
  return {
    templates: templates.map((t) => (t.id === stepId ? next : t)),
    diff: { createdSteps: [], modifiedSteps: [stepId], deletedSteps: [] },
  };
}

// The marketplace step counter, read off a templates[] array.
//
// 🔴 `meta.stepIndexCounter[<action key>]` is a HIGH-WATER MARK, not a running total.
// ACCUMULATING onto the stored value across edits sends it to 24 for 12 steps (live-caught
// on a hand-rolled client migration), and the builder renders the canvas `#N` prefix off
// `stepIndex` — so a wrong counter is visible, wrong numbering on the canvas. Recomputing
// from the templates themselves is the only shape that is idempotent across re-runs.
export function marketplaceStepIndexCounter(templates) {
  const counter = new Map();
  for (const t of templates ?? []) {
    if (t?.isMarketplaceAction !== true || !t.type) continue;
    counter.set(t.type, Math.max(counter.get(t.type) ?? 0, Number(t.stepIndex) || 0));
  }
  return counter;
}

// Renumber every marketplace step's `stepIndex` as a PER-ACTION-KEY, 1-based occurrence
// counter in templates order — the same rule compiler.mjs applies on the build path (see
// its marketplaceStepIndexCounter comment for why this is deliberately NOT the global
// premium stepIndex). The build path can count as it emits; an edit cannot, because a
// step spliced into an existing workflow has to be numbered against the steps ALREADY
// there — a standalone compile always hands back `stepIndex: 1`, which would collide with
// the first stored step of the same key.
//
// Returns the ids whose stepIndex actually moved so the caller can mark them modified: a
// step whose number changed but which never appears in modifiedSteps is a change the
// server is never asked to persist.
export function assignMarketplaceStepIndexes(templates) {
  const running = new Map();
  const changed = [];
  const out = (templates ?? []).map((t) => {
    if (t?.isMarketplaceAction !== true || !t.type) return t;
    const n = (running.get(t.type) ?? 0) + 1;
    running.set(t.type, n);
    if (t.stepIndex === n) return t;
    changed.push(t.id);
    return { ...t, stepIndex: n };
  });
  return { templates: out, changed, counter: running };
}

// Rename a step. The name is what every downstream reader — the canvas, an export, the
// next human — uses to know what the step does, so leaving it stale after a modifyStep is
// worse than leaving it generic. Whole-templates commit means this needs no transport
// work: the renamed step round-trips like any other modification (proven live on the UK
// account 2026-07-31 — version 14→15, 8 steps intact, attributes byte-identical, the
// workflow stayed published).
export function renameStep(templates, stepId, name) {
  if (typeof name !== 'string' || name.trim() === '')
    throw new Error(`renameStep: 'name' must be a non-empty string (got ${JSON.stringify(name)})`);
  return modifyStep(templates, stepId, {}, { name });
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
//
// `prepend` puts the subgraph at the FRONT of templates[] instead of the back. That is not
// cosmetic: the BUILDER RESOLVES THE ROOT BY ARRAY POSITION, not by parentKey. Every
// UI-built workflow has its head at templates[0] (verified against a UI-built container
// workflow, 2026-07-19), and compileSubgraph's own head lookup falls back to `tpls[0]`.
// Appending a new HEAD therefore produced a graph that was correct by every pointer check
// — right parentKey, right branches, no orphans, clean round-trip, publish 200 — but whose
// container the canvas silently refused to render, showing the old head as the first step.
// Caught only by opening the builder on a live canary; the unit tests passed because they
// find the head by predicate rather than by position.
function spliceSubgraph(templates, sub, anchorId, position, prepend = false) {
  const entry = { ...sub.entry, ...position };
  if (position.parent == null) delete entry.parent;
  const rest = sub.templates.filter((t) => t.id !== sub.entry.id);
  const existing = templates.map((t) => (anchorId && t.id === anchorId ? { ...t, next: entry.id } : t));
  const out = prepend ? [entry, ...rest, ...existing] : [...existing, entry, ...rest];
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

// ---------------------------------------------------------------------------
// Prepend / insertBefore
//
// Every other add op takes an anchor to sit AFTER, so nothing could become step 1 of an
// existing workflow — a real gap (adding a gate in front of a published workflow had to
// be done by hand in the UI). Two distinct cases hide behind one caller-facing op:
//
//   - `beforeId` has an inbound `next` → this is just insertAfter(that predecessor).
//     One code path, so mid-chain insertBefore inherits every guard insertAfter has.
//   - `beforeId` is the ROOT HEAD → a genuine prepend: the new step takes over as head.
//     For a CONTAINER that means the entire existing workflow becomes the tail and must
//     be re-scoped onto ONE branch. Same `attachTailTo` contract as insertAfter, but the
//     stakes are maximal: here the "tail" is 100% of the workflow's traffic, so a guess
//     would reroute everything. Ambiguity stays an error.
// ---------------------------------------------------------------------------

// Who points AT `id`. A container reaches its branch entries through its `next` ARRAY —
// that is structural wiring, not a chain edge, so it is reported separately and refused.
function inboundOf(templates, id) {
  const viaBranch = templates.find((t) => Array.isArray(t.next) && t.next.includes(id));
  if (viaBranch) return { pred: viaBranch, viaBranchArray: true };
  return { pred: templates.find((t) => t.next === id) ?? null, viaBranchArray: false };
}

function rootHead(templates) {
  return templates.find((t) => (t.parentKey === null || t.parentKey === undefined) && t.parent == null) ?? null;
}

function refuseBranchEntry(entry, beforeId, opLabel) {
  throw new Error(
    `${opLabel}: '${entry.name ?? beforeId}' is a BRANCH ENTRY of '${entry.name ?? ''}' — its position is structural `
    + `(the container's next[] is the branch wiring, not a chain), so nothing can be spliced in front of it. `
    + `Use appendToBranch to add steps INSIDE the branch instead.`);
}

// Make a plain step the new head of the root chain. The old head re-parents onto it and
// the whole root scope is renumbered, which is what flattenGraph would have emitted had
// the author built this shape fresh.
export function prependStep(templates, newStep, head = null) {
  const target = head ?? rootHead(templates);
  if (!target)
    throw new Error('prependStep: cannot locate the workflow head step (parentKey null, no parent) — refusing to guess which step is first.');
  const step = { ...newStep, next: target.id, parentKey: null, order: 0 };
  delete step.parent;
  const byId = new Map(templates.map((t) => [t.id, t]));
  const modified = new Set([target.id]);
  const order = new Map();
  scopeChain(byId, target.id).forEach((n, i) => { order.set(n.id, i + 1); modified.add(n.id); });
  const out = templates.map((t) => {
    let n = t;
    if (n.id === target.id) n = { ...n, parentKey: step.id };
    if (order.has(n.id)) n = { ...n, order: order.get(n.id) };
    return n;
  });
  out.unshift(step);
  return { templates: out, diff: { createdSteps: [step.id], modifiedSteps: [...modified], deletedSteps: [] } };
}

// Insert a plain step immediately BEFORE `beforeId`.
export function insertBefore(templates, newStep, beforeId) {
  const target = requireStep(templates, beforeId, 'insertBefore');
  const { pred, viaBranchArray } = inboundOf(templates, beforeId);
  if (viaBranchArray) refuseBranchEntry(target, beforeId, 'insertBefore');
  if (pred) return insertAfter(templates, newStep, pred.id);
  return prependStep(templates, newStep, target);
}

// Insert a CONTAINER subgraph immediately BEFORE `beforeId`, re-scoping what it displaces
// onto the container's `attachTailTo` branch.
export function insertSubgraphBefore(templates, sub, beforeId, attachTailTo) {
  const target = requireStep(templates, beforeId, 'insertSubgraphBefore');
  const { pred, viaBranchArray } = inboundOf(templates, beforeId);
  if (viaBranchArray) refuseBranchEntry(target, beforeId, 'insertBefore');
  if (pred) return insertSubgraphAfter(templates, sub, pred.id, attachTailTo);
  if (target.parent != null)
    throw new Error(`insertBefore: '${target.name ?? beforeId}' has no inbound edge but sits in a branch scope — the graph is malformed; repair it before editing.`);
  // Root prepend: the container becomes the head and the WHOLE existing chain is the tail.
  // prepend:true is REQUIRED — the new head must land at templates[0] or the builder will
  // not render it (see spliceSubgraph).
  const { out, entry, created } = spliceSubgraph(templates, sub, null, { parentKey: null, order: 0, parent: null }, true);
  const modified = new Set();
  const branch = resolveBranchTarget(entry, out, attachTailTo, 'insertBefore');
  const templatesOut = reScopeTailOntoBranch(out, branch.id, beforeId, modified);
  return { templates: templatesOut, diff: { createdSteps: created, modifiedSteps: [...modified], deletedSteps: [] } };
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

// Dead-branch risk: THIS edit created a container that took over an existing chain, and
// one of its branches carries those pre-existing steps while a SIBLING terminates
// immediately at END. That is a near-miss shape seen live — an if_else spliced in front of
// a release workflow put the whole existing chain on one branch and sent the other
// straight to END, so the normal path would never release anything. It is invisible in a
// diff (the branch is simply empty) and only readable off the canvas.
//
// Deliberately NARROW. It cannot know which branch is semantically "normal", so it does
// not try — it reports the choice the author actually made and makes them confirm it.
// Scoped to created containers that DISPLACED something, so:
//   - a fresh build never fires (nothing pre-existing on any branch);
//   - a container appended at a tail never fires (no chain displaced, empty branches are
//     the expected starting state);
//   - a legacy workflow's own asymmetric branches never fire (not created by this edit).
//
// One more exemption, and the reason for it: a branch carrying a PREDEFINED
// `__branchKey__` (find_opportunity's 'predefined_Opportunity Found', and the other
// finder/booking containers) is one whose meaning GHL defines, not the author. The tail
// belongs on Found ~always — resolveBranchTarget says so in as many words — and its
// Not-Found sibling dead-ending is the idiomatic shape, not a near-miss. Only
// AUTHOR-NAMED branches (if_else, workflow_split) are genuinely symmetric, and those are
// exactly where the routing choice is invisible without opening the canvas. Firing on the
// idiomatic case too would train the author to pass the override reflexively, which is
// how a fail-closed guard stops being one.
export function deadBranchRisk(templates, diff) {
  const created = new Set(diff.createdSteps ?? []);
  const byId = new Map(templates.map((t) => [t.id, t]));
  const risks = [];
  for (const t of templates) {
    if (!created.has(t.id) || !Array.isArray(t.next)) continue;
    const targets = branchTargets(t, templates);
    const predefined = new Set(targets.filter((x) => x.key != null).map((x) => x.id));
    const branches = t.next.map((id) => byId.get(id)).filter(Boolean);
    const ended = branches.filter((b) => b.next == null);
    const carrying = branches.filter((b) => typeof b.next === 'string'
      && !predefined.has(b.id)
      && scopeChain(byId, b.next).some((n) => !created.has(n.id)));
    if (ended.length && carrying.length)
      risks.push({
        containerId: t.id, name: t.name ?? t.id,
        carrying: carrying.map((b) => b.name ?? b.id),
        deadEnded: ended.map((b) => b.name ?? b.id),
      });
  }
  return risks;
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
  // FIELD enforcement on the steps THIS edit touched. Steps ADDED by ops were compiled through
  // compile() and its chokepoint already; `modifyStep` merges an attrPatch straight onto a stored
  // step and NEVER reaches the compiler — the long-known bypass (same reason tools.mjs runs
  // lintContactFieldTemplates on the modified set). Scoped to touched steps so a legacy
  // workflow's pre-existing violations on untouched steps never brick unrelated edits.
  // FAIL-OPEN when no catalog is passed: an unwired caller keeps its exact prior behaviour.
  if (opts.catalog) {
    const touched = new Set([...(diff.createdSteps ?? []), ...(diff.modifiedSteps ?? [])]);
    enforceTemplates(newTemplates.filter((t) => touched.has(t.id)), opts.catalog,
      { warn: opts.warn, skipEnforcement: opts.skipEnforcement });
  }

  // Fail CLOSED on a step REFERENCE (goto target, wait reply/email-event lists, goal steps)
  // left dangling by this edit — scoped like the parentKey check below: only refs whose holder
  // was touched, or whose target this edit deleted, can block; legacy residue on untouched
  // steps does not brick unrelated edits. opts.allowDanglingStepRefs is the explicit hatch.
  if (opts.allowDanglingStepRefs !== true) {
    const touchedIds = new Set([...(diff.createdSteps ?? []), ...(diff.modifiedSteps ?? [])]);
    const deletedIds = new Set(diff.deletedSteps ?? []);
    const bad = danglingStepRefs(newTemplates)
      .filter((d) => touchedIds.has(d.id) || deletedIds.has(d.missing));
    if (bad.length)
      throw new Error(`edit would leave ${bad.length} dangling step reference(s): ` +
        bad.map((b) => `'${b.name ?? b.id}' (${b.type}) ${b.path} → missing '${b.missing}'`).join('; ') +
        `. GHL reports 0 errors on this and renders a broken link. Repoint the reference, or pass allowDanglingStepRefs:true.`);
  }
  // Fail CLOSED on a parentKey that references a deleted/nonexistent step, the way the
  // round-trip verifier fails on duplicate ids. Scope it to steps THIS edit created or
  // modified so a legacy workflow's pre-existing residue doesn't brick unrelated edits —
  // and so the repairParentKeys op (which modifies exactly the orphans) can still run to
  // clean it. Runtime walks `next`, so this is builder hygiene, not a live corruptor
  // (finding 2026-07-17f) — but the builder/validator may not stay forgiving, and a
  // dangling parentKey makes a graph unreadable. Pass allowDanglingParentKeys to override.
  if (opts.allowDanglingParentKeys !== true) {
    const touched = new Set([...(diff.createdSteps ?? []), ...(diff.modifiedSteps ?? [])]);
    const bad = danglingParentKeys(newTemplates).filter((d) => touched.has(d.id));
    if (bad.length)
      throw new IRError('DANGLING_PARENTKEY',
        `edit left ${bad.length} step(s) with a parentKey pointing at a missing step: `
        + bad.map((d) => `'${d.name ?? d.id}' → ${d.parentKey}`).join(', ')
        + `. Add a repairParentKeys op, or pass allowDanglingParentKeys:true to commit anyway.`);
  }
  // Fail CLOSED on a goto THIS edit created or modified that now closes a cycle — the exact
  // shape the build path refuses unconditionally in compile() (goto-loops.mjs). Scoped to
  // touched steps like the parentKey check above: a legacy workflow's pre-existing loop must
  // not brick an unrelated edit near it. Unlike the build-path throw, this one carries a hatch
  // (opts.allowGotoLoops) — the build path authors a fresh workflow with no legitimate reason
  // to emit something GHL will immediately demote to draft, but the edit path runs over
  // harvested legacy data of uncertain provenance, the same reason every sibling guard here
  // (allowDanglingParentKeys, allowDanglingStepRefs, deadBranchAcknowledged) carries one.
  if (opts.allowGotoLoops !== true) {
    const touched = new Set([...(diff.createdSteps ?? []), ...(diff.modifiedSteps ?? [])]);
    const loops = gotoLoops(newTemplates).filter((l) => touched.has(l.id));
    if (loops.length)
      throw new IRError('GOTO_LOOP',
        `edit would leave ${loops.length} goto step(s) jumping BACKWARD to a step that can reach `
        + `them again: ` + loops.map((l) => `'${l.name ?? l.id}' -> '${l.targetName ?? l.target}'`).join('; ')
        + `. GHL detects the cycle server-side, marks the node "Loop Locked", stamps the workflow `
        + `loopIdentified and forces its status to draft — a published workflow silently stops. `
        + `Point the goto forward, or pass allowGotoLoops:true to commit anyway.`);
  }
  // Fail CLOSED on a container this edit spliced in that routes the displaced chain down
  // one branch and a sibling straight to END. The author names the branch, so this is not
  // second-guessing them — it is surfacing a routing decision that is otherwise only
  // visible by opening the canvas. Pass deadBranchAcknowledged once it has been read.
  if (opts.deadBranchAcknowledged !== true) {
    const risks = deadBranchRisk(newTemplates, diff);
    if (risks.length)
      throw new IRError('DEAD_BRANCH',
        risks.map((r) =>
          `'${r.name}' routes the workflow's existing steps down ${r.carrying.map((b) => `'${b}'`).join(', ')} `
          + `while ${r.deadEnded.map((b) => `'${b}'`).join(', ')} ${r.deadEnded.length > 1 ? 'terminate' : 'terminates'} immediately at END`).join('; ')
        + `. Contacts taking the terminating branch reach the end of the workflow and nothing downstream runs. `
        + `Confirm that is intended (or attach steps to it / re-run with a different attachTailTo), then pass deadBranchAcknowledged:true.`);
  }
  // meta.stepIndexCounter, per marketplace action key. Emitted ONLY when this edit
  // actually touched a marketplace step: a native edit on a workflow that happens to
  // contain marketplace steps must not rewrite metadata it had no reason to look at, and
  // a native edit on a native workflow must send exactly the body it sent before this
  // feature existed (`...fresh` carries any pre-existing meta through untouched either way).
  //
  // MERGED over the stored map rather than replacing it — a key whose steps this edit
  // deleted keeps its stored entry, which is what the builder does too. And it is set to
  // the HIGH-WATER MARK read back off the templates, never accumulated onto the stored
  // number: see marketplaceStepIndexCounter.
  const counter = marketplaceStepIndexCounter(newTemplates);
  const touched = new Set([...(diff.createdSteps ?? []), ...(diff.modifiedSteps ?? [])]);
  const editTouchedMarketplace = newTemplates
    .some((t) => t.isMarketplaceAction === true && touched.has(t.id));
  // WORKFLOW-LEVEL SETTINGS (the Settings tab) — `updateSettings` ops arrive as opts.settingsPatch.
  // Stored values ⊕ patch go through the same contract the build path uses (settings.mjs): an
  // unknown key or impossible value REFUSES; the result is the exact key set the UI's own Save
  // PUT carries (live-proven 2026-08-22: window + meta.statsView round-trip). No patch → the
  // body below is byte-identical to what it was before this existed (`...fresh` carries the
  // stored settings through untouched).
  const settingsBody = opts.settingsPatch ? settingsCommitFields(fresh, opts.settingsPatch, uid, opts) : {};
  return {
    ...fresh,
    updatedBy: uid,
    status: fresh.status ?? 'draft',
    version: fresh.version,
    triggersChanged: false,
    // Terminals go on the wire with no `next` key — an explicit null is refused by the save
    // validator, including on steps this edit never touched. See terminals.mjs.
    // A legacy add_to_workflow step stored as {workflow_id, type} is missing
    // input_trigger_params, which blocks EVERY save on the workflow, not just this step —
    // same wire-assembly boundary, same reason. See terminals.mjs.
    workflowData: { templates: fillInputTriggerParams(stripNullNext(newTemplates)) },
    ...(counter.size > 0 && editTouchedMarketplace
      ? { meta: { ...(fresh.meta ?? {}),
        stepIndexCounter: { ...(fresh.meta?.stepIndexCounter ?? {}), ...Object.fromEntries(counter) } } }
      : {}),
    ...settingsBody,
    createdSteps: diff.createdSteps, modifiedSteps: diff.modifiedSteps, deletedSteps: diff.deletedSteps,
  };
}

/** The Settings-tab keys as currently stored on a workflow document (what the UI's drawer loads). */
export function settingsFromDoc(doc) {
  return {
    allowMultiple: doc.allowMultiple, allowMultipleOpportunity: doc.allowMultipleOpportunity,
    stopOnResponse: doc.stopOnResponse, autoMarkAsRead: doc.autoMarkAsRead,
    removeContactFromLastStep: doc.removeContactFromLastStep, timezone: doc.timezone,
    window: doc.window ?? null, senderAddress: doc.senderAddress ?? {}, eventStartDate: doc.eventStartDate ?? '',
    scheduledPauseDates: doc.scheduledPauseDates ?? [], workflowNote: doc.workflowNote ?? null,
    statsView: doc.meta?.statsView ?? false,
  };
}

/** Stored settings ⊕ patch → the top-level keys for the commit body (+ meta.statsView merge). */
export function settingsCommitFields(fresh, patch, uid, opts = {}) {
  const unknown = Object.keys(patch).filter((k) => !KNOWN_SETTINGS_KEYS.has(k));
  if (unknown.length && opts.skipSettingsCheck !== true)
    throw new IRError('SETTINGS_KEY', `updateSettings: unknown settings key(s) [${unknown.join(', ')}] — known: ${[...KNOWN_SETTINGS_KEYS].join(', ')}`);
  const merged = { ...settingsFromDoc(fresh), ...patch };
  // the stored note keeps its authorship; a NEW/changed note is stamped by this edit
  if (typeof patch.workflowNote === 'string' && fresh.workflowNote?.content !== undefined && patch.workflowNote !== fresh.workflowNote.content)
    merged.workflowNote = { ...fresh.workflowNote, content: patch.workflowNote, updatedBy: uid, updatedAt: (opts.now ? new Date(opts.now) : new Date()).toISOString() };
  const { body } = normalizeSettings(merged, {
    uid, now: opts.now, warn: opts.warn, skipSettingsCheck: opts.skipSettingsCheck,
    senderRuleAdvisory: !('senderAddress' in patch),
  });
  const { statsView, ...top } = body;
  const out = { ...top };
  if ('statsView' in patch || fresh.meta?.statsView !== undefined) out.meta = { ...(fresh.meta ?? {}), statsView };
  return out;
}

// ─── Action NOTES (the node ⋯ → "Notes" popover; CommentSection.vue) ─────────────────────
// Stored on the step as `comments[]`, newest FIRST (the UI unshifts), each
// `{ id: uuid, userId, timestamp: moment.utc().format() → 'YYYY-MM-DDTHH:mm:ssZ', comment: HTML }`.
// Saved with the workflow — no separate endpoint. The count is not capped (the i18n "max 10"
// key has no consumer). An EDIT of an existing note overwrites userId + timestamp too.
export { stepNoteRecord };
export function addStepNote(templates, stepId, text, opts = {}) {
  const found = templates.find((t) => t.id === stepId);
  if (!found) throw new Error(`addStepNote: no step with id '${stepId}'`);
  const note = stepNoteRecord(text, opts);
  const out = templates.map((t) => (t.id === stepId ? { ...t, comments: [note, ...(Array.isArray(t.comments) ? t.comments : [])] } : t));
  return { templates: out, diff: { createdSteps: [], modifiedSteps: [stepId], deletedSteps: [] }, note };
}

// ─── DUPLICATE a step (the node ⋯ → "Copy action" + "Copy here" on the next plus node) ───
// UI rules (states/node.ts:242-284 cloneNode, PlusNode.vue:116-147 addNode, EDIT-OPS §5/§7):
//   • refused for containers (if_else/split/multipath), workflow_goal, loop (its body lives in
//     sibling templates) and goto (a second goto to the same target is a different intent);
//   • the copy carries name + attributes + advanceCanvasMeta (the DISABLED state travels);
//   • comments (notes) are NOT copied; a fresh id; inserted right after the source by default;
//   • an email built in the email builder gets `attributes.isCloned = true` written on the
//     SOURCE node (the UI mutates the source when you copy it) — mirrored, so the source lands
//     in modifiedSteps; a marketplace copy gets a fresh stepIndex via applyOps' renumbering.
const NOT_DUPLICABLE = new Set(['workflow_goal', 'loop', 'goto', 'if_else', 'workflow_split', 'wait']);
export function duplicateStep(templates, stepId, idGen, { afterId } = {}) {
  const src = templates.find((t) => t.id === stepId);
  if (!src) throw new Error(`duplicateStep: no step with id '${stepId}'`);
  if (Array.isArray(src.next) || NOT_DUPLICABLE.has(src.type) || src.attributes?.convertToMultipath === true || src.attributes?.isHybridAction === true)
    throw new Error(`duplicateStep: '${src.name ?? stepId}' (${src.type}) cannot be copied — the builder hides "Copy action" for containers/multipath waits, goals, loops and gotos. Build the container again instead.`);
  let tpls = templates;
  const modified = [];
  if (src.type === 'email' && src.attributes?.templatesource === 'email-builder' && src.attributes?.isCloned !== true) {
    tpls = tpls.map((t) => (t.id === stepId ? { ...t, attributes: { ...t.attributes, isCloned: true } } : t));
    modified.push(stepId);
  }
  // clone from the (possibly just-marked) source: the UI copies `currentNode.attributes` AFTER
  // markEmailAsCloned ran on it, so the copy carries isCloned too
  const marked = tpls.find((t) => t.id === stepId);
  const { comments, id: _id, next: _n, parentKey: _p, parent: _pa, order: _o, ...rest } = marked;
  const clone = { ...JSON.parse(JSON.stringify(rest)), id: idGen() };
  if (src.advanceCanvasMeta) clone.advanceCanvasMeta = JSON.parse(JSON.stringify(src.advanceCanvasMeta));
  const r = insertAfter(tpls, clone, afterId ?? stepId);
  if (!r.diff.createdSteps?.length) throw new Error(`duplicateStep: insert anchor '${afterId ?? stepId}' not found`);
  return { templates: r.templates, diff: { ...r.diff, modifiedSteps: [...new Set([...(r.diff.modifiedSteps ?? []), ...modified])] }, newId: clone.id };
}

// ─── FIND & REPLACE, tag mode (the magnifier rail panel; components/search-nodes/**) ──────
// The UI's TAG mode is the one non-literal replace: EXACT equality on tag arrays
// (`attributes.tags`, if/else `conditions[].conditionValue` where conditionSubType === 'tags'),
// a case-SENSITIVE string replace on `attributes.customTags`, and — for triggers — the same on
// `conditions[].value` (array → exact swap, string → replace). If the new tag already exists on a
// node the UI offers "the original tag will be removed" → the result is de-duplicated.
// (TEXT mode has no replace in the UI at all; custom-value mode is a substring replace — not here.)
const TAG_CONDITION_SUBTYPES = new Set(['tags']);
function swapInArray(arr, oldTag, newTag) {
  if (!Array.isArray(arr) || !arr.includes(oldTag)) return { arr, changed: false };
  const out = []; for (const v of arr) { const nv = v === oldTag ? newTag : v; if (!out.includes(nv)) out.push(nv); }
  return { arr: out, changed: true };
}
export function replaceTagInTemplates(templates, oldTag, newTag) {
  if (typeof oldTag !== 'string' || !oldTag || typeof newTag !== 'string' || !newTag) throw new Error(`replaceTag needs non-empty 'oldTag' and 'newTag' strings`);
  if (oldTag === newTag) throw new Error(`replaceTag: oldTag and newTag are the same ('${oldTag}') — nothing to do (the UI warns and no-ops)`);
  const modified = [];
  const out = templates.map((t) => {
    let changed = false;
    const attrs = t.attributes && typeof t.attributes === 'object' ? { ...t.attributes } : null;
    if (!attrs) return t;
    const r = swapInArray(attrs.tags, oldTag, newTag); if (r.changed) { attrs.tags = r.arr; changed = true; }
    if (typeof attrs.customTags === 'string' && attrs.customTags.includes(oldTag)) { attrs.customTags = attrs.customTags.split(oldTag).join(newTag); changed = true; }
    if (Array.isArray(attrs.branches)) {
      attrs.branches = attrs.branches.map((b) => {
        if (!Array.isArray(b?.segments)) return b;
        let bChanged = false;
        const segments = b.segments.map((s) => {
          if (!Array.isArray(s?.conditions)) return s;
          const conditions = s.conditions.map((c) => {
            if (!c || !TAG_CONDITION_SUBTYPES.has(c.conditionSubType)) return c;
            if (Array.isArray(c.conditionValue)) { const rr = swapInArray(c.conditionValue, oldTag, newTag); if (rr.changed) { bChanged = true; return { ...c, conditionValue: rr.arr }; } return c; }
            if (c.conditionValue === oldTag) { bChanged = true; return { ...c, conditionValue: newTag }; }
            return c;
          });
          return { ...s, conditions };
        });
        if (bChanged) changed = true;
        return { ...b, segments };
      });
    }
    if (!changed) return t;
    modified.push(t.id);
    return { ...t, attributes: attrs };
  });
  return { templates: out, diff: { createdSteps: [], modifiedSteps: modified, deletedSteps: [] }, replaced: modified.length };
}
/** Trigger side: conditions[].value — array → exact swap, string → case-sensitive replace. Returns the rewritten conditions or null when untouched. */
export function replaceTagInTriggerConditions(conditions, oldTag, newTag) {
  if (!Array.isArray(conditions)) return null;
  let changed = false;
  const out = conditions.map((c) => {
    if (!c || typeof c !== 'object') return c;
    if (Array.isArray(c.value)) { const r = swapInArray(c.value, oldTag, newTag); if (r.changed) { changed = true; return { ...c, value: r.arr }; } return c; }
    if (typeof c.value === 'string' && c.value.includes(oldTag)) { changed = true; return { ...c, value: c.value.split(oldTag).join(newTag) }; }
    return c;
  });
  return changed ? out : null;
}
