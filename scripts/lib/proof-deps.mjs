// What a tool's proof DEPENDS ON, computed the same way by the one writer (scripts/proof.mjs) and
// the one reader (the Surface Console). Two implementations of "did this endpoint change" would
// disagree the first time either was edited — so there is exactly one, and both import it.
//
// Keys, never catalogue ids: one fold commit renamed 23 ids in a single step, and a dependency keyed
// by id would have read every one of them as a disappeared endpoint.
import { createHash } from 'node:crypto';

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export const normPath = (p) => {
  const s = String(p ?? '').split('?')[0]
    .replace(/\$\{[^}]*\}|\{[^}]*\}|:[A-Za-z_]\w*/g, '{}')
    .replace(/\/+$/, '');
  return s || '/';
};
export const routeKey = (method, path) => `${String(method).toUpperCase()} ${normPath(path)}`;
export const endpointKey = (method, origin, path) => `${String(method).toUpperCase()} ${origin} ${normPath(path)}`;

// Deterministic JSON: sorted keys at every depth, so a re-ordered catalogue row hashes the same.
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
    : JSON.stringify(v ?? null));

export function catalogIndex(endpoints) {
  const byRoute = new Map();
  const byKey = new Map();
  const push = (m, k, e) => { if (!m.has(k)) m.set(k, []); if (!m.get(k).includes(e)) m.get(k).push(e); };
  for (const e of endpoints) {
    // An `aka` is a path the same row was once known by: a rename, never a second endpoint.
    for (const p of [e.path, ...(e.aka ?? [])]) push(byRoute, routeKey(e.method, p), e);
    push(byKey, endpointKey(e.method, e.origin, e.path), e);
  }
  return { byRoute, byKey };
}

// The key is not unique (six keys map to two rows on 2026-09-14), so the hash covers the SET of rows
// sharing it, sorted, and never the row id.
export const rowHash = (rows) => sha256(rows
  .map((e) => canon({ method: e.method, origin: e.origin, path: normPath(e.path), query: e.query ?? null, body: e.body ?? null }))
  .sort().join('\n'));

const joined = (tool, manifest, index) => manifest
  .filter((r) => r.tool === tool)
  .flatMap((m) => index.byRoute.get(routeKey(m.method, m.path)) ?? []);

export function endpointHashes(tool, manifest, index) {
  const keys = new Set(joined(tool, manifest, index).map((e) => endpointKey(e.method, e.origin, e.path)));
  return Object.fromEntries([...keys].sort().map((k) => [k, rowHash(index.byKey.get(k))]));
}

export function primarySurfaces(tool, manifest, index) {
  const votes = new Map();
  for (const e of joined(tool, manifest, index)) if (e.service) votes.set(e.service, (votes.get(e.service) ?? 0) + 1);
  if (!votes.size) return ['unassigned'];
  const top = Math.max(...votes.values());
  return [...votes].filter(([, n]) => n === top).map(([s]) => s).sort();
}

// 🔴 A GUESS MAY NOT GATE A PROOF. Until 2026-09-15 this took `tier1.length ? tier1 : list`, and
// since NO surface in app-surface-map.json has a tier-1 app, the fallback fired everywhere and every
// listed app became a gating dependency whatever its confidence. `workflows` lists adPublishingApp
// and notificationApp at tier 3, both `confidence: "GUESS"`, neither carrying a `why` — and
// adPublishingApp shipped seven builds in seventeen days, so all 27 workflow tools were demoted to
// `shipped` roughly every 1.3 days and `confirmed` sat at 0 permanently. A signal that fires that
// often for an unverified reason is not a signal.
//
// The guess was not merely unproven, it was contradicted: zero of the 311 capability rows touch an
// /ad-publishing or /notification path, so those builds cannot bear on whether our tools work.
//
// Nothing is lost. The map still lists every app with its confidence and tier — that is where the
// "these might be related" knowledge belongs, and raising a confidence there is what promotes an app
// back into gating. `depends` accepts only four keys (proof-record.mjs keysOnly), so a non-gating
// copy inside the record is not available and would duplicate the map anyway.
//
// Deliberately NOT extended to tiers: tier is about how central an app is, confidence is about
// whether we KNOW. Only the second belongs in a gate. See console bl-145.
const GATES = (a) => String(a?.confidence ?? '').toUpperCase() !== 'GUESS';
// SCOPED TO THE TOOLS IT BEARS ON. An app entry may name `tools`: then it gates those tools only.
// reportingApp is on the workflows surface because it hosts the stats screen behind get_workflow_stats,
// and nothing else — but without a scope it gated all 36 workflows tools, so every reporting-page ship
// (262 -> 278 in 26 days) demoted build_workflow and edit_workflow to "GHL shipped" and the console's
// "confirmed" sat at 0 of 83 hours after a full live run (2026-09-24). Same failure as bl-145, one tier up.
const APPLIES = (a, tool) => !Array.isArray(a?.tools) || tool == null || a.tools.includes(tool);
export function buildDeps(surfaces, map, { apps, builderEntry = null, tool = null }) {
  const out = {};
  for (const s of surfaces) {
    const list = (map.surfaces?.[s] ?? []).filter((a) => a?.app).filter(GATES).filter((a) => APPLIES(a, tool));
    const tier1 = list.filter((a) => a.tier === 1);
    for (const a of (tier1.length ? tier1 : list)) out[a.app] = apps.get(a.app)?.build ?? null;
    // The workflow builder is its own SPA; the federated manifest cannot see it.
    if (s === 'workflows') out['builder-chunks'] = builderEntry;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
