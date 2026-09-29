// STEP OUTPUTS (G16) — the contract for referencing what a step PRODUCES.
//
// Producing steps expose data to LATER steps as merge tags ({{ns.N.field}}) and if/else
// conditions ({conditionType: <group>, conditionSubType: "N.field"}). Source contract
// (reference/STEP-OUTPUTS.md, recovered builder source, 2026-08-22):
//   • N = the step's per-type `stepIndex` — a 1-based monotonic counter minted at creation from
//     workflow.meta.stepIndexCounter[type] and PERSISTED on the step (top level). There is NO
//     step-id binding (sole exception: the `trigger` condition group stores the trigger id).
//   • ⚠ deleting the highest-indexed step of a type REBASES the counter, so the next step of
//     that type reuses N and stale references silently rebind to the new step.
//   • Scope: the picker offers only ANCESTORS of the current node (sibling branches never).
//   • custom_webhook outputs exist only when the step has saveResponse:true AND a saved
//     successful test (attributes.webhookResponse) — the fields come from that blob.
//   • inboundWebhookRequest.* has no N (per-trigger reference request); marketplace TRIGGER
//     outputs have no N either; marketplace ACTION outputs are {{<actionType>.N.<reference>}}
//     from the app's declared customVars.
//
// This module is the REGISTRY (what an LLM needs to author references) + advisory checks.
// Severity: warnings only — a reference to a producer the engine can see is checkable; runtime
// join semantics are server-side and stay unasserted.

export const STEP_OUTPUTS = Object.freeze({
  chatgpt:            { ns: 'chatgpt',            fields: ['response'], kind: 'fixed' },
  custom_webhook:     { ns: 'custom_webhook',     fields: ['response', 'headers', 'status'], kind: 'per-instance', from: 'attributes.webhookResponse (requires saveResponse:true + a successful test request)' },
  custom_code:        { ns: 'custom_code',        fieldsFrom: (a) => Object.keys(a?.output ?? {}).map((k) => `output.${k}`), kind: 'per-instance', from: 'attributes.output (the run-test result)' },
  ai_agent:           { ns: 'ai_agent',           fields: ['response'], kind: 'per-instance', from: 'structuredResponse JSON schema adds paths beyond .response' },
  datetime_formatter: { ns: 'datetime_formatter', fields: ['date', 'datetime', 'days'], kind: 'fixed', note: 'condition subtypes append _system_format for date operators' },
  number_formatter:   { ns: 'number_formatter',   fields: ['result'], kind: 'fixed' },
  text_formatter:     { ns: 'text_formatter',     fields: ['result'], kind: 'fixed' },
  math_operation:     { ns: 'math_operation',     fields: ['result'], kind: 'fixed' },
  array_functions:    { ns: 'array_functions',    fields: ['result'], kind: 'per-instance', from: 'per action; object paths come from the snapshotted referenceObject; primitives → [N]' },
  // live 2026-09-28: all three rendered in a later field write (knowledge live-3Q-generate-image.json)
  workflow_ai_generate_image: { ns: 'workflow_ai_generate_image', fields: ['image_url', 'image_file.path', 'image_file.name'], kind: 'fixed' },
  'task-notification':{ ns: '[task-notification]',fields: ['id', 'title', 'body', 'bodyRawText', 'dueDate', 'assignedTo'], kind: 'fixed', note: 'bracketed namespace' },
  // Two namespaces, and WHICH action produces each matters (utils/premium-actions-helpers/google_sheets_helpers.ts:66-137):
  // lookup_row #N → {{sheet.N.<column letter>}} (one per sheetHeaders entry, A, B, … AA) and {{sheet.N.rowNumber}};
  // lookup_multiple_rows #N → {{sheet.N.rowCount}} and {{sheetLookupResult.N.result}}. Other Sheets actions produce nothing.
  google_sheets:      { ns: 'sheet', alsoNs: ['sheetLookupResult'], fields: ['<column letter>', 'rowNumber', 'rowCount'], kind: 'per-instance',
    from: 'lookup_row: column letters + rowNumber; lookup_multiple_rows: rowCount + sheetLookupResult.N.result' },
});

const NS_TO_TYPE = Object.freeze(Object.fromEntries(Object.entries(STEP_OUTPUTS).flatMap(([ty, v]) =>
  [v.ns, ...(v.alsoNs ?? [])].map((ns) => [ns.replace(/^\[|\]$/g, '').toLowerCase(), ty]))));

