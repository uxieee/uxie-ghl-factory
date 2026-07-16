// IR (intermediate representation) parser + invariant validator.
// See docs/superpowers/specs/2026-07-10-create-ghl-workflow-v2-design.md §4.
export class IRError extends Error {
  constructor(code, message) { super(message); this.name = 'IRError'; this.code = code; }
}

// Node-level scope arrays that hold a nested linear sequence (a child graph).
// Every multipath container reaches its children through one of these.
const SCOPE_KEYS = ['onEvent', 'onTimeout', 'onFound', 'onNotFound', 'onBooked', 'onNotBooked', 'default'];

// ─── Container kinds: `kind:` is an accepted alias for `type:` ────────────────────────
// The find/merge containers are discriminated in the compiler by node.type. An author
// mirroring the `kind:'wait'` / `kind:'if_else'` spelling naturally writes
// `kind:'find_opportunity'` — which used to leave n.type undefined, so the container
// handler never matched, the node fell through to the LINEAR path, and its whole
// onFound/onNotFound subtree was silently discarded. The build then reported a clean
// round-trip for a fraction of the authored IR (found live 2026-07-16: a 51-step IR
// reported "steps: 8 | round-trip: 8 clean"). Normalize the alias here, once, so both
// spellings reach the compiler as { kind:'action', type:'<container>' }.
const CONTAINER_KINDS = new Set(['find_opportunity', 'find_contact', 'lc_merge_contact']);

// Every node-level key the compiler actually reads. A key outside this set is author
// intent the engine would silently discard — see checkNodeKeys.
const KNOWN_NODE_KEYS = new Set([
  'ref', 'kind', 'type', 'name', 'attributes', 'assocGuaranteed', 'disabled', 'advanceCanvasMeta',
  'config', 'window', 'waitType',          // wait
  'branches', 'paths', 'mode', 'condition', // if_else / split
  'find', 'match_by',                       // find_opportunity / find_contact / lc_merge_contact
  'reply', 'timeout',                       // multipath wait
  'instructions', 'information',            // ai_decision
  'target',                                 // goto
  ...SCOPE_KEYS,
]);

// Scope keys only mean something on a node the compiler routes to a container handler.
// `onFound` on a plain action is the item-1 failure in miniature: authored, never read.
const SCOPE_OWNERS = {
  onEvent: ['wait'], onTimeout: ['wait'],
  onFound: ['find_opportunity', 'find_contact', 'lc_merge_contact'],
  onNotFound: ['find_opportunity', 'find_contact', 'lc_merge_contact'],
  onBooked: ['conversationai_book_appointment'], onNotBooked: ['conversationai_book_appointment'],
  default: ['ai_decision', 'conversationai_ai_splitter', 'split'],
};

// Reject any node-level key the compiler will not read. Attribute keys already had this
// (ATTR_KEY); node keys did not, which is how `kind:'find_opportunity'`, a typo'd
// `attribute:`, and a stray `onFound:` all compiled "clean" while doing nothing.
function checkNodeKeys(n) {
  const bad = Object.keys(n).filter((k) => !KNOWN_NODE_KEYS.has(k));
  if (bad.length)
    throw new IRError('NODE_KEY',
      `unknown node key(s) [${bad.join(', ')}] on '${n.ref}' — the compiler never reads these, so they ` +
      `would be silently discarded. Known node keys: ${[...KNOWN_NODE_KEYS].join(', ')}.`);
  for (const [scope, owners] of Object.entries(SCOPE_OWNERS)) {
    if (n[scope] === undefined) continue;
    const owns = owners.includes(n.type) || owners.includes(n.kind);
    if (!owns)
      throw new IRError('NODE_KEY',
        `node '${n.ref}' has scope '${scope}' but its type/kind ('${n.type ?? n.kind}') has no container ` +
        `handler that reads it — the entire '${scope}' subtree would be silently discarded. ` +
        `'${scope}' belongs on: ${owners.join(', ')}.`);
  }
}

// ─── Opportunity pipeline-stage condition: the ONE canonical spelling ────────────────
// GHL stores a stage condition as conditionType:'opportunities' (PLURAL) +
// conditionSubType:'pipelineStageId' (camelCase). Any other spelling is a SILENT
// failure: it compiles, publishes and round-trips clean, but GHL cannot map the
// type/subType back to a known field — so the branch never evaluates at runtime and
// the builder renders a blank "Select" instead of the stage picker. Confirmed live
// 2026-07-16 (workflow "08 Deposit Paid Handler", 37d8de74) where all three
// "Booked yet?" checkpoints came out dead this way.
//
// Both the compiler (shape emission) and the resolver (stage NAME→id lookup) key off
// this type, so the alias tables live here — shared, single source of truth.
export const OPP_STAGE_TYPE = 'opportunities';
export const OPP_STAGE_SUBTYPE = 'pipelineStageId';
const OPP_STAGE_TYPE_ALIASES = new Set(['opportunity', 'opportunities', 'opportunity_stage',
  'opportunities_stage', 'opportunityStage']);
