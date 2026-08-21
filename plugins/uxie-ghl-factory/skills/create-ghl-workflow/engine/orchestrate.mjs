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
import { requiredKeysFor, isSupplied } from './required-fields.mjs';
import { fetchActionSchema, checkWorkflow } from './action-schema.mjs';
import { buildMarketplaceIndex } from './marketplace.mjs';
import { walkNodes } from './ir.mjs';
import { validateAssets, describeFinding } from './asset-preflight.mjs';
import { parseServerValidation, describeServerFindings } from './server-validation.mjs';
import { checkWorkflowRules } from './graph-rules.mjs';

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
    // CORRECTED 2026-07-27 from live traffic. This was `/ai-employees/agents`, annotated
    // "best-effort (may 404)" — but it does not "may" 404, it ALWAYS does: GHL answers
    // `404 {"message":"Cannot GET /ai-employees/agents?locationId=…","error":"Not Found"}`,
    // an express route-not-registered. So this leg contributed nothing on every call and the
    // best-effort annotation made a permanent blind spot look like an occasional one —
    // `list_account_entities` reported ZERO Conversation AI agents on accounts that had them.
    // The live discovery route is the search sibling of the per-agent detail route.
    g(`/ai-employees/employees/search?${locationQuery()}`), // best-effort (may 404)
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
    authored: 0, compiled: 0, steps: 0, warnings: [],
    triggers: { posted: 0, failed: [] }, verify: { pass: 0, issues: [] }, published: false,
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
      catalog.workflowRules, { skipWorkflowRules: opts.skipWorkflowRules });
  } catch (e) {
    report.failurePhase = 'workflow_rules';
    report.aborted = `${e.code ?? 'WORKFLOW_RULE'}: ${e.message}`;
    return report;
  }
  const assetCheck = await validateAssets(call, loc, {
    templates: built.autoSaveBody?.workflowData?.templates,
    triggers: built.triggerBodies,
    companyId: built.autoSaveBody?.companyId,
  });
  report.assetPreflight = assetCheck;
  for (const w of assetCheck.warnings ?? []) report.warnings.push(`asset: ${describeFinding(w)}`);
  if (assetCheck.errors?.length && opts.ignoreAssetErrors !== true) {
    report.failurePhase = 'validate_assets';
    report.aborted = `GHL rejected ${assetCheck.errors.length} asset reference(s) before any write: `
      + assetCheck.errors.map(describeFinding).join('; ')
      + '. Create the missing objects, correct the references, or pass ignoreAssetErrors to build anyway.';
    return report;
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
  const backoff = opts.triggerBackoffMs ?? [0, 700, 2000];
  for (const tb of built.triggerBodies.map(swap)) {
    let r;
    for (const delay of backoff) {
      if (delay) await new Promise((res) => setTimeout(res, delay));
      r = await callAt('trigger_create', 'POST', `/workflow/${loc}/trigger`, tb);
      if (!r) return report;
      if (r.ok) break;
    }
    if (r?.ok) report.triggers.posted++;
    else report.triggers.failed.push({ type: tb.type, name: tb.name, status: r?.status,
      error: JSON.stringify(r?.json ?? '').slice(0, 160) });
  }

  // 5. round-trip verify
  const back = await callAt('workflow_verify_get', 'GET', `/workflow/${loc}/${WID}?includeScheduledPauseInfo=true`);
  if (!back) return report;
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
    const body = { ...fresh, status: 'published', version: fresh.version,
      triggersChanged: false, oldTriggers: triggers, newTriggers: triggers,
      modifiedSteps: [], deletedSteps: [], createdSteps: [] };
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
