// Deterministic compiler: IR -> GHL builder-API payloads (create/auto-save/trigger).
// See docs/superpowers/specs/2026-07-10-create-ghl-workflow-v2-design.md §5.
import { parseIR, IRError, checkOpportunityAssociation } from './ir.mjs';

function attributesFor(node, ctx) {
  if (node.kind === 'wait') return waitAttributes(node);
  if (node.type === 'email') return emailAttributes(node);
  if (node.type === 'custom_webhook') return webhookAttributes(node.attributes ?? {});
  if (node.type === 'custom_code') return codeAttributes(node.attributes ?? {});
  if (node.type === 'voice_ai_outbound_call') return voiceAiOutboundCallAttributes(node.attributes ?? {});
  if (node.type === 'create_opportunity') return createOpportunityAttributes(node.attributes ?? {});
  if (node.type === 'update_opportunity') return updateOpportunityAttributes(node.attributes ?? {});
  // Generic path: the author supplies intent attributes; the compiler fills the
  // two structural fields the corpus shows on this type but a human never hand-writes:
  //   - attributes.type  (mirrors the step type — present on ~all linear action types)
  //   - __customInputs__  (the internal-action field envelope — present on INTERNAL types)
  // Both are catalog-gated so we never inject a field the verified-live example lacks.
  return normalizeAttrs(node, node.attributes ?? {}, ctx);
}

// Fill structural attribute fields from the catalog's verified-live shape. Only
// touches fields the real persisted example carried, so a bare intent authoring
// (e.g. { points: 5, operator: 'add' } for contact_engagement_score) round-trips
// into the exact stored shape without the author knowing the envelope.
function normalizeAttrs(node, attrs, ctx) {
  const meta = ctx?.catalog?.step(node.type);
  if (!meta) return attrs;
  const out = { ...attrs };
  if (meta.usesCustomInputs && !('__customInputs__' in out)) out.__customInputs__ = {};
  if (Array.isArray(meta.attrKeys) && meta.attrKeys.includes('type') && !('type' in out)) {
    // internal_notification's attributes.type is the CHANNEL, not the step type —
    // derive it from whichever channel envelope the author supplied.
    out.type = node.type === 'internal_notification'
      ? (['sms', 'email', 'notification', 'whatsapp'].find((c) => c in out) ?? node.type)
      : node.type;
  }
  checkAttrKeys(node, out, meta);
  return out;
}

// Attribute keys the compiler/orchestrator/resolver own, plus the documented
// name-authoring intent keys (the resolver adds the resolved id but keeps the name).
const ENGINE_ATTR_KEYS = new Set(['type', '__customInputs__', '__customInputFields__', '_template',
  'user', 'calendar', 'agent', 'employee', 'assignedEmployeeId', 'pipeline', 'stage']);

// An invented attribute key (e.g. `message` instead of `body` on sms) saves fine
// but renders a blank step at runtime — fail at compile instead. Enforced only
// where the catalog carries a verified-live example whose key set we trust;
// bundle-derived/marketplace shapes are too loosely known to fail closed on.
function checkAttrKeys(node, out, meta) {
  if (meta.confidence !== 'verified-live' || !Array.isArray(meta.attrKeys) || meta.attrKeys.length === 0) return;
  const known = new Set([...meta.attrKeys, ...(meta.requiredFields ?? []).map((k) => k.split('.')[0]), ...ENGINE_ATTR_KEYS]);
  const bad = Object.keys(out).filter((k) => !known.has(k));
  if (bad.length)
    throw new IRError('ATTR_KEY',
      `unknown attribute key(s) [${bad.join(', ')}] on '${node.ref}' (${node.type}) — ` +
      `known keys for this type: ${meta.attrKeys.join(', ')}. An invented key saves but renders a blank step; ` +
      `check the corpus example (${meta.example ?? 'catalog'}) for the real shape.`);
}