const OPP_STAGE_SUBTYPE_ALIASES = new Set(['pipelinestageid', 'pipeline_stage_id', 'pipeline_stage',
  'pipelinestage', 'stage']);

const isOppStageSubType = (v) => typeof v === 'string' && OPP_STAGE_SUBTYPE_ALIASES.has(v.toLowerCase());

// Does this authored condition intend an opportunity pipeline-stage test?
// True when the type is an opportunity alias AND the stage is identified by any of the
// accepted routes: the `stage` intent key, a stage-ish conditionSubType, or lean-IR `field`.
export function isOppStageCondition(c) {
  if (!c || !OPP_STAGE_TYPE_ALIASES.has(c.conditionType)) return false;
  return c.stage !== undefined || isOppStageSubType(c.conditionSubType) || isOppStageSubType(c.field);
}

// Rewrite an opp-stage condition's type/subType to the canonical pair, dropping the
// lean-IR `field` alias (it is intent-only and must not reach the stored object).
// Returns a new object; non-stage conditions pass through untouched.
export function canonicalizeOppStageCondition(c) {
  if (!isOppStageCondition(c)) return c;
  const { field, ...rest } = c;
  return { ...rest, conditionType: OPP_STAGE_TYPE, conditionSubType: OPP_STAGE_SUBTYPE };
}

// Fail-closed backstop for any path that reaches condition emission without
// canonicalizing. These two spellings are the known-dead ones; they must never be
// stored, so surface them at compile like the ATTR_KEY lint rather than shipping a
// branch that quietly never fires.
export function lintConditionShape(c) {
  if (c.conditionType === 'opportunity') {
    throw new IRError('COND_SHAPE',
      `if_else condition has conditionType:"opportunity" (singular) — GHL requires "${OPP_STAGE_TYPE}". `
      + 'This shape publishes clean but the branch never evaluates and the builder shows a blank "Select". '
      + `Author it as { conditionType:"${OPP_STAGE_TYPE}", stage:"<name or id>" }.`);
  }
  if (isOppStageSubType(c.conditionSubType) && c.conditionSubType !== OPP_STAGE_SUBTYPE) {
    throw new IRError('COND_SHAPE',
      `if_else condition has conditionSubType:"${c.conditionSubType}" — GHL requires "${OPP_STAGE_SUBTYPE}" `
      + `(camelCase) on conditionType:"${OPP_STAGE_TYPE}". This shape publishes clean but the branch never `
      + `evaluates. Author it as { conditionType:"${OPP_STAGE_TYPE}", stage:"<name or id>" }.`);
  }
  return c;
}

// Walk every node (graph + every nested scope) and every trigger, collecting refs.
export function collectRefs(ir) {
  const refs = [];
  for (const t of ir.triggers ?? []) refs.push(t.ref);
  const walk = (nodes) => {
    for (const n of nodes ?? []) {
      if (n.ref !== undefined) refs.push(n.ref);
      // branch/path collections carry their own ref + a then[] child scope
      for (const b of n.branches ?? []) { if (b.ref !== undefined) refs.push(b.ref); walk(b.then); }
      for (const p of n.paths ?? []) { if (p.ref !== undefined) refs.push(p.ref); walk(p.then); }
      for (const k of SCOPE_KEYS) walk(n[k]);
    }
  };
  walk(ir.graph);
  return refs;
}

// Visit every authored NODE (graph + branch/path `then` + every nested scope). Branch and
// path records themselves are NOT nodes — they become container-internal branch entries,
// not standalone templates — so they are walked through, never visited.
export function walkNodes(nodes, visit) {
  for (let i = 0; i < (nodes ?? []).length; i++) {
    const n = nodes[i];
    visit(n, i, nodes);
    for (const b of n.branches ?? []) walkNodes(b.then, visit);
    for (const p of n.paths ?? []) walkNodes(p.then, visit);
    for (const k of SCOPE_KEYS) walkNodes(n[k], visit);
  }
}

