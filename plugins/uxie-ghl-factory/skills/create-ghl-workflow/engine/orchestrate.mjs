// THE canonical build path. An agent must route every workflow build through
// orchestrate() — never hand-assemble calls — so dependency pre-creation and
// name resolution can't be forgotten (the "workflow built but its tags never
// existed" class of bug).
//
// What it guarantees, in order:
//   1. Resolve every human NAME → the account's real ID (pipelines/stages/
//      calendars/users/forms/custom-fields/AI-agents).
//   2. ABORT LOUDLY if an account-level dependency is missing (a pipeline/
//      calendar/user/form/agent that doesn't exist) — it will NOT build a
//      workflow that silently points at nothing. The caller surfaces the list.
//   3. AUTO-CREATE workflow-local dependencies that are safe to create: tags
//      and inline email templates.
//   4. compile → create draft → auto-save steps → create triggers.
//   5. Round-trip verify (sent vs GET) and report per-step.
//   6. Optional publish (opts.publish) — draft otherwise.
//
// The caller supplies a `gw` gateway: { call(method,path,body[,base]), loc, uid }.
// `call` returns { status, ok, json }. Kept transport-agnostic so it's testable.
import { compile } from './compiler.mjs';
import { makeUuidV4 } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';
import { collectRequiredTags, missingTags } from './tags.mjs';
import { buildResolvers, resolveIR } from './resolve.mjs';

const BASE = 'https://backend.leadconnectorhq.com';

// Fetch the account entities the resolver needs. Each is best-effort — a missing
// endpoint degrades that resolver to "unresolvable", never throws.
export async function fetchEntities(gw) {
  const { call, loc } = gw;
  const g = async (p) => { try { const r = await call('GET', p); return r.ok ? r.json : {}; } catch { return {}; } };
  const [pl, cl, us, fm, cf, agS, agC] = await Promise.all([
    g(`/opportunities/pipelines?locationId=${loc}`),
    g(`/calendars/?locationId=${loc}`),
    g(`/users/?locationId=${loc}`),
    g(`/forms/?locationId=${loc}&limit=100`),
    g(`/locations/${loc}/customFields`),
    g(`/voice-ai/agents?locationId=${loc}`),               // best-effort (may 404)
    g(`/ai-employees/agents?locationId=${loc}`),           // best-effort (may 404)
  ]);
  const agents = [...(agS.agents || agS.data || []), ...(agC.agents || agC.data || [])]
    .map((a) => ({ id: a.id || a._id, name: a.name || a.agentName || a.title }));
  return {
    pipelines: (pl.pipelines || []).map((p) => ({ id: p.id || p._id, name: p.name, stages: (p.stages || []).map((s) => ({ id: s.id, name: s.name })) })),
    calendars: (cl.calendars || []).map((c) => ({ id: c.id || c._id, name: c.name })),
    users: (us.users || us || []).map((u) => ({ id: u.id || u._id, firstName: u.firstName, lastName: u.lastName, email: u.email, name: u.name })),
    forms: (fm.forms || []).map((f) => ({ id: f.id || f._id, name: f.name })),
    customFields: (cf.customFields || cf || []).map((c) => ({ id: c.id || c._id, name: c.name, fieldKey: c.fieldKey })),
    agents,
  };
}

// email nodes carrying an inline template spec: attributes._template {title, html, previewText}
function collectEmailTemplates(ir) {
  const out = [];
  const walk = (nodes) => { for (const n of nodes ?? []) {
    if (n.type === 'email' && n.attributes?._template) out.push(n);
    for (const b of n.branches ?? []) walk(b.then);
    for (const p of n.paths ?? []) walk(p.then);
    for (const k of ['onEvent', 'onTimeout', 'onFound', 'onNotFound', 'default']) walk(n[k]);
  } };
  walk(ir.graph);
  return out;
}