// Opportunity actions store their fields in a __customInputFields__ array
// (live-verified shape). Each field = {filterField, value, dataType, valueFieldType, __customInputs__}.
// The IR supplies resolved pipelineId + stageId (the orchestrator resolves names→ids via the
// pipelines list, like tags/templates).
function oppField(filterField, value, dataType, valueFieldType) {
  return { __customInputs__: {}, dataType, filterField, value, valueFieldType };
}
function createOpportunityAttributes(a) {
  const f = [];
  if (a.name != null) f.push(oppField('name', a.name, 'TEXT', 'string'));
  if (a.stageId != null) f.push(oppField('pipelineStageId', a.stageId, 'SINGLE_OPTIONS', 'select'));
  f.push(oppField('status', a.status ?? 'open', 'SINGLE_OPTIONS', 'select'));
  if (a.source != null) f.push(oppField('source', a.source, 'TEXT', 'string'));
  if (a.value != null) f.push(oppField('monetaryValue', String(a.value), 'NUMERICAL', 'number'));
  return { pipelineId: a.pipelineId, type: 'internal_create_opportunity', __customInputFields__: f, __customInputs__: {} };
}
function updateOpportunityAttributes(a) {
  // a.updates: [{ field, value, dataType?, valueFieldType? }]
  const f = (a.updates ?? []).map((u) => oppField(u.field, u.value, u.dataType ?? 'SINGLE_OPTIONS', u.valueFieldType ?? 'select'));
  return { allowBackward: a.allowBackward ?? false, type: 'internal_update_opportunity', __customInputFields__: f, __customInputs__: {} };
}

// voice_ai_outbound_call — places an outbound call from a configured Voice AI agent
// (live-verified 2026-07-11). `agentId` (the Voice AI agent record id) and
// `fromPhoneNumber` (the literal E.164 number string — NOT a number-pool/id reference)
// are both required in the captured schema (`required: true` on both dynamic-fields
// entries) — a step saved without them is broken, so we fail fast at compile time.
// `outboundGuidelines` is a frozen, non-interactive info-banner field; the builder
// always emits it empty on save. `__customInputs__` is an empty placeholder, unused.
function voiceAiOutboundCallAttributes(a) {
  if (!a.agentId) throw new IRError('MISSING_FIELD', "voice_ai_outbound_call requires 'agentId'");
  if (!a.fromPhoneNumber) throw new IRError('MISSING_FIELD', "voice_ai_outbound_call requires 'fromPhoneNumber'");
  return {
    agentId: a.agentId,
    fromPhoneNumber: a.fromPhoneNumber,
    outboundGuidelines: '',
    type: 'voice_ai_outbound_call',
    __customInputs__: {},
  };
}

// custom_webhook (outbound HTTP) — live-verified shape. body.rawData is a JSON STRING;
// headers/parameters are arrays of {key,value}; authorization is a {type,data} union.
function webhookAttributes(a) {
  return {
    event: a.event ?? 'CUSTOM',
    method: a.method ?? 'POST',
    url: a.url ?? '',
    body: a.body ?? { contentType: 'application/json', rawData: a.rawData ?? '{}', keyValueData: [] },
    headers: a.headers ?? [],
    parameters: a.parameters ?? [],
    authorization: a.authorization ?? { type: 'NONE', data: null },
    saveResponse: a.saveResponse ?? false,
    webhookResponse: a.webhookResponse ?? { isSampleRequested: false, selectedContact: '' },
  };
}

// custom_code (JS sandbox) — `code` is a function body; `inputData` is a flat object
// {key:value}; `output` is a REQUIRED hand-populated sample of the return value (publish
// blocks on empty output). Sandbox HTTP uses customRequest.*, not fetch.
function codeAttributes(a) {
  return {
    code: a.code ?? 'return {};',
    language: a.language ?? 'javascript',
    inputData: a.inputData ?? {},
    output: a.output ?? {},
  };
}

