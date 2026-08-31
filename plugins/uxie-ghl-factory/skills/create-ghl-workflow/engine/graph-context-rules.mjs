// Rules that need the WHOLE template list, not one node's attributes.
//
// The coupled-field layer in required-fields.mjs sees a single node's attributes and nothing
// else, which is right for most of GHL's validators. The rules here cannot live there: each one
// needs another node — a parent, a sibling of the same type, a downstream step, a branch head.
// Everything here is warning-severity, so all of them warn.
//
// They run after compile, on the emitted templates, so they see exactly what will be sent.

/** GHL: gotoValidator, internal-action-validators.ts:69-75. `parentNode?.next` truthy → warning. */
function gotoPlacement(templates) {
  const out = [];
  const byId = new Map(templates.map((t) => [t.id, t]));

  for (const t of templates) {
    if (t.type !== 'goto') continue;
    // A goto ends a branch. GHL asks whether the node ABOVE it still points onward — if it does,
    // there is a step after the goto that can never run, because the goto has already jumped.
    // `next` is a scalar on a linear step and an array on a branch container; only the scalar
    // case can strand a sibling.
    const parent = [...byId.values()].find((p) => p.next === t.id);
    if (!parent) continue;
    if (typeof t.next === 'string' && t.next) {
      out.push(`goto '${t.name ?? t.id}' has a step after it. A goto jumps away, so anything `
        + `below it in the same branch is unreachable — move it to the end of the branch.`);
    }
  }
  return out;
}

/**
 * GHL: mathOperationValidator + getMathOperationSourceTypeFromTemplates,
 * additional-action-validators.ts:320-345 and :362-382.
 *
 * A math step can take its input from an earlier math step's result via the merge tag
 * `{{math_operation.N.result}}`. Two things go wrong and neither is visible on the node itself:
 *
 *   the upstream step was DELETED       → the reference resolves to nothing at runtime
 *   the upstream step's TYPE changed    → e.g. the first op was switched to `date` while this
 *                                         one still declares `numerical`
 *
 * GHL resolves N by `stepIndex` when present and falls back to the N-th math step in template
 * order — reproduced exactly, because the two disagree in the tree view where stepIndex is unset.
 */
function mathUpstreamRefs(templates) {
  const out = [];
  const mathOps = templates.filter((t) => t.type === 'math_operation' && t.attributes);

  const sourceTypeFor = (selectField) => {
    const m = String(selectField ?? '').match(/\{\{math_operation\.(\d+)\.result\}\}/);
    if (!m || !mathOps.length) return null;
    const n = parseInt(m[1], 10);
    const byStepIndex = mathOps.find((t) => (t.stepIndex ?? 0) === n);
    if (byStepIndex?.attributes) return byStepIndex.attributes.selectFieldtype || 'numerical';
    const byOrder = mathOps[n];
    if (!byOrder?.attributes) return null;
    return byOrder.attributes.selectFieldtype || 'numerical';
  };

  for (const t of mathOps) {
    const selectField = t.attributes?.selectField;
    const isRef = /\{\{math_operation\.\d+\.result\}\}/.test(String(selectField ?? ''));
    const sourceType = sourceTypeFor(selectField);
    const ref = t.name ?? t.id;

    if (isRef && !sourceType) {
      out.push(`math_operation '${ref}' reads {{math_operation.N.result}} from a step that does `
        + `not exist — the upstream math step was deleted, so this computes from nothing.`);
      continue;
    }
    if (sourceType && t.attributes?.selectFieldtype !== sourceType) {
      out.push(`math_operation '${ref}' declares selectFieldtype `
        + `'${t.attributes?.selectFieldtype}' but its upstream math step now produces `
        + `'${sourceType}' — the types drifted apart.`);
    }
  }
  return out;
}

/**
 * Run every graph-context rule and hand each finding to `warn`. Never throws: every rule here is
 * warning-severity, and promoting one would refuse a document the builder opens.
 * Returns the findings so a caller can assert on them.
 */
// A MANUAL step (manual-call, manual-sms) creates a TASK and the run WAITS there until a human
// completes it. Anything downstream — an SMS, an email — does not go out "shortly after"; it goes
// out whenever someone gets round to the task, which may be never. Authors read these as
// "notify a rep, then continue", and the sequencing surprise only shows up in runtime logs.
const MANUAL_STEP_TYPES = new Set(['manual-call', 'manual-sms', 'manual_call', 'manual_sms']);
const OUTBOUND_SEND_TYPES = new Set(['sms', 'email', 'send_outbound_whatsapp_message',
  'messenger', 'instagram-dm', 'whatsapp', 'internal_notification']);

