// Pure driver for edit-mode: turn a list of edit ops into { templates, diff } over an
// existing workflow's templates[]. No I/O — scripts/edit.mjs does the GET/PUT and passes
// the fresh templates in. Keeping this pure makes the op sequencing + diff-merge testable.
import {
  appendStep, deleteStep, insertAfter, modifyStep, renameStep, appendToBranch, moveStep,
  addBranch, deleteContainer, setStepDisabled, disableStepsByType,
  appendSubgraph, insertSubgraphAfter, appendSubgraphToBranch, repairParentKeys,
  insertBefore, insertSubgraphBefore, prependStep,
  retypeStep, assignMarketplaceStepIndexes,
  addStepNote,
  duplicateStep,
  replaceTagInTemplates,
  replaceTagInTriggerConditions,
  resolveBranchTarget,
} from './edit.mjs';
import { compile, buildTrigger } from './compiler.mjs';
import { walkNodes, IRError } from './ir.mjs';
import { STICKY_OPS } from './sticky-notes.mjs';
export { STICKY_OPS };

// Triggers live in a SEPARATE document from workflowData.templates, with their own CRUD
// endpoints — so a trigger op can't be a templates→templates function like the step ops.
// These ops are partitioned out and planned into request intents instead.
export const TRIGGER_OPS = new Set(['addTrigger', 'deleteTrigger', 'modifyTrigger', 'duplicateTrigger', 'replaceTagInTriggers']);
// Workflow-LEVEL settings (the Settings tab) live on the workflow document's top level, not in
// workflowData.templates — so they are neither step ops nor trigger ops. partitionOps() lifts
// them out; the commit merges them over the stored values (editCommitBody opts.settingsPatch).
export const SETTINGS_OPS = new Set(['updateSettings']);

// The LIVE document as a reference universe for a one-node compile: every step id, and every
// step name that is UNIQUE (a duplicated name maps to null so it can never be guessed). `opRefs`
// are the refs earlier ops in the SAME call authored, mapped to the ids they minted, so op 2 can
// target what op 1 created.
export function externalRefsOf(templates, opRefs = new Map()) {
  const ids = new Set((templates ?? []).map((t) => t.id));
  const byName = new Map();
  for (const t of templates ?? []) {
    if (typeof t.name !== 'string' || !t.name) continue;
    byName.set(t.name, byName.has(t.name) ? null : t.id);
  }
  // An AUTHORED ref always wins a collision with a live step name — overwrite, never skip.
  // Skipping let a live step named 'Tag A' shadow the ref 'Tag A' that an earlier op in the
  // same call had just minted, so op 2 silently targeted the wrong step.
  for (const [ref, id] of opRefs) { ids.add(id); byName.set(ref, id); }
  return { ids, byName };
}

// The same universe as a plain ref->id map, for buildTrigger's `target` resolution.
const refMapFrom = (externalRefs) => {
  const m = new Map();
  for (const id of externalRefs?.ids ?? []) m.set(id, id);
  for (const [name, id] of externalRefs?.byName ?? []) if (id && !m.has(name)) m.set(name, id);
  return m;
};

export function partitionOps(ops) {
  const stepOps = [], triggerOps = [], settingsOps = [], stickyOps = [];
  for (const op of ops ?? []) {
    (TRIGGER_OPS.has(op.op) ? triggerOps : SETTINGS_OPS.has(op.op) ? settingsOps : STICKY_OPS.has(op.op) ? stickyOps : stepOps).push(op);
    // Find & Replace (tag mode) spans BOTH documents like the UI's "Replace All": the step op
    // rewrites templates; a derived trigger op rewrites every trigger condition carrying the tag.
    if (op.op === 'replaceTag' && op.triggers !== false) triggerOps.push({ op: 'replaceTagInTriggers', oldTag: op.oldTag, newTag: op.newTag });
  }
  return { stepOps, triggerOps, settingsOps, stickyOps };
}