// wait — 9 subtypes discriminated by attributes.type. This builds LINEAR waits
// (single next). Multipath waits (timeout branching) are handled in flattenGraph.
function waitAttributes(node) {
  const a = node.attributes ?? {};
  const hybrid = { cat: '', isHybridAction: true, hybridActionType: 'wait', convertToMultipath: false, transitions: [] };
  const wt = node.waitType ?? (node.config ? 'time' : (a.type ?? 'time'));
  if (wt === 'time') {
    const c = node.config ?? {};
    const base = { type: 'time', startAfter: { type: c.unit, value: c.value, when: c.when }, ...hybrid };
    // "Advance window" — resume-on days + resume-between-hours (live-verified shape)
    if (node.window) {
      const w = node.window;
      base.window = w.condition === 'exact'
        ? { condition: 'exact', days: w.days ?? [], start: w.start }
        : { condition: 'when', days: w.days ?? [0, 1, 2, 3, 4, 5, 6], start: w.start, end: w.end };
      base.windowCondition = { field: '', operator: '', value: '' };
    }
    return base;
  }
  // other subtypes (appointment, email_event, link_clicked, condition, ...): the IR supplies
  // the subtype-specific fields in node.attributes; we set type + hybrid flags.
  return { type: wt, ...a, ...hybrid };
}

// Email attributes — fills the fields the builder requires (live-verified 2026-07-10:
// a bare {subject,html} email shows an error until these are present). Handles both the
// inline-HTML path and the template path. For template mode the `template_id` must already
// exist (created via POST /emails/builder by the orchestrator) — a non-existent id errors.
function emailAttributes(node) {
  const a = node.attributes ?? {};
  const base = {
    trackingOptions: a.trackingOptions ?? { hasTrackingLinks: true, hasUtmTracking: true, hasTags: false },
    conditions: a.conditions ?? [],
    subject: a.subject ?? '',
    preHeader: a.preHeader ?? '',
    from_name: a.from_name ?? '{{location.name}}',
    from_email: a.from_email ?? '{{location.email}}',
    templateCreationMode: a.templateCreationMode ?? 'existing',
    syncEnabled: a.syncEnabled ?? false,
    attachments: a.attachments ?? [],
    fieldDefaults: a.fieldDefaults ?? { subject: {} },
  };
  if (a.template_id) {
    // template path: html lives in the template, not the step
    base.template_id = a.template_id;
    base.templatesource = a.templatesource ?? 'email-builder';
  } else {
    // inline path: NO template_id key (a literal "none" errors); html on the step
    base.html = a.html ?? '';
    base.htmlDefaults = a.htmlDefaults ?? {};
  }
  return base;
}

function typeFor(node) {
  if (node.kind === 'wait') return 'wait';
  if (node.type === 'create_opportunity') return 'internal_create_opportunity';
  if (node.type === 'update_opportunity') return 'internal_update_opportunity';
  return node.type; // action / raw
}