export async function orchestrate(ir, gw, opts = {}) {
  const { call, loc, uid } = gw;
  const catalog = loadCatalog();
  const report = { wid: null, resolvedFrom: null, unresolved: [], createdTags: [], createdTemplates: [],
    steps: 0, verify: { pass: 0, issues: [] }, published: false, aborted: null };

  // 1. resolve names → ids
  const entities = await fetchEntities(gw);
  const resolvers = buildResolvers(entities);
  const { unresolved } = resolveIR(ir, resolvers);
  report.unresolved = unresolved;
  report.resolvedFrom = { pipelines: entities.pipelines.length, calendars: entities.calendars.length,
    users: entities.users.length, forms: entities.forms.length, agents: entities.agents.length };

  // 2. ABORT on missing account-level deps (don't build something broken)
  if (unresolved.length && !opts.ignoreUnresolved) {
    report.aborted = `Missing account dependencies: ${unresolved.map((u) => `${u.name} (${u.where})`).join('; ')}. `
      + `Create/rename these in the sub-account first, or pass ignoreUnresolved to build anyway.`;
    return report;
  }

  // 3a. pre-create inline email templates
  for (const n of collectEmailTemplates(ir)) {
    const spec = n.attributes._template;
    const c = await call('POST', '/emails/builder', { locationId: loc, type: 'html', title: spec.title, name: spec.title, updatedBy: uid, isPlainText: false });
    const tid = c.json?.id || c.json?._id;
    if (tid) {
      await call('POST', '/emails/builder/data', { locationId: loc, templateId: tid, updatedBy: uid, html: spec.html, editorType: 'html', previewText: spec.previewText || '', isPlainText: false });
      n.attributes.template_id = tid; n.attributes.templatesource = 'email-builder';
      report.createdTemplates.push({ title: spec.title, id: tid });
    }
    delete n.attributes._template;
  }

  // 3b. pre-create tags referenced anywhere in the IR (THE fix for the missing-tags bug)
  const required = collectRequiredTags(ir);
  if (required.length) {
    const tl = await call('GET', `/locations/${loc}/tags`);
    const existing = (tl.json?.tags || tl.json || []).map((t) => t.name);
    for (const name of missingTags(required, existing)) {
      const r = await call('POST', `/locations/${loc}/tags`, { name });
      if (r.ok) report.createdTags.push(name);
    }
  }

  // 4. compile + build
  const built = compile(ir, { loc, cid: undefined, uid, companyAge: 0, idGen: makeUuidV4, catalog });
  const ph = built._wid;
  const c = await call('POST', `/workflow/${loc}`, built.createBody);
  const WID = c.json?.id || c.json?._id;
  if (!WID) { report.aborted = `create failed: ${c.status}`; return report; }
  report.wid = WID;
  const swap = (o) => JSON.parse(JSON.stringify(o).split(ph).join(WID));
  const sent = swap(built.autoSaveBody);
  const s = await call('PUT', `/workflow/${loc}/${WID}/auto-save`, sent);
  if (!s.ok) { report.aborted = `auto-save failed: ${s.status}`; return report; }
  for (const tb of built.triggerBodies.map(swap)) await call('POST', `/workflow/${loc}/trigger`, tb);

  // 5. round-trip verify
  const back = await call('GET', `/workflow/${loc}/${WID}?includeScheduledPauseInfo=true`);
  const got = back.json?.workflowData?.templates || [];
  const sentById = new Map(sent.workflowData.templates.map((x) => [x.id, x]));
  report.steps = got.length;
  for (const gt of got) {
    const st = sentById.get(gt.id); if (!st) continue;
    const dropped = Object.keys(st.attributes || {}).filter((k) => !(k in (gt.attributes || {})) && k !== 'template_id');
    if (dropped.length) report.verify.issues.push({ type: gt.type, dropped }); else report.verify.pass++;
  }

  // 6. optional publish (opt-in; strip server/session fields, flip status)
  if (opts.publish) {
    const fresh = (await call('GET', `/workflow/${loc}/${WID}`)).json;
    for (const k of ['autoSaveSession', 'autoSaveSessionId', '__v', 'filePath', 'createdAt', 'updatedAt']) delete fresh[k];
    fresh.status = 'published';
    const pub = await call('PUT', `/workflow/${loc}/${WID}`, fresh);
    report.published = pub.ok;
    if (!pub.ok) report.verify.issues.push({ publish: pub.status, body: JSON.stringify(pub.json).slice(0, 160) });
  }

  return report;
}
