// W6 item 2: the lifter — a stored workflow document back to the build format, so one format goes out
// (export_workflow {format:'spec'}) and the same format comes back in (build_workflow, repair_workflow {spec}).
//
// A lifted spec is the IR plus `stored` (stored.mjs). The IR names every step, branch, path and lane by its stored
// id; `stored.pins` carries the ids the compiler would otherwise mint for itself and the stored stepIndex counter;
// `stored.residual` carries, per step, what compile(lift(W)) does not reproduce; `stored.frozen` carries the nodes
// the IR cannot express, verbatim. compile(lift(W)) with pinIds then reproduces W step for step.
//
// The inverse of each container handler follows the measured wire→IR mapping (knowledge-side research note
// W6b-lifter-mapping, 326 sample workflows): compile(lift(W)) is a fixpoint on the compiler's own output, but
// reproduces only 37% of UI-built steps byte-for-byte — hence the residual, not a promise that every builder is
// idempotent on UI output.
import { compile } from './compiler.mjs';
import { IRError } from './ir.mjs';
import { diffPaths, elementGuards } from './stored.mjs';
import { normalizeSettings, KNOWN_SETTINGS_KEYS } from './settings.mjs';

// A difference on one of these is identity or graph, never cosmetics: a lifter bug, so the node is frozen instead.
// `parent`/`parentKey` are not here: the runtime walks `next`, and the UI's own parentKey is not always the chain
// predecessor (measured on the samples), so a stored one rides in the residual — restored only while the recompile
// still puts the step in the same place.
export const SEMANTIC_PATH_HEADS = Object.freeze([['id'], ['type'], ['next'], ['nodeType'], ['stepIndex']]);
// On a step (not a lane node): what it does and where it jumps.
const STEP_SEMANTIC_HEADS = [['attributes', 'type'], ['attributes', 'targetNodeId'], ['attributes', 'reply']];
// A frozen head is linked where its placeholder sits; its stored `next` rides in the residual (guarded), so an
// author who moves it wins and an unmoved one comes back as stored.
const WHOLE_ARRAY_SEMANTIC = new Set(['transitions', 'branches', 'paths', 'segments']);
const startsWith = (p, h) => h.length <= p.length && h.every((k, i) => p[i] === k);

function isSemantic(d, s) {
  const { p } = d;
  // A stepIndex the document never stored (absent, or null) is the compiler numbering a step the UI left alone.
  if (p[0] === 'stepIndex' && p.length === 1 && !Number.isInteger(d.t)) return false;
  if (SEMANTIC_PATH_HEADS.some((h) => startsWith(p, h))) return true;
  if (p.at(-1) === 'id') return true;
  const laneNode = s.type === 'transition' || BRANCH_NODE_TYPES.has(s.nodeType);
  if (!laneNode && STEP_SEMANTIC_HEADS.some((h) => startsWith(p, h))) return true;
  return Array.isArray(s.next) && p[0] === 'attributes' && WHOLE_ARRAY_SEMANTIC.has(p.at(-1));
}

const OPP_INV_CREATE = { pipeline_id: 'pipelineId', pipeline_stage_id: 'stageId', opportunity_name: 'name', opportunity_source: 'source',
  opportunity_status: 'status', monetary_value: 'value', allow_backward: 'allowBackward', allow_multiple: 'allowMultiple', lostReasonId: 'lostReasonId' };
const STRICT_INV = { name: 'name', pipelineStageId: 'stageId', status: 'status', lostReasonId: 'lostReasonId', source: 'source',
  monetaryValue: 'value', forecastExpectedCloseDate: 'forecastExpectedCloseDate', forecastProbability: 'forecastProbability' };
const BRANCH_NODE_TYPES = new Set(['branch-yes', 'branch-no']);

class Lossy extends Error {}
const lossy = (why) => { throw new Lossy(why); };