// Flatten a linear scope into template objects, wiring next/parentKey/order.
// parentScopeId: the id set as `parent` for nodes in this scope (null at root).
// Returns { templates, entryId }.
export function flattenGraph(nodes, ctx, refMap, parentScopeId = null) {
  const templates = [];
  const ids = nodes.map((n) => {
    if (!refMap.has(n.ref)) refMap.set(n.ref, ctx.idGen());
    return refMap.get(n.ref);
  });
  nodes.forEach((n, i) => {
    const id = ids[i];
    const next = i < nodes.length - 1 ? ids[i + 1] : null;
    const parentKey = i > 0 ? ids[i - 1] : (parentScopeId ?? null);

    if (n.kind === 'if_else') {
      const branchIds = n.branches.map((b) => {
        if (!refMap.has(b.ref)) refMap.set(b.ref, ctx.idGen());
        return refMap.get(b.ref);
      });
      // Container shape mirrors a real live container (harvested 2026-07-10):
      // the builder's node label comes from `attributes.conditionName` — without it
      // the node renders "undefined". The container carries cat/comments (not parent/sibling).
      const elseBranch = n.branches.find((b) => b.else === true);
      templates.push({
        id, type: 'if_else', name: n.name, order: i,
        parentKey, next: branchIds, nodeType: 'condition-node',
        cat: '', comments: [],
        attributes: {
          branches: n.branches.map((b, bi) => ({
            id: branchIds[bi], name: b.name, operator: 'and',
            segments: (b.conditions && b.conditions.length)
              ? [{ operator: 'and', conditions: b.conditions }] : [],
            showErrors: false, branchNameError: 'Branch name cannot be empty!',
          })),
          currentRecipeType: 'CUSTOM',
          conditionName: n.name,        // <- the builder's display label
          if: true,
          operator: 'and',
          noneBranchName: elseBranch?.name ?? 'No',
        },
      });
      n.branches.forEach((b, bi) => {
        const child = flattenGraph(b.then ?? [], ctx, refMap, branchIds[bi]);
        templates.push({
          id: branchIds[bi], type: 'if_else', name: b.name, order: bi,
          parent: id, parentKey: id, cat: '', comments: [],
          sibling: branchIds.filter((x) => x !== branchIds[bi]),
          nodeType: b.else === true ? 'branch-no' : 'branch-yes',
          attributes: {},
          next: child.entryId,
        });
        templates.push(...child.templates);
      });
      return;
    }

    // Multipath wait (reply/condition/email_event/link_clicked WITH a timeout) — a 2-path
    // container mirroring if_else: next=[primaryTransition, timeoutTransition], plus separate
    // type:"transition" entry steps that children hang off. Live-verified shape 2026-07-10.
    if (n.kind === 'wait' && (n.onEvent || n.onTimeout)) {
      const wt = n.waitType ?? 'reply';
      const t1 = ctx.idGen(), t2 = ctx.idGen();
      const eventDesc = n.reply?.labels?.length ? `What will happen when a contact replies on ${n.reply.labels.join(', ')}` : 'What will happen when the event fires';
      const timeoutDesc = n.timeout ? `What will happen after ${n.timeout.value} ${n.timeout.unit}` : 'What will happen on timeout';
      const startAfter = n.timeout ? { type: n.timeout.unit, value: n.timeout.value, when: n.timeout.when ?? 'after' } : undefined;
      // subtype-specific fields (reply references prior step ids — resolve via refMap)
      let subtype = {};
      if (wt === 'reply') {
        const replyIds = (n.reply?.steps ?? []).map((r) => { if (!refMap.has(r)) refMap.set(r, ctx.idGen()); return refMap.get(r); });
        subtype = { reply: replyIds, replyLabel: n.reply?.labels ?? [] };
      } else {
        subtype = { ...(n.attributes ?? {}) };
      }
      const mkTrans = (tid, name, cond, primary, desc) => ({ id: tid, name, condition: cond, conditionType: 'user-defined', isPrimaryBranch: primary, description: '', attributes: { type: primary ? `wait_${wt}` : 'wait_timeout', description: desc } });
      const container = {
        id, type: 'wait', name: n.name, order: i, parentKey, next: [t1, t2], cat: 'multi-path',
        attributes: {
          type: wt, ...(startAfter ? { startAfter } : {}), ...subtype, name: n.name, cat: 'multi-path',
          timePeriodInputMode: 'standard', unitInputMode: 'standard',
          isHybridAction: true, hybridActionType: 'wait', convertToMultipath: true,
          transitions: [mkTrans(t1, 'wait', 'primary', true, eventDesc), mkTrans(t2, 'timeout', 'timeout', false, timeoutDesc)],
        },
      };
      if (parentScopeId !== null) container.parent = parentScopeId;
      templates.push(container);
      const prim = flattenGraph(n.onEvent ?? [], ctx, refMap, t1);
      templates.push({ id: t1, parentKey: id, parent: id, type: 'transition', name: 'wait', attributes: { type: `wait_${wt}`, description: eventDesc }, order: 0, cat: 'transition', next: prim.entryId });
      templates.push(...prim.templates);
      const tout = flattenGraph(n.onTimeout ?? [], ctx, refMap, t2);
      templates.push({ id: t2, parentKey: id, parent: id, type: 'transition', name: 'timeout', attributes: { type: 'wait_timeout', description: timeoutDesc }, order: 1, cat: 'transition', next: tout.entryId });
      templates.push(...tout.templates);
      return;
    }

    // find_opportunity — multipath container with PRE-DEFINED Found/Not-Found branches
    // (live-verified). Same transition-step mechanics as the multipath wait.
    if (n.type === 'find_opportunity' && (n.onFound || n.onNotFound)) {
      const t1 = ctx.idGen(), t2 = ctx.idGen();
      const fields = (n.find?.filters ?? []).map((f) => ({ __customInputs__: {}, filterField: f.field, value: f.operator ?? 'eq', secondValue: f.value }));
      const container = {
        id, type: 'find_opportunity', name: n.name, order: i, parentKey, cat: 'multi-path',
        workflowsActionType: 'INTERNAL', next: [t1, t2],
        attributes: {
          sorting: n.find?.sorting ?? 'latest', type: 'find_opportunity',
          __customInputFields__: fields, __customInputs__: {}, cat: 'multi-path', convertToMultipath: true,
          transitions: [
            { id: t1, name: 'Opportunity Found', fields: [], meta: { __branchKey__: 'predefined_Opportunity Found' }, conditionType: 'pre-defined' },
            { id: t2, name: 'Opportunity Not Found', fields: [], meta: { __branchKey__: 'predefined_Opportunity Not Found' }, conditionType: 'pre-defined' },
          ],
          __name__: n.name,
        },
      };
      if (parentScopeId !== null) container.parent = parentScopeId;
      templates.push(container);
      const found = flattenGraph(n.onFound ?? [], ctx, refMap, t1);
      templates.push({ id: t1, type: 'transition', name: 'Opportunity Found', cat: 'transition', parentKey: id, parent: id, order: 0, attributes: {}, next: found.entryId });
      templates.push(...found.templates);
      const notf = flattenGraph(n.onNotFound ?? [], ctx, refMap, t2);
      templates.push({ id: t2, type: 'transition', name: 'Opportunity Not Found', cat: 'transition', parentKey: id, parent: id, order: 1, attributes: {}, next: notf.entryId });
      templates.push(...notf.templates);
      return;
    }

    if (n.kind === 'goto') {
      // Resolve the target id (forward refs legal — pre-assign if not seen yet;
      // the target node reuses this id when its own scope is walked).
      if (!refMap.has(n.target)) refMap.set(n.target, ctx.idGen());
      const tmpl = {
        id, type: 'goto', name: n.name ?? 'Go To', order: i,
        attributes: { targetNodeId: refMap.get(n.target), type: 'goto' },
        next: null, parentKey,
      };
      if (parentScopeId !== null) tmpl.parent = parentScopeId;
      templates.push(tmpl);
      return;
    }

    // workflow_split — random/weighted A/B/N-way split (live-verified shape mirrors
    // catalog/step-examples/workflow_split.json). Each path gets a `transition` entry
    // step (conditionType:"default") that its children hang off. Weights live in
    // extras.weightDistribution (a `random` split with no weights defaults to even).
    if (n.kind === 'split') {
      const pathIds = n.paths.map(() => ctx.idGen());
      const weighted = n.mode === 'weighted' || n.mode === 'random';
      const even = Math.round(100 / n.paths.length);
      const weightDistribution = {};
      n.paths.forEach((p, pi) => { weightDistribution[pathIds[pi]] = weighted ? (p.weight ?? even) : even; });
      const container = {
        id, type: 'workflow_split', name: n.name ?? 'Split', order: i, parentKey, cat: 'multi-path', next: pathIds,
        attributes: {
          name: n.name ?? 'Split', cat: 'multi-path', type: 'workflow_split',
          transitions: n.paths.map((p, pi) => ({
            id: pathIds[pi], name: p.name ?? `Path ${String.fromCharCode(65 + pi)}`,
            condition: p.name ?? `Path ${String.fromCharCode(65 + pi)}`,
            conditionType: 'default', isPrimaryBranch: false, description: '', attributes: {},
          })),
          paths: n.paths.map((p, pi) => ({ name: p.name ?? `Path ${String.fromCharCode(65 + pi)}`, id: pathIds[pi] })),
          condition: n.condition ?? 'random-split',
          extras: { weightDistribution },
        },
      };
      if (parentScopeId !== null) container.parent = parentScopeId;
      templates.push(container);
      n.paths.forEach((p, pi) => {
        const child = flattenGraph(p.then ?? [], ctx, refMap, pathIds[pi]);
        templates.push({ id: pathIds[pi], type: 'transition', name: p.name ?? `Path ${String.fromCharCode(65 + pi)}`,
          cat: 'transition', parentKey: id, parent: id, order: pi, attributes: {}, next: child.entryId });
        templates.push(...child.templates);
      });
      return;
    }

    // Pre-set 2-branch finder containers: find_contact (user-defined Found/Not-Found),
    // lc_merge_contact (pre-defined Duplicate Found/Not-Found). Same transition-step
    // mechanics as find_opportunity; shapes mirror the verified-live corpus examples.
    if ((n.type === 'find_contact' || n.type === 'lc_merge_contact') && (n.onFound || n.onNotFound)) {
      const t1 = ctx.idGen(), t2 = ctx.idGen();
      const isFC = n.type === 'find_contact';
      const container = {
        id, type: n.type, name: n.name ?? (isFC ? 'Find Contact' : 'Merge Contact'), order: i, parentKey, cat: 'multi-path', next: [t1, t2],
        attributes: isFC ? {
          type: 'find_contact', fields: n.find?.fields ?? [], convertToMultipath: true,
          name: n.name ?? 'Find Contact', cat: 'multi-path', isHybridAction: true, hybridActionType: 'find_contact',
          transitions: [
            { id: t1, name: 'Contact Found', condition: 'contact_found', conditionType: 'user-defined', isPrimaryBranch: true, description: '', attributes: { type: 'contact_found', description: 'Contact Found', cat: 'multi-path' } },
            { id: t2, name: 'Contact Not Found', condition: 'contact_not_found', conditionType: 'user-defined', isPrimaryBranch: false, description: '', attributes: { type: 'contact_not_found', description: 'Contact Not Found' } },
          ],
        } : {
          match_by: n.match_by ?? 'email', type: 'lc_merge_contact', __customInputs__: {}, cat: 'multi-path', convertToMultipath: true,
          transitions: [
            { id: t1, name: 'Duplicate Contact Found', fields: {}, meta: { __branchKey__: ctx.idGen() }, conditionType: 'pre-defined' },
            { id: t2, name: 'Duplicate Contact Not Found', fields: {}, meta: { __branchKey__: ctx.idGen() }, conditionType: 'pre-defined' },
          ],
          __name__: n.name ?? `Merge Contact by ${n.match_by ?? 'email'}`,
        },
      };
      if (!isFC) container.workflowsActionType = 'INTERNAL';
      if (parentScopeId !== null) container.parent = parentScopeId;
      templates.push(container);
      const found = flattenGraph(n.onFound ?? [], ctx, refMap, t1);
      templates.push({ id: t1, type: 'transition', name: container.attributes.transitions[0].name, cat: 'transition', parentKey: id, parent: id, order: 0, attributes: {}, next: found.entryId });
      templates.push(...found.templates);
      const notf = flattenGraph(n.onNotFound ?? [], ctx, refMap, t2);
      templates.push({ id: t2, type: 'transition', name: container.attributes.transitions[1].name, cat: 'transition', parentKey: id, parent: id, order: 1, attributes: {}, next: notf.entryId });
      templates.push(...notf.templates);
      return;
    }

    // AI decision-maker / ConvAI splitter — N author-defined branches routed by an LLM,
    // plus an always-present pre-defined Default Branch (first). Mirrors the verified-live
    // workflow_ai_decision_maker corpus shape. Author supplies branches[{name,description,then}].
    if (n.kind === 'ai_decision') {
      const type = n.type ?? 'workflow_ai_decision_maker';
      const defId = ctx.idGen();
      const branchIds = n.branches.map(() => ctx.idGen());
      const transitions = [
        { id: defId, name: 'Default Branch', fields: { description: 'Go in this branch if none of the other branches make sense.', branchKey: 'none' }, meta: { __branchKey__: 'predefined_Default Branch' }, conditionType: 'pre-defined' },
        ...n.branches.map((b, bi) => ({
          id: branchIds[bi], name: b.name,
          fields: { description: b.description ?? '', branchKey: b.branchKey ?? `branch_${bi}` },
          meta: { __branchKey__: ctx.idGen() }, conditionType: 'user-defined',
        })),
      ];
      const container = {
        id, type, name: n.name ?? 'Workflow AI - Decision Maker', order: i, parentKey, cat: 'multi-path',
        workflowsActionType: 'INTERNAL', next: [defId, ...branchIds],
        attributes: {
          instructions: n.instructions ?? '', information: n.information ?? '',
          type, __customInputs__: {}, cat: 'multi-path', convertToMultipath: true,
          transitions, __name__: n.name ?? 'Workflow AI - Decision Maker',
        },
      };
      if (parentScopeId !== null) container.parent = parentScopeId;
      templates.push(container);
      // Default branch tail (optional) + each author branch
      const def = flattenGraph(n.default ?? [], ctx, refMap, defId);
      templates.push({ id: defId, type: 'transition', name: 'Default Branch', cat: 'transition', parentKey: id, parent: id, order: 0, attributes: {}, next: def.entryId });
      templates.push(...def.templates);
      n.branches.forEach((b, bi) => {
        const child = flattenGraph(b.then ?? [], ctx, refMap, branchIds[bi]);
        templates.push({ id: branchIds[bi], type: 'transition', name: b.name, cat: 'transition', parentKey: id, parent: id, order: bi + 1, attributes: {}, next: child.entryId });
        templates.push(...child.templates);
      });
      return;
    }

    // Root-scope linear steps stay lean; steps inside a branch carry `parent`
    // (= the branch-entry id) while `parentKey` advances along the chain.
    const tmpl = { id, type: typeFor(n), name: n.name, order: i, attributes: attributesFor(n, ctx), next, parentKey };
    if (parentScopeId !== null) tmpl.parent = parentScopeId;
    templates.push(tmpl);
  });
  return { templates, entryId: ids[0] ?? null };
}