// Column letters as the builder mints them from a header's index (getColumnLetters: 0 → A, 25 → Z, 26 → AA).
const columnIndex = (letters) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
/** Why a Sheets reference does not match what its producer step emits, or null when it does. */
function sheetsRefMismatch(ref, step) {
  const action = step.attributes?.action?.id;
  const ns = ref.ns.toLowerCase();
  if (ns === 'sheetlookupresult') return action === 'lookup_multiple_rows' && ref.field === 'result' ? null
    : `only a lookup_multiple_rows step produces {{sheetLookupResult.N.result}} (step #${ref.n} is ${action || 'no action'})`;
  if (ref.field === 'rowCount') return action === 'lookup_multiple_rows' ? null
    : `rowCount comes only from lookup_multiple_rows (step #${ref.n} is ${action || 'no action'})`;
  if (action !== 'lookup_row') return `{{sheet.N.${ref.field}}} comes only from lookup_row (step #${ref.n} is ${action || 'no action'})`;
  if (ref.field === 'rowNumber') return null;
  if (!/^[A-Z]+$/i.test(ref.field)) return `'${ref.field}' is not a column letter or rowNumber`;
  const headers = step.attributes?.sheetHeaders;
  if (Array.isArray(headers) && headers.length && columnIndex(ref.field) >= headers.length)
    return `column ${ref.field} is past the step's ${headers.length} sheetHeaders`;
  return null;
}
const REF_RE = /\{\{\s*\[?([a-z_][a-z0-9_-]*)\]?\.(\d+)\.([^}\s]+)\s*\}\}/gi;

/** Every {{ns.N.field}} step-output reference in a string. */
export function findOutputRefs(text) {
  if (typeof text !== 'string') return [];
  return [...text.matchAll(REF_RE)]
    .filter((m) => NS_TO_TYPE[m[1].toLowerCase()])
    .map((m) => ({ ns: m[1], type: NS_TO_TYPE[m[1].toLowerCase()], n: Number(m[2]), field: m[3], raw: m[0] }));
}

/**
 * Advisory pass over compiled templates: does every step-output reference have a matching
 * PRODUCER, and is a referenced custom_webhook actually configured to save its response?
 * ctx.warn only.
 *
 * Matching is on the stored `stepIndex` when the producer has one. When it does not, the reference
 * is accepted at EITHER occurrence number, because the runtime demonstrably resolves a 0-based
 * reference against an unnumbered producer and we cannot yet say whether that is the rule or
 * leniency. Warning on a shape that works in production is worse than staying quiet.
 */
export function checkStepOutputRefs(templates, ctx = {}) {
  if (ctx.skipStepOutputCheck === true) return [];
  const warn = (m) => { if (typeof ctx.warn === 'function') ctx.warn(m); };
  const producers = new Map();           // type → [{ns:Set<number>, step}]
  const occ = new Map();
  for (const t of templates ?? []) {
    if (!STEP_OUTPUTS[t?.type]) continue;
    const k = t.type; const cnt = (occ.get(k) ?? 0) + 1; occ.set(k, cnt);
    // A step that HAS a stepIndex answers to exactly that number: producer and consumer only ever
    // need to agree, and the stored field is the key they agree on.
    //
    // A step with NO stepIndex is the case we do not get to be confident about. This used to assume
    // the 1-based occurrence and warn on anything else, which is a FALSE POSITIVE on shapes that
    // demonstrably work: a peer account has four math_operation steps with no stepIndex at all
    // whose consumers reference {{math_operation.0.result}}, and two production sends on different
    // days rendered the real, changing number. So the runtime resolves a 0-based reference against
    // a producer whose field was never written.
    //
    // One account is not enough to say whether that is a 0-based rule or leniency about the base,
    // and guessing wrong turns this advisory into noise on working workflows. So an absent
    // stepIndex accepts EITHER occurrence number and this check stays quiet — an advisory pass
    // should only speak where it knows.
    const ns = Number.isInteger(t.stepIndex) ? new Set([t.stepIndex]) : new Set([cnt - 1, cnt]);
    (producers.get(k) ?? producers.set(k, []).get(k)).push({ ns, step: t });
  }
  const findings = [];
  for (const t of templates ?? []) {
    const texts = [];
    const walk = (v) => { if (typeof v === 'string') texts.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
    walk(t?.attributes);
    for (const s of texts) for (const ref of findOutputRefs(s)) {
      const list = producers.get(ref.type) ?? [];
      const hit = list.find((p) => p.ns.has(ref.n));
      if (!hit) {
        findings.push(ref);
        warn(`step output ${ref.raw} on '${t.name ?? t.id}': no ${ref.type} step answers to ${ref.n} in this workflow — the reference renders literally/empty at runtime. N is the producer's stored stepIndex; a producer with no stepIndex answers to its occurrence position (see references/step-outputs).`);
        continue;
      }
      if (ref.type === 'google_sheets') {
        const why = sheetsRefMismatch(ref, hit.step);
        if (why) { findings.push(ref); warn(`step output ${ref.raw} on '${t.name ?? t.id}': ${why} — it renders empty at runtime.`); }
      }
      if (ref.type === 'custom_webhook' && hit.step.attributes?.saveResponse !== true) {
        findings.push(ref);
        warn(`step output ${ref.raw} on '${t.name ?? t.id}': webhook '${hit.step.name ?? hit.step.id}' has saveResponse ${JSON.stringify(hit.step.attributes?.saveResponse ?? false)} — the UI only exposes webhook outputs when "Save response from this Webhook" is ON and a successful test request was saved (webhookResponse).`);
      }
      if (ref.type === 'custom_code') {
        const out = hit.step.attributes?.output;
        if (!out || typeof out !== 'object' || !Object.keys(out).length)
          warn(`step output ${ref.raw} on '${t.name ?? t.id}': custom_code '${hit.step.name ?? hit.step.id}' has no run-test output object — the field list is empty until a test run is saved.`);
      }
    }
  }
  return findings;
}