function liftGraph(T, freeze, { catalog, marketplace, stripKeys = new Map() } = {}) {
  const byId = new Map(T.map((t) => [t.id, t]));
  const slots = {};
  const frozen = {};
  const reasons = new Map();
  const owner = new Map();          // stored step id -> the IR node (its stored id) that produces it
  const reached = new Set();
  const reachedLog = [];

  const markOwned = (id, by) => { if (!reached.has(id)) reachedLog.push(id); reached.add(id); owner.set(id, by); };
  const slot2 = (t) => {
    if (!Array.isArray(t.next) || t.next.length !== 2) lossy(`a two-lane container stored with ${t.next?.length ?? 0} lanes`);
    slots[`${t.id}:transition:0`] = t.next[0];
    slots[`${t.id}:transition:1`] = t.next[1];
    branchKeys(t);
  };
  const branchKeys = (t) => {
    for (const tr of t.attributes?.transitions ?? []) {
      const k = tr?.meta?.__branchKey__;
      if (typeof k === 'string' && !k.startsWith('predefined_')) slots[`${tr.id}:branchKey`] = k;
    }
  };
  // w6c-2 (bl-785): a loop's continuation is attributes.exitNext, not its next (its next is the first body step).
  const loopExit = (t) => (typeof t.attributes?.exitNext === 'string' ? t.attributes.exitNext : null);
  const after = (c) => (c.type === 'loop' ? (loopExit(c) ? byId.get(loopExit(c)) ?? null : null)
    : typeof c.next === 'string' ? byId.get(c.next) : null);
  const subtree = (t, by, out) => {
    out.push(t); markOwned(t.id, by);
    if (t.type === 'loop') {   // the body runs from loop.next up to exitNext; the continuation belongs to the caller's chain
      const stop = loopExit(t);
      let c = typeof t.next === 'string' && t.next !== stop ? byId.get(t.next) : null;
      while (c && c.id !== stop && !reached.has(c.id)) {
        subtree(c, by, out);
        if (Array.isArray(c.next)) break;
        c = typeof c.next === 'string' ? byId.get(c.next) : null;
      }
      return;
    }
    if (!Array.isArray(t.next)) return;
    for (const lid of t.next) {
      const lane = byId.get(lid);
      if (!lane || reached.has(lid)) continue;
      out.push(lane); markOwned(lid, by);
      let c = typeof lane.next === 'string' ? byId.get(lane.next) : null;
      while (c && !reached.has(c.id)) {
        subtree(c, by, out);
        if (Array.isArray(c.next)) break;
        c = typeof c.next === 'string' ? byId.get(c.next) : null;
      }
    }
  };
  const freezeNode = (t, why) => {
    const list = [];
    subtree(t, t.id, list);
    frozen[t.id] = list;
    reasons.set(t.id, why);
    return { ref: t.id, kind: 'stored', name: t.name };
  };

  const chain = (startId) => {
    const out = [];
    let c = startId ? byId.get(startId) : null;
    while (c && !reached.has(c.id)) {
      out.push(liftNode(c));
      if (Array.isArray(c.next)) break;
      c = after(c);
    }
    return out;
  };
  const lane = (lid, containerId) => {
    const l = byId.get(lid);
    if (!l) lossy(`lane ${lid} is not in the document`);
    markOwned(lid, containerId);
    return chain(typeof l.next === 'string' ? l.next : null);
  };
  const common = (t, n) => {
    if (t.advanceCanvasMeta?.isDisabled === true) n.disabled = true;
    if (Number.isInteger(t.stepIndex)) n.stepIndex = t.stepIndex;
    return n;
  };

  function liftNode(t) {
    if (freeze.has(t.id)) return freezeNode(t, freeze.get(t.id));
    const mark = reachedLog.length;
    markOwned(t.id, t.id);
    try {
      return common(t, inverse(t));
    } catch (e) {
      if (!(e instanceof Lossy)) throw e;
      // Everything walked below this node before the loss was found belongs to its frozen subtree now.
      for (const id of reachedLog.splice(mark)) { reached.delete(id); owner.delete(id); delete frozen[id]; reasons.delete(id); }
      return freezeNode(t, e.message);
    }
  }

  function inverse(t) {
    const a = t.attributes ?? {};
    const base = { ref: t.id, name: t.name };
    if (t.type === 'transition' || BRANCH_NODE_TYPES.has(t.nodeType)) lossy('a lane node reached as a step');
    // w6c-2 (bl-785): a Loop lifts to the loop kind. Its body is the chain from loop.next up to attributes.exitNext; each body step
    // carries parentContainerId = the loop. Anything the emitter would not write back is lossy, so the loop is frozen as stored.
    if (t.type === 'loop') {
      const over = a.loopOver ?? 'list';
      if (over !== 'list' && over !== 'range') lossy(`loop loopOver '${over}' is not list or range`);
      const known = new Set(['type', 'items', 'limit', 'mode', 'loopOver', 'startNumber', 'endNumber', 'exitNext']);
      const extra = Object.keys(a).filter((k) => !known.has(k));
      if (extra.length) lossy(`loop carries attributes the IR does not hold: ${extra.join(', ')}`);
      if (a.limit !== null && a.limit !== undefined) lossy('loop limit is set; the IR does not hold it');
      if (a.mode === undefined) lossy('loop has no mode');
      const range = over === 'range';
      if (range && (a.startNumber === undefined || a.endNumber === undefined || (a.items ?? '') !== '')) lossy('range loop bounds are not as the emitter writes them');
      if (!range && (a.startNumber !== undefined || a.endNumber !== undefined)) lossy('list loop carries range bounds');
      const exit = loopExit(t);
      const body = [];
      let c = typeof t.next === 'string' && t.next !== exit ? byId.get(t.next) : null;
      while (c && c.id !== exit && !reached.has(c.id)) {
        if (c.parentContainerId !== t.id) lossy(`body step '${c.name}' is not tagged with its loop`);
        body.push(liftNode(c));
        if (Array.isArray(c.next)) break;
        c = typeof c.next === 'string' ? byId.get(c.next) : null;
      }
      return { ...base, kind: 'loop', loopOver: over, mode: a.mode, ...(range
        ? { startNumber: a.startNumber, endNumber: a.endNumber }
        : { items: a.items ?? '' }), body };
    }
    // w6c-1 (bl-784): a Router root lifts to the router kind. Its lanes are its branches (next = the lane ids, in order); each
    // custom branch keeps its one condition group (conditions + segment operator), a fallback or always-run branch none.
    if (t.type === 'router' && t.nodeType === 'condition-node') {
      const bs = a.branches ?? [];
      if (!Array.isArray(t.next) || t.next.length !== bs.length || bs.some((b, i) => b.id !== t.next[i]))
        lossy('router lanes do not match its branches');
      const branches = bs.map((b) => {
        const seg = b.segments ?? [];
        const custom = (b.branchType ?? 'custom') === 'custom';
        if (seg.length > 1) lossy(`branch '${b.name}' has ${seg.length} condition segments; the IR holds one`);
        if (seg[0]?.__segmentId) slots[`${b.id}:segment:0`] = seg[0].__segmentId;
        return { ref: b.id, name: b.name, branchType: b.branchType ?? 'custom',
          ...(custom ? { conditions: structuredClone(seg[0]?.conditions ?? []) } : {}),
          ...(custom && seg[0]?.operator && seg[0].operator !== 'and' ? { op: seg[0].operator } : {}),
          then: lane(b.id, t.id) };
      });
      return { ...base, kind: 'router', name: a.routerName ?? t.name, branches };
    }
    if (t.type === 'if_else' && t.nodeType === 'condition-node') {
      const bs = a.branches ?? [];
      if (!Array.isArray(t.next) || t.next.length !== bs.length + 1 || bs.some((b, i) => b.id !== t.next[i]))
        lossy('if_else lanes do not match its branches');
      const branches = bs.map((b) => {
        const seg = b.segments ?? [];
        if (seg.length > 1) lossy(`branch '${b.name}' has ${seg.length} condition segments; the IR holds one`);
        if (seg[0]?.__segmentId) slots[`${b.id}:segment:0`] = seg[0].__segmentId;
        return { ref: b.id, name: b.name, conditions: structuredClone(seg[0]?.conditions ?? []),
          ...(seg[0]?.operator && seg[0].operator !== 'and' ? { op: seg[0].operator } : {}), then: lane(b.id, t.id) };
      });
      const noneId = t.next.at(-1);
      branches.push({ ref: noneId, name: byId.get(noneId)?.name ?? a.noneBranchName, else: true, then: lane(noneId, t.id) });
      return { ...base, kind: 'if_else', branches };
    }
    if (t.type === 'goto') return { ...base, kind: 'goto', target: a.targetNodeId };
    if (t.type === 'wait' && Array.isArray(t.next)) {
      slot2(t);
      const n = { ...base, kind: 'wait', waitType: a.type,
        timeout: { unit: a.startAfter?.type, value: a.startAfter?.value, ...(a.startAfter?.when ? { when: a.startAfter.when } : {}) } };
      if (a.type === 'reply') n.reply = { steps: a.reply ?? [], labels: a.replyLabel ?? [] };
      else {
        const { type, startAfter, name, cat, timePeriodInputMode, unitInputMode, isHybridAction, hybridActionType, convertToMultipath, transitions, ...rest } = a;
        n.attributes = structuredClone(rest);
      }
      n.onEvent = lane(t.next[0], t.id);
      n.onTimeout = lane(t.next[1], t.id);
      return n;
    }
    if (t.type === 'wait') return { ...base, kind: 'wait', waitType: a.type, attributes: structuredClone(a) };
    if (t.type === 'find_opportunity') {
      slot2(t);
      return { ...base, kind: 'action', type: t.type,
        find: { sorting: a.sorting, filters: (a.__customInputFields__ ?? []).map((f) => ({ field: f.filterField, operator: f.value, value: f.secondValue })) },
        onFound: lane(t.next[0], t.id), onNotFound: lane(t.next[1], t.id) };
    }
    if (t.type === 'find_contact') {
      slot2(t);
      return { ...base, kind: 'action', type: t.type, find: { fields: structuredClone(a.fields ?? []) }, onFound: lane(t.next[0], t.id), onNotFound: lane(t.next[1], t.id) };
    }
    if (t.type === 'lc_merge_contact') {
      slot2(t);
      return { ...base, kind: 'action', type: t.type, ...(a.match_by !== undefined ? { match_by: structuredClone(a.match_by) } : {}),
        onFound: lane(t.next[0], t.id), onNotFound: lane(t.next[1], t.id) };
    }
    if (t.type === 'co_find_company_record') {
      slot2(t);
      return { ...base, kind: 'action', type: t.type,
        find: { filter_on: a.filter_on, filters: (a.__customInputFields__ ?? []).map((f) => ({ field: f.filterField, value: f.valueField })) },
        onFound: lane(t.next[0], t.id), onNotFound: lane(t.next[1], t.id) };
    }
    if (t.type === 'conversationai_book_appointment' || t.type === 'conversationai_services_booking') {
      slot2(t);
      const keys = t.type === 'conversationai_book_appointment' ? ['promptInstructions', 'calendarId'] : ['conversationai_services', 'conversationai_booking_description'];
      return { ...base, kind: 'action', type: t.type, attributes: Object.fromEntries(keys.filter((k) => a[k] !== undefined).map((k) => [k, structuredClone(a[k])])),
        onBooked: lane(t.next[0], t.id), onNotBooked: lane(t.next[1], t.id) };
    }
    // w6c-5 (bl-788): an A/B Test lifts to the ab_test kind. The event metric's single goal condition is the win criterion; its id is
    // pinned so a recompile reproduces it. A contact-condition metric, or any extras the IR does not hold, is frozen as stored.
    if (t.type === 'workflow_ab_test') {
      if (!Array.isArray(t.next)) lossy('an A/B test stored without paths');
      const ex = a.extras ?? {};
      const extraKeys = Object.keys(ex).filter((k) => !['metric', 'endCondition', 'afterEnd', 'resetTestRun'].includes(k));
      if (extraKeys.length) lossy(`A/B extras the IR does not hold: ${extraKeys.join(', ')}`);
      const m = ex.metric;
      if (!m || m.kind !== 'event') lossy(`A/B metric '${m?.kind}' is not the event metric the IR holds`);
      const segs = m.matchCriteria?.segments ?? [];
      if (segs.length !== 1 || segs[0].op !== 'or' || (segs[0].conditions ?? []).length !== 1) lossy('A/B event metric is not a single goal condition');
      const cond = segs[0].conditions[0];
      if (!ex.endCondition) lossy('A/B test stored without an endCondition');
      if (ex.resetTestRun !== undefined && ex.resetTestRun !== true) lossy('A/B resetTestRun is not true');
      slots[`${t.id}:metric:condition:0`] = cond.id;
      return { ...base, kind: 'ab_test', metric: { kind: 'event', goal: cond.goal_condition, goalExtras: structuredClone(cond.extras ?? {}) },
        endCondition: structuredClone(ex.endCondition), afterEnd: ex.afterEnd,
        ...(ex.resetTestRun === true ? { resetTestRun: true } : {}),
        paths: t.next.map((pid) => ({ ref: pid, name: (a.transitions ?? []).find((x) => x.id === pid)?.name ?? byId.get(pid)?.name, then: lane(pid, t.id) })) };
    }
    if (t.type === 'workflow_split') {
      if (!Array.isArray(t.next)) lossy('a split stored without lanes');
      // w6c-4 (plan Task 4): the stored condition IS the mode. even-split stores no weights; weighted and random store whole
      // percentages. Anything else (a conditional split, unknown extras) is frozen as stored, not guessed.
      const mode = { 'even-split': 'even', 'weighted-split': 'weighted', 'random-split': 'random' }[a.condition];
      if (mode === undefined) lossy(`split condition '${a.condition}' is not an authored mode (conditional-split is unproven: SPLIT_MODE_UNPROVEN)`);
      const extraKeys = Object.keys(a.extras ?? {}).filter((k) => k !== 'rememberPath' && k !== 'weightDistribution');
      if (extraKeys.length) lossy(`split extras the IR does not hold: ${extraKeys.join(', ')}`);
      const hasWeights = a.extras?.weightDistribution !== undefined;
      if (mode === 'even' && hasWeights) lossy('an even-split that stores weights');
      if (mode !== 'even' && !hasWeights) lossy(`a ${a.condition} stored without weights`);
      if (a.extras?.rememberPath !== undefined && a.extras.rememberPath !== true) lossy('split rememberPath is not true');
      const w = a.extras?.weightDistribution ?? {};
      return { ...base, kind: 'split', mode, ...(a.extras?.rememberPath === true ? { rememberPath: true } : {}),
        paths: t.next.map((pid) => ({ ref: pid, name: (a.transitions ?? []).find((x) => x.id === pid)?.name ?? byId.get(pid)?.name,
          ...(mode !== 'even' ? { weight: w[pid] } : {}), then: lane(pid, t.id) })) };
    }
    if (t.type === 'workflow_ai_decision_maker' || (Array.isArray(t.next) && a.type === 'workflow_ai_decision_maker')) {
      const tr = a.transitions ?? [];
      const def = tr.find((x) => x.conditionType === 'pre-defined');
      if (!def || tr[0] !== def) lossy('ai_decision stored without its Default Branch first');
      slots[`${t.id}:transition:0`] = def.id;
      branchKeys(t);
      return { ...base, kind: 'ai_decision', type: t.type, instructions: a.instructions, information: a.information, default: lane(def.id, t.id),
        branches: tr.slice(1).map((x) => ({ ref: x.id, name: x.name, description: x.fields?.description, branchKey: x.fields?.branchKey, then: lane(x.id, t.id) })) };
    }
    if (t.type === 'conversationai_ai_splitter') {
      const tr = a.transitions ?? [];
      if (tr[0]?.conditionType !== 'pre-defined') lossy('AI splitter stored without its No-condition lane first');
      tr.forEach((x, i) => { slots[`${t.id}:transition:${i}`] = x.id; });
      branchKeys(t);
      return { ...base, kind: 'action', type: t.type, attributes: { description: a.description }, default: lane(tr[0].id, t.id),
        branches: tr.slice(1).map((x) => ({ name: x.name, fields: structuredClone(x.fields ?? {}), then: lane(x.id, t.id) })) };
    }
    if (t.type === 'workflow_ai_intent_detection') {
      return { ...base, kind: 'ai_intent', type: t.type, inputText: a.inputText,
        branches: (a.transitions ?? []).map((x) => ({ ref: x.id, name: String(x.name).toLowerCase(), then: lane(x.id, t.id) })) };
    }
    if (Array.isArray(t.next)) lossy(`a '${t.type}' container has no inverse in the IR`);
    // A type the catalogue has never seen compiles only under allowUnknownStepTypes; kept as stored instead.
    if (t.isMarketplaceAction !== true && !catalog?.step?.(t.type) && !(typeof t.workflowsActionType === 'string' && marketplace?.get?.(t.type, 'action')))
      lossy(`step type '${t.type}' is not in the catalogue`);
    // linear
    let type = t.type;
    let attributes = structuredClone(a);
    if (type === 'create_opportunity') {
      attributes = {};
      for (const [k, v] of Object.entries(a)) {
        if (OPP_INV_CREATE[k]) { if (v !== '' || k === 'pipeline_stage_id') attributes[OPP_INV_CREATE[k]] = v; }
        else if (k === 'fields' && Array.isArray(v) && v.length) lossy('create_opportunity custom-field rows have no author form');
        else if (k !== 'type' && k !== 'fields') lossy(`create_opportunity stored key '${k}' has no author form`);
      }
      if (attributes.stageId === '') delete attributes.stageId;
    } else if (type === 'internal_create_opportunity') {
      attributes = { pipelineId: a.pipelineId };
      for (const f of a.__customInputFields__ ?? []) {
        if (!STRICT_INV[f.filterField]) lossy(`create_opportunity_strict row '${f.filterField}' has no author form`);
        attributes[STRICT_INV[f.filterField]] = f.value;
      }
      type = 'create_opportunity_strict';
    } else if (type === 'internal_update_opportunity') {
      attributes = { allowBackward: a.allowBackward,
        updates: (a.__customInputFields__ ?? []).map((f) => ({ field: f.filterField, value: f.value, dataType: f.dataType, valueFieldType: f.valueFieldType })) };
      type = 'update_opportunity';
    }
    // Stored keys the build rail refuses (ATTR_KEY) stay out of the IR; the residual puts them back as stored.
    for (const k of stripKeys.get(t.id) ?? []) delete attributes[k];
    const n = { ...base, kind: 'action', type, attributes };
    if (t.isMarketplaceAction === true || (typeof t.workflowsActionType === 'string' && t.workflowsActionType !== 'INTERNAL')) n.marketplace = true;
    return n;
  }

  // The root is the step nothing points at — not "the step with no parentKey" (measured: 40 sample steps break that).
  const inbound = new Set();
  for (const t of T) for (const x of [t.next].flat()) if (typeof x === 'string') inbound.add(x);
  const candidates = T.filter((t) => t.type !== 'transition' && !BRANCH_NODE_TYPES.has(t.nodeType) && !inbound.has(t.id) && t.parent == null);
  const root = candidates.find((t) => t.parentKey == null) ?? candidates[0] ?? null;
  const graph = root ? chain(root.id) : [];
  const detached = T.filter((t) => !reached.has(t.id));
  return { graph, slots, frozen, reasons, owner, detached };
}

