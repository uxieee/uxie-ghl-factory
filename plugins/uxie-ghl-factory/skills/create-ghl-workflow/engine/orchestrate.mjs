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
import { danglingParentKeys } from './edit.mjs';

const BASE = 'https://backend.leadconnectorhq.com';

// Fetch the account entities the resolver needs. Each is best-effort — a missing
// endpoint degrades that resolver to "unresolvable", never throws.
export async function fetchEntities(gw) {
  const { call, loc } = gw;
  const g = async (p) => { try { const r = await call('GET', p); return r.ok ? r.json : {}; } catch { return {}; } };
  const arrayFrom = (...values) => values.find(Array.isArray) ?? [];
  const recordsFrom = (...values) => arrayFrom(...values)
    .filter((value) => value && typeof value === 'object' && !Array.isArray(value));
  const locationQuery = (extra = {}) => new URLSearchParams({ locationId: String(loc), ...extra });
  const locationPath = encodeURIComponent(String(loc));
  const [pl, cl, us, fm, cf, agS, agC] = await Promise.all([
    g(`/opportunities/pipelines?${locationQuery()}`),
    g(`/calendars/?${locationQuery()}`),
    g(`/users/?${locationQuery()}`),
    g(`/forms/?${locationQuery({ limit: '100' })}`),
    // model=all: the plain /customFields endpoint returns CONTACT fields only, so an
    // update_opportunity referencing an OPPORTUNITY custom field false-threw OPP_FIELD_UNKNOWN
    // (live-caught on GROM AU 2026-07-18). The search endpoint returns every model's custom
    // fields; includeStandards=false keeps it to genuine custom fields (standard opp fields
    // like name/status are matched by STANDARD_OPP_FIELDS before the custom lookup).
    g(`/locations/${locationPath}/customFields/search?${new URLSearchParams({
      parentId: '', skip: '0', limit: '10000', documentType: 'field',
      model: 'all', query: '', includeStandards: 'false',
    })}`),
    g(`/voice-ai/agents?${locationQuery()}`),               // best-effort (may 404)
    g(`/ai-employees/agents?${locationQuery()}`),           // best-effort (may 404)
  ]);
  const agents = [...recordsFrom(agS?.agents, agS?.data, agS), ...recordsFrom(agC?.agents, agC?.data, agC)]
    .map((a) => ({ id: a.id || a._id, name: a.name || a.agentName || a.title }));
  return {
    pipelines: recordsFrom(pl?.pipelines, pl).map((p) => ({
      id: p.id || p._id, name: p.name,
      stages: recordsFrom(p.stages).map((s) => ({ id: s.id, name: s.name })),
    })),
    calendars: recordsFrom(cl?.calendars, cl).map((c) => ({ id: c.id || c._id, name: c.name })),
    users: recordsFrom(us?.users, us).map((u) => ({ id: u.id || u._id, firstName: u.firstName, lastName: u.lastName, email: u.email, name: u.name })),
    forms: recordsFrom(fm?.forms, fm).map((f) => ({ id: f.id || f._id, name: f.name })),
    customFields: recordsFrom(cf?.customFields, cf).map((c) => ({ id: c.id || c._id, name: c.name, fieldKey: c.fieldKey, dataType: c.dataType, model: c.model })),
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
  // authored/compiled/steps are reported TOGETHER on purpose. A bare "steps: 8 | round-trip:
  // 8 clean" hid a dropped 51-step subtree on a live build (2026-07-16) because round-trip
  // only compares SENT vs GOT — both were 8. `authored` is the only number tied to what the
  // operator actually wrote. compile() hard-fails on a drop; this surfaces the shape anyway.
  const report = { wid: null, resolvedFrom: null, unresolved: [], createdTags: [], createdTemplates: [],
    authored: 0, compiled: 0, steps: 0, warnings: [],
    triggers: { posted: 0, failed: [] }, verify: { pass: 0, issues: [] }, published: false, aborted: null };

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
    const tagList = Array.isArray(tl.json) ? tl.json : (tl.json?.tags ?? []);
    const existing = tagList.map((t) => t.name);
    for (const name of missingTags(required, existing)) {
      const r = await call('POST', `/locations/${loc}/tags`, { name });
      if (r.ok) report.createdTags.push(name);
    }
  }

  // 4. compile + build. IR rejections (OPP_UNASSOCIATED, schema/invariant errors)
  //    land in report.aborted like the other failure modes — not a raw throw.
  let built;
  try {
    built = compile(ir, { loc, cid: undefined, uid, companyAge: 0, idGen: makeUuidV4, catalog,
      customFields: entities.customFields, warn: (msg) => report.warnings.push(msg),
      // §5: an account-wide email sender default. Reachable two ways — programmatically via
      // opts.senderDefault, or declaratively as a top-level `senderDefault` on the IR (which
      // parseIR passes through). Without either, email steps fall back to {{location.*}}.
      senderDefault: opts.senderDefault ?? ir.senderDefault });
  } catch (e) {
    if (e?.name === 'IRError') { report.aborted = `compile rejected (${e.code}): ${e.message}`; return report; }
    throw e;
  }
  report.authored = built.authored;
  report.compiled = built.compiled;
  const ph = built._wid;
  const c = await call('POST', `/workflow/${loc}`, built.createBody);
  const WID = c.json?.id || c.json?._id;
  if (!WID) { report.aborted = `create failed: ${c.status}`; return report; }
  report.wid = WID;
  const swap = (o) => JSON.parse(JSON.stringify(o).split(ph).join(WID));
  const sent = swap(built.autoSaveBody);
  const s = await call('PUT', `/workflow/${loc}/${WID}/auto-save`, sent);
  if (!s.ok) { report.aborted = `auto-save failed: ${s.status}`; return report; }
  // Trigger POSTs right after auto-save intermittently 400 {"message":"Workflow
  // not found"} — the workflow doc hasn't settled server-side yet (observed live
  // 2026-07-13). Retry with backoff, and RECORD failures instead of dropping them.
  const backoff = opts.triggerBackoffMs ?? [0, 700, 2000];
  for (const tb of built.triggerBodies.map(swap)) {
    let r;
    for (const delay of backoff) {
      if (delay) await new Promise((res) => setTimeout(res, delay));
      r = await call('POST', `/workflow/${loc}/trigger`, tb);
      if (r.ok) break;
    }
    if (r?.ok) report.triggers.posted++;
    else report.triggers.failed.push({ type: tb.type, name: tb.name, status: r?.status,
      error: JSON.stringify(r?.json ?? '').slice(0, 160) });
  }

  // 5. round-trip verify
  const back = await call('GET', `/workflow/${loc}/${WID}?includeScheduledPauseInfo=true`);
  const got = back.json?.workflowData?.templates || [];
  const sentById = new Map(sent.workflowData.templates.map((x) => [x.id, x]));
  report.steps = got.length;
  // The server dropping whole steps is a distinct failure from it dropping attributes —
  // and the old per-step loop `continue`d right past it, so a short GET still reported
  // every surviving step as a pass.
  if (got.length !== sent.workflowData.templates.length)
    report.verify.issues.push({ stepCountMismatch: { sent: sent.workflowData.templates.length, got: got.length },
      note: 'GHL did not persist every step that was sent — the workflow is INCOMPLETE.' });
  // Fail on a parentKey referencing a step that isn't in the graph, the way we fail on a
  // step-count mismatch. GHL's runtime walks `next` so a dangling parentKey does not break
  // execution (finding 2026-07-17f) — but it makes the builder graph unreadable and the
  // validator may not stay forgiving, so surface it rather than let it round-trip silently.
  const dangling = danglingParentKeys(got);
  if (dangling.length)
    report.verify.issues.push({ danglingParentKeys: dangling,
      note: 'step(s) point parentKey at a missing step — builder hygiene, not a runtime break (runtime walks `next`). Repair with the repairParentKeys edit op.' });
  for (const gt of got) {
    const st = sentById.get(gt.id); if (!st) continue;
    const dropped = Object.keys(st.attributes || {}).filter((k) => !(k in (gt.attributes || {})) && k !== 'template_id');
    if (dropped.length) report.verify.issues.push({ type: gt.type, dropped }); else report.verify.pass++;
  }

  // 6. optional publish (opt-in). Mirrors the builder's real publish PUT — this is
  //    NOT a bare status flip. The UI sends the WHOLE workflow object as-is (it keeps
  //    filePath/fileUrl/version/autoSaveSessionId — do NOT strip them), bumps `version`,
  //    and includes oldTriggers + newTriggers (the full trigger list). Those trigger
  //    arrays are what wire the triggers into the live execution bucket; without them
  //    status becomes "published" but the workflow never fires (verified 2026-07-11).
  if (opts.publish) {
    // NB: the bare GET /workflow/{loc}/{wid} 404s ("Not Found") — the workflow GET
    // REQUIRES the ?includeScheduledPauseInfo=true query param.
    const fresh = (await call('GET', `/workflow/${loc}/${WID}?includeScheduledPauseInfo=true`)).json;
    const tr = (await call('GET', `/workflow/${loc}/trigger?workflowId=${WID}`)).json;
    const triggers = (Array.isArray(tr) ? tr : (tr?.triggers || tr?.data || [])).map((t) => ({ ...t, active: true }));
    // Send the CURRENT version (optimistic-concurrency check) — NOT version+1, which
    // 422s "version is outdated". The server bumps it internally on publish.
    const body = { ...fresh, status: 'published', version: fresh.version,
      triggersChanged: false, oldTriggers: triggers, newTriggers: triggers,
      modifiedSteps: [], deletedSteps: [], createdSteps: [] };
    const pub = await call('PUT', `/workflow/${loc}/${WID}`, body);
    const check = (await call('GET', `/workflow/${loc}/${WID}?includeScheduledPauseInfo=true`)).json;
    report.published = pub.ok && (check?.status === 'published');
    if (!report.published) report.verify.issues.push({ publish: pub.status, status: check?.status, body: JSON.stringify(pub.json).slice(0, 160) });
  }

  return report;
}