function manualStepHoldsChain(list) {
  const byId = new Map(list.map((t) => [t.id, t]));
  const out = [];
  for (const t of list) {
    if (!t || !MANUAL_STEP_TYPES.has(t.type)) continue;
    // walk the LINEAR chain after it; a container ends the simple case
    let cursor = typeof t.next === 'string' ? byId.get(t.next) : null;
    let hops = 0;
    while (cursor && hops++ < 50) {
      if (OUTBOUND_SEND_TYPES.has(cursor.type)) {
        out.push(`'${t.name ?? t.id}' (${t.type}) is a manual TASK — the queue HOLDS the run there `
          + `until a human completes it, so '${cursor.name ?? cursor.id}' (${cursor.type}) below it does `
          + `not send on a schedule. Put the send BEFORE the manual step, or accept that it waits.`);
        break;
      }
      cursor = typeof cursor.next === 'string' ? byId.get(cursor.next) : null;
    }
  }
  return out;
}

// THE OPPORTUNITY SEARCH IS AN INDEX, AND IT LAGS. Proven live 2026-08-29: a card created with
// POST /opportunities/ read back by ID immediately, but did NOT appear in
// GET /opportunities/search for about a minute. Fetch-by-id is the record; search is an index
// behind it. So a find_opportunity placed seconds after a create reads a pipeline that does not
// yet contain the card — with no error to say so, it simply takes the Not-Found branch.
const CREATE_OPP_TYPES = new Set(['internal_create_opportunity', 'create_opportunity']);
const FIND_OPP_TYPES = new Set(['find_opportunity', 'internal_find_opportunity']);

function findAfterCreateRace(list) {
  const byId = new Map(list.map((t) => [t.id, t]));
  const out = [];
  for (const t of list) {
    if (!t || !CREATE_OPP_TYPES.has(t.type)) continue;
    let cursor = typeof t.next === 'string' ? byId.get(t.next) : null;
    let hops = 0;
    let waited = false;
    while (cursor && hops++ < 12) {
      // any wait between them is the fix, so stop looking
      if (cursor.type === 'wait') { waited = true; break; }
      if (FIND_OPP_TYPES.has(cursor.type)) {
        out.push(`'${cursor.name ?? cursor.id}' (${cursor.type}) searches for an opportunity `
          + `${hops} step(s) after '${t.name ?? t.id}' created one. The opportunity SEARCH is an INDEX and `
          + `lags a create by tens of seconds (measured), so this reads a pipeline that does not yet contain `
          + `the card and silently takes the Not-Found branch. Put a short wait between them.`);
        break;
      }
      cursor = typeof cursor.next === 'string' ? byId.get(cursor.next) : null;
    }
    void waited;
  }
  return out;
}

// A SPLITTER BRANCH THAT LEADS WITH A CONTAINER IS NEVER OFFERED. Proven live (GROM sandbox,
// 2026-08-30): a branch wired directly to a conversationai_book_appointment — itself a multipath
// container — was never once chosen across four conversations whose wording matched its label
// almost verbatim, and two rewrites of the splitter's description changed nothing. The cause is
// structural, not prompting: nesting a container directly under a splitter branch means GHL never
// offers that branch. One add_notes inserted at the head of the branch and it fired on the very
// next message; every branch that DOES get chosen begins with a simple step.
const isContainer = (t) =>
  !!t && (t.cat === 'multi-path' || t.attributes?.cat === 'multi-path' || Array.isArray(t.next));

function splitterBranchLeadsWithContainer(list) {
  const byId = new Map(list.map((t) => [t.id, t]));
  const out = [];
  for (const t of list) {
    if (!t || t.type !== 'conversationai_ai_splitter' || !Array.isArray(t.next)) continue;
    for (const entryId of t.next) {
      const entry = byId.get(entryId);
      const head = entry && typeof entry.next === 'string' ? byId.get(entry.next) : null;
      if (!isContainer(head)) continue;
      out.push(`splitter '${t.name ?? t.id}' branch '${entry.name ?? entry.id}' leads directly `
        + `with '${head.name ?? head.id}' (${head.type}), a multipath container — GHL never offers a `
        + `branch whose first step is a container, so this branch is never chosen no matter how well `
        + `the conversation matches it. Put one simple step (add_notes, update_contact_field, `
        + `conversationai_continue, …) at the head of the branch, before the container.`);
    }
  }
  return out;
}

export function checkGraphContextRules(templates, { warn, skipGraphContextRules } = {}) {
  if (skipGraphContextRules === true) return [];
  const list = Array.isArray(templates) ? templates : [];
  const findings = [...gotoPlacement(list), ...mathUpstreamRefs(list), ...manualStepHoldsChain(list), ...findAfterCreateRace(list), ...splitterBranchLeadsWithContainer(list)];
  for (const f of findings) warn?.(`GRAPH_CONTEXT: ${f}`);
  return findings;
}