export function parseIR(ir) {
  if (!ir || typeof ir !== 'object' || !Array.isArray(ir.triggers) || !Array.isArray(ir.graph))
    throw new IRError('SCHEMA', 'IR must have triggers[] and graph[]');
  // triggers: [] is legal — trigger-less workflows are enrolled from another
  // workflow via add_to_workflow (the builder's "empty trigger tab" shape).
  // The build path simply has no trigger POSTs to make.

  const refs = collectRefs(ir);
  const seen = new Set();
  for (const r of refs) {
    if (seen.has(r)) throw new IRError('DUP_REF', `duplicate ref: ${r}`);
    seen.add(r);
  }

  // Normalize the container-kind alias BEFORE any type-keyed validation runs, so the
  // rest of the pipeline only ever sees the canonical { kind:'action', type:'<container>' }.
  walkNodes(ir.graph, (n) => {
    if (CONTAINER_KINDS.has(n.kind) && n.type === undefined) { n.type = n.kind; n.kind = 'action'; }
  });
  walkNodes(ir.graph, (n) => checkNodeKeys(n));

  walkNodes(ir.graph, (n, idx, siblings) => {
    if (n.kind === 'goto') {
      if (!seen.has(n.target)) throw new IRError('GOTO_UNRESOLVED', `goto target not found: ${n.target}`);
      if (idx !== siblings.length - 1) throw new IRError('GOTO_NOT_TERMINAL', `goto '${n.ref}' must be last in its branch`);
    }
    if (n.kind === 'if_else') {
      if ((n.branches ?? []).length < 2) throw new IRError('IFELSE_ARITY', `if_else '${n.ref}' needs >=2 branches`);
      const elses = n.branches.filter((b) => b.else === true);
      if (elses.length > 1) throw new IRError('IFELSE_ELSE', `if_else '${n.ref}' has >1 else branch`);
      for (const b of n.branches) {
        const hasCond = Array.isArray(b.conditions) && b.conditions.length > 0;
        if (b.else === true && hasCond) throw new IRError('BRANCH_SHAPE', `branch '${b.ref}' has both else and conditions`);
        if (b.else !== true && !hasCond) throw new IRError('BRANCH_SHAPE', `branch '${b.ref}' has neither else nor conditions`);
      }
    }
    if (n.kind === 'split') {
      if ((n.paths ?? []).length < 2) throw new IRError('SPLIT_ARITY', `split '${n.ref}' needs >=2 paths`);
      if (n.mode === 'weighted' && n.paths.some((p) => typeof p.weight !== 'number'))
        throw new IRError('SPLIT_WEIGHT', `split '${n.ref}' weighted requires weight per path`);
    }
    if (n.kind === 'ai_decision') {
      if ((n.branches ?? []).length < 1) throw new IRError('AI_DECISION_ARITY', `ai_decision '${n.ref}' needs >=1 branch`);
      for (const b of n.branches) if (!b.name) throw new IRError('AI_DECISION_BRANCH', `ai_decision '${n.ref}' branch missing name`);
    }
    // Conversation-AI "AI splitter" — LLM-routed named branches (no conditions; the
    // routing prose lives in attributes.description). Each branch needs a name so it
    // can label its transition node + fallback branch.
    if (n.type === 'conversationai_ai_splitter') {
      for (const b of n.branches ?? []) if (!b.name) throw new IRError('AI_SPLITTER_BRANCH', `conversationai_ai_splitter '${n.ref}' branch missing name`);
    }
  });

  const triggers = ir.triggers.map((t) => ({ active: true, ...t }));
  return { ...ir, triggers };
}

// --- Opportunity-association invariant -------------------------------------
// update_opportunity is a runtime no-op unless the executing contact already
// has an opportunity ASSOCIATED in the workflow context. Association sources:
//   1. ALL entry triggers are opportunity-based (catalog category 'opportunities'
//      — the caller passes that set; ir.mjs stays catalog-free),
//   2. a create_opportunity earlier on the same path,
//   3. being inside a find_opportunity `onFound` scope.
// A mixed trigger set does NOT seed the root (contacts entering via the non-opp
// trigger carry no opportunity). `assocGuaranteed: true` on a node or on a
// branch/path scope is the author's escape hatch for shapes static analysis
// can't prove (trigger-identity if/else, goto convergence). Lexical per-scope
// only — no propagation across goto edges (v1 limitation, see the spec).
export const REQUIRES_OPPORTUNITY = new Set(['update_opportunity', 'internal_update_opportunity']);
export const CREATES_OPPORTUNITY = new Set(['create_opportunity', 'internal_create_opportunity']);

export function checkOpportunityAssociation(norm, oppTriggerTypes) {
  const rootAssoc = norm.triggers.length > 0 && norm.triggers.every((t) => oppTriggerTypes.has(t.type));
  const walk = (nodes, assoc) => {
    for (const n of nodes ?? []) {
      if (REQUIRES_OPPORTUNITY.has(n.type) && !assoc && n.assocGuaranteed !== true)
        throw new IRError('OPP_UNASSOCIATED',
          `update_opportunity '${n.ref}' has no associated opportunity on its path — ` +
          `add a find_opportunity (put this step in its Found branch, and a create_opportunity in Not Found), ` +
          `add a create_opportunity before it, use an opportunity trigger on ALL triggers, ` +
          `or set assocGuaranteed:true if you know association is established in a way the checker can't see.`);
      if (CREATES_OPPORTUNITY.has(n.type)) assoc = true; // flows to later siblings + their child scopes
      for (const b of n.branches ?? []) walk(b.then, b.assocGuaranteed === true || assoc);
      for (const p of n.paths ?? []) walk(p.then, p.assocGuaranteed === true || assoc);
      walk(n.onEvent, assoc);
      walk(n.onTimeout, assoc);
      walk(n.default, assoc);
      // onFound guarantees an opportunity ONLY for find_opportunity — find_contact
      // and lc_merge_contact reuse the same scope keys for contact-level branches.
      walk(n.onFound, n.type === 'find_opportunity' ? true : assoc);
      walk(n.onNotFound, assoc);
      // Conversation-AI book_appointment branches book into a GHL calendar, not an
      // opportunity — association carries through unchanged.
      walk(n.onBooked, assoc);
      walk(n.onNotBooked, assoc);
    }
  };
  walk(norm.graph, rootAssoc);
}
