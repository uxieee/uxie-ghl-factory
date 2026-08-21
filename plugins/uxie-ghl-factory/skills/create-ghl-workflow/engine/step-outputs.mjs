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
  'task-notification':{ ns: '[task-notification]',fields: ['id', 'title', 'body', 'bodyRawText', 'dueDate', 'assignedTo'], kind: 'fixed', note: 'bracketed namespace' },
});

const NS_TO_TYPE = Object.freeze(Object.fromEntries(Object.entries(STEP_OUTPUTS).map(([ty, v]) => [v.ns.replace(/^\[|\]$/g, ''), ty])));
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
 * PRODUCER (same type, same stepIndex — or Nth occurrence when stepIndex is absent), and is a
 * referenced custom_webhook actually configured to save its response? ctx.warn only.
 */
export function checkStepOutputRefs(templates, ctx = {}) {
  if (ctx.skipStepOutputCheck === true) return [];
  const warn = (m) => { if (typeof ctx.warn === 'function') ctx.warn(m); };
  const producers = new Map();           // type → [{n, step}]
  const occ = new Map();
  for (const t of templates ?? []) {
    if (!STEP_OUTPUTS[t?.type]) continue;
    const k = t.type; const cnt = (occ.get(k) ?? 0) + 1; occ.set(k, cnt);
    const n = Number.isInteger(t.stepIndex) ? t.stepIndex : cnt;
    (producers.get(k) ?? producers.set(k, []).get(k)).push({ n, step: t });
  }
  const findings = [];
  for (const t of templates ?? []) {
    const texts = [];
    const walk = (v) => { if (typeof v === 'string') texts.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
    walk(t?.attributes);
    for (const s of texts) for (const ref of findOutputRefs(s)) {
      const list = producers.get(ref.type) ?? [];
      const hit = list.find((p) => p.n === ref.n);
      if (!hit) {
        findings.push(ref);
        warn(`step output ${ref.raw} on '${t.name ?? t.id}': no ${ref.type} step with stepIndex ${ref.n} exists in this workflow — the reference renders literally/empty at runtime. N is the per-type stepIndex (see references/step-outputs).`);
        continue;
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