function liftTriggers(triggers) {
  return (triggers ?? []).map((t) => {
    const lt = { ref: t.id, type: t.type, name: t.name, filters: structuredClone(t.conditions ?? []) };
    if (t.masterType !== undefined) lt.masterType = t.masterType;
    if (t.targetActionId) lt.targetActionId = t.targetActionId;
    if (t.type === 'custom_date_reminder' && t.custom_date_reminder_config)
      lt.config = { ...structuredClone(t.custom_date_reminder_config), ...(t.customDateFieldId ? { field: t.customDateFieldId } : {}) };
    return lt;
  });
}

function liftSettings(doc, refusals) {
  const out = {};
  for (const k of KNOWN_SETTINGS_KEYS) {
    const v = k === 'statsView' ? doc.meta?.statsView : doc[k];
    if (v === undefined) continue;
    try { normalizeSettings({ [k]: v }); out[k] = structuredClone(v); }
    catch (e) { refusals.push({ kind: 'setting', key: k, code: e.code ?? 'SETTING', message: e.message }); }
  }
  return out;
}

const tokenGen = () => { let n = 0; return () => `lift-${String(++n).padStart(6, '0')}`; };
const LIFT_TOKEN = /^lift-\d{6}$/;

/**
 * @param {{doc: object, triggers?: object[], stickyNotes?: object[]}} input the stored workflow, its triggers, its notes
 * @param {{catalog: object, marketplace?: object, now?: number}} opts
 * @returns {{ir: object|null, refusals: object[], report: object}}
 */
