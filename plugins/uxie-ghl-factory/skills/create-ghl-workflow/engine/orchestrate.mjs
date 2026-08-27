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
import { planReadinessChecks, runReadinessChecks } from './preflight.mjs';
import { webhookUrlsFor } from './webhook-rail.mjs';
import { webhookMergeTags } from './webhook-mergetags.mjs';
import { planStickyNotes } from './sticky-notes.mjs';
import { makeUuidV4 } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';
import { collectRequiredTags, missingTags } from './tags.mjs';
import { buildResolvers, resolveIR } from './resolve.mjs';
import { danglingParentKeys } from './edit.mjs';
import { requiredKeysFor, isSupplied } from './required-fields.mjs';
import { fetchActionSchema, checkWorkflow } from './action-schema.mjs';
import { buildMarketplaceIndex } from './marketplace.mjs';
import { walkNodes } from './ir.mjs';
import { validateAssets, describeFinding } from './asset-preflight.mjs';
import { parseServerValidation, describeServerFindings } from './server-validation.mjs';
import { checkWorkflowRules } from './graph-rules.mjs';
import { checkGraphContextRules } from './graph-context-rules.mjs';
import { stripNullNext } from './terminals.mjs';

const BASE = 'https://backend.leadconnectorhq.com';

// Which attested required fields a PERSISTED step is missing. Uses the same
// presence-vs-non-empty rule the compiler applied, so verify cannot drift into a second,
// subtly different notion of "supplied" — a `waitForReply: false` is satisfied, an empty
// `description` is not.
export function missingRequiredFields(step) {
  const keys = requiredKeysFor(step?.type);
  if (!keys.length) return [];
  return keys.filter((k) => !isSupplied(step.type, k, step.attributes ?? {}));
}