// Fold `{ op:'updateSettings', settings:{…} }` ops (in order) into ONE patch of Settings-tab keys.
// Validation of keys/values happens at commit (normalizeSettings over stored ⊕ patch), where the
// stored document is known. Returns null when there are no settings ops — the commit body is
// then byte-identical to what it was before this op existed.
export function mergeSettingsOps(settingsOps) {
  if (!settingsOps?.length) return null;
  const patch = {};
  for (const op of settingsOps) {
    if (!op.settings || typeof op.settings !== 'object' || Array.isArray(op.settings))
      throw new Error(`updateSettings needs a 'settings' object, e.g. { "op":"updateSettings", "settings": { "stopOnResponse": true } }`);
    Object.assign(patch, op.settings);
  }
  return patch;
}

// Does this edit reference the marketplace rail at all? The caller uses this to decide
// whether to fetch the per-location marketplace index into ctx — the same gate the build
// path applies in orchestrate() (`usesMarketplace`), for the same reason: an edit that
// touches nothing third-party must stay network-identical to what it was before this
// feature existed, with no extra GETs.
//
// Walk the ops' step SUBGRAPHS — never string-scan the serialized ops. A marketplace step
// nested inside an if/else branch of an added container must still be found, and an
// attribute string that merely CONTAINS the text `"marketplace":true` (a pasted JSON body
// in a custom_webhook step, say) must NOT be mistaken for one.
export function opsUseMarketplace(ops) {
  let uses = false;
  const mark = (node) => { if (node?.marketplace === true) uses = true; };
  for (const op of ops ?? []) {
    mark(op?.trigger);
    if (op?.step) walkNodes([op.step], mark);
  }
  return uses;
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
// FLOW-BOT ENTRY GUARD — a conv_ai_trigger is the entry of a FLOW_BUILDER_BOT's flow, and it is
// LOAD-BEARING in a way no other trigger is: the agent points at this workflow
// (objectiveBuilderWorkflowId) while the workflow points back at the agent (the botId condition).
// Break one half and the bot is orphaned -- it still lists the flow, but nothing enters it.
//
// The GHL UI makes this trigger uneditable and undeletable. THE API DOES NOT. Live-proven
// 2026-08-26 on the designated test account, one attempt each, each read back separately:
//   PUT a different botId          -> 200, applied. The flow now belongs to another agent.
//   PUT type: 'contact_tag'        -> 200, applied. An agent-type workflow whose entry is no
//                                     longer a chat trigger at all, conditions wiped.
// Neither was refused, warned about, or reverted. So the engine has to be the one that refuses:
// there is no server-side guarantee to inherit here.
//
// Hatch: ctx.allowFlowTriggerEdit === true, for the caller who genuinely means it.
const isFlowEntry = (t) => t?.type === 'conv_ai_trigger';
function guardFlowEntry(op, t, ctx) {
  if (ctx?.allowFlowTriggerEdit === true) return;
  if (!isFlowEntry(t)) return;
  const bot = (t.conditions ?? []).find((c) => c?.field === 'botId')?.value;
  const who = bot ? `agent ${bot}` : 'its agent';
  throw new Error(
    `${op.op}: refusing to touch a conv_ai_trigger — this is the entry of a FLOW_BUILDER_BOT flow `
    + `bound to ${who}. GHL's API allows this (live-proven 2026-08-26: rebinding and retyping both `
    + `return 200 and apply) but the flow builder does not, and breaking it orphans the bot: the `
    + `agent keeps objectiveBuilderWorkflowId while nothing can enter the flow. `
    + `Edit the flow through the flow builder, or pass ctx.allowFlowTriggerEdit if you mean it.`);
}

// A trigger's `active` is a READ-ONLY PROJECTION of its own `status` field ("draft"|
// "published") — `active === (status !== "draft")`. Nothing on the per-trigger PUT/POST
// controls `active` directly; `status` is the field that does. buildTrigger's `status:'draft'`
// therefore must never ride an EDIT-path write unexamined —
// see addTrigger/duplicateTrigger (workflowStatus-driven) and modifyTrigger
// (translateActiveToStatus) below, each of which decides `status` for itself rather than
// inheriting whatever buildTrigger happened to hardcode.
//
// requestedActive !== storedActive is a genuine attempted CHANGE; a match, or an absent
// `active`, is not. true -> 'published', false -> 'draft'. Returns undefined (send no
// `status` key at all) for the non-change cases, because absent is the one body shape
// proven to leave `status` — and therefore `active` — unchanged.
function translateActiveToStatus(requestedActive, storedActive) {
  if (requestedActive === undefined || requestedActive === storedActive) return undefined;
  return requestedActive ? 'published' : 'draft';
}

// `workflowStatus` ('draft'|'published') is the TARGET WORKFLOW's own status, needed to
// decide what `status` a freshly-created trigger (addTrigger/duplicateTrigger) should carry.
// planTriggerOps has no way to see the workflow document itself, so every caller passes it in:
// mcp-internal/core/tools.mjs's edit_workflow (`fresh.status`) and scripts/edit.mjs
// (also `fresh.status`). Missing/unrecognised values default to 'draft' — the safe choice for
// a caller not yet updated, and consistent with buildTrigger's own historical default.
export function planTriggerOps(triggerOps, { ctx, wid, uid, existing = [], workflowStatus } = {}) {
  const loc = ctx.loc;
  const targetStatus = workflowStatus === 'published' ? 'published' : 'draft';
  return (triggerOps ?? []).flatMap((op) => {
    switch (op.op) {
      case 'addTrigger':
        // buildTrigger is the SAME corpus-traced shape the create path posts: the full
        // envelope (schedule_config/masterType/actions/company_age/…) plus expandFilter's
        // condition expansion — including the scalar unwrap that keeps a contact_tag value
        // a plain string. A lean hand-rolled body saves but never attaches.
        //
        // `status` OVERRIDES buildTrigger's own hardcoded 'draft' (correct only on the BUILD
        // path) with the TARGET WORKFLOW's status: 'published' lands the new trigger active
        // immediately (measured 2026-08-28 — no known write ever activated a trigger against
        // an already-published workflow before this); 'draft' keeps draft-first true, so a
        // trigger added to a still-draft workflow stays inactive until the workflow itself
        // publishes. Without this override, addTrigger on an already-published workflow used
        // to create a DEAD trigger — status:'draft' with nothing that would ever flip it,
        // since publishing (the only known activation path) does not re-run on a workflow
        // that is already published.
        return { op: op.op, method: 'POST', path: `/workflow/${loc}/trigger`, body: { ...buildTrigger(op.trigger, ctx, wid, refMapFrom(ctx?.externalRefs)), status: targetStatus } };
      case 'deleteTrigger': {
        const t = resolveTrigger(op, existing);
        guardFlowEntry(op, t, ctx);
        // userId is a REQUIRED query param on the delete (docs/03-endpoints.md §3.5).
        return { op: op.op, method: 'DELETE', path: `/workflow/${loc}/trigger/${t.id ?? t._id}?userId=${uid}`, triggerId: t.id ?? t._id };
      }
      // "Copy Trigger" (trigger ⋯ menu / ⌘V → cloneTriggers, recovered EDIT-RAIL.md): the stored
      // trigger is re-posted with a "(Copy)" name, and an inbound-webhook trigger gets a fresh
      // predeterminedId (its URL must differ).
      //
      // The roster GET `t` came from never carries a `status` key, and an absent `status`
      // lands a trigger ACTIVE on either a draft OR a published workflow (per the measured
      // POST table above planTriggerOps) — wrong for a copy landing on a still-draft
      // workflow. `status` follows the workflow's own state explicitly, same rule as
      // addTrigger, so a copy matches its workflow instead of the absent-status default.
      case 'duplicateTrigger': {
        const t = resolveTrigger(op, existing);
        const { id: _i, _id: _ii, date_added: _da, date_updated: _du, deleted: _d, ...rest } = t;
        // `name` selects the SOURCE (resolveTrigger); the copy's name is `newName`, default "<name> (Copy)" like the UI.
        // `active: false` is kept for read-back fidelity of the request shape even though the
        // server does not key off it (only `status` does) — see the mechanism note above.
        const body = { ...JSON.parse(JSON.stringify(rest)), name: op.newName ?? `${t.name ?? t.type} (Copy)`, active: false, status: targetStatus, workflow_id: wid };
        if (body.predeterminedId && ctx.idGen) body.predeterminedId = ctx.idGen();
        for (const c of body.conditions ?? []) if (c && typeof c === 'object' && c.field === 'predeterminedId' && ctx.idGen) c.value = body.predeterminedId ?? ctx.idGen();
        return { op: op.op, method: 'POST', path: `/workflow/${loc}/trigger`, body, sourceTriggerId: t.id ?? t._id };
      }
      // derived from a `replaceTag` op: one full-object PUT per trigger whose conditions carry the tag
      case 'replaceTagInTriggers': {
        return existing.flatMap((t) => {
          const conditions = replaceTagInTriggerConditions(t.conditions, op.oldTag, op.newTag);
          if (!conditions) return [];
          const tid = t.id ?? t._id;
          return [{ op: op.op, method: 'PUT', path: `/workflow/${loc}/trigger/${tid}`, triggerId: tid, body: { ...t, conditions, id: tid, _id: t._id ?? tid } }];
        });
      }
      case 'modifyTrigger': {
        const t = resolveTrigger(op, existing);
        guardFlowEntry(op, t, ctx);
        const tid = t.id ?? t._id;
        // `target` (an IR ref) resolves through buildTrigger's refMap argument, which only
        // exists on the fresh-build path (compile() flattens the graph first and hands
        // buildTrigger the resulting ref->id map). The edit path has no IR graph here, only
        // the live trigger/step roster, so it never has a refMap to pass — buildTrigger would
        // see `target` set, find no refMap, and unconditionally throw REF_DANGLING regardless
        // of whether the ref was ever valid, coaching the caller to keep retrying refs that
        // can never resolve. Refuse it here instead, naming the real fix.
        // TRANSLATE an attempted `active` CHANGE into the field that actually controls it —
        // see translateActiveToStatus above for the full mechanism. A value that MATCHES the
        // stored trigger is a harmless no-op echo (common when a caller round-trips a whole
        // trigger object) and sends no status write, as does the absence of `active`
        // altogether — only a genuine attempted CHANGE produces one.
        const requestedActive = op.trigger?.active;
        const storedActive = t.active ?? false;
        const status = translateActiveToStatus(requestedActive, storedActive);
        // The update PUT wants the FULL trigger object with edits, not a patch. Rebuild
        // through buildTrigger so an edited filter gets the same expansion a fresh create
        // gets, then re-seat the server's identity/envelope fields over the top.
        const merged = buildTrigger(
          { type: op.trigger?.type ?? t.type, name: op.trigger?.name ?? t.name,
            masterType: op.trigger?.masterType ?? t.masterType,
            filters: op.trigger?.filters ?? t.conditions ?? [],
            // NEVER force-activate: a modify that doesn't mention `active` preserves whatever
            // the live trigger already had. There is a standing project rule against enabling
            // anything found off. (`status` above, not this `active` field, is what actually
            // moves the projection — this stays only for read-back fidelity of the request
            // shape the server echoes.)
            active: op.trigger?.active ?? t.active ?? false,
            // Forward the stored target so buildTrigger's own goto-target check sees it. Left
            // unset, a modify of a goto trigger (conv_ai_autonomous_trigger) warned
            // TRIGGER_TARGET: "... is a goto trigger with NO target" on every edit — dishonest,
            // since t.targetActionId in fact survives onto the PUT body below via spread order
            // (`{ ...t, ...merged }`) whether buildTrigger ever saw it or not. An author-supplied
            // targetActionId (a real step id) on the op overrides the stored one. `target` (a
            // ref) is refused above rather than forwarded here — buildTrigger has no refMap on
            // this path to resolve it against.
            // `target` is an id or a UNIQUE NAME of a LIVE step, resolved against the roster the
            // tool seeds into ctx.externalRefs; `targetActionId` is a literal id. Either works now.
            ...(op.trigger?.target
              ? { target: op.trigger.target }
              : { targetActionId: op.trigger?.targetActionId ?? t.targetActionId }),
            ...(op.trigger?.convTriggerBotId ? { convTriggerBotId: op.trigger.convTriggerBotId } : {}) },
          ctx, wid, refMapFrom(ctx?.externalRefs),
        );
        // buildTrigger hardcodes `status:'draft'` (correct ONLY on the BUILD path — see
        // compiler.mjs's own comment). Left in `merged`, that 'draft' would ride EVERY
        // modifyTrigger PUT and DEACTIVATE the trigger being edited, because `active` is a
        // projection of `status` (`active === (status !== 'draft')`) and status:'draft' is a
        // genuine write, not an echo. Strip it — this PUT sends `status` if, and only if,
        // `status` above says a change was actually requested.
        delete merged.status;
        return { op: op.op, method: 'PUT', path: `/workflow/${loc}/trigger/${tid}`, triggerId: tid,
          body: { ...t, ...merged, id: tid, _id: t._id ?? tid, ...(status !== undefined ? { status } : {}) } };
      }
      default: throw new Error(`unknown trigger op: ${JSON.stringify(op.op)}`);
    }
  });
}

// planTriggerActivation() does not exist — do not re-add a function that sends a per-trigger
// PUT carrying `active` directly. `active` is a SERVER-MANAGED PROJECTION of the workflow's
// publish state, not a field any PUT body controls: a publish with zero trigger writes still
// activates every trigger sub-second after the publish PUT returns, and a per-trigger PUT
// with `active:false` against a published workflow returns 200 with the trigger reading
// active:true. The field that actually controls it is the trigger's OWN `status` field
// ("draft"|"published") — `active === (status !== "draft")`. Sending `status:"published"` on
// a per-trigger PUT DOES activate a trigger on an already-published workflow, read back clean
// at +0.5s/+2s/+5s; `status:"draft"` deactivates it the same way. A bogus `status` string is
// silently accepted and ignored (200, unchanged) — never trust the 200, always read `active`
// back.
//
// The per-trigger PUT is still genuinely load-bearing for trigger CONTENT (conditions, name,
// targetActionId) — see modifyTrigger above, which uses the same PUT shape for content edits,
// just never sends `active`.
//
// This is the REPAIR rail: publish_workflow (mcp-internal/core/tools.mjs), orchestrate.mjs's
// --publish step, and scripts/edit.mjs's post-add activation check each send this exact PUT —
// one per trigger that STILL reads inactive after the publish PUT's own cascade (the
// workflow-level draft→published transition sets `status:"published"` on every trigger within
// ~0.3s, with no trigger write needed, which usually makes the repair a no-op) — then re-list
// and verify before reporting success. Only a trigger still inactive after that repair is
// reported as a failure; see each call site's own comment for the current wording. The
// round-trip verification is mandatory either way: it is the only thing in this system that
// tells the truth about activation.

// Compile an IR action node into the subgraph the edit ops splice in. A linear step
// compiles to exactly one template; a CONTAINER (find_opportunity with onFound/onNotFound,
// if_else, workflow_split, the multipath waits…) compiles to an entry node plus its
// branch entries and their children.
//
// Reusing compile() — the same function build.mjs runs — is what makes an edit-inserted
// container byte-identical to a freshly-built one. Anything hand-rolled here would drift
// from the compiler's hard-won container shapes (the None node, the enriched conditions,
// the transitions' __branchKey__) the moment either side changed.
//
// assocGuaranteed keeps the throwaway standalone compile from tripping the
// opportunity-association check; the REAL check runs in editCommitBody against the
// whole workflow graph.
export function compileSubgraph(node, ctx) {
  const out = compile(
    { name: '_edit', triggers: [], graph: [{ ...node, ref: node.ref ?? '_edit_step', kind: node.kind ?? 'action', assocGuaranteed: true }] },
    ctx,
  );
  // `_templates`, not `autoSaveBody.workflowData.templates`: the latter has its terminal
  // `next: null` stripped for the wire (terminals.mjs). Reading the stripped shape here would
  // not break any splice logic — rootTail/scopeChain/inboundOf/branchTargets below are all
  // absent-safe — but it WOULD hand the edit graph an inconsistent node (missing `next` on a
  // terminal it inherits, e.g. an empty find_opportunity Not-Found transition) next to every
  // other node in the graph that still carries `next: null`. `_templates` keeps every node
  // compileSubgraph hands off in the SAME in-memory convention as the rest of the graph.
  // See compiler.mjs's `_templates` comment for the aliasing hazard this shortcut carries.
  const tpls = out._templates;
  // The compiled scope's head: the only node the flattener left unparented.
  const head = tpls.find((t) => (t.parentKey === null || t.parentKey === undefined) && t.parent == null) ?? tpls[0];
  const isContainer = Array.isArray(head.next);
  const entry = { ...head };
  // the edit op re-wires graph POSITION; drop the standalone values. A container's
  // next[] is not position — it's the branch wiring, and it stays.
  delete entry.order; delete entry.parentKey; delete entry.parent;
  if (!isContainer) delete entry.next;
  if (!isContainer && tpls.length !== 1)
    throw new Error(`edit-add: '${node.type}' compiled to ${tpls.length} templates but its entry has no branch array — unsupported shape`);
  return { entry, templates: [entry, ...tpls.filter((t) => t.id !== head.id)], isContainer, refMap: out._refMap };
}

// Back-compat: compile a step known to be LINEAR. Container types now have a real path
// (compileSubgraph + the subgraph splices), so reaching this with one is a caller bug.
export function compileStep(node, ctx) {
  const sub = compileSubgraph(node, ctx);
  if (sub.isContainer)
    throw new Error(`compileStep: '${node.type}' is a container — use compileSubgraph() and a subgraph splice`);
  return sub.entry;
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
// The required argument keys per op. Without this, a wrong key was not caught at the op
// layer at all: `{op:'appendStep', node:{...}}` — `node` being the obvious guess for what
// a step is called — sailed through the tool's passthrough schema and died deep inside
// compileSubgraph as `Cannot read properties of undefined (reading 'kind')`, which names
// neither the op nor the key. Cost real time live on AU 2026-07-25.
const OP_REQUIRED_ARGS = {
  addStepNote: ['stepId', 'text'], duplicateStep: ['stepId'], replaceTag: ['oldTag', 'newTag'],
  appendStep: ['step'],
  insertAfter: ['step', 'afterId'],
  insertBefore: ['step', 'beforeId'],
  appendToBranch: ['step'],   // the ANCHOR is one of three shapes — checked below
  deleteStep: ['stepId'],
  modifyStep: ['stepId'],
  retypeStep: ['stepId', 'step'],
  renameStep: ['stepId', 'name'],
  setStepDisabled: ['stepId'],
  disableStepsByType: ['type'],
  moveStep: ['stepId', 'afterId'],
  addBranch: ['containerId'],
  deleteContainer: ['containerId'],
  repairParentKeys: [],
};

// Keys people reach for that mean something else here. `node` is by far the common one:
// the IR calls these things nodes everywhere EXCEPT the edit ops, which call them steps.
const OP_ARG_ALIASES = {
  node: 'step', newStep: 'step', action: 'step',
  id: 'stepId', targetId: 'stepId', afterStepId: 'afterId', beforeStepId: 'beforeId',
  branchId: 'branchEntryId', container: 'containerId',
  newName: 'name', stepName: 'name', label: 'name', title: 'name',
};

export function checkOpShape(op) {
  const required = OP_REQUIRED_ARGS[op?.op];
  if (!required) return;   // unknown ops fall through to the dispatch default
  // appendToBranch takes ONE of three anchors, so it cannot be expressed as a required-key list.
  if (op.op === 'appendToBranch' && !op.branchEntryId && !op.branchRef && !(op.containerId && op.branch)) {
    // Keep the alias coaching: `branchEntryId` left OP_REQUIRED_ARGS when the anchor became a
    // choice of three, which silently switched off the "you passed 'branchId'" suggestion.
    const aliased = Object.keys(op).find((k) => OP_ARG_ALIASES[k] === 'branchEntryId');
    throw new Error(
      (aliased ? `you passed '${aliased}' — this op takes 'branchEntryId'. ` : '')
      + `edit op 'appendToBranch' needs ONE anchor: branchEntryId (a branch entry id), branchRef (a `
      + `branch ref authored earlier in this call), or containerId + branch (display name, `
      + `__branchKey__, or id).`);
  }
  const missing = required.filter((k) => op[k] === undefined);
  if (!missing.length) return;
  const suggestions = missing
    .map((want) => {
      const wrong = Object.keys(op).find((k) => OP_ARG_ALIASES[k] === want);
      return wrong ? `you passed '${wrong}' — this op takes '${want}'` : null;
    })
    .filter(Boolean);
  throw new Error(
    `edit op '${op.op}' is missing required argument(s) [${missing.join(', ')}]`
    + (suggestions.length ? ` — ${suggestions.join('; ')}` : '')
    + `. '${op.op}' takes: ${required.join(', ')}.`);
}

const requireStepFor = (templates, id, op) => {
  const hit = (templates ?? []).find((t) => t.id === id);
  if (!hit) throw new Error(`${op}: no step with id '${id}'`);
  return hit;
};

export function applyOp(templates, op, { ctx, idGen }) {
  checkOpShape(op);
  switch (op.op) {
    // The three add ops each take EITHER a linear step or a container subgraph; the
    // compile decides which, so callers write the same op either way.
    case 'appendStep': {
      const sub = compileSubgraph(op.step, ctx);
      return { ...(sub.isContainer ? appendSubgraph(templates, sub) : appendStep(templates, sub.entry)), refMap: sub.refMap };
    }
    case 'insertAfter': {
      const sub = compileSubgraph(op.step, ctx);
      return { ...(sub.isContainer
        ? insertSubgraphAfter(templates, sub, op.afterId, op.attachTailTo)
        : insertAfter(templates, sub.entry, op.afterId)), refMap: sub.refMap };
    }
    case 'insertBefore': {
      const sub = compileSubgraph(op.step, ctx);
      return { ...(sub.isContainer
        ? insertSubgraphBefore(templates, sub, op.beforeId, op.attachTailTo)
        : insertBefore(templates, sub.entry, op.beforeId)), refMap: sub.refMap };
    }
    case 'appendToBranch': {
      const sub = compileSubgraph(op.step, ctx);
      // Three anchors, one resolution: a branch entry id; a branch REF authored earlier in this
      // same call (folded into externalRefs.byName by externalRefsOf); or the container plus the
      // branch's display name / __branchKey__ / id, resolved by the same resolveBranchTarget the
      // insert splices use — so a wrong name lists the real options instead of failing blankly.
      let anchorId = op.branchEntryId;
      if (!anchorId && op.branchRef) {
        anchorId = ctx.externalRefs?.byName?.get(op.branchRef) ?? null;
        if (!anchorId)
          throw new Error(`appendToBranch: branchRef '${op.branchRef}' was not authored by an earlier op in this call`);
      }
      if (!anchorId) {
        const container = requireStepFor(templates, op.containerId, 'appendToBranch');
        anchorId = resolveBranchTarget(container, templates, op.branch, 'appendToBranch').id;
      }
      return { ...(sub.isContainer
        ? appendSubgraphToBranch(templates, anchorId, sub)
        : appendToBranch(templates, anchorId, sub.entry)), refMap: sub.refMap };
    }
    case 'deleteStep': return deleteStep(templates, op.stepId);
    // Find & Replace, TAG mode (exact on tag arrays / tags-subtype conditions; string replace on customTags)
    case 'replaceTag': return replaceTagInTemplates(templates, op.oldTag, op.newTag);
    // Action NOTES (node ⋯ → Notes): unshift {id, userId, timestamp, comment:HTML} onto step.comments[]
    case 'addStepNote': return addStepNote(templates, op.stepId, op.text, { uid: ctx?.uid, now: ctx?.now, idGen });
    // "Copy action" + "Copy here": a fresh-id copy right after the source (or op.afterId); containers/goals/loops/gotos refused
    case 'duplicateStep': return duplicateStep(templates, op.stepId, idGen, { afterId: op.afterId });
    case 'repairParentKeys': { const { templates: t, diff } = repairParentKeys(templates); return { templates: t, diff }; }
    // `stepPatch` is the TOP-LEVEL merge (name lives beside attributes, not inside it);
    // it refuses graph fields — see PROTECTED_STEP_FIELDS.
    case 'modifyStep': return modifyStep(templates, op.stepId, op.attrPatch ?? {}, op.stepPatch, ctx);
    // A retype REPLACES the step's whole attribute set, so `step.attributes` is
    // MANDATORY — that requirement is the entire reason this is its own op rather than a
    // hole in modifyStep's PROTECTED_STEP_FIELDS. Absent is refused; an explicit `{}` is
    // allowed, because "this type takes no attributes" is a real, deliberate answer.
    case 'retypeStep': {
      if (op.step?.attributes === undefined)
        throw new Error(`retypeStep: '${op.stepId}' needs a full 'attributes' object on 'step'. `
          + `A retype REPLACES attributes, never merges them — without one the new type would `
          + `inherit the old type's keys (an sms 'body' stranded beside a whatsapp 'message'). `
          + `Pass the complete attribute set for '${op.step?.type ?? '?'}', or {} if it takes none.`);
      const sub = compileSubgraph(op.step, ctx);
      if (sub.isContainer)
        throw new Error(`retypeStep: '${op.step.type}' is a container — it compiles to a whole `
          + `subgraph (entry + branch entries), which cannot replace a single step in place. `
          + `Use deleteStep plus one of the subgraph splices.`);
      return { ...retypeStep(templates, op.stepId, sub.entry), refMap: sub.refMap };
    }
    case 'renameStep': return renameStep(templates, op.stepId, op.name);
    case 'setStepDisabled': return setStepDisabled(templates, op.stepId, op.disabled);
    case 'disableStepsByType': return disableStepsByType(templates, op.type, op.disabled);
    case 'moveStep': return moveStep(templates, op.stepId, op.afterId);
    case 'addBranch': return addBranch(templates, op.containerId, { name: op.name, conditions: op.conditions ?? [] }, idGen);
    case 'deleteContainer': return deleteContainer(templates, op.containerId);
    default:
      if (TRIGGER_OPS.has(op.op))
        throw new Error(`'${op.op}' is a TRIGGER op — it edits a separate document, not workflowData.templates. Route it through partitionOps()/planTriggerOps().`);
      if (SETTINGS_OPS.has(op.op))
        throw new Error(`'${op.op}' is a SETTINGS op — it edits the workflow document's top level, not workflowData.templates. Route it through partitionOps()/mergeSettingsOps() → editCommitBody({ settingsPatch }).`);
      if (STICKY_OPS.has(op.op))
        throw new Error(`'${op.op}' is a STICKY-NOTE op — sticky notes are a separate resource (/workflows/sticky-note), not workflowData.templates. Route it through partitionOps()/planStickyNoteOp().`);
      throw new Error(`unknown edit op: ${JSON.stringify(op.op)}`);
  }
}

// Apply an ordered list of ops, threading templates and merging diffs.
export function applyOps(templates, ops, { ctx, idGen }) {
  let tpls = templates;
  let diff = empty();
  // refs authored by EARLIER ops in this call -> the ids they minted, so op 2 can target op 1.
  const opRefs = new Map();
  for (const op of ops ?? []) {
    const opCtx = { ...ctx, externalRefs: externalRefsOf(tpls, opRefs) };
    const r = applyOp(tpls, op, { ctx: opCtx, idGen });
    tpls = r.templates;
    diff = mergeDiff(diff, r.diff);
    // Record only refs this op actually MINTED — the seeded live ids/names map to themselves
    // and re-recording them would let a live name shadow a later authored ref.
    for (const [ref, id] of r.refMap ?? []) {
      if (opCtx.externalRefs.ids.has(id) && opCtx.externalRefs.byName.get(ref) === id) continue;
      if (opCtx.externalRefs.ids.has(ref) && ref === id) continue;
      opRefs.set(ref, id);
    }
  }
  const norm = normalizeDiff(diff);
  // A marketplace step's `stepIndex` is a per-action-key occurrence counter over the WHOLE
  // workflow, and the builder renders it as the canvas `#N` prefix. Each op compiles its
  // step standalone, so every added/retyped marketplace step arrives numbered `1` — it can
  // only be numbered correctly once all the ops have landed and the final step order is
  // known. Renumber here, at the one choke point both callers (the MCP tool and the edit
  // CLI) share, rather than in either of them.
  //
  // Gated on this edit having TOUCHED a marketplace step: a purely native edit — even on a
  // workflow that happens to contain marketplace steps elsewhere — leaves their numbering
  // exactly as stored.
  const touched = new Set([...norm.createdSteps, ...norm.modifiedSteps]);
  if (tpls.some((t) => t?.isMarketplaceAction === true && touched.has(t.id))) {
    const renumbered = assignMarketplaceStepIndexes(tpls);
    tpls = renumbered.templates;
    if (renumbered.changed.length)
      norm.modifiedSteps = [...new Set([...norm.modifiedSteps, ...renumbered.changed])];
  }
  return { templates: tpls, diff: norm, opRefs };
}