export function casingLint({ triggerBodies, autoSaveBody }) {
  for (const tb of triggerBodies ?? []) {
    if ('workflow_id' in tb) throw new IRError('CASING', 'trigger root must use camelCase workflowId, not workflow_id');
    if (!('workflowId' in tb)) throw new IRError('CASING', 'trigger missing camelCase workflowId');
    for (const k of ['location_id', 'company_id']) if (!(k in tb)) throw new IRError('CASING', `trigger missing snake ${k}`);
  }
  if (autoSaveBody && ('location_id' in autoSaveBody || 'company_id' in autoSaveBody))
    throw new IRError('CASING', 'workflow body must use camelCase locationId/companyId');
}

// Operators that take an array value (the compiler wraps a scalar automatically).
const ARRAY_OPS = new Set(['is-any-of', 'is-in-array', 'contains-any', 'contains-none',
  'string-contains-any-of', 'string-matches-any-of', 'index-of-true', 'index-of-false']);
// Default operator by filter-row type when the row/author didn't specify one.
function defaultOp(type) {
  if (type === 'number' || type === 'date') return '==';
  if (type === 'string' || type === 'input') return 'is-any-of';
  return '=='; // select
}

// Expand an authored filter into the full GHL condition shape using the trigger's
// recovered filter model. The author may write a lean intent filter — `{ on, value }`
// (on = a row's id / label / field) or `{ field, value }` — and the compiler fills
// operator/title/type/id from the model row. A fully-specified filter (field+operator+
// title+type) passes through untouched, so hand-authored conditions still work.
function expandFilter(f, rows) {
  if (f.field && f.operator && f.title && f.type) return f; // already complete
  const key = f.on ?? f.field ?? f.id;
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s_-]+/g, '');
  const row = rows.find((r) => r.id === key || r.value === key || r.label === key || norm(r.label) === norm(key) || norm(r.value) === norm(key));
  if (!row) return f; // unknown row — passthrough whatever was given
  const type = f.type ?? row.type ?? 'select';
  let operator = f.operator ?? row.operator ?? defaultOp(type);
  let value = f.value;
  // an array value with a scalar-equality operator means "one of" — upgrade to is-any-of
  // (e.g. form.id, whose recovered row has no operator and defaults to '==')
  if (Array.isArray(value) && operator === '==') operator = 'is-any-of';
  if (ARRAY_OPS.has(operator) && !Array.isArray(value)) value = [value];
  const cond = { field: row.value, operator, value, title: f.title ?? row.label, type };
  if (row.id) cond.id = row.id;
  return cond;
}