const UPSTREAM_SECRET_KEY = /(?:authorization|token|jwt|api[-_ ]?(?:key|secret)|client[-_ ]?secret|password|credentials?|cookies?|session)/i;
const UPSTREAM_TOKENISH = /\bey[A-Za-z0-9._-]{20,}/g;
const UPSTREAM_BEARER = /\bBearer\s+[A-Za-z0-9._-]{8,}/gi;
const UPSTREAM_LABELED_SECRET = /\b((?:authorization|token|jwt|api[-_ ]?(?:key|secret)|client[-_ ]?secret|password|credentials?|cookies?|session))\s*([:=])\s*(?:Bearer\s+)?([^\s,;&#/]+)/gi;
function scrubUpstream(value, key = '') {
  if (UPSTREAM_SECRET_KEY.test(String(key))) return '<redacted>';
  if (typeof value === 'string') {
    return value
      .replace(UPSTREAM_TOKENISH, '<redacted>')
      .replace(UPSTREAM_LABELED_SECRET, (_match, label, separator) => `${label}${separator} <redacted>`)
      .replace(UPSTREAM_BEARER, 'Bearer <redacted>');
  }
  if (Array.isArray(value)) return value.map((item) => scrubUpstream(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, item]) => (
      [childKey, scrubUpstream(item, childKey)]
    )));
  }
  return value;
}

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
  const [pl, cl, us, fm, cf, agS, agC, wfL, cvL, lkL, ofL, mpL, tpL, ebL, prL, cpL, phL, fnL, fbL, dtL, obL] = await Promise.all([
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
    // CORRECTED 2026-07-27 from live traffic. This was `/ai-employees/agents`, annotated
    // "best-effort (may 404)" — but it does not "may" 404, it ALWAYS does: GHL answers
    // `404 {"message":"Cannot GET /ai-employees/agents?locationId=…","error":"Not Found"}`,
    // an express route-not-registered. So this leg contributed nothing on every call and the
    // best-effort annotation made a permanent blind spot look like an occasional one —
    // `list_account_entities` reported ZERO Conversation AI agents on accounts that had them.
    // The live discovery route is the search sibling of the per-agent detail route.
    g(`/ai-employees/employees/search?${locationQuery()}`), // best-effort (may 404)
    // SECOND-ORDER resolvers (SURFACE-GAP-ANALYSIS G1–G3, live-proven shapes 2026-08-22):
    // the account's workflows (add_to_workflow targets by NAME), custom values, trigger links,
    // membership offers + course products (course/offer trigger filters, grant/revoke offer).
    g(`/workflow/${locationPath}/list?${new URLSearchParams({ type: 'workflow', limit: '200', offset: '0', sortBy: 'name', sortOrder: 'asc' })}`),
    g(`/locations/${locationPath}/customValues`),
    g(`/links/?${locationQuery()}`),
    g(`/membership/locations/${locationPath}/offers`),                                    // → [{id,title,…}]
    g(`/membership/locations/${locationPath}/products?doNotIncludeOffers=true&sendCustomizations=true`),
    // G4/G5/G6/G9 (shapes live-proven 2026-08-22): SMS/WhatsApp template library, email-builder
    // templates, store products, coupons, phone numbers, funnels (the /funnels prefix answers on
    // this same Bearer rail — the token-id requirement is the OTHER host's).
    g(`/locations/${locationPath}/templates?limit=200`),
    g(`/emails/builder?${locationQuery({ limit: '100', offset: '0' })}`),
    g(`/products/?${locationQuery({ limit: '100' })}`),
    g(`/payments/coupon/list?${new URLSearchParams({ altId: String(loc), altType: 'location', limit: '100' })}`),
    g(`/phone-system/numbers?${locationQuery()}`),
    g(`/funnels/funnel/list?${locationQuery({ type: 'funnel', offset: '0', limit: '200' })}`),
    // G7/G18: connected Facebook pages (facebook.pageId trigger filters) + document/estimate templates
    g(`/integrations/facebook/${locationPath}/pages?getAll=true`),
    g(`/proposals/templates?${locationQuery({ limit: '100' })}`),
    g(`/objects/?${locationQuery()}`),                                                    // G8: object schemas
  ]);
  // `employees` is the live key on the search route (`{employees, totalCount, count}`);
  // `agents` is kept ahead of it because the Voice leg still answers under that key, and a
  // reader that stopped accepting it would trade one silent empty list for another.
  const agents = [...recordsFrom(agS?.agents, agS?.data, agS),
    ...recordsFrom(agC?.employees, agC?.agents, agC?.data, agC)]
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
    workflows: recordsFrom(wfL?.rows, wfL).filter((w) => (w.type ?? 'workflow') === 'workflow').map((w) => ({ id: w._id || w.id, name: w.name, status: w.status })),
    customValues: recordsFrom(cvL?.customValues, cvL).map((v) => ({ id: v.id || v._id, name: v.name, fieldKey: v.fieldKey })),
    triggerLinks: recordsFrom(lkL?.links, lkL).map((l) => ({ id: l.id || l._id, name: l.name, redirectTo: l.redirectTo })),
    offers: recordsFrom(ofL).map((o) => ({ id: o.id || o._id, name: o.title ?? o.name })),
    membershipProducts: recordsFrom(mpL?.products, mpL).map((m) => ({ id: m.id || m._id, name: m.title ?? m.name })),
    smsTemplates: recordsFrom(tpL?.templates, tpL).filter((t) => (t.type ?? 'sms') !== 'email').map((t) => ({ id: t.id || t._id, name: t.name, type: t.type })),
    emailTemplates: recordsFrom(ebL?.builders, ebL).map((t) => ({ id: t.id || t._id, name: t.name })),
    products: recordsFrom(prL?.products, prL).map((x) => ({ id: x._id || x.id, name: x.name })),
    coupons: recordsFrom(cpL?.data, cpL).map((x) => ({ id: x._id || x.id, name: x.name, code: x.code })),
    phoneNumbers: recordsFrom(phL?.phoneNumbers, phL).map((x) => ({ number: x.value ?? x.phoneNumber, title: x.title ?? x.name })),
    funnels: recordsFrom(fnL?.funnels, fnL).map((x) => ({ id: x._id || x.id, name: x.name })),
    fbPages: recordsFrom(fbL?.pages, fbL).map((x) => ({ id: x.facebookPageId || x.id, name: x.facebookPageName || x.name })),
    documentTemplates: recordsFrom(dtL?.data, dtL).map((x) => ({ id: x._id || x.id, name: x.name })),
    objects: recordsFrom(obL?.objects, obL).map((x) => ({ key: x.key, id: x.id || x._id, singular: x.labels?.singular, plural: x.labels?.plural, standard: x.standard ?? (x.type === 'SYSTEM_DEFINED') })),
  };
}

