// Inbound-webhook rail: the receiving URL (knowable as soon as the trigger POST returns — ids
// are SERVER-assigned; the builder only pre-knows them via predeterminedId, which we don't send), the `{{inboundWebhookRequest.*}}` reference lint against a sample
// payload, and the pure plan for pinning a sample as the trigger's mapping REFERENCE.
//
// Harvested 2026-08-22 from the builder source (InboundWebhookTrigger.vue,
// InboundWebhookRequestService.ts, utils/merge_tags.ts) and live-proven on GROM AU:
//  - receiving URL  POST https://services.leadconnectorhq.com/hooks/{loc}/webhook-trigger/{triggerId}
//    (unauthenticated by design — external systems post to it)
//  - management     GET  /hooks/inbound-webhook-request/trigger/{triggerId}?limit=10&locationId=
//                   GET  /hooks/inbound-webhook-request/reference/{triggerId}?locationId=
//                   PUT  /hooks/inbound-webhook-request/set-as-reference/{requestId}?locationId=
//    (served on BOTH backend.leadconnectorhq.com and services.leadconnectorhq.com)
//  - the merge-tag vocabulary is EXACTLY the leaf paths of the pinned reference payload —
//    the sample IS the schema (GHL also stores the request `headers` inside the payload).
import { webhookMergeTags } from './webhook-mergetags.mjs';

export const WEBHOOK_HOOKS_BASE = 'https://services.leadconnectorhq.com/hooks';
export const WEBHOOK_TRIGGER_TYPE = 'inbound_webhook';
const REF_RE = /\{\{\s*inboundWebhookRequest(?:\.([A-Za-z0-9_.$-]+))?\s*\}\}/g;

/** The URL external systems POST to for one inbound_webhook trigger. */
export const webhookTriggerUrl = (loc, triggerId) => `${WEBHOOK_HOOKS_BASE}/${loc}/webhook-trigger/${triggerId}`;

/** Every `{{inboundWebhookRequest[.path]}}` reference in the compiled templates, with the step. */
export function findWebhookRefs(templates) {
  const refs = [];
  for (const t of templates ?? []) {
    const walk = (v) => {
      if (typeof v === 'string') { for (const m of v.matchAll(REF_RE)) refs.push({ step: t.name ?? t.id ?? '?', path: m[1] ?? '' }); }
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(t?.attributes);
  }
  return refs;
}

/**
 * Advisory lint: every referenced path must exist as a leaf (or an object/array prefix) of the
 * sample payload — because at runtime the picker/merge only knows the pinned reference's
 * leaves. Warns (ctx.warn) and returns findings; hatch ctx.skipWebhookCheck.
 */
export function checkWebhookRefs(templates, samplePayload, ctx = {}) {
  if (ctx.skipWebhookCheck === true || samplePayload == null || typeof samplePayload !== 'object') return [];
  const warn = (m) => { if (typeof ctx.warn === 'function') ctx.warn(m); };
  const leaves = Object.keys(webhookMergeTags(samplePayload, { includeHeaders: true }));
  const known = new Set(leaves);
  // an object/array prefix is legal too: {{inboundWebhookRequest.items}} feeds a loop
  for (const l of leaves) { const parts = l.split('.'); for (let i = 1; i < parts.length; i++) known.add(parts.slice(0, i).join('.')); }
  const findings = [];
  for (const r of findWebhookRefs(templates)) {
    if (r.path === '' || known.has(r.path)) continue;
    const near = nearMisses(r.path, leaves);
    const msg = `'${r.step}' references {{inboundWebhookRequest.${r.path}}} but the sample payload has no such path` + (near.length ? ` (did you mean ${near.join(', ')}?)` : '') + ' — at runtime it renders EMPTY.';
    findings.push({ step: r.step, path: r.path, near });
    warn(`webhook: ${msg}`);
  }
  return findings;
}

// Near-miss hint: same last segment modulo a typo (edit distance ≤ 2) or a substring either way.
function editDistance(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
function nearMisses(path, leaves) {
  const want = path.split('.').pop().toLowerCase();
  return leaves.filter((l) => {
    const last = l.split('.').pop().toLowerCase();
    return last.includes(want) || want.includes(last) || editDistance(last, want) <= 2;
  }).slice(0, 3);
}

/** Pure plan for pinning a sample as the reference — executed by orchestrate / the MCP tool. */
export function planWebhookPin({ loc, triggerId, samplePayload }) {
  return {
    post: { method: 'POST', url: webhookTriggerUrl(loc, triggerId), body: samplePayload, auth: 'none' },
    list: { method: 'GET', path: `/hooks/inbound-webhook-request/trigger/${triggerId}?${new URLSearchParams({ limit: '10', locationId: loc })}` },
    pin: (requestId) => ({ method: 'PUT', path: `/hooks/inbound-webhook-request/set-as-reference/${requestId}?${new URLSearchParams({ locationId: loc })}`, body: { locationId: loc } }),
    reference: { method: 'GET', path: `/hooks/inbound-webhook-request/reference/${triggerId}?${new URLSearchParams({ locationId: loc })}` },
  };
}

/** Report helper: the URL for every inbound_webhook trigger body the build posted. */
export function webhookUrlsFor(loc, triggerBodies) {
  return (triggerBodies ?? []).filter((tb) => tb?.type === WEBHOOK_TRIGGER_TYPE && (tb.id || tb.predeterminedId))
    .map((tb) => ({ name: tb.name ?? null, triggerId: tb.id ?? tb.predeterminedId, url: webhookTriggerUrl(loc, tb.id ?? tb.predeterminedId) }));
}