function buildTrigger(t, ctx, wid) {
  const meta = ctx.catalog.trigger(t.type);
  const rows = meta?.filterRows ?? [];
  const conditions = (t.filters ?? []).map((f) => (rows.length ? expandFilter(f, rows) : f));
  return {
    status: 'draft', workflowId: wid, schedule_config: {},
    conditions,
    type: t.type, masterType: t.masterType ?? meta?.masterType ?? 'highlevel', name: t.name,
    actions: [{ workflow_id: wid, type: 'add_to_workflow' }],
    active: t.active !== false, triggersChanged: true,
    location_id: ctx.loc, company_id: ctx.cid, company_age: ctx.companyAge,
  };
}

export function compile(ir, ctx) {
  const norm = parseIR(ir);
  // update_opportunity needs an associated opportunity at runtime — enforce the
  // invariant with the catalog-derived set of opportunity-attaching triggers.
  const oppTriggerTypes = new Set(
    ctx.catalog.allTriggers().filter((t) => ctx.catalog.trigger(t)?.category === 'opportunities'));
  checkOpportunityAssociation(norm, oppTriggerTypes);
  const refMap = new Map();
  const { templates } = flattenGraph(norm.graph, ctx, refMap, null);

  // situational injection (catalog-gated); parent/sibling/nodeType already set structurally
  let stepIndex = 0;
  for (const t of templates) {
    const meta = ctx.catalog.step(t.type);
    if (meta && meta.situational?.includes('workflowsActionType') && !('workflowsActionType' in t))
      t.workflowsActionType = 'INTERNAL';
    // premium actions carry a top-level stepIndex (runtime sequence id). Which types
    // carry it is derived from the verified-live corpus (catalog `premium` flag):
    // custom_webhook, custom_code, ai_agent, chatgpt, google_sheets, the *_formatter
    // family, appointment_booking, find_or_create_contact, conversationai_objective.
    if (meta?.premium && !('stepIndex' in t)) t.stepIndex = stepIndex;
    stepIndex += 1;
  }

  const wid = ctx.idGen();
  const sessionId = ctx.idGen();
  const createdSteps = templates.map((t) => t.id);

  const createBody = {
    name: norm.name, status: 'draft', parentId: null, updatedBy: ctx.uid,
    modifiedSteps: [], deletedSteps: [], createdSteps: [], senderAddress: {},
    stopOnResponse: false, allowMultiple: false, allowMultipleOpportunity: true,
    autoMarkAsRead: false, eventStartDate: '', timezone: '',
    workflowData: { templates: [] }, triggersChanged: false,
    company_id: ctx.cid, company_age: ctx.companyAge,
  };

  const autoSaveBody = {
    _id: wid, id: wid, locationId: ctx.loc, companyId: ctx.cid, companyAge: ctx.companyAge,
    name: norm.name, status: 'draft', version: 1, dataVersion: 7, type: 'workflow', parentId: null,
    permission: 380, permissionMeta: { canRead: true, canWrite: true },
    creationSource: 'builder', originType: 'user', isTriggerBucketMigrated: true, deleted: false,
    timezone: norm.settings?.timezone ?? 'account',
    allowMultiple: norm.settings?.allowMultiple ?? false,
    allowMultipleOpportunity: norm.settings?.allowMultipleOpportunity ?? true,
    removeContactFromLastStep: norm.settings?.removeContactFromLastStep ?? true,
    stopOnResponse: norm.settings?.stopOnResponse ?? false,
    autoMarkAsRead: norm.settings?.autoMarkAsRead ?? false,
    scheduledPauseDates: [], senderAddress: norm.settings?.senderAddress ?? {},
    eventStartDate: norm.settings?.eventStartDate ?? '', updatedBy: ctx.uid,
    triggersChanged: false, isAutoSave: true,
    autoSaveSession: { workflowId: wid, id: sessionId, userId: ctx.uid, version: 1 },
    createdSteps, modifiedSteps: [], deletedSteps: [],
    workflowData: { templates },
  };

  const triggerBodies = norm.triggers.map((t) => buildTrigger(t, ctx, wid));
  const result = { createBody, autoSaveBody, triggerBodies, _wid: wid };
  casingLint(result);
  return result;
}