// Gather both marketplace sources for one location. Never throws — a build must not fail
// because an optional enrichment was unavailable, matching fetchActionSchema's contract.
// The two module reads are on the AI host; the caller's gateway routes them.
export async function fetchMarketplace(call, loc) {
  const empty = { assets: null, modules: { actions: [], triggers: [] } };
  const get = async (path) => {
    try {
      const r = await call('GET', path);
      return r?.ok ? r.json : null;
    } catch { return null; }
  };
  const assets = await get(`/workflows-marketplace/location/${loc}/assets?workflowTypes=default,contacts`);
  const page = (type) =>
    `/marketplace/core/search/module?locationId=${encodeURIComponent(loc)}&type=${type}&isInstalled=true&skip=0&limit=200`;
  const actions = await get(page('actions'));
  const triggers = await get(page('triggers'));
  if (!assets && !actions && !triggers) return empty;
  return {
    assets,
    modules: {
      actions: Array.isArray(actions) ? actions : (actions?.modules ?? actions?.data ?? []),
      triggers: Array.isArray(triggers) ? triggers : (triggers?.modules ?? triggers?.data ?? []),
    },
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
    authored: 0, compiled: 0, steps: 0, warnings: [], stickyNotes: { planned: 0, posted: 0, failed: [] }, readiness: [],
    triggers: { posted: 0, failed: [], ids: [] }, webhookUrls: [], webhookPins: [], customCodeTests: [], verify: { pass: 0, issues: [] }, published: false,
    aborted: null, failurePhase: null, failureHttp: null };
  const callAt = async (failurePhase, method, path, body) => {
    try {
      return await call(method, path, body);
    } catch (error) {
      report.failurePhase = failurePhase;
      report.aborted = `Gateway transport failed during ${failurePhase}: ${error?.message ?? String(error)}`;
      return null;
    }
  };
  const dependencyCallAt = async (failurePhase, method, path, body) => {
    const response = await callAt(failurePhase, method, path, body);
    if (!response) return null;
    if (!response.ok) {
      report.failurePhase = failurePhase;
      report.failureHttp = {
        status: response.status ?? null,
        body: scrubUpstream(response.json ?? null),
      };
      // the save/update API announces validation failures in a structured payload — name the
      // findings instead of reporting an opaque HTTP status (server-validation.mjs)
      const sv = parseServerValidation(response.json);
      report.aborted = sv
        ? `GHL server validation (${sv.validationType}) rejected during ${failurePhase}: ${describeServerFindings(sv)}`
        : `Upstream non-2xx during ${failurePhase}: HTTP ${response.status ?? 'unknown'}`;
      return null;
    }
    return response;
  };

  // 1. resolve names → ids
  const entities = await fetchEntities(gw);
  // Only fetch when the IR asks for it: a native build must remain network-identical to
  // what it was before marketplace support existed. Walk every scope (branches, paths,
  // onEvent/onTimeout/onFound/…) rather than string-scanning the serialized IR — a
  // marketplace step nested inside an if/else branch must still be found, and an attribute
  // string that merely CONTAINS the text `"marketplace":true` (a pasted JSON body in a
  // custom_webhook step, say) must NOT be mistaken for one.
  let usesMarketplace = (ir.triggers ?? []).some((t) => t.marketplace === true);
  walkNodes(ir.graph ?? [], (n) => { if (n.marketplace === true) usesMarketplace = true; });
  const marketplace = usesMarketplace
    ? buildMarketplaceIndex(await fetchMarketplace(call, loc))
    : buildMarketplaceIndex({ assets: null, modules: { actions: [], triggers: [] } });
  const resolvers = buildResolvers(entities);
  const { unresolved } = resolveIR(ir, resolvers);
  report.unresolved = unresolved;
  report.resolvedFrom = { pipelines: entities.pipelines.length, calendars: entities.calendars.length,
    workflows: entities.workflows?.length ?? 0, customValues: entities.customValues?.length ?? 0,
    triggerLinks: entities.triggerLinks?.length ?? 0, offers: entities.offers?.length ?? 0,
    smsTemplates: entities.smsTemplates?.length ?? 0, emailTemplates: entities.emailTemplates?.length ?? 0,
    products: entities.products?.length ?? 0, coupons: entities.coupons?.length ?? 0,
    phoneNumbers: entities.phoneNumbers?.length ?? 0, funnels: entities.funnels?.length ?? 0,
    fbPages: entities.fbPages?.length ?? 0, documentTemplates: entities.documentTemplates?.length ?? 0,
    objects: entities.objects?.length ?? 0,
    users: entities.users.length, forms: entities.forms.length, agents: entities.agents.length };

  // 2. ABORT on missing account-level deps (don't build something broken)
  if (unresolved.length && !opts.ignoreUnresolved) {
    report.failurePhase = 'dependency_resolution';
    report.aborted = `Missing account dependencies: ${unresolved.map((u) => `${u.name} (${u.where})`).join('; ')}. `
      + `Create/rename these in the sub-account first, or pass ignoreUnresolved to build anyway.`;
    return report;
  }

  // 3a. pre-create inline email templates
  for (const n of collectEmailTemplates(ir)) {
    const spec = n.attributes._template;
    const c = await dependencyCallAt('email_template_create', 'POST', '/emails/builder', { locationId: loc, type: 'html', title: spec.title, name: spec.title, updatedBy: uid, isPlainText: false });
    if (!c) return report;
    const tid = c.json?.id || c.json?._id;
    if (tid) {
      report.createdTemplates.push({ title: spec.title, id: tid });
      const data = await dependencyCallAt('email_template_data_create', 'POST', '/emails/builder/data', { locationId: loc, templateId: tid, updatedBy: uid, html: spec.html, editorType: 'html', previewText: spec.previewText || '', isPlainText: false });
      if (!data) return report;
      n.attributes.template_id = tid; n.attributes.templatesource = 'email-builder';
    }
    delete n.attributes._template;
  }

  // 3b. pre-create tags referenced anywhere in the IR (THE fix for the missing-tags bug)
  const required = collectRequiredTags(ir);
  if (required.length) {
    const tl = await dependencyCallAt('tag_list', 'GET', `/locations/${loc}/tags`);
    if (!tl) return report;
    const tagList = Array.isArray(tl.json) ? tl.json : (tl.json?.tags ?? []);
    const existing = tagList.map((t) => t.name);
    for (const name of missingTags(required, existing)) {
      const r = await dependencyCallAt('tag_create', 'POST', `/locations/${loc}/tags`, { name });
      if (!r) return report;
      report.createdTags.push(name);
    }
  }

  // 4. compile + build. IR rejections (OPP_UNASSOCIATED, schema/invariant errors)
  //    land in report.aborted like the other failure modes — not a raw throw.
  let built;
  try {
    built = compile(ir, { loc, cid: undefined, uid, companyAge: 0, idGen: makeUuidV4, catalog, marketplace,
      customFields: entities.customFields, warn: (msg) => report.warnings.push(msg),
      // §5: an account-wide email sender default. Reachable two ways — programmatically via
      // opts.senderDefault, or declaratively as a top-level `senderDefault` on the IR (which
      // parseIR passes through). Without either, email steps fall back to {{location.*}}.
      senderDefault: opts.senderDefault ?? ir.senderDefault,
      // Inbound-webhook sample payload (opts or top-level IR key): lets the compiler lint every
      // {{inboundWebhookRequest.*}} reference against the paths that will exist once the sample is
      // pinned as the trigger's reference (webhook-rail.mjs).
      sampleWebhookPayload: opts.sampleWebhookPayload ?? ir.sampleWebhookPayload,
      // Deliberate override for STEP_TYPE_UNKNOWN — see compiler.mjs. Off by default:
      // an unrecognised type builds a step the builder cannot render or open.
      skipEnforcement: opts.skipEnforcement,
      allowUnknownStepTypes: opts.allowUnknownStepTypes });
  } catch (e) {
    if (e?.name === 'IRError') {
      report.failurePhase = 'compile';
      report.aborted = `compile rejected (${e.code}): ${e.message}`;
      return report;
    }
    throw e;
  }
  report.authored = built.authored;
  report.compiled = built.compiled;
  const ph = built._wid;

  // ── Asset pre-flight ────────────────────────────────────────────────────────────────────
  // Ask GHL's own reference validator about this build BEFORE creating anything, so a step
  // pointing at a deleted calendar / removed user / missing workflow is a named, pre-write
  // abort instead of a workflow that saves clean and silently misbehaves. Reference-only —
  // it does NOT check field shapes (see asset-preflight.mjs). Fail-open: if the endpoint is
  // unreachable the build proceeds and the report says it was skipped.
  // WORKFLOW-level rules (GHL's WorkflowValidator — the layer that blocks a save before any
  // HTTP). Graph-scoped + trigger-aware, so it needs the compiled templates AND trigger bodies
  // together; that is only true here. Hatch: opts.skipWorkflowRules.
  try {
    checkWorkflowRules({ templates: built.autoSaveBody?.workflowData?.templates, triggers: built.triggerBodies, publishing: opts.publish === true },
      catalog.workflowRules, { skipWorkflowRules: opts.skipWorkflowRules, warn: (m) => report.warnings.push(m) });
  } catch (e) {
    report.failurePhase = 'workflow_rules';
    report.aborted = `${e.code ?? 'WORKFLOW_RULE'}: ${e.message}`;
    return report;
  }
  // Graph-CONTEXT rules: GHL validators that need the whole template list rather than one node's
  // attributes — goto placement (needs the parent) and math_operation's upstream reference (needs
  // every other math step). Both are result:'warning' in GHL, so both warn and neither aborts.
  checkGraphContextRules(built.autoSaveBody?.workflowData?.templates,
    { warn: (m) => report.warnings.push(m), skipGraphContextRules: opts.skipGraphContextRules });

  const assetCheck = await validateAssets(call, loc, {
    templates: built.autoSaveBody?.workflowData?.templates,
    triggers: built.triggerBodies,
    companyId: built.autoSaveBody?.companyId,
  });
  report.assetPreflight = assetCheck;
  // ACCOUNT-READINESS (G15, advisory): will the channels/types this workflow uses actually
  // FUNCTION on this location? Read-only signals, never blocks; unverifiable planes say so.
  try {
    const rPlan = planReadinessChecks({
      templates: built.autoSaveBody?.workflowData?.templates ?? [],
      triggerTypes: (built.triggerBodies ?? []).map((t) => t.type),
      settings: ir.settings ?? {}, catalog,
    });
    report.readiness = rPlan.length ? await runReadinessChecks(rPlan, gw) : [];
    for (const c of report.readiness) if (c.ok === false) report.warnings.push(`readiness: ${c.detail} (needed by ${c.why.join('; ')})`);
  } catch (e) { report.readiness = [{ key: 'readiness', checked: false, ok: null, detail: `pre-flight failed to run: ${e.message}`, why: [] }]; }
  for (const w of assetCheck.warnings ?? []) report.warnings.push(`asset: ${describeFinding(w)}`);
  if (assetCheck.errors?.length && opts.ignoreAssetErrors !== true) {
    report.failurePhase = 'validate_assets';
    report.aborted = `GHL rejected ${assetCheck.errors.length} asset reference(s) before any write: `
      + assetCheck.errors.map(describeFinding).join('; ')
      + '. Create the missing objects, correct the references, or pass ignoreAssetErrors to build anyway.';
    return report;
  }

  // STICKY NOTES (sticky-notes.mjs): a separate resource the builder creates the moment a note
  // is placed — validated BEFORE any write so a bad note aborts like a bad step would.
  let notePlans = [];
  try { notePlans = planStickyNotes(ir.stickyNotes, { loc, wid: ph, skipStickyCheck: opts.skipStickyCheck }); report.stickyNotes.planned = notePlans.length; }
  catch (e) { report.failurePhase = 'compile'; report.aborted = `sticky notes rejected (${e.code ?? 'STICKY_NOTE'}): ${e.message}`; return report; }

  // ── Custom-code sandbox pre-flight (custom-code-test rail, live-proven 2026-08-22) ───────
  // Every custom_code step is run in GHL's own sandbox (POST /workflow/custom-code/run-test) with
  // the step's code + its inputData sample — the same call the builder's "Test code" button makes.
  // A passing run REPLACES the authored `output` sample with the REAL return object (its keys are
  // what the {{custom_code.N.<key>}} picker offers), warning when the keys differ. A thrown/invalid
  // run is RECORDED as a warning and the authored sample is kept; opts.strictCustomCode makes it
  // abort instead. Nothing in the account is touched. Hatch: opts.skipCustomCodeTest.
  if (opts.skipCustomCodeTest !== true) {
    const allTemplates = [built.autoSaveBody?.workflowData?.templates, built.createBody?.workflowData?.templates]
      .filter(Array.isArray);
    const seenIds = new Set();
    for (const list of allTemplates) for (const t of list) {
      if (t?.type !== 'custom_code' || seenIds.has(t.id)) continue;
      seenIds.add(t.id);
      const a = t.attributes ?? {};
      const r = await callAt('custom_code_test', 'POST', '/workflow/custom-code/run-test',
        { location_id: loc, attributes: { language: a.language ?? 'javascript', code: a.code ?? '', inputData: a.inputData ?? {} } });
      if (!r) return report;
      const j = r.ok && r.json && typeof r.json === 'object' ? r.json : null;
      const out = j?.output;
      const valid = out !== null && typeof out === 'object' && !Array.isArray(out) && Object.keys(out).length > 0;
      const entry = { id: t.id, name: t.name ?? null, status: r.status, passed: !!j && j.hasError !== true && valid,
        hasError: j?.hasError === true, errorMessage: j?.errorMessage ?? null,
        authoredKeys: Object.keys(a.output ?? {}), outputKeys: valid ? Object.keys(out) : [],
        consoleErrors: Array.isArray(j?.consoleErrors) ? j.consoleErrors : [], replacedOutput: false };
      if (entry.passed) {
        const authored = a.output ?? {};
        const missing = entry.authoredKeys.filter((k) => !(k in out));
        const extra = entry.outputKeys.filter((k) => !(k in authored));
        if (missing.length || extra.length) report.warnings.push(`custom_code '${entry.name ?? t.id}': sandbox output keys differ from the authored sample (missing: ${missing.join(',') || '-'}; extra: ${extra.join(',') || '-'}) — the sandbox result was saved as the step's output`);
        // apply to EVERY copy of this template (create + auto-save bodies may hold distinct objects)
        for (const l2 of allTemplates) for (const t2 of l2) if (t2?.id === t.id) t2.attributes = { ...(t2.attributes ?? {}), output: out };
        entry.replacedOutput = true;
      } else {
        const why = j ? (j.errorMessage ?? (valid ? 'unknown' : 'output is not a non-empty object')) : `HTTP ${r.status}`;
        report.warnings.push(`custom_code '${entry.name ?? t.id}': sandbox test did not pass (${why}); the authored output sample was kept`);
        if (opts.strictCustomCode === true) {
          report.customCodeTests.push(entry);
          report.failurePhase = 'custom_code_test';
          report.aborted = `custom_code '${entry.name ?? t.id}' failed the sandbox test: ${why}`;
          return report;
        }
      }
      report.customCodeTests.push(entry);
    }
  }

  const c = await callAt('workflow_create', 'POST', `/workflow/${loc}`, built.createBody);
  if (!c) return report;
  const WID = c.json?.id || c.json?._id;
  if (!WID) { report.failurePhase = 'workflow_create'; report.aborted = `create failed: ${c.status}`; return report; }
  report.wid = WID;
  const swap = (o) => JSON.parse(JSON.stringify(o).split(ph).join(WID));
  const sent = swap(built.autoSaveBody);
  const s = await callAt('workflow_auto_save', 'PUT', `/workflow/${loc}/${WID}/auto-save`, sent);
  if (!s) return report;
  if (!s.ok) { report.failurePhase = 'workflow_auto_save'; report.aborted = `auto-save failed: ${s.status}`; return report; }
  // Trigger POSTs right after auto-save intermittently 400 {"message":"Workflow
  // not found"} — the workflow doc hasn't settled server-side yet (observed live
  // 2026-07-13). Retry with backoff, and RECORD failures instead of dropping them.
  //
  // ⚠ That 400 has a SECOND cause and the message does not distinguish them (proven live
  // 2026-08-25). The workflow id appears TWICE in a trigger body — `workflowId` at the top
  // level and `workflow_id` inside actions[] — and a stale id in EITHER produces the identical
  // "Workflow not found", which no amount of backoff fixes. `swap()` above is what makes this
  // a non-issue here: it replaces the placeholder across the whole serialised document rather
  // than field by field. Keep it that way — a targeted per-field substitution reintroduces the
  // bug in the id nobody remembers. See corpus/workflows/20-api/trigger-create.md.
  const backoff = opts.triggerBackoffMs ?? [0, 700, 2000];
  for (const tb of built.triggerBodies.map(swap)) {
    let r;
    for (const delay of backoff) {
      if (delay) await new Promise((res) => setTimeout(res, delay));
      r = await callAt('trigger_create', 'POST', `/workflow/${loc}/trigger`, tb);
      if (!r) return report;
      if (r.ok) break;
    }
    if (r?.ok) {
      report.triggers.posted++;
      // Trigger ids are SERVER-assigned on POST (no predeterminedId is sent) — record them so the
      // report can name the inbound-webhook receiving URL, knowable only from here on.
      const id = r.json?.id ?? r.json?._id ?? null;
      report.triggers.ids.push({ type: tb.type, name: tb.name ?? null, id });
    } else report.triggers.failed.push({ type: tb.type, name: tb.name, status: r?.status,
      error: JSON.stringify(r?.json ?? '').slice(0, 160) });
  }
  report.webhookUrls = webhookUrlsFor(loc, report.triggers.ids);

  // ── Webhook sample pin (opt-in: pinWebhookSample + sampleWebhookPayload) ──────────────────
  // Makes the {{inboundWebhookRequest.*}} vocabulary REAL for each inbound_webhook trigger: POST
  // the sample to the receiving URL (unauthenticated by design; the backend host accepts it too,
  // live-proven 2026-08-22), wait for GHL to record it, PUT set-as-reference, read the reference
  // back and mint the merge tags. Failures are RECORDED per trigger, never abort.
  {
    const wantPin = opts.pinWebhookSample ?? ir.pinWebhookSample;
    const sample = opts.sampleWebhookPayload ?? ir.sampleWebhookPayload;
    if (wantPin === true && sample && typeof sample === 'object' && report.webhookUrls.length) {
      const sleep = opts.sleep ?? ((ms) => new Promise((res) => setTimeout(res, ms)));
      const pollMs = opts.pinPollMs ?? 1500, maxPolls = opts.pinMaxPolls ?? 8;
      const canon = (o) => JSON.stringify(sortKeysDeep(o));
      const sig = canon(sample);
      for (const w of report.webhookUrls) {
        const pin = { triggerId: w.triggerId, url: w.url, posted: null, requestId: null, referenceId: null, tagCount: null, mergeTags: null, error: null };
        const p = await callAt('webhook_pin_post', 'POST', `/hooks/${loc}/webhook-trigger/${w.triggerId}`, sample);
        if (!p) return report;
        pin.posted = p.status;
        if (!p.ok) { pin.error = `sample POST → ${p.status}`; report.warnings.push(`webhook pin (${w.triggerId}): ${pin.error}`); report.webhookPins.push(pin); continue; }
        let req = null;
        for (let i = 0; i < maxPolls && !req; i++) {
          await sleep(pollMs);
          const l = await callAt('webhook_pin_list', 'GET', `/hooks/inbound-webhook-request/trigger/${w.triggerId}?${new URLSearchParams({ limit: '10', locationId: loc })}`);
          if (!l) return report;
          const rows = Array.isArray(l.json) ? l.json : [];
          req = rows.find((row) => { const { headers: _h, ...rest } = row?.payload ?? {}; return canon(rest) === sig; }) ?? null;
        }
        if (!req) { pin.error = 'sample not recorded within the poll window'; report.warnings.push(`webhook pin (${w.triggerId}): ${pin.error}`); report.webhookPins.push(pin); continue; }
        pin.requestId = req._id ?? null;
        const st = await callAt('webhook_pin_set', 'PUT', `/hooks/inbound-webhook-request/set-as-reference/${req._id}?${new URLSearchParams({ locationId: loc })}`, { locationId: loc });
        if (!st) return report;
        if (!st.ok) { pin.error = `set-as-reference → ${st.status}`; report.warnings.push(`webhook pin (${w.triggerId}): ${pin.error}`); report.webhookPins.push(pin); continue; }
        pin.referenceId = typeof st.json === 'string' ? st.json : (st.json?._id ?? null);
        const g = await callAt('webhook_pin_read', 'GET', `/hooks/inbound-webhook-request/reference/${w.triggerId}?${new URLSearchParams({ locationId: loc })}`);
        if (!g) return report;
        if (g.ok) { pin.mergeTags = webhookMergeTags(g.json?.payload ?? {}); pin.tagCount = Object.keys(pin.mergeTags).length; }
        else pin.error = `reference read → ${g.status}`;
        report.webhookPins.push(pin);
      }
    }
  }

  // sticky notes — one POST each (live: POST /workflows/sticky-note?locationId= → 201), after the
  // document exists; a failure is RECORDED, never silently dropped, and never aborts the build
  for (const np of notePlans) {
    const r = await callAt('sticky_note_create', np.method, np.path, swap(np.body));
    if (!r) return report;
    if (r.ok) report.stickyNotes.posted++;
    else report.stickyNotes.failed.push({ ref: np.ref, status: r.status, error: JSON.stringify(r.json ?? '').slice(0, 160) });
  }

  // 5. round-trip verify
  const back = await callAt('workflow_verify_get', 'GET', `/workflow/${loc}/${WID}?includeScheduledPauseInfo=true`);
  if (!back) return report;
  const got = back.json?.workflowData?.templates || [];
  const sentById = new Map(sent.workflowData.templates.map((x) => [x.id, x]));
  report.steps = got.length;
  // Recorded so a DRAFT-only tool (buildWorkflowData in mcp-internal/core/tools.mjs) can
  // state what it actually verified rather than assert a publication state it never
  // checked. Two separately-built workflows have been observed reading back
  // status:"published" here with no publish call and no --publish flag — the underlying
  // cause is a separate, unresolved platform-adjacent defect (out of scope for this fix);
  // this field only stops the tool from asserting "nothing was published" unconditionally.
  report.statusReadBack = back.json?.status ?? null;
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
    const st = sentById.get(gt.id);
    const issue = {};
    if (st) {
      const dropped = Object.keys(st.attributes || {}).filter((k) => !(k in (gt.attributes || {})) && k !== 'template_id');
      if (dropped.length) issue.dropped = dropped;
    }
    // Assert the required set against what GHL actually STORED. Every check above this
    // one is about persistence — did the step survive, did an attribute key vanish — and
    // all of them are blind to a step whose attributes round-tripped perfectly but which
    // is missing a field the BUILDER requires. That is why verify returned
    // {pass:14, issues:[]} on a workflow the builder showed "Resolve 7 Errors" for.
    // Reading it off the GET rather than the sent body also catches the server dropping a
    // required field we did send.
    const missingRequired = missingRequiredFields(gt);
    if (missingRequired.length) {
      issue.missingRequired = missingRequired;
      issue.note = 'the builder renders this step with a red error badge and the workflow CANNOT be '
        + 'published — this does NOT show up as a dropped attribute because the key was never sent.';
    }
    if (Object.keys(issue).length) report.verify.issues.push({ type: gt.type, id: gt.id, name: gt.name, ...issue });
    else if (st) report.verify.pass++;
  }

  // 5b. Cross-check the persisted graph against GHL'S OWN action schema — the same rulebook
  //     the builder computes its "Resolve N Errors" banner from. No endpoint returns that
  //     banner (validate-assets checks referenced assets, not field completeness), so this
  //     is the only way to know before a human opens the canvas.
  //
  //     Best-effort by design: the fetch returns null on any failure and the build carries
  //     on. It is an ADDITION to the checks above, not a replacement — the marketplace
  //     catalog describes 307 of the engine's 383 step types and omits the core native ones
  //     (add_contact_tag, send_email, sms, if_else, wait, custom_webhook, …), so an absent
  //     type means "not described here", never "clean". (The catalog now INGESTS this same
  //     rulebook — see gen-catalog.mjs — so the 307 it describes all have entries; the
  //     boundary is unchanged, because ingesting it cannot make it cover what it omits.)
  const actionSchema = await fetchActionSchema(call, loc);
  if (actionSchema) {
    const triggerTypes = (ir.triggers ?? []).map((t) => t.type).filter(Boolean);
    const schemaErrors = checkWorkflow(got, actionSchema, triggerTypes.length ? { triggerTypes } : {});
    report.schemaChecked = { source: 'live', types: actionSchema.size, steps: got.length };
    for (const e of schemaErrors) {
      report.verify.issues.push({ type: e.type, id: e.stepId, name: e.step, schemaErrors: e.messages,
        note: "from GHL's own action schema — this is what the builder's \"Resolve N Errors\" panel would show." });
    }
  } else {
    report.schemaChecked = { source: 'unavailable', note: 'live action schema could not be fetched; required-field checks fell back to the attested map' };
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
    const freshResponse = await callAt('publish_workflow_get', 'GET', `/workflow/${loc}/${WID}?includeScheduledPauseInfo=true`);
    if (!freshResponse) return report;
    const fresh = freshResponse.json;
    const triggerResponse = await callAt('publish_trigger_get', 'GET', `/workflow/${loc}/trigger?workflowId=${WID}`);
    if (!triggerResponse) return report;
    const tr = triggerResponse.json;
    const triggers = (Array.isArray(tr) ? tr : (tr?.triggers || tr?.data || [])).map((t) => ({ ...t, active: true }));
    // Send the CURRENT version (optimistic-concurrency check) — NOT version+1, which
    // 422s "version is outdated". The server bumps it internally on publish.
    // publish echoes the stored document back as a PUT, so it inherits every stored
    // `next: null` — including ones written before this fix. Normalise before the wire
    // or the publish 400s on a step nobody touched. Mirrors the publish_workflow fix in
    // mcp-internal/core/tools.mjs — see terminals.mjs.
    const body = { ...fresh, status: 'published', version: fresh.version,
      triggersChanged: false, oldTriggers: triggers, newTriggers: triggers,
      modifiedSteps: [], deletedSteps: [], createdSteps: [],
      ...(Array.isArray(fresh?.workflowData?.templates)
        ? { workflowData: { ...fresh.workflowData, templates: stripNullNext(fresh.workflowData.templates) } }
        : {}) };
    const pub = await callAt('publish_put', 'PUT', `/workflow/${loc}/${WID}`, body);
    if (!pub) return report;
    const checkResponse = await callAt('publish_verify_get', 'GET', `/workflow/${loc}/${WID}?includeScheduledPauseInfo=true`);
    if (!checkResponse) return report;
    const check = checkResponse.json;
    report.published = pub.ok && (check?.status === 'published');
    if (!report.published) report.verify.issues.push({ publish: pub.status, status: check?.status, body: JSON.stringify(pub.json).slice(0, 160) });
  }

  return report;
}

// Canonical JSON for payload matching: GHL returns the stored request with its own key order,
// so a naive JSON.stringify comparison against the sample is order-sensitive.
function sortKeysDeep(o) {
  if (Array.isArray(o)) return o.map(sortKeysDeep);
  if (o && typeof o === 'object') return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeysDeep(o[k])]));
  return o;
}