export function liftWorkflow({ doc, triggers = [], stickyNotes = [] }, { catalog, marketplace, now = 0 } = {}) {
  if (!catalog) throw new Error('liftWorkflow needs the step catalogue (opts.catalog)');
  const T = structuredClone(doc?.workflowData?.templates ?? []);
  const refusals = [];
  const settings = liftSettings(doc ?? {}, refusals);
  const warnings = [];
  const baseCtx = {
    loc: doc?.locationId ?? 'LOC', cid: doc?.companyId ?? 'CID', uid: doc?.updatedBy ?? 'LIFT', companyAge: doc?.companyAge ?? 0,
    catalog, marketplace, now, ignoreUnresolved: true, skipObjectRules: true, allowUnknownStepTypes: true, skipTriggerSeeds: true,
    warn: (m) => warnings.push(m),
  };
  // A trigger the build rail would refuse stays out of the IR (kept verbatim in stored.triggers) and is named.
  const liftedTriggers = [];
  for (const lt of liftTriggers(triggers)) {
    try { compile({ name: 'x', triggers: [lt], graph: [] }, { ...baseCtx, idGen: tokenGen() }); liftedTriggers.push(lt); }
    catch (e) { refusals.push({ kind: 'trigger', id: lt.ref, code: e.code ?? 'TRIGGER', message: e.message }); }
  }

  const freeze = new Map();
  const stripKeys = new Map();
  const accepted = { gotoLoops: [], oppUnassociated: [] };
  const names = new Map();
  for (const t of T) names.set(t.name, names.has(t.name) ? null : t.id);
  for (let round = 0; round < T.length + 8; round++) {
    const g = liftGraph(T, freeze, { catalog, marketplace, stripKeys });
    const stored = {
      pins: { slots: g.slots, ...(doc?.meta?.stepIndexCounter ? { stepIndexCounter: structuredClone(doc.meta.stepIndexCounter) } : {}) },
      residual: {}, frozen: g.frozen, detached: g.detached, accepted: structuredClone(accepted), order: T.map((t) => t.id),
      types: Object.fromEntries(T.map((t) => [t.id, t.type])), triggerIds: liftedTriggers.map((t) => t.ref),
      ...(stickyNotes?.length ? { stickyNotes: structuredClone(stickyNotes) } : {}),
      ...(liftedTriggers.length !== (triggers ?? []).length ? { triggers: structuredClone(triggers) } : {}),
    };
    const ir = { name: doc?.name ?? 'Lifted workflow', triggers: structuredClone(liftedTriggers), graph: g.graph,
      ...(Object.keys(settings).length ? { settings: structuredClone(settings) } : {}),
      ...(doc?.customObjectType ? { customObjectType: doc.customObjectType } : {}),
      ...(doc?.workflowType ? { workflowType: doc.workflowType } : {}), stored };
    let built;
    try {
      built = compile(structuredClone(ir), { ...baseCtx, idGen: tokenGen(), pinIds: true, pins: stored.pins });
    } catch (e) {
      if (!(e instanceof IRError)) throw e;
      if (e.code === 'GOTO_LOOP' && Array.isArray(e.loops) && e.loops.length) {
        for (const l of e.loops) accepted.gotoLoops.push(`${l.id}>${l.target}`);
        continue;
      }
      if (e.code === 'OPP_UNASSOCIATED' && e.ref) { accepted.oppUnassociated.push(e.ref); continue; }
      const ak = e.code === 'ATTR_KEY' && /unknown attribute key\(s\) \[([^\]]*)\] on '([^']+)'/.exec(e.message);
      if (ak && g.owner.get(ak[2]) === ak[2] && !freeze.has(ak[2])) {
        const keys = ak[1].split(',').map((k) => k.trim()).filter(Boolean);
        const have = stripKeys.get(ak[2]) ?? new Set();
        if (keys.some((k) => !have.has(k))) { for (const k of keys) have.add(k); stripKeys.set(ak[2], have); continue; }
      }
      // Any other refusal names the step (refs ARE stored ids); freeze what produces it and go again.
      const hit = T.map((t) => t.id).filter((id) => e.message.includes(id) && g.owner.has(id) && !freeze.has(g.owner.get(id)));
      const byName = hit.length ? [] : [...names].filter(([n, id]) => id && n && e.message.includes(`'${n}'`) && g.owner.has(id) && !freeze.has(g.owner.get(id))).map(([, id]) => id);
      const targets = [...new Set([...hit, ...byName].map((id) => g.owner.get(id)))];
      if (!targets.length) { refusals.push({ kind: 'workflow', code: e.code, message: e.message }); return { ir: null, refusals, report: { warnings } }; }
      for (const id of targets) freeze.set(id, `${e.code}: ${e.message.slice(0, 200)}`);
      continue;
    }

    // Diff every stored step the IR produced against what came back.
    const C = new Map(built.autoSaveBody.workflowData.templates.map((t) => [t.id, t]));
    const frozenIds = new Set(Object.values(g.frozen).flat().map((t) => t.id));
    const detachedIds = new Set(g.detached.map((t) => t.id));
    const toFreeze = new Map();
    for (const s of T) {
      if (detachedIds.has(s.id)) continue;
      const c = C.get(s.id);
      const by = g.owner.get(s.id);
      if (!c) { toFreeze.set(by, 'the compile did not reproduce this step'); continue; }
      const head = g.frozen[s.id] !== undefined;
      if (frozenIds.has(s.id) && !head) continue;          // copied verbatim
      const diffs = diffPaths(c, s);
      const bad = diffs.filter((d) => isSemantic(d, s) && !(head && d.p.length === 1 && d.p[0] === 'next'));
      if (bad.length && !head) { toFreeze.set(by, `the compile changed ${bad.map((d) => d.p.join('.')).slice(0, 3).join(', ')}`); continue; }
      for (const d of diffs) if (!('t' in d) && typeof d.f === 'string' && LIFT_TOKEN.test(d.f)) { delete d.f; d.any = true; }
      const minted = diffs.filter((d) => d.any).map((d) => d.p);
      for (const d of diffs) {
        const g = elementGuards(c, d.p, minted);
        if (g.length) d.g = g;
      }
      if (diffs.length) stored.residual[s.id] = diffs;
    }
    const storedIds = new Set(T.map((t) => t.id));
    for (const c of C.values()) {
      if (storedIds.has(c.id)) continue;
      const by = g.owner.get(c.parent) ?? g.owner.get(c.parentKey);
      if (!by) { refusals.push({ kind: 'workflow', code: 'LIFT_EXTRA_STEP', message: `the compile added step '${c.name ?? c.id}' the document does not hold` }); return { ir: null, refusals, report: { warnings } }; }
      toFreeze.set(by, `the compile added step '${c.name ?? c.id}'`);
    }
    const fresh = [...toFreeze].filter(([id]) => !freeze.has(id));
    if (fresh.length) { for (const [id, why] of fresh) freeze.set(id, why); continue; }

    return {
      ir,
      refusals,
      report: {
        steps: T.length,
        frozen: Object.keys(g.frozen).map((id) => ({ id, name: T.find((t) => t.id === id)?.name, reason: g.reasons.get(id) })),
        detached: g.detached.map((t) => t.id),
        acceptedLoops: accepted.gotoLoops, acceptedOppUnassociated: accepted.oppUnassociated,
        residualSteps: Object.keys(stored.residual).length, rounds: round + 1, warnings,
      },
    };
  }
  refusals.push({ kind: 'workflow', code: 'LIFT_NO_FIXPOINT', message: 'the lifter did not settle; nothing is returned rather than a partial spec' });
  return { ir: null, refusals, report: { warnings } };
}
