// Transport-blind tool definitions. Descriptions are pulled from the generated
// tool-description catalog so proof status and risk reach the agent verbatim.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ok, fail, fromHttp, CODES, REDACTED, containsSecrets, scrubSecrets } from './errors.mjs';
import { authStatus, DEFAULT_TOKEN_FILE, readCredentials } from './auth.mjs';
import { checkLocationBinding } from './location-binding.mjs';
import { scanPage, judge, judgeVersions, judgeRouting, judgePathCollisions, judgePageRecord, judgeRendered, judgeStyles, normaliseTag } from './site-audit.mjs';
import { makeAuditCircuit, makeAuditGateway, makeAuditLimiter } from './audit-gateway.mjs';
import { makeGateway } from './gateway.mjs';
import {
  ELEMENT_KINDS, buildPageData, autosaveEnvelope, auditPageData, makeLeaf, makeColumn,
  makeSection, textCss, buttonCss, leafStyleCss, resetIds, val,
} from './funnel-pages.mjs';
import { collectWorkflowRuntimeWindow, validateRuntimeWindowInput } from './workflow-runtime-window.mjs';
import {
  getAiConfigurationBundle,
  listWorkflowsComplete,
  validateAiBundleInput,
  validateRosterInput,
} from './audit-configuration.mjs';
import { fetchEntities, fetchMarketplace, missingRequiredFields, orchestrate } from '../../skills/create-ghl-workflow/engine/orchestrate.mjs';
import { buildResolvers } from '../../skills/create-ghl-workflow/engine/resolve.mjs';
import { editCommitBody } from '../../skills/create-ghl-workflow/engine/edit.mjs';
import { stripNullNext, fillInputTriggerParams } from '../../skills/create-ghl-workflow/engine/terminals.mjs';
import { checkWorkflowRules, rulesNeedTriggers } from '../../skills/create-ghl-workflow/engine/graph-rules.mjs';
import { checkGraphContextRules } from '../../skills/create-ghl-workflow/engine/graph-context-rules.mjs';
import { validateAssets, describeFinding } from '../../skills/create-ghl-workflow/engine/asset-preflight.mjs';
import { planReadinessChecks, runReadinessChecks } from '../../skills/create-ghl-workflow/engine/preflight.mjs';
import { parseActionSchema, parseTriggerSchema, checkWorkflow, marketplaceDrift } from '../../skills/create-ghl-workflow/engine/action-schema.mjs';
import { INNER_ATTRIBUTE_TYPE } from '../../skills/create-ghl-workflow/engine/required-fields.mjs';
import { HELPER_FIDELITY, compileValidators, runBuilderValidators, validatorNamesFor, validatorSource } from './builder-validators.mjs';
import {
  applyOps,
  externalRefsOf,
  opsNeedResolution,
  resolveOps,
  mergeSettingsOps,
  opsUseMarketplace,
  partitionOps,
  planTriggerOps,
} from '../../skills/create-ghl-workflow/engine/edit-driver.mjs';
import { planStickyNoteOp } from '../../skills/create-ghl-workflow/engine/sticky-notes.mjs';
import { lintContactFieldTemplates } from '../../skills/create-ghl-workflow/engine/contact-field-shapes.mjs';
import { lintOpportunityWrites } from '../../skills/create-ghl-workflow/engine/lints/opportunity.mjs';
import { FIELD_CAPS, checkFieldCaps, describeCap } from '../../skills/create-ghl-workflow/engine/field-caps.mjs';
import { lintTriggerRows } from '../../skills/create-ghl-workflow/engine/lints/trigger-rows.mjs';
import { searchMergeTags } from '../../skills/create-ghl-workflow/engine/merge-tags.mjs';
import { digestWorkflow, fingerprintWorkflow } from '../../skills/create-ghl-workflow/engine/digest.mjs';
import { entityCapabilities } from '../../skills/create-ghl-workflow/engine/entities.mjs';
import { readCache } from './read-cache.mjs';
import {
  baseKnownFields,
  buildColumns,
  buildFilterSpec,
  classifyFilterSpec,
  DEFAULT_COLUMN_KEYS,
  DSL_COLUMN_MISTRANSLATIONS,
  EXCLUDED_FIELD_TYPES,
  isGroup,
  leaves as filterLeaves,
} from './smart-lists.mjs';
import { CONFLICT_KEYS, PUSH_CATEGORIES, buildPushBody, checkSelection, diffStored, manifestIndex, nonEmptyCategories, resolveCompanyId } from './snapshots.mjs';
import {
  digestSpans as digestAgentSpans,
  branchNameMap as agentLogBranchNames,
  parseMeta as parseAgentLogMeta,
  SORT_FIELDS as AGENT_LOG_SORT_FIELDS,
  TIME_RANGES as AGENT_LOG_TIME_RANGES,
  PRODUCTS as AGENT_LOG_PRODUCTS,
  MAX_OFFSET as AGENT_LOG_MAX_OFFSET,
  sessionBody as agentLogSessionBody,
  sessionRow as agentLogSessionRow,
  walkSessions as walkAgentSessions,
} from './agent-logs.mjs';
import { runLints } from '../../skills/create-ghl-workflow/engine/lints/runner.mjs';
import { loadDoctrinePack } from '../../skills/create-ghl-workflow/engine/lints/doctrine.mjs';
import { loadCatalog } from '../../skills/create-ghl-workflow/engine/catalog.mjs';
import { makeDeterministicIdGen } from '../../skills/create-ghl-workflow/engine/idgen.mjs';
import { collectOpTags, missingTags } from '../../skills/create-ghl-workflow/engine/tags.mjs';
import { buildMarketplaceIndex, parseInstalledModules } from '../../skills/create-ghl-workflow/engine/marketplace.mjs';
import { makeFF } from '../../skills/ghl-workflow-fast-forward/engine/ff.mjs';
import { GhlMembershipsApi } from '../../skills/ghl-memberships/engine/api.mjs';
import { buildCourse, previewCourseSpec } from '../../skills/ghl-memberships/engine/course-builder.mjs';
import { compileConvaiAgent } from '../../engines/ai/convai-compiler.mjs';
import { compileVoiceAiAgent, compileVoiceAiUpdate } from '../../engines/ai/voiceai-compiler.mjs';
import { compileSuperAgentCreate, compileSuperAgentUpdate } from '../../engines/ai/studio-compiler.mjs';
import { executeAgentPlan, executeAgentUpdate } from '../../engines/ai/driver.mjs';
import { compileConvaiUpdateFromRecord } from '../../engines/ai/convai-compiler.mjs';
import { StudioApi, queryProjectHistory, filterRoutes, classifySite, nameWarning,
         sessionFor, awaitTurn, isTerminal, MESSAGES, DIFFS, answerBodyFor } from './ai-studio.mjs';

// In the bundle the catalog is inlined via esbuild --define (__HAS_CATALOG__/__TOOL_CATALOG__,
// see scripts/esbuild-config.mjs), so descriptions work on a user's machine with no external
// file. The un-bundled dev entry reads the co-located committed copy; either way, a missing
// catalog degrades gracefully to each tool's hardcoded fallback string.
const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG = typeof __HAS_CATALOG__ !== 'undefined'
  ? __TOOL_CATALOG__
  : (() => {
      try { return JSON.parse(readFileSync(resolve(HERE, '../tool-descriptions.json'), 'utf8')); }
      catch { return {}; }
    })();
// A1: a stub catalog entry must never shadow a real sentence.
//
// This was `CATALOG[tool]?.description ?? fallback`, so the catalog line won unconditionally. For
// the 30 catalog entries that are just a title plus a proof clause, that meant the hand-written
// sentence in this file never shipped: get_workflow_logs advertised "Get workflow logs" while
// "executionId returns one run's full step trace" -- the sentence that answers a diagnostic
// question -- sat unused a thousand lines below.
//
// What is NOT removed: the `proof: ...; risk: ...` clause. An earlier pass here treated it as
// maintainer provenance and stripped it. That was wrong, and three tests say so
// (ai-agent-tools.test.mjs "descriptions disclose proof status honestly", and the two audit
// composite guards below). The label tells the agent how far to trust the tool --
// `external-receipt-required` means this rail has never been live-proven -- which is exactly the
// kind of thing that belongs in front of a caller. Provenance that predicts nothing lives in the
// proofRows/riskRows arrays, and those already stay out of the description.
//
// So: keep the clause and its tail, and take the LEAD from whichever source actually says
// something. Length is the test for that, and it is deterministic where a hand-maintained
// precedence list would rot.
const PROVENANCE = /\s*\u2014\s*proof:[\s\S]*?risk:\s*([a-z-]+)\.?/i;

/**
 * GHL's live validator answers 200 `{ valid: true, assetWarnings }` or 400 `{ valid: false,
 * errorMessage, errorMetadata: { validationType, errors[] } }` (live 2026-09-11). Anything else is
 * not a verdict: null, so the caller reports the HTTP failure instead of inventing a pass or a fail.
 */
function readServerValidation(json) {
  if (!json || typeof json !== 'object' || typeof json.valid !== 'boolean') return null;
  const assetWarnings = Array.isArray(json.assetWarnings) ? json.assetWarnings : [];
  if (json.valid) return { valid: true, layer: null, errorMessage: null, errors: [], assetWarnings };
  const meta = json.errorMetadata ?? {};
  return {
    valid: false,
    layer: meta.validationType ?? null,
    errorMessage: json.errorMessage ?? json.message ?? null,
    errors: (Array.isArray(meta.errors) ? meta.errors : []).map((e) => ({
      message: e?.message ?? null,
      ruleId: e?.ruleId ?? null,
      severity: e?.severity ?? null,
      source: e?.source ?? null,
      stepId: e?.stepId ?? null,
      stepName: e?.stepName ?? null,
      stepType: e?.stepType ?? null,
      triggerId: e?.triggerId ?? null,
      triggerName: e?.triggerName ?? null,
      triggerType: e?.triggerType ?? null,
    })),
    assetWarnings,
    note: 'One layer per call: fix what this names and call again. Other layers may still fail.',
  };
}

const describe = (tool, fallback) => {
  const meta = CATALOG[tool];
  if (!meta?.description) return fallback;
  const clause = meta.description.match(PROVENANCE);
  if (!clause) return meta.description.length >= fallback.length ? meta.description : fallback;
  const lead = meta.description.slice(0, clause.index).trim();
  const tail = meta.description.slice(clause.index + clause[0].length).trim();
  // A hand-written lead sometimes carries its own inline "(proof: engine source)". The catalog's
  // clause is the authoritative one -- and the two disagree (engine source vs documented) -- so
  // the inline copy is dropped rather than printed alongside it.
  const handWritten = fallback
    .replace(PROVENANCE, '')
    .replace(/\s*\((?:proof|floor):[^()]*\)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const chosen = handWritten.length > lead.length ? handWritten.replace(/\.$/, '') : lead;
  return [chosen, clause[0].trim(), tail].filter(Boolean).join(' ').replace(/\s{2,}/g, ' ');
};

const SCHEMA_KEYS = new WeakMap();
const schema = (shape) => {
  // Passthrough is deliberate: strict Zod validation includes an unknown property
  // name in the SDK's protocol error, which leaks a credential used as that key.
  // Known fields remain SDK-validated; unknowns are rejected below with a fixed,
  // non-echoing tool contract before any handler or state mutation runs.
  const inputSchema = z.object(shape).passthrough();
  SCHEMA_KEYS.set(inputSchema, new Set(Object.keys(shape)));
  return inputSchema;
};

const credentialFailure = (code = CODES.VALIDATION_FAILED) => fail(
  code,
  'a tool argument contains a credential-looking value (value withheld)',
  'Remove credentials from tool arguments. Authentication comes only from the configured token file.',
);

// ONE limiter and ONE circuit for the whole process, created lazily on first audit use.
//
// The plan (line 331) says the audit stdio process creates one of each and shares them
// across every audit gateway. That process does not exist until Task 5, and on the server
// that DOES exist nothing supplies them — so `deps.auditLimiter ?? makeAuditLimiter()` was
// the only reachable branch and every tool call got a FRESH pair. A 429 that latched the
// circuit on call N was discarded before call N+1, which then re-hammered the very
// location that had just asked this process to stop; and the pacing each call promised was
// pacing against nothing. Module scope is the process, so the invariant holds on today's
// server too, while an injected pair still wins for the Task 5 driver and for tests.
let sharedAuditLimiter = null;
let sharedAuditCircuit = null;
// ── Step/trigger type cards ───────────────────────────────────────────────────────────────
// The corpus documents 284 step and trigger types with their real field tables; the plugin
// used to ship only 68 single step examples, and one example pins ONE value of every
// discriminator (see create-ghl-workflow/references/step-shapes.md). Loading all 284 is not an
// option — the catalog is ~134,000 tokens. So it is served the way the public rail serves its
// API catalog: a ranked search returning stubs, then one card on request.
//
//   whole catalog  ~134,000 tokens     one search page  ~360     one card  ~400
//
// Read lazily and cached: a session that never builds a workflow never pays for it.
let TYPE_CARDS = null;
const typeCards = () => {
  if (TYPE_CARDS) return TYPE_CARDS;
  try {
    TYPE_CARDS = JSON.parse(readFileSync(resolve(HERE, '../../skills/create-ghl-workflow/catalog/type-cards.json'), 'utf8')).cards ?? [];
  } catch { TYPE_CARDS = []; }
  return TYPE_CARDS;
};

// ── the internal ENDPOINT catalog ─────────────────────────────────────────────────────────
// Endpoints mined from GHL's own recovered builder source by
// knowledge/scripts/build-endpoint-catalog.mjs. The COUNT is never written down here: a hardcoded
// "222" outlived the catalog reaching 235 and shipped stale in two places, with no test to catch
// it. Read it from the file. This exists because the internal rail had no
// discovery layer: hand-written tools, and everything else reachable only if you already knew
// the path. The public rail solved the same problem with search -> describe -> execute over a
// catalog; this is that, for reads.
//
// DELIBERATELY NOT AN EXECUTOR. There is no execute_endpoint, because raw_request already
// executes internal paths and already carries the confirm gate, the host/rail selection and the
// secret scrub. A second execution path would double the surface that has to stay correct and
// would inevitably drift from the first. Discovery is what was missing, so discovery is what
// this adds — describe_endpoint hands the caller to raw_request.
//
// A row is SOURCE-DERIVED: it proves the builder calls that path, not that the path is reachable
// with your token, and definitely not that it is safe to call.
//
// HEADERS, not scope. Anything outside the /workflow/* prefix — /workflows/*,
// /workflows-marketplace/*, /marketplace/*, /conversations-reporting/* — needs three extra
// headers or it returns 401 with the body `version header was not found`:
//
//     Channel: APP   Source: WEB_USER   Version: 2021-04-15
//
// (services/marketplaceServices/BaseService.ts:19-48 sets exactly these.) /workflow/* does not
// require them but tolerates them, so they are safe to send everywhere on this host.
//
// An earlier pass read those 401s as proof of a separate auth scope and wrote that here. It was
// wrong: the token is the same, and GHL named the real cause in the response body while the
// status code invited the other conclusion. Proven by differential 2026-08-25 — see
// corpus/workflows/70-research/AUTH-HEADERS-2026-08-25.md.
// Inlined at build time like the tool-description catalog, and for the same reason: dist/ ships
// with no siblings. Before this, the bundle silently depended on a catalog/ directory next to it,
// so search_endpoints worked in the repo and failed everywhere else.
let ENDPOINTS = null;
const endpoints = () => {
  if (ENDPOINTS) return ENDPOINTS;
  if (typeof __HAS_ENDPOINTS__ !== 'undefined') {
    ENDPOINTS = __ENDPOINT_CATALOG__.endpoints ?? [];
    return ENDPOINTS;
  }
  try {
    ENDPOINTS = JSON.parse(readFileSync(resolve(HERE, '../catalog/internal-endpoints.json'), 'utf8')).endpoints ?? [];
  } catch { ENDPOINTS = []; }
  return ENDPOINTS;
};

// What an endpoint DOES, for ranking only. The overlay (catalog/endpoint-kinds.json) carries the
// rows whose danger the method does not reveal -- a POST that starts a mass enrolment or sends a
// real SMS. Everything else defaults by method.
//
// This is RANKING metadata and nothing else. raw_request gates every non-GET on `confirm`
// regardless of what this file says, so a missing row here can never widen what may be called.
let OVERLAY = null;
const overlay = () => {
  if (OVERLAY) return OVERLAY;
  if (typeof __HAS_ENDPOINTS__ !== 'undefined') {
    OVERLAY = __ENDPOINT_OVERLAY__.rows ?? {};
    return OVERLAY;
  }
  try { OVERLAY = JSON.parse(readFileSync(resolve(HERE, '../catalog/endpoint-overlay.json'), 'utf8')).rows ?? {}; }
  catch { OVERLAY = {}; }
  return OVERLAY;
};
// The overlay is COMPILED INTO the catalogue by scripts/build-endpoint-catalog.mjs, so a row
// normally carries kind/summary/note/reach itself. The overlay is still consulted as a fallback so
// an edit to it shows up in a dev tree before the catalogue is rebuilt.
const overlayFor = (e) => overlay()[`${e.method} ${e.path}`] ?? {};
const endpointKind = (e) => e.kind ?? overlayFor(e).kind
  ?? (e.method === 'GET' ? 'read' : e.method === 'DELETE' ? 'destructive' : 'write');
const endpointWords = (e) => ({
  summary: e.summary ?? overlayFor(e).summary,
  note: e.note ?? overlayFor(e).note,
  reach: e.reach ?? overlayFor(e).reach,
});

// Verbs that mean the caller intends to CHANGE something. `add` and `set` are deliberately absent:
// CARD_STOP strips both before scoring ever sees them, so listing them here would be a rule that
// silently never fires.
const MUTATION_VERBS = new Set([
  'create', 'make', 'new', 'build', 'update', 'edit', 'change', 'modify', 'delete', 'remove',
  'clear', 'drop', 'publish', 'unpublish', 'install', 'uninstall', 'start', 'stop', 'pause',
  'resume', 'enroll', 'move', 'restore', 'send', 'reset', 'register', 'deregister', 'requeue',
  'bypass', 'blacklist',
]);
// The subset that means the caller intends to DESTROY something. A destructive row surfaces only
// when one of these is present: "publish the workflow" must not return flowguard/blacklist, which
// STOPS the workflow, however well its path happens to match.
const DESTRUCTIVE_VERBS = new Set([
  'delete', 'remove', 'clear', 'drop', 'stop', 'bypass', 'blacklist', 'reset', 'deregister',
  'requeue', 'unpublish', 'uninstall',
]);
const intentVerbs = (terms) => ({
  mutating: terms.some((t) => MUTATION_VERBS.has(t)),
  destructive: terms.some((t) => DESTRUCTIVE_VERBS.has(t)),
});

const scoreEndpoint = (e, terms, verbs = intentVerbs(terms)) => {
  if (!terms.length) return 0;
  const path = String(e.path || '').toLowerCase();
  const segs = new Set(path.split(/[^a-z0-9]+/).filter(Boolean));
  // The overlay's own words are part of the haystack. GHL names a route `/{loc}/list` and a caller
  // asks for "workflow folders" -- no path token matches, so the right row lost to copyWorkflow rows
  // that merely share the word "workflow". Indexing the human sentence is the single thing that
  // makes the public rail's search work, and it costs nothing here.
  const words = endpointWords(e);
  // `serviceClass` is indexed alongside `service` because they answer different questions. The
  // catalogue used to put a mined TypeScript class name in `service` (WorkflowService,
  // AssessmentServiceService); it now carries a real surface there and keeps the class in
  // `serviceClass`. Indexing only `service` would have made those 508 rows unfindable by the
  // name an agent reading recovered source actually has in front of it — and 105 of them have
  // no surface at all, so the class is the only handle they have.
  const hay = `${e.method} ${e.origin ?? e.base ?? ''} ${e.path} ${e.service ?? ''} ${e.serviceClass ?? ''} ${words.summary ?? ''} ${words.note ?? ''}`.toLowerCase();
  let score = 0, segHits = 0;
  for (const t of terms) {
    // Match on a STEM, not the whole word. GHL names the path segment `error-notification` while
    // a caller asks about "erroring workflows" — exact-word matching returned neither, and put
    // unrelated marketplace rows on top instead.
    const stem = t.length > 4 ? t.replace(/(ing|ed|es|s)$/, '') : t;
    const hit = (v) => v === t || v === stem || v.startsWith(stem);
    if ([...segs].some(hit)) { score += 25; segHits++; }
    else if (path.includes(stem)) { score += 10; segHits++; }
    if (hay.includes(stem)) score += 3;
    if ((words.summary ?? '').toLowerCase().includes(stem)) { score += 12; segHits++; }
  }
  score += segHits * segHits * 8;
  // A path with fewer parameters is the more general entry point for the same noun —
  // /workflow/:locationId/list should outrank /workflow/:locationId/:workflowId/logs for "list".
  score -= (path.match(/:/g) ?? []).length;
  // Prefer the builder's own service over the resolver endpoints it merely reads from.
  if (String(e.origin ?? e.base ?? '').includes('backend.') && e.path.startsWith('/workflow')) score += 5;

  // A0 measured what this fixes. Across ten read-shaped intents, 18 of 30 top-3 slots were writes
  // and only one intent had a clean read-only top 3. "which contacts are sitting at step X right
  // now" -- a pure read -- returned remove-stuck-statuses and requeue-stuck-statuses at #1 and #2,
  // both destructive runtime mutations. "read the email deliverability posture" put send-test-email
  // at #2, which sends a real message. The scorer had no notion of what a row DOES.
  const kind = endpointKind(e);
  if (kind === 'destructive' && !verbs.destructive) return 0;
  if (kind === 'write' && !verbs.mutating) score -= 40;

  // A row proven to 401 from this rail is a guaranteed wasted turn. The whole /flowguard/* family
  // is exactly that -- live-proven 2026-08-22, a location-user Bearer never gets through -- and
  // those rows were ranking FIRST for several read-shaped questions because their paths carry
  // "workflow", "step" and "contact". Demoted, not hidden: the path is real, and a caller with a
  // higher credential class may still want it.
  if (endpointWords(e).reach === 'refused') score -= 60;
  return score;
};

// The contact filter-field catalogue. NO ENDPOINT SERVES THIS — the contacts screen assembles it in
// the browser on every page load, from a static list compiled into its own chunk plus the account's
// own custom fields. The static half is mined into the corpus and synced into catalog/; the
// per-account half is read live. Bundled via a define for the same reason the endpoint catalogue is:
// dist/ ships with no sibling catalog/.
let FILTER_FIELDS = null;
// GHL's own action validators, compiled once per process. The bag is memoised because compiling
// 67 function bodies on every check_workflow call is pure waste, and because a compile failure
// should be reported the same way every time rather than re-attempted silently.
let VALIDATOR_BAG;
const builderValidatorBag = () => {
  if (VALIDATOR_BAG !== undefined) return VALIDATOR_BAG;
  const src = validatorSource(() => JSON.parse(readFileSync(resolve(HERE, '../catalog/builder-validators.json'), 'utf8')));
  const bag = src ? compileValidators(src) : null;
  VALIDATOR_BAG = (bag && bag.error) ? null : bag;
  return VALIDATOR_BAG;
};

const staticFilterFields = () => {
  if (FILTER_FIELDS) return FILTER_FIELDS;
  if (typeof __HAS_FILTER_FIELDS__ !== 'undefined') { FILTER_FIELDS = __CONTACT_FILTER_FIELDS__; return FILTER_FIELDS; }
  try { FILTER_FIELDS = JSON.parse(readFileSync(resolve(HERE, '../catalog/contact-filter-fields.json'), 'utf8')); }
  catch { FILTER_FIELDS = null; }
  return FILTER_FIELDS;
};

// What the agent sees BEFORE it spends a turn on describe_endpoint. `callSites` is gone: 211 of the
// 235 rows carry the same value, so it never discriminated between two candidates while occupying
// the most budget-sensitive payload on the rail. What replaces it is what a caller actually picks
// on -- what the endpoint does, what it returns, and the one trap.
const endpointStub = (e) => {
  const w = endpointWords(e);
  return {
    id: e.id,
    method: e.method,
    path: e.path,
    kind: endpointKind(e),
    ...(w.summary ? { summary: w.summary } : {}),
    ...(e.coveredBy?.length ? { coveredBy: e.coveredBy } : {}),
    ...(w.note ? { note: w.note } : {}),
    // ALWAYS, including `source-only`. Hiding it meant the 936 unproven rows looked identical to
    // a row nobody had annotated yet, so an agent could not tell "we know this is unreached" from
    // "nobody has looked". `proof` rides along when the corpus recorded one.
    reach: w.reach ?? 'source-only',
    ...(e.proof ? { proof: e.proof } : {}),
    ...(e.rawCallable === false ? { rawCallable: false } : {}),
  };
};

const CARD_STOP = new Set(['a','an','the','to','of','for','and','or','in','on','with','my','me','i','it','is','that','this','when','how','do','does','add','set','use']);
const cardWords = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1 && !CARD_STOP.has(w));

// Ranking rewards COVERAGE of the caller's terms, not one strong hit. "update a contact field"
// must return `update_contact_field` above `contact`: the short slug matches one term exactly
// and would otherwise win on the exact-match bonus alone, while the type the caller actually
// wants matches three.
const scoreCard = (card, terms) => {
  if (!terms.length) return 0;
  const type = String(card.type || '').toLowerCase();
  const slug = new Set(type.split(/[^a-z0-9]+/).filter(Boolean));
  const hay = [card.type, card.title, card.summary, card.family, card.validator,
               ...(card.fields ?? []).map(f => f.name)].join(' ').toLowerCase();
  let score = 0, slugHits = 0;
  for (const t of terms) {
    if (slug.has(t)) { score += 25; slugHits++; }
    else if (type.includes(t)) { score += 10; slugHits++; }
    if (hay.includes(t)) score += 4;
  }
  if (type === terms.join('_') || type === terms.join('')) score += 200;  // they named the slug
  score += slugHits * slugHits * 8;              // covering more of the intent compounds
  if (slugHits === slug.size && slug.size > 1) score += 15;  // every word of the slug was asked for
  if (card.fields?.length) score += 2;
  // Native before third-party. "send an sms" means GHL's SMS step, not a marketplace app that
  // happens to have "sms" in its slug — and without this the two tie and sort alphabetically,
  // which put `manual-sms` above `sms`.
  if (!card.family?.includes('marketplace')) score += 6;
  return score;
};

const cardStub = (card) => ({
  type: card.type,
  family: card.family,
  summary: card.summary?.slice(0, 160),
  fields: card.fields?.length ?? 0,
  configSurface: card.configSurface,
});

export function processAuditPacing() {
  sharedAuditLimiter ??= makeAuditLimiter();
  sharedAuditCircuit ??= makeAuditCircuit();
  return { limiter: sharedAuditLimiter, circuit: sharedAuditCircuit };
}

// The gateway factory the stdio entry points hand to registerTools. It lives here, and is
// a spread rather than a destructure, because the destructured version in stdio.mjs
// (`({ loc, rail }) => makeGateway({ tokenFile, loc, rail })`) silently swallowed every
// other option — including the `throttleMs: 0, jitterMs: 0` the audit tools pass so the
// SHARED limiter can own pacing. The result was the double-throttle Task 2's carry-forward
// warns about: the per-gateway 300-450ms delay AND the limiter's, on every audit read.
export function makeGatewayFactory({ state, gatewayImpl = makeGateway }) {
  // `renewer` rides state (not the options) so EVERY tool's gateway renews, including the audit
  // tools that pass their own throttle options — the same forwarding lesson as the spread.
  return (options = {}) => gatewayImpl({ tokenFile: state.tokenFile, legacyTokenFileEnv: state.legacyTokenFileEnv, renewer: state.renewer ?? null, ...options });
}

function validateRegisteredArgs(tool, args) {
  // Secret detection MUST precede unknown-key validation so neither keys nor
  // values can be reflected by an SDK/Zod error or our own response.
  if (containsSecrets(args)) {
    return credentialFailure(tool.name === 'set_token_file' ? CODES.TOKEN_MISSING : CODES.VALIDATION_FAILED);
  }
  const allowed = SCHEMA_KEYS.get(tool.inputSchema) ?? new Set();
  if (Object.keys(args).some((key) => !allowed.has(key))) {
    return fail(
      CODES.VALIDATION_FAILED,
      'tool arguments contain unsupported fields (names withheld)',
      'Remove fields not declared by this tool schema and retry.',
    );
  }
  return null;
}

const payloadSummary = (body) => {
  if (body === undefined) return { kind: 'none' };
  if (Array.isArray(body)) return { kind: 'array', items: body.length };
  if (body && typeof body === 'object') return { kind: 'object', fields: Object.keys(body).sort() };
  return { kind: typeof body };
};

const descriptorPreview = (descriptor) => ({
  method: descriptor.method,
  path: descriptor.path,
  payload: payloadSummary(descriptor.body),
});

// A project's own lint pack, read from the same `.ghl/` seam the token lives in. Client policy
// travels with the project, never with the engine.
function readProjectLintPack(state, locationId) {
  try {
    if (process.env.GHL_READ_CACHE === '0') return null;
    const dir = state?.tokenFile ? dirname(state.tokenFile) : null;
    if (!dir || !locationId) return null;
    const p = join(dir, String(locationId), 'lint-pack.json');
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  } catch { return null; }
}

export function compileAiAgentPlan(kind, args) {
  if (kind === 'convai') {
    const compiled = compileConvaiAgent(args.spec, { locationId: args.locationId });
    // The create wire calls the name employeeName; the read representation calls it name.
    const { employeeName, ...rest } = compiled.create.body;
    return { ...compiled, verifyExpected: { ...rest, name: employeeName } };
  }
  if (kind === 'voiceai') {
    const compiled = compileVoiceAiAgent(args.spec, { locationId: args.locationId });
    const update = compileVoiceAiUpdate(args.spec, { agentId: '{agentId}', locationId: args.locationId });
    return { ...compiled, followUps: [update], verifyExpected: update.body };
  }
  // Two genuinely distinct roles: `buildPrompt` is the free-text instruction the AI
  // builds the agent from (SSE); `systemPrompt` is the exact prompt the follow-up PUT
  // overwrites with. But requiring BOTH — with an error naming whichever you omitted —
  // read as contradictory (live-caught 2026-07-21). Accept EITHER and derive the missing
  // one, so a single field just works; supplying both keeps their distinct roles.
  const studioSpec = {
    ...args.spec,
    buildPrompt: args.spec?.buildPrompt ?? args.spec?.systemPrompt,
    systemPrompt: args.spec?.systemPrompt ?? args.spec?.buildPrompt,
  };
  const create = compileSuperAgentCreate(studioSpec, { locationId: args.locationId, companyId: args.companyId });
  const update = compileSuperAgentUpdate(studioSpec, { agentId: '{agentId}', locationId: args.locationId });
  // Verify ONLY the identity fields we deterministically set and that round-trip:
  // name + systemPrompt. LIVE-CAUGHT 2026-07-21 (GROM AU): verifying the WHOLE
  // update config produced false `config.triggers` / `config.actions` mismatches,
  // because a Studio agent is built by the AI from `buildPrompt` — the server keeps
  // the AI-generated triggers (expected [] from the IR, persisted 1) and does not
  // store an `actions` key at all (expected []). Those fields are AI/server-owned,
  // not ours to assert. The follow-up PUT still sends the full config; we just don't
  // pretend to verify what we did not author.
  const { name, systemPrompt } = update.body.config ?? {};
  return { create, actions: [], followUps: [update], verifyExpected: { config: { name, systemPrompt } } };
}

const aiPlanPreview = (plan) => ({
  create: descriptorPreview(plan.create),
  followUps: (plan.followUps ?? []).map(descriptorPreview),
  actions: (plan.actions ?? []).map(descriptorPreview),
  verification: { method: 'GET', path: 'provider-specific agent read by created id' },
});

function buildWorkflowData(report, locationId) {
  const counts = [report.authored, report.compiled, report.steps];
  const mismatch = new Set(counts).size !== 1;
  const trg = report.triggers ?? {};
  const failed = trg.failed?.length ?? 0;
  const triggerMismatch = failed > 0
    || (Number.isInteger(trg.persisted) && Number.isInteger(trg.authored) && trg.persisted !== trg.authored);
  return ok({
    ...report,
    countIntegrity: {
      mismatch,
      warning: mismatch
        ? `LOUD STEP-COUNT MISMATCH: authored=${report.authored}, compiled=${report.compiled}, persisted steps=${report.steps}. The draft may be incomplete.`
        : 'authored, compiled, and persisted step counts match.',
    },
    // The same integrity sentence for TRIGGERS. `failed[]` was always recorded; it was never a
    // HEADLINE, so a build whose every trigger POST failed still read as a clean draft with
    // `verify.pass: N, issues: []` (F5-16). A workflow with no working trigger never runs.
    triggerIntegrity: {
      authored: trg.authored ?? null,
      posted: trg.posted ?? 0,
      failed,
      persisted: trg.persisted ?? null,
      mismatch: triggerMismatch,
      warning: triggerMismatch
        ? `LOUD TRIGGER MISMATCH: authored=${trg.authored}, posted=${trg.posted}, failed=${failed}, persisted=${trg.persisted}. The draft has NO working trigger for each failed POST — fix before calling this done.`
        : 'every authored trigger was posted and read back.',
    },
    partial: mismatch || triggerMismatch,
    builderUrl: report.wid
      ? `https://app.gohighlevel.com/v2/location/${encodeURIComponent(locationId)}/automation/workflow/${encodeURIComponent(report.wid)}`
      : null,
    // build_workflow never calls publish — but a "nothing was published" claim is only as
    // good as what we actually checked. orchestrate.mjs's round-trip GET (~line 527) reads
    // the document back and records report.statusReadBack; base the note on THAT, not on
    // the fact that we never issued a publish PUT. Two separately-built workflows have been
    // observed reading back status:"published" with no publish call and no --publish flag —
    // the underlying cause is a separate, unresolved platform-adjacent defect (out of scope
    // here). This only stops the tool from asserting a safety property it never verified.
    statusReadBack: report.statusReadBack ?? null,
    publicationNote: report.statusReadBack === 'draft'
      ? 'Draft-only operation: nothing was published; read back as draft.'
      : report.statusReadBack == null
        ? 'Draft-only operation: nothing was published; status could not be read back to confirm.'
        : `⚠ read back as '${report.statusReadBack}' although no publish was requested — investigate before relying on draft state.`,
  }).data;
}

const recordsFrom = (payload, ...keys) => {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  return [];
};

const finiteCount = (record, numberKeys, arrayKeys) => {
  for (const key of numberKeys) {
    const value = Number(record?.[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  for (const key of arrayKeys) if (Array.isArray(record?.[key])) return record[key].length;
  return null;
};

const summarizeCourse = (course) => ({
  id: course?._id ?? course?.id ?? null,
  title: course?.title ?? course?.name ?? null,
  status: course?.status ?? course?.visibility ?? null,
  counts: {
    chapters: finiteCount(course, ['categoriesCount', 'categoryCount', 'chaptersCount', 'chapterCount'], ['categories', 'chapters']),
    lessons: finiteCount(course, ['postsCount', 'postCount', 'lessonsCount', 'lessonCount'], ['posts', 'lessons']),
    offers: finiteCount(course, ['offersCount', 'offerCount'], ['offers']),
  },
});

const countCourseTree = (payload) => {
  const roots = recordsFrom(payload, 'categories', 'data', 'rows');
  const seen = new WeakSet();
  let chapters = 0;
  let lessons = 0;
  const visit = (category) => {
    if (!category || typeof category !== 'object' || seen.has(category)) return;
    seen.add(category);
    chapters++;
    lessons += recordsFrom(category?.posts, 'posts', 'lessons', 'data').length;
    for (const child of recordsFrom(category?.children, 'categories', 'children', 'subCategories')) visit(child);
    for (const child of recordsFrom(category?.subCategories, 'categories', 'children', 'subCategories')) visit(child);
    for (const child of recordsFrom(category?.categories, 'categories', 'children', 'subCategories')) visit(child);
  };
  for (const root of roots) visit(root);
  return { chapters, lessons };
};

const workflowPath = (locationId, workflowId) => (
  `/workflow/${encodeURIComponent(locationId)}/${encodeURIComponent(workflowId)}`
);

async function getWorkflow(gw, locationId, workflowId) {
  return gw.call('GET', `${workflowPath(locationId, workflowId)}?includeScheduledPauseInfo=true`);
}

async function listWorkflowTriggers(gw, locationId, workflowId) {
  const query = new URLSearchParams({ workflowId });
  const response = await gw.call(
    'GET',
    `/workflow/${encodeURIComponent(locationId)}/trigger?${query}`,
  );
  return { response, triggers: recordsFrom(response.json, 'triggers', 'data') };
}

// A request's own body says whether it will leave something inactive: `status:'draft'` will
// (an addTrigger/duplicateTrigger landing on a still-draft workflow); anything else —
// `status:'published'`, or no `status` key at all (a pure content edit, delete,
// replaceTagInTriggers) — does not, by itself, need a publish to take effect.
//
// `modifyTrigger` is mostly excluded from that check: a modifyTrigger status write is
// self-contained in BOTH directions — it applies immediately and is round-trip verified by
// verifyTriggerRoundTrip's verifyActive path (see triggerSemanticExpectation) — so an explicit
// DEACTIVATION through modifyTrigger never needs a publish on its own. (Telling a caller to
// publish after a deactivation would be actively harmful: republishing cascades
// draft→published across every trigger on the workflow and would turn the just-deactivated
// trigger back on.)
//
// The one modifyTrigger case that DOES need a publish: an ACTIVATION (`status:'published'`)
// landing on a trigger whose WORKFLOW is still `draft`. The trigger itself goes
// `status:'published'` — it will evaluate and match events — but the workflow cannot enrol
// anyone until it too is published (measured: an active trigger on a draft workflow matched
// its event but produced no enrolment). Reporting `requiresPublish:false` here under-advises:
// it tells the caller nothing more is needed when the workflow still cannot act on the match.
function triggerRequiresPublish(request, workflowStatus) {
  if (request.method === 'DELETE') return false;
  if (request.op === 'modifyTrigger') {
    return request.body?.status === 'published' && workflowStatus === 'draft';
  }
  return request.body?.status === 'draft';
}

// Selects the instruction text for whatever in triggerPlan tripped triggerRequiresPublish.
// The two cases need different wording: a CREATE that inherited draft (addTrigger/
// duplicateTrigger) has not activated at all yet, while a modifyTrigger ACTIVATION on a draft
// workflow has already gone active and is waiting on the workflow, not the trigger. `committed`
// picks the tense — the preview path hasn't written anything yet, the confirm path already has.
function triggerPublishInstruction(triggerPlan, workflowStatus, { committed }) {
  const matches = triggerPlan.filter((request) => triggerRequiresPublish(request, workflowStatus));
  if (matches.length === 0) return null;
  if (matches.some((request) => request.op === 'modifyTrigger')) {
    return committed
      ? 'This trigger is now active, but its workflow is still draft — GHL will not enrol anyone until the workflow itself is published. Invoke publish_workflow with confirm:true to publish it.'
      : 'This trigger will be active, but its workflow is still draft — GHL will not enrol anyone until the workflow itself is published. After verifying the edit, invoke publish_workflow with confirm:true to publish it.';
  }
  return committed
    ? 'Trigger configuration was committed without activation. After verifying the edit, invoke publish_workflow with confirm:true to activate it explicitly.'
    : 'Trigger configuration will be committed without activation. After verifying the edit, invoke publish_workflow with confirm:true to activate it explicitly.';
}

// Ops that write step ATTRIBUTES. Only these can breach a per-field rule such as a character cap,
// so only these are worth a catalog fetch — a rename or a move cannot make a field invalid, and
// the edit path's network shape is a pinned contract that must not grow for nothing.
const ATTR_WRITING_OPS = new Set([
  'addBranch', 'appendStep', 'appendToBranch', 'duplicateStep', 'insertAfter', 'insertBefore',
  'modifyStep', 'replaceInAttributes', 'replaceFieldId', 'replaceTag', 'retypeStep',
]);

// The builder's "Resolve N Errors" list, computed for an edit before it is sent. Same catalog and
// same predicate check_workflow uses, so the two can never disagree about what the builder shows.
// Returns [] on any failure: this is a reporting layer, never a gate.
async function editSchemaViolations(gw, loc, templates, triggers, ops, prefetchedAssets) {
  if (!(ops ?? []).some((o) => ATTR_WRITING_OPS.has(o?.op))) return [];
  return schemaViolationsFor(gw, loc, templates, triggers, prefetchedAssets);
}
// The ungated core, shared with repair_workflow (which has no op list to gate on — a whole
// document is being replaced, so any non-empty diff is worth the catalog fetch).
async function schemaViolationsFor(gw, loc, templates, triggers, prefetchedAssets) {
  try {
    // A marketplace op has already fetched this exact payload to resolve its keys. Reuse it
    // rather than asking for the same 3 MB twice in one edit.
    let assets = prefetchedAssets;
    if (!assets) {
      const resp = await gw.call('GET',
        `/workflows-marketplace/location/${loc}/assets?workflowTypes=default,contacts`);
      if (!resp?.ok || !resp.json) return [];
      assets = resp.json;
    }
    const schema = parseActionSchema(assets);
    const triggerTypes = (triggers ?? []).map((t) => t?.type).filter(Boolean);
    return checkWorkflow(templates, schema, triggerTypes.length ? { triggerTypes } : {});
  } catch {
    return [];
  }
}

// ── The build path's pre-write validators, shared by edit_workflow and repair_workflow ──────
// orchestrate.mjs runs these on every build; they were ported to the edit path in 0.48.0 and to
// repair_workflow in the same release, so every write path holds the same ladder. Each is scoped
// to `touchedIds` — the steps THIS write created or modified — because an untouched legacy
// step's debt is someone else's (the doctrine the intent lints set), and re-running GHL's
// sandbox over code the caller never touched would silently rewrite outputs they did not ask to
// change. Each fails open on transport, per the edit path's standing rule: a new validator must
// never become a new way for a working write to die. Every refusal names its hatch. All run
// before the confirm gate, so a preview already carries the verdicts.

// The custom_code_test phase: run each touched custom_code step in GHL's own sandbox
// (POST /workflow/custom-code/run-test — the builder's "Test code" button; executes the code,
// touches nothing on the account). A passing run REPLACES the authored `output` sample IN PLACE
// with the real return object — so callers must run this BEFORE building the commit body —
// because the keys the {{custom_code.N.<key>}} picker offers are whatever is stored. A failing
// run warns and keeps the authored sample; `strict` refuses instead. `skip` covers both the
// caller's skipCustomCodeTest and the op-class gate.
async function customCodePreflight({ gw, loc, templates, touchedIds, strict, skip, warnings }) {
  const tests = [];
  if (skip === true) return { tests, refusal: null };
  for (const t of templates) {
    if (t?.type !== 'custom_code' || !touchedIds.has(t.id)) continue;
    const a = t.attributes ?? {};
    let r = null;
    let transportError = null;
    try {
      r = await gw.call('POST', '/workflow/custom-code/run-test',
        { location_id: loc, attributes: { language: a.language ?? 'javascript', code: a.code ?? '', inputData: a.inputData ?? {} } });
    } catch (e) { transportError = e?.message ?? String(e); }
    const j = r?.ok && r.json && typeof r.json === 'object' ? r.json : null;
    const out = j?.output;
    const valid = out !== null && typeof out === 'object' && !Array.isArray(out) && Object.keys(out).length > 0;
    const entry = { id: t.id, name: t.name ?? null, status: r?.status ?? null,
      passed: !!j && j.hasError !== true && valid,
      hasError: j?.hasError === true, errorMessage: j?.errorMessage ?? transportError ?? null,
      authoredKeys: Object.keys(a.output ?? {}), outputKeys: valid ? Object.keys(out) : [],
      consoleErrors: Array.isArray(j?.consoleErrors) ? j.consoleErrors : [], replacedOutput: false };
    if (entry.passed) {
      const missing = entry.authoredKeys.filter((k) => !(k in out));
      const extra = entry.outputKeys.filter((k) => !(k in (a.output ?? {})));
      if (missing.length || extra.length) warnings.push(`custom_code '${entry.name ?? t.id}': sandbox output keys differ from the authored sample (missing: ${missing.join(',') || '-'}; extra: ${extra.join(',') || '-'}) — the sandbox result was saved as the step's output`);
      t.attributes = { ...a, output: out };
      entry.replacedOutput = true;
    } else {
      const why = transportError ? `sandbox unreachable: ${transportError}`
        : j ? (j.errorMessage ?? (valid ? 'unknown' : 'output is not a non-empty object')) : `HTTP ${r?.status}`;
      warnings.push(`custom_code '${entry.name ?? t.id}': sandbox test did not pass (${why}); the authored output sample was kept`);
      if (strict === true) {
        tests.push(entry);
        return { tests, refusal: withFailureData(fail(
          CODES.ENGINE_ABORT,
          `custom_code '${entry.name ?? t.id}' failed the sandbox test: ${why}`,
          'Fix the code (test_custom_code iterates without writing), drop strictCustomCode to write it with a warning, or pass skipCustomCodeTest:true to skip the sandbox entirely. Nothing was written.',
        ), { customCodeTests: tests, warnings }) };
      }
    }
    tests.push(entry);
  }
  return { tests, refusal: null };
}

// The validate_assets phase: GHL's OWN reference validator — stateless (payload in, verdict out),
// so a candidate document is judged before anything is written. Errors on touched steps refuse
// (hatch: ignoreAssetErrors); errors on untouched steps are legacy debt and demote to warnings;
// a finding with no stepId is attributed to the document as a whole, which this write is
// replacing, so it blocks. Fail-open inside validateAssets: an unreachable endpoint reports
// `skipped` and the write proceeds.
//
// The verdict is stamped `phase: 'pre-write'`: it describes the CANDIDATE document, before the
// write. R-96 misread a correct, persistent pre-write error as a stale cache and hatched past it
// with ignoreAssetErrors — the reference it complained about was exactly the one the (silently
// dropped) op was meant to fix. Two guards follow from that: the phase is named, and the hatch
// is refused when the flagged asset id is one this edit's own ops are REPLACING (replaceFieldId /
// replaceTag / replaceInAttributes old values) — that is precisely the case where the error is
// real and the write is the fix, so suppressing it would hide a failed re-point.
const idsBeingReplaced = (ops = []) => new Set(ops.flatMap((o) => [o?.oldId, o?.oldTag, o?.find]).filter((v) => typeof v === 'string' && v));
async function assetPreflightFor({ gw, loc, templates, triggers, companyId, touchedIds, ignoreAssetErrors, warnings, ops = [] }) {
  const verdict = await validateAssets((m, p, b) => gw.call(m, p, b), loc, { templates, triggers, companyId });
  const assetPreflight = { phase: 'pre-write', ...verdict };
  for (const w of assetPreflight.warnings ?? []) warnings.push(`asset: ${describeFinding(w)}`);
  const blocking = [];
  for (const e of assetPreflight.errors ?? []) {
    if (e.stepId && !touchedIds.has(e.stepId)) warnings.push(`asset (pre-existing, untouched by this edit): ${describeFinding(e)}`);
    else blocking.push(e);
  }
  if (blocking.length && ignoreAssetErrors === true) {
    const replacing = idsBeingReplaced(ops);
    const stillOld = blocking.filter((e) => e.assetId && replacing.has(e.assetId));
    if (stillOld.length) {
      return { assetPreflight, refusal: withFailureData(fail(
        CODES.VALIDATION_FAILED,
        `ignoreAssetErrors refused: GHL still reports ${stillOld.length} reference(s) to an id this edit is REPLACING — `
          + stillOld.map(describeFinding).join('; ')
          + '. The candidate document still carries the old id, so the replace op did not reach it.',
        'This is the R-96 shape: an asset error naming the very reference you are fixing means the fix has not landed in '
          + 'the candidate document. Check the op (replaceInAttributes path / replaceFieldId / replaceTag) reaches the field, '
          + 'preview without confirm to read data.preview.assetPreflight, and do not hatch past it. Nothing was written.',
      ), { assetPreflight, warnings }) };
    }
  }
  if (blocking.length && ignoreAssetErrors !== true) {
    return { assetPreflight, refusal: withFailureData(fail(
      CODES.VALIDATION_FAILED,
      `GHL rejected ${blocking.length} asset reference(s) in this edit before any write: `
        + blocking.map(describeFinding).join('; '),
      'Create the missing objects or correct the references. ignoreAssetErrors:true writes the edit anyway and is for a '
        + 'reference you KNOW is about to exist — if the error names the reference this edit is meant to fix, the fix has '
        + 'not landed and hatching past it hides a failed re-point (R-96). This verdict describes the document BEFORE the '
        + 'write (phase: pre-write); a confirmed write re-checks the persisted document. Nothing was written.',
    ), { assetPreflight, warnings }) };
  }
  return { assetPreflight, refusal: null };
}

// The POST-WRITE check: GHL's reference validator run again over the PERSISTED document, so a
// caller can tell "the pre-write verdict was stale" from "the error is still there". An error
// that survives the write on a step this call touched (or on the document as a whole) is the
// R-96 signal, surfaced as a warning and as `assetErrorsPersist` — never an abort, because the
// write has already happened and an abort would misreport that. Fail-open like the pre-check.
async function assetPostcheck({ gw, loc, templates, triggers, companyId, touchedIds, warnings }) {
  const verdict = await validateAssets((m, p, b) => gw.call(m, p, b), loc, { templates, triggers, companyId });
  const persisting = (verdict.errors ?? []).filter((e) => !e.stepId || touchedIds.has(e.stepId));
  for (const e of persisting) {
    warnings.push(`ASSET_ERROR_PERSISTS_AFTER_WRITE: ${describeFinding(e)} — GHL still reports this on the PERSISTED document. `
      + 'If this is the reference you meant to fix, the fix did not land: re-read with export_workflow and compare.');
  }
  return { phase: 'post-write', ...verdict, persisting };
}

// LARGE DOCUMENTS (backlog 21, 27). A finished flow bot is ~90 KB / 120 steps: above what an MCP
// client passes inline as a tool argument, and its export and log reads exceed the tool-result
// cap and land as files anyway. So the read tools can WRITE their result to a caller-named file
// (scrubbed exactly like the inline result), and repair_workflow can READ its templates from one
// — an export_workflow file, a raw workflow GET body, or a bare templates array. The path must
// be absolute: this is a local stdio server acting for its own user, and a relative path would
// resolve against wherever the server happened to start.
function writeResultFile(path, data) {
  if (typeof path !== 'string' || !isAbsolute(path)) {
    return { failure: fail(CODES.VALIDATION_FAILED, 'writeTo must be an absolute file path.', 'Pass e.g. "/Users/you/project/.ghl/export.json".') };
  }
  const text = JSON.stringify(scrubSecrets(data), null, 1);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, { mode: 0o600 });
  return { writtenTo: path, bytes: Buffer.byteLength(text) };
}
function readTemplatesFile(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) {
    return { failure: fail(CODES.VALIDATION_FAILED, 'templatesPath must be an absolute file path.', 'Pass the file export_workflow wrote (writeTo), or any JSON holding the templates array.') };
  }
  let parsed;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
    return { failure: fail(CODES.VALIDATION_FAILED, `templatesPath could not be read as JSON: ${e.message}`, 'Point it at an export_workflow file or a JSON file holding the templates array.') };
  }
  const templates = Array.isArray(parsed) ? parsed
    : Array.isArray(parsed?.templates) ? parsed.templates
      : Array.isArray(parsed?.workflowData?.templates) ? parsed.workflowData.templates
        : Array.isArray(parsed?.workflow?.workflowData?.templates) ? parsed.workflow.workflowData.templates
          : null;
  if (!templates) {
    return { failure: fail(CODES.VALIDATION_FAILED, 'templatesPath holds no templates array.', 'Accepted shapes: a bare array, {templates}, a workflow GET body {workflowData:{templates}}, or an export_workflow file {workflow:{workflowData:{templates}}}.') };
  }
  return { templates };
}

// MEASURED FIELD CAPS (field-caps.mjs), enforced BEFORE the write on the steps this call touches.
// Four caps were crossed in one week on the rails, each committed with `verify.roundTrip: true`
// and found later in the builder (backlog 15, 25). The server accepts the value; the builder
// shows an error badge and the drawer refuses to save. Refused by default; `allowOverCap:true`
// writes anyway and keeps the finding as a FIELD_CAP warning. The general per-field layer is
// still the live action schema (schemaViolations) — this table covers only what was measured.
function fieldCapGate({ templates, scope, allowOverCap, warnings }) {
  const findings = checkFieldCaps(templates, { scope });
  if (!findings.length) return { findings, refusal: null };
  if (allowOverCap === true) {
    for (const f of findings) warnings.push(`FIELD_CAP (allowOverCap): ${describeCap(f)}`);
    return { findings, refusal: null };
  }
  return { findings, refusal: withFailureData(fail(
    CODES.VALIDATION_FAILED,
    `${findings.length} field(s) exceed the builder's character cap: ${findings.map(describeCap).join('; ')}`,
    'Shorten the value to the cap (describe_step_type shows caps per type), or pass allowOverCap:true to write it '
      + 'anyway — the server will store it and the builder will flag it. Nothing was written.',
  ), { fieldCaps: findings, warnings }) };
}

// The G15 account-readiness advisory: will the channels the touched steps (and any trigger types
// this write adds) use actually function on this location? Network grows only when a touched
// step's channel needs a signal read. Advisory — never blocks; the account can be fixed after.
async function readinessFor({ gw, loc, templates, touchedIds, triggerTypes = [], settings = {}, catalog, warnings }) {
  try {
    const plan = planReadinessChecks({
      templates: templates.filter((t) => touchedIds.has(t.id)), triggerTypes, settings, catalog,
    });
    const readiness = plan.length ? await runReadinessChecks(plan, { call: (m, p, b) => gw.call(m, p, b), loc }) : [];
    for (const c of readiness) if (c.ok === false) warnings.push(`readiness: ${c.detail} (needed by ${c.why.join('; ')})`);
    return readiness;
  } catch (e) {
    return [{ key: 'readiness', checked: false, ok: null, detail: `pre-flight failed to run: ${e.message}`, why: [] }];
  }
}

// The build path's persisted-required-field assertion (orchestrate.mjs step 5), read off the
// round-trip GET: a step whose attributes survived perfectly can still be missing a field the
// BUILDER requires — the key was never sent, so no persistence check can see it. Scoped to
// touched steps; advisory, matching the build path (the server accepted the document, so this
// is a red badge and a publish block in the UI, not a failed write).
function persistedMissingRequired(gotTemplates, touchedIds, warnings) {
  const missingRequired = gotTemplates
    .filter((t) => touchedIds.has(t.id))
    .map((t) => ({ id: t.id, name: t.name ?? null, type: t.type, missing: missingRequiredFields(t) }))
    .filter((entry) => entry.missing.length);
  for (const entry of missingRequired) {
    warnings.push(`required: step '${entry.name ?? entry.id}' (${entry.type}) is missing builder-required field(s) ${entry.missing.join(', ')} — the builder renders it with a red error badge and the workflow cannot be published until they are supplied`);
  }
  return missingRequired;
}

function editPreview(ops, beforeTemplates, templates, diff, triggerPlan, neededTags, tagsToCreate, workflowStatus) {
  const beforeIds = new Set(beforeTemplates.map((step) => step.id));
  const afterIds = new Set(templates.map((step) => step.id));
  const requiresPublish = triggerPlan.some((request) => triggerRequiresPublish(request, workflowStatus));
  return {
    opsApplied: ops.map((op) => op?.op ?? null),
    stepCount: { before: beforeTemplates.length, after: templates.length },
    idsAdded: [...afterIds].filter((id) => !beforeIds.has(id)),
    idsRemoved: [...beforeIds].filter((id) => !afterIds.has(id)),
    diff,
    // A NOOP entry is a modifyTrigger whose every requested value already matches the store —
    // shown, never sent (D-67: a no-op PUT "verified" a write that never happened).
    triggerChanges: triggerPlan.map(({ op, method, path, triggerId, noop, reason, requested }) => (noop
      ? { op, triggerId, noop: true, reason, requested }
      : { op, method, path, ...(triggerId ? { triggerId } : {}), ...(requested ? { requested } : {}) })),
    requiresPublish,
    publishInstruction: triggerPublishInstruction(triggerPlan, workflowStatus, { committed: false }),
    tagsReferenced: neededTags,
    tagsToCreate,
  };
}

function expectedSubsetMismatches(expected, actual, path = '') {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [{ path, expected, actual }];
    return expected.flatMap((value, index) => (
      index < actual.length
        ? expectedSubsetMismatches(value, actual[index], `${path}[${index}]`)
        : [{ path: `${path}[${index}]`, expected: value, actual: undefined }]
    ));
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
      return [{ path, expected, actual }];
    }
    return Object.entries(expected).flatMap(([key, value]) => {
      const childPath = path ? `${path}.${key}` : key;
      if (!Object.hasOwn(actual, key)) return [{ path: childPath, expected: value, actual: undefined }];
      return expectedSubsetMismatches(value, actual[key], childPath);
    });
  }
  return Object.is(expected, actual) ? [] : [{ path, expected, actual }];
}

const triggerIdOf = (trigger) => trigger?.id ?? trigger?._id ?? null;

function returnedResourceId(response) {
  const id = response?.json?.id
    ?? response?.json?._id
    ?? response?.json?.data?.id
    ?? response?.json?.data?._id
    ?? null;
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null;
}

// `active` is excluded from this comparison list on purpose: it is a SERVER-MANAGED
// PROJECTION of the workflow's publish state (measured: publishing with zero trigger writes
// flips it; an explicit per-trigger PUT setting `active` does nothing, in either direction),
// and it converges ASYNCHRONOUSLY, on its own schedule, following any publish transition
// anywhere on the workflow — not just this request. A round-trip GET run moments after an
// unrelated publish can legitimately observe a DIFFERENT `active` value than whatever this
// request echoed, for reasons that have nothing to do with whether THIS edit's content
// (conditions/name/targetActionId/etc.) persisted. Comparing it unconditionally would
// manufacture false-negative round-trip failures on an otherwise-clean content edit.
//
// The one exception: when an op explicitly requests an active change, the request body
// carries a `status` key (edit-driver.mjs's translateActiveToStatus omits it for every
// non-change), and THAT write does determine the final `active` value — so `verifyActive` is
// passed true ONLY for that case, verifying the one thing the write is actually responsible
// for; the async-drift risk above does not apply to it, because this request is exactly
// what's expected to have caused the value. Every other trigger write (a pure content
// modifyTrigger, an addTrigger, replaceTagInTriggers…) still must not compare `active`, for
// the async-drift reason above. See mcp-internal/test/edit-workflow.test.mjs's drift test for
// the untranslated case this still avoids, and its two 'DOES verify' tests for the translated
// case this catches.
function triggerSemanticExpectation(body = {}, { verifyActive = false } = {}) {
  // ROOT `workflowId` is deliberately NOT here. The POST body carries it camelCase (the only casing
  // the server accepts — see casingLint), but the STORED trigger carries `workflow_id` and no
  // `workflowId` at all, so expecting the WRITE key on the READ shape manufactured a false
  // "did not persist" abort on every successful add (F5-13, hit twice in one session; the abort
  // tells the caller not to publish and invites a retry, which duplicates the trigger). The
  // attachment IS still verified: `actions[0].workflow_id` rides inside the compared `actions`
  // subtree, and that is the field that actually binds a trigger to its workflow.
  const keys = [
    'type', 'masterType', 'name', 'conditions', 'actions',
    'schedule_config', 'convTriggerBotId',
  ];
  const expected = Object.fromEntries(keys
    .filter((key) => Object.hasOwn(body, key))
    .map((key) => [key, body[key]]));
  if (verifyActive) expected.active = body.status === 'published';
  return expected;
}

function verifyTriggerRoundTrip(expectations, actualTriggers, beforeTriggers = []) {
  const usableId = (trigger) => {
    const id = triggerIdOf(trigger);
    return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null;
  };
  const countIds = (triggers) => {
    const counts = new Map();
    for (const trigger of triggers) {
      const id = usableId(trigger);
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  };
  const beforeIdCounts = countIds(beforeTriggers);
  const actualIdOccurrences = new Map();
  const newlyObservedIndexes = new Set();
  actualTriggers.forEach((trigger, index) => {
    const id = usableId(trigger);
    if (!id) return;
    const occurrence = (actualIdOccurrences.get(id) ?? 0) + 1;
    actualIdOccurrences.set(id, occurrence);
    if (occurrence > (beforeIdCounts.get(id) ?? 0)) newlyObservedIndexes.add(index);
  });
  const actualById = new Map(actualTriggers
    .map((trigger) => [usableId(trigger), trigger])
    .filter(([id]) => typeof id === 'string' && id.length > 0));
  const consumedAddIndexes = new Set();
  const checks = expectations.map(({ request, returnedId }) => {
    if (request.op === 'deleteTrigger') {
      const persisted = !actualById.has(request.triggerId);
      return { op: request.op, triggerId: request.triggerId, persisted, mismatches: [] };
    }

    // The TRANSLATED case only: a modifyTrigger whose op explicitly requested an active
    // change carries a `status` key on its body (translateActiveToStatus omits it otherwise —
    // see edit-driver.mjs). That is the one write this round trip should hold to its `active`
    // promise; see triggerSemanticExpectation's comment for the full reasoning.
    const verifyActive = request.op === 'modifyTrigger' && Object.hasOwn(request.body ?? {}, 'status');
    const expected = triggerSemanticExpectation(request.body, { verifyActive });
    let actual;
    let matchSource = null;
    if (request.op === 'modifyTrigger') {
      actual = actualById.get(request.triggerId);
      matchSource = actual ? 'triggerId' : null;
    } else if (returnedId) {
      const index = actualTriggers.findIndex((candidate, candidateIndex) => (
        !consumedAddIndexes.has(candidateIndex) && usableId(candidate) === returnedId
      ));
      if (index >= 0) {
        actual = actualTriggers[index];
        consumedAddIndexes.add(index);
        matchSource = 'returnedId';
      }
    } else {
      const index = actualTriggers.findIndex((candidate, candidateIndex) => (
        newlyObservedIndexes.has(candidateIndex)
        && !consumedAddIndexes.has(candidateIndex)
        && expectedSubsetMismatches(expected, candidate).length === 0
      ));
      if (index >= 0) {
        actual = actualTriggers[index];
        consumedAddIndexes.add(index);
        matchSource = 'newlyObserved';
      }
    }
    const mismatches = actual ? expectedSubsetMismatches(expected, actual) : [];
    // WHAT THE CALLER ASKED FOR, held against the store — not what the engine decided to send.
    // R-96's verifier passed eight no-op writes because it compared the engine's own (empty)
    // intent against an unchanged record. `request.requested` is the caller's fields as they
    // must read back (edit-driver.mjs requestedTriggerFields); a store that disagrees with ANY
    // of them is a failed write, whatever the PUT body said.
    const requested = request.requested && actual ? expectedSubsetMismatches(request.requested, actual) : [];
    for (const m of requested) if (!mismatches.some((x) => x.path === m.path)) mismatches.push({ ...m, requestedByCaller: true });
    // THE TAMPER-EVIDENT FIELD. The server stamps `date_updated` itself on every accepted
    // write and ignores the client's value (D-67, measured: a PUT carrying the old stamp read
    // back with a new one). A value that matches what was sent proves nothing — it may never
    // have differed. An UNMOVED stamp after an acknowledged PUT proves the write never landed
    // (D-67: two "persisted: true" reports, zero writes). Checked whenever the pre-write row
    // carried a stamp; a roster without one reports the check as unavailable, never as passed.
    let dateUpdated = null;
    if (actual && request.before && (request.before.date_updated || request.before.updatedAt)) {
      const before = request.before.date_updated ?? request.before.updatedAt;
      const after = actual.date_updated ?? actual.updatedAt ?? null;
      dateUpdated = { before, after, moved: after != null && after !== before };
      if (!dateUpdated.moved) {
        mismatches.push({ path: 'date_updated', expected: `a stamp later than ${before}`, actual: after,
          note: 'the server stamps date_updated on every write it applies; an unmoved stamp after a 200 means the PUT changed nothing (D-67)' });
      }
    } else if (actual && request.before) {
      dateUpdated = { before: null, after: actual.date_updated ?? actual.updatedAt ?? null, moved: null, note: 'pre-write row carried no date_updated — the moved-stamp check could not run' };
    }
    return {
      op: request.op,
      triggerId: request.triggerId ?? returnedId ?? triggerIdOf(actual),
      matchSource,
      persisted: Boolean(actual) && mismatches.length === 0,
      mismatches,
      ...(request.requested ? { requested: request.requested } : {}),
      ...(dateUpdated ? { dateUpdated } : {}),
    };
  });
  return { roundTrip: checks.every((check) => check.persisted), checks };
}

// The diff an ops-based edit gets for free, derived instead by comparing two template sets by id.
// repair_workflow takes a whole document, so it has no op list to read a diff from — but every
// commit guard downstream is driven by that diff, so it has to be computed rather than assumed.
function diffTemplates(before, after) {
  const b = new Map((before ?? []).map((t) => [t.id, t]));
  const a = new Map((after ?? []).map((t) => [t.id, t]));
  return {
    createdSteps: [...a.keys()].filter((id) => !b.has(id)),
    modifiedSteps: [...a.keys()].filter((id) => b.has(id) && JSON.stringify(b.get(id)) !== JSON.stringify(a.get(id))),
    deletedSteps: [...b.keys()].filter((id) => !a.has(id)),
  };
}

function verifyEditRoundTrip(expectedTemplates, beforeTemplates, gotTemplates) {
  const expectedById = new Map(expectedTemplates.map((step) => [step.id, step]));
  const gotById = new Map(gotTemplates.map((step) => [step.id, step]));
  const expectedIds = new Set(expectedById.keys());
  const beforeIds = new Set(beforeTemplates.map((step) => step.id));
  const missingExpectedIds = [...expectedIds].filter((id) => !gotById.has(id));
  const removedStillPresent = [...beforeIds].filter((id) => !expectedIds.has(id) && gotById.has(id));
  const duplicateIds = gotTemplates
    .map((step) => step.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  const mismatchedGraphIds = [];
  const droppedAttributes = [];
  const valueMismatches = [];

  for (const [id, expected] of expectedById) {
    const got = gotById.get(id);
    if (!got) continue;
    const graphKeys = ['next', 'parentKey', 'parent', 'order'];
    if (graphKeys.some((key) => JSON.stringify(got[key]) !== JSON.stringify(expected[key]))) {
      mismatchedGraphIds.push(id);
    }
    const dropped = Object.keys(expected.attributes ?? {})
      .filter((key) => !(key in (got.attributes ?? {})));
    if (dropped.length) droppedAttributes.push({ id, dropped });
    for (const mismatch of expectedSubsetMismatches(expected, got)) {
      valueMismatches.push({ id, ...mismatch });
    }
  }

  const stepCountMatch = gotTemplates.length === expectedTemplates.length;
  const roundTrip = stepCountMatch
    && missingExpectedIds.length === 0
    && removedStillPresent.length === 0
    && duplicateIds.length === 0
    && mismatchedGraphIds.length === 0
    && droppedAttributes.length === 0
    && valueMismatches.length === 0;
  return {
    roundTrip,
    stepCountMatch,
    missingExpectedIds,
    removedStillPresent,
    duplicateIds: [...new Set(duplicateIds)],
    mismatchedGraphIds,
    droppedAttributes,
    valueMismatches,
  };
}

const withFailureData = (failure, data) => ({ ...failure, data: ok(data).data });

function fromThrown(error) {
  if (error?.gatewayResponse) {
    return fromHttp(error.gatewayResponse.status, error.gatewayResponse.json);
  }
  if (error?.code && error?.remediation) {
    return fail(error.code, error.detail ?? error.message, error.remediation);
  }
  // Not every throw is a transport failure. A compiler/validator rejecting a spec throws
  // BEFORE anything is sent — telling that caller to "inspect account state" sends them
  // hunting the account for what is actually a typo in their spec (live-caught 2026-07-21:
  // a missing `mode` on a ConvAI spec reported as a gateway transport failure).
  const message = error?.message ?? String(error);
  const isSpecRejection = error?.name === 'IRError'
    || /^[A-Z_]+:/.test(message)
    || /\bmust be one of\b|\bis required\b|\bunknown key\b|\binvalid\b/i.test(message);
  return fail(
    CODES.ENGINE_ABORT,
    message,
    isSpecRejection
      ? 'The spec was rejected before any request was sent — nothing was created. Fix the spec and retry.'
      : 'Gateway transport failed before an HTTP result was available; inspect account state before retrying.',
  );
}

async function safeGatewayCall(invoke) {
  try {
    return { value: await invoke(), threw: false, failure: null, error: null };
  } catch (error) {
    return { value: null, threw: true, failure: fromThrown(error), error };
  }
}

function urgentPartialFailure(failure, data, publishedStateVerified = false) {
  const urgency = publishedStateVerified
    ? 'URGENT: account state changed. A published state was verified, but inspect the workflow and runtime logs before retrying.'
    : 'URGENT: account state may be partially changed. Inspect the workflow immediately; if it is draft, republish it before relying on triggers.';
  return withFailureData({
    ...failure,
    remediation: `${urgency} ${failure.remediation ?? ''}`.trim(),
  }, data);
}

function editWriteFailure(failure, data) {
  return withFailureData({
    ...failure,
    remediation: `URGENT: the edit may be partially applied. Inspect the workflow and re-run a read-only edit preview before retrying. If trigger changes landed, invoke publish_workflow with confirm:true only after the intended configuration is verified. ${failure.remediation ?? ''}`.trim(),
  }, data);
}

function rawWriteFailure(failure, data, { ambiguous = false } = {}) {
  const warning = ambiguous
    ? 'URGENT: the raw request outcome is ambiguous because transport failed after the write was attempted. Inspect the target resource before retrying.'
    : 'URGENT: the raw request reached upstream but was not accepted. Inspect the target resource and endpoint response before retrying.';
  return withFailureData({
    ...failure,
    remediation: warning,
  }, data);
}

function fastForwardAmbiguousFailure(failure, data, rows) {
  const statusIds = rows.map((row) => row._id);
  const contactIds = [...new Set(rows.map((row) => row.contactId).filter(Boolean))];
  return withFailureData(
    fail(
      failure.code,
      failure.detail,
      `URGENT: the fast-forward outcome is ambiguous after attempting status IDs [${statusIds.join(', ')}] for contact enrollments [${contactIds.join(', ')}]. Inspect the parked roster and runtime logs before retrying; the next workflow actions may already have fired.`,
    ),
    data,
  );
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function boundEditIdGen(locationId, workflowId, version, ops, occupiedIds) {
  const base = makeDeterministicIdGen(JSON.stringify(canonicalize({
    locationId, workflowId, version, ops,
  })));
  const occupied = new Set(occupiedIds);
  return () => {
    let id;
    do { id = base(); } while (occupied.has(id));
    occupied.add(id);
    return id;
  };
}

function fastForwardSelector(args = {}) {
  const provided = ['contactId', 'statusIds', 'all']
    .filter((key) => args[key] !== undefined);
  if (provided.length !== 1) return null;
  const contactId = typeof args.contactId === 'string' && args.contactId.trim().length > 0;
  const statusIds = Array.isArray(args.statusIds)
    && args.statusIds.length > 0
    && args.statusIds.every((id) => typeof id === 'string' && id.trim().length > 0);
  const all = args.all === true;
  if (Number(contactId) + Number(statusIds) + Number(all) !== 1) return null;
  if (contactId) return { contactId: args.contactId.trim() };
  if (statusIds) {
    return {
      statusIds: [...new Set(args.statusIds.map((id) => id.trim()))],
    };
  }
  return { all: true };
}

function dedupeParkedRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    if (seen.has(row?._id)) return false;
    seen.add(row?._id);
    return true;
  });
}

function malformedParkedEnvelope(rows) {
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return `row ${index} is not an object`;
    }
    if (typeof row._id !== 'string' || row._id.trim().length === 0) {
      return `row ${index} has no nonempty workflow-status _id`;
    }
  }
  return null;
}

function selectParkedRows(rows, selector) {
  const uniqueRows = dedupeParkedRows(rows);
  if (selector.contactId) return uniqueRows.filter((row) => row.contactId === selector.contactId);
  if (selector.statusIds) {
    const byStatusId = new Map(uniqueRows.map((row) => [row._id, row]));
    return selector.statusIds.map((id) => byStatusId.get(id)).filter(Boolean);
  }
  return uniqueRows;
}

function malformedSelectedParkedRows(rows) {
  for (const [index, row] of rows.entries()) {
    if (typeof row.contactId !== 'string' || row.contactId.trim().length === 0) {
      return `selected row ${index} has no nonempty contactId`;
    }
  }
  return null;
}

function fastForwardPreview(rows, selector, { locationId, workflowId, stepId }) {
  const sample = rows.slice(0, 10);
  const statusIds = rows.map((row) => row._id);
  const canonicalRows = rows
    .map((row) => ({ statusId: row._id, contactId: row.contactId ?? null }))
    .sort((left, right) => (
      String(left.statusId).localeCompare(String(right.statusId))
      || String(left.contactId).localeCompare(String(right.contactId))
    ));
  const previewToken = createHash('sha256')
    .update(JSON.stringify(canonicalize({
      locationId,
      workflowId,
      stepId,
      selector,
      rows: canonicalRows,
    })))
    .digest('hex');
  return {
    count: rows.length,
    statusIds,
    previewToken,
    samples: {
      statusIds: sample.map((row) => row._id),
      contactIds: sample.map((row) => row.contactId),
    },
  };
}

// The AI host, named once. `raw_request` inlined it; the per-contact Conversation AI tools
// need the same base, and two string literals of the same host is how one of them ends up
// pointed somewhere the `ai` rail refuses to attach its token-id to (AI_RAIL_HOST_INVALID).
const AI_BASE = 'https://services.leadconnectorhq.com';

// ---------------------------------------------------------------------------
// Per-contact Conversation AI bot config (`/conversations-ai/employeeConfigs`)
//
// Reverse-engineered live 2026-08-07; every field below was captured or written and read
// back (research/conversation-ai-per-contact-toggle.md). Two facts drive this whole block:
//
//   1. The GET AUTO-CREATES the config when none exists, so it doubles as the id-resolver
//      the PUT needs and works on a contact that has never been messaged. It is therefore
//      not a pure read, and both tools say so.
//   2. The PUT REPLACES the reactivation pair rather than merging it — sending
//      `{"status":"active"}` alone nulled a previously-set 99-hour value. So the write
//      always sends the whole intent, including explicit nulls for "no reactivation",
//      rather than omitting the pair and hoping the server keeps or clears it.
// ---------------------------------------------------------------------------
const CONTACT_AI_CONFIGS_PATH = '/conversations-ai/employeeConfigs';
const CONTACT_AI_STATUSES = ['active', 'inactive'];
const CONTACT_AI_TIME_UNITS = ['hour', 'day'];

const contactAiConfigQuery = ({ locationId, contactId, conversationId }) => {
  const query = new URLSearchParams({ locationId, contactId });
  // Verified optional: omitted entirely and passed empty both return the same config. An
  // empty string is therefore dropped rather than sent, so the two spellings cannot diverge.
  if (typeof conversationId === 'string' && conversationId.length > 0) {
    query.set('conversationId', conversationId);
  }
  return `${CONTACT_AI_CONFIGS_PATH}?${query.toString()}`;
};

// The fields worth reporting, lifted out of a response that also carries `messageCount`,
// `followupTask*` and `agentLogsSessionId` — all present in the capture but never written
// to, so none of them is characterised and none is promoted to the tool contract.
const summarizeContactAiConfig = (config) => ({
  configId: config?.id ?? null,
  status: config?.status ?? null,
  sleepingTill: config?.sleepingTill ?? null,
  reactivateAfterTimeValue: config?.reactivateAfterTimeValue ?? null,
  reactivateAfterTimeUnit: config?.reactivateAfterTimeUnit ?? null,
  assignedEmployeeId: config?.assignedEmployee?.id ?? null,
  updatedAt: config?.updatedAt ?? null,
});

// Compile the caller's intent into the exact `data` object the PUT will carry, or explain
// the rejection. Returns { data, expectSleeping } or { error }. `expectSleeping` is what
// makes the read-back an ASSERTION rather than a printout: a 200 tells you the server
// accepted the body, not that the bot is now asleep until a particular instant.
function compileContactAiIntent({ status, reactivateAfterTimeValue, reactivateAfterTimeUnit }) {
  if (!CONTACT_AI_STATUSES.includes(status)) {
    return { error: fail(CODES.VALIDATION_FAILED, 'status must be "active" or "inactive" (value withheld)',
      'Pass status:"inactive" to silence the bot for this contact, or status:"active" to switch it back on.') };
  }
  const unitGiven = reactivateAfterTimeUnit !== undefined && reactivateAfterTimeUnit !== null;
  const valueGiven = reactivateAfterTimeValue !== undefined && reactivateAfterTimeValue !== null;
  if (unitGiven && !CONTACT_AI_TIME_UNITS.includes(reactivateAfterTimeUnit)) {
    return { error: fail(CODES.VALIDATION_FAILED, 'reactivateAfterTimeUnit must be "hour" or "day" (value withheld)',
      'Both units are live-verified. Pass one of them, or omit the pair entirely for "off until switched back on".') };
  }
  if (unitGiven && !valueGiven) {
    return { error: fail(CODES.VALIDATION_FAILED, 'reactivateAfterTimeUnit was given without reactivateAfterTimeValue',
      'A unit has no meaning without a number. Pass both, or omit both for an indefinite switch-off.') };
  }
  if (valueGiven && status === 'active') {
    return { error: fail(CODES.VALIDATION_FAILED, 'a reactivation window was given alongside status:"active"',
      'The reactivation window only means anything while the bot is off, and its behaviour alongside '
      + '"active" was never captured. Pass status:"inactive" with the window, or status:"active" alone.') };
  }
  // The pair is sent as EXPLICIT nulls rather than omitted. Both spellings are live-verified
  // to mean "off indefinitely" (sleepingTill: null), and the explicit form puts the
  // replace-not-merge semantics on the wire where the returned request body shows it.
  if (!valueGiven) {
    return {
      data: { status, reactivateAfterTimeValue: null, reactivateAfterTimeUnit: null },
      expectSleeping: false,
    };
  }
  return {
    data: {
      status,
      reactivateAfterTimeValue,
      // 0 is accepted and read as "never" (live-verified as `0` + `hour`), so a bare 0 is
      // passed through with the unit it was captured with rather than rewritten to nulls.
      reactivateAfterTimeUnit: unitGiven ? reactivateAfterTimeUnit : 'hour',
    },
    expectSleeping: reactivateAfterTimeValue > 0,
  };
}

const HTTP_METHOD_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
function normalizeHttpMethod(method) {
  if (typeof method !== 'string') return null;
  const normalized = method.trim();
  return normalized && HTTP_METHOD_TOKEN.test(normalized) ? normalized.toUpperCase() : null;
}

// Run a handler body, mapping AuthError/engine throws onto the error contract.
export async function guard(fn, args, { credentialCode = CODES.VALIDATION_FAILED } = {}) {
  try {
    if (containsSecrets(args)) {
      return credentialFailure(credentialCode);
    }
    return await fn();
  }
  catch (e) {
    return fromThrown(e);
  }
}

const STUDIO_IDTOKENS = new Map();   // locationId -> { idToken, expiresAt }

// Wiring shared by the AI Studio read/resolve tools so each one does not repeat it. `gw` carries
// the Bearer (jwt) rail /vibe-ai lives on; `fb` carries the firebase rail for Firestore history
// reads; `history` mints/caches the Firestore idToken, runs one query, and retries ONCE on a
// rejected idToken (C2 — a 401/403 used to read as an empty collection).
const studioDeps = (args, deps) => {
  const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
  const api = new StudioApi({ gw, loc: args.locationId });
  const fb = deps.makeGw({ loc: args.locationId, state: deps.state, rail: 'firebase' });
  const history = (collection, projectId, orderBy, limit) => queryProjectHistory({
    gwJwt: gw, gwFirebase: fb, locationId: args.locationId, cache: STUDIO_IDTOKENS,
    collection, projectId, orderBy, limit,
  });
  return { gw, api, history };
};

// C3 — `alt_id` is NOT enforced on by-id reads (ai-studio.mjs header, rule 3): /projects/{id} and
// /files return the full record under another location's alt_id, and under none at all.
// `locationId` is allowlist-guarded by checkLocationBinding, but `projectId` is a free string, so
// a registration bound to location A could read (or, worse, WRITE — spend money on, publish,
// take down) location B's project just by naming its id. This is the ONE shared check every
// project-scoped AI Studio tool must run before touching the project — reusing get_studio_site's
// original wording so the error is identical everywhere it fires.
//
// This check FAILS CLOSED, BY DESIGN, on two independent axes — do not "simplify" it back to a
// truthiness test on `project?.alt_id`. Three bypasses were executed against the real handlers
// before this was fixed:
//   1. boundary GET returned 200 with a record carrying NO `alt_id` at all -> unpublish_studio_site executed.
//   2. boundary GET returned 500 with an unrecognised body ({error:'internal server error'}) -> publish_studio_site executed.
//   3. boundary GET returned 404 with a null body -> set_studio_secrets' PUT executed.
// Rule 3 in ai-studio.mjs's header names BOTH "under another location's alt_id" and "under none
// at all" as observed shapes — an absent/empty/non-string alt_id must refuse, never pass. And a
// boundary GET that did not itself succeed (non-ok status, a null/non-object body, or a thrown
// error) means the boundary was never actually verified — "the check failed" is not "the check
// passed"; if the record cannot be read, the account has not been checked.
const assertProjectLocation = async (api, projectId, locationId) => {
  let res;
  try {
    res = await api.getProject(projectId);
  } catch (e) {
    return { project: null, error: fail(CODES.VALIDATION_FAILED,
      `could not verify which sub-account owns project ${projectId}: the boundary check itself failed (${e?.message ?? e})`,
      'This is "could not verify", not "belongs to another sub-account" — the boundary GET threw '
      + 'rather than answering. Resolve the underlying error and retry; never treat a failed check as a pass.') };
  }
  const project = res?.json;
  if (!res?.ok || project === null || typeof project !== 'object') {
    return { project: null, error: fail(CODES.VALIDATION_FAILED,
      `could not verify which sub-account owns project ${projectId}: the boundary GET returned status ${res?.status}`,
      'This is "could not verify", not "belongs to another sub-account" — a non-ok status or an '
      + 'unreadable body means the boundary was never checked. Resolve the underlying error and retry.') };
  }
  if (!project.alt_id || typeof project.alt_id !== 'string' || project.alt_id !== locationId) {
    return { project: null, error: fail(CODES.VALIDATION_FAILED,
      `project ${projectId} belongs to a different sub-account (${project.alt_id ?? 'none recorded'})`,
      'alt_id is not enforced on by-id reads; verify it on the returned record.') };
  }
  return { project, error: null };
};

export const TOOLS = [
  {
    name: 'set_token_file',
    description: `Point the server at the capture file holding the GHL JWT (and optional token-id). Path only — never paste a token. Default: ${DEFAULT_TOKEN_FILE}`,
    inputSchema: schema({ path: z.string().describe('Absolute path to the capture file — a PATH, never a token') }),
    capabilities: [],
    handler: async (args, deps) => guard(async () => {
      const path = args?.path;
      const state = deps?.state ?? {};
      if (typeof path !== 'string' || path.length === 0) {
        return fail(CODES.TOKEN_MISSING, 'set_token_file requires a "path" string',
          `Pass the capture file's path (default ${DEFAULT_TOKEN_FILE}).`);
      }
      // Validate by actually reading before committing it to state, so a bad path
      // fails loudly here rather than at the first tool call. readCredentials throws
      // AuthError, which guard maps to a top-level failure (not ok:true).
      readCredentials({ tokenFile: path });
      state.tokenFile = path;
      // An explicit path is the operator taking control back — there is nothing left for the
      // stale-env-var guard to protect against once they have named the file themselves, so
      // clear it here rather than leaving every later call (including this tool's own
      // authStatus below) refuse against an env var the operator just worked around.
      state.legacyTokenFileEnv = false;
      return ok(authStatus(state));
    }, args, { credentialCode: CODES.TOKEN_MISSING }),
  },
  {
    name: 'auth_status',
    description: 'Report credential state: JWT presence/expiry (claims only, never the token), token-id availability, and the engine build this server was made from.',
    inputSchema: schema({}),
    capabilities: [],
    handler: async (args, deps) => guard(async () => ok(authStatus(deps?.state ?? {})), args),
  },
  {
    name: 'create_convai_agent',
    description: `${describe('create_convai_agent', 'Create Conversation AI agent — proof: live-roundtrip (2026-07-11); risk: write')}. Confirmation-gated: preview compiles a no-write plan.`,
    inputSchema: schema({ locationId: z.string(), spec: z.object({}).passthrough(), confirm: z.boolean().default(false) }),
    capabilities: [
      { method: 'POST', path: '/ai-employees/employees' },
      { method: 'POST', path: '/ai-employees/actions' },
      { method: 'GET', path: '/ai-employees/employees/{agentId}' },
    ],
    handler: async (args, deps) => guard(async () => {
      const plan = compileAiAgentPlan('convai', args);
      const preview = aiPlanPreview(plan);
      if (args.confirm !== true) return withFailureData(fail(
        CODES.CONFIRM_REQUIRED,
        'Conversation AI agent preview is ready; no gateway call or write was made.',
        'Review data.preview, then repeat the same locationId and spec with confirm:true to create.',
      ), { preview });
      const report = await executeAgentPlan({ plan, gw: deps.makeGw({ loc: args.locationId, rail: 'ai', state: deps.state }) });
      const data = { preview, created: { agentId: report.agentId, actionIds: report.actionIds }, followUps: report.followUps, actions: report.actions, verification: report.verification };
      return report.ok ? ok(data) : withFailureData(fail(report.code, 'Conversation AI creation did not complete and verify.',
        'Inspect data.created and data.verification before retrying; remove any unintended canary agent manually.'), data);
    }, args),
  },
  {
    // F5-04. A partial PUT to this endpoint RESETS omitted agent-level booleans — measured live
    // 2026-08-28, after a capture-derived "it merges" claim had stood for months (that capture's
    // at-risk fields were already false, so a reset was invisible in it). The UI never sends a
    // partial; it PUTs the whole record. This tool does the same, and then proves it: the keys
    // the update did NOT set are diffed before/after, and any movement fails the call.
    name: 'update_convai_agent',
    description: describe('update_convai_agent',
      'Update a Conversation AI agent by READ-MERGE-WRITE — proof: engine; risk: write. GETs the current '
      + 'record, overlays your spec, applies the builder\'s own bot-type cleanup, PUTs the WHOLE record, '
      + 're-reads, and diffs every field the update did not set. A partial PUT resets omitted agent-level '
      + 'booleans (cancelEnabled/rescheduleEnabled measured live), so a partial is never sent. Any '
      + 'collateral change fails with AGENT_COLLATERAL_CHANGED. Previews by default; confirm:true writes.'),
    inputSchema: schema({
      locationId: z.string(),
      agentId: z.string(),
      spec: z.object({}).passthrough(),
      confirm: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'GET', path: '/ai-employees/employees/{agentId}' },
      { method: 'PUT', path: '/ai-employees/employees/{agentId}' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, rail: 'ai', state: deps.state });
      const path = `/ai-employees/employees/${args.agentId}`;
      const current = await gw.call('GET', path);
      if (!current?.ok) return fromHttp(current?.status ?? 502, current?.json);
      const record = current.json?.employee ?? current.json;
      if (!record || typeof record !== 'object') {
        return fail(CODES.ENGINE_ABORT, 'the agent GET returned no record to merge onto.',
          'Confirm the agentId with get_ai_configuration_bundle; nothing was written.');
      }
      let plan;
      try {
        plan = compileConvaiUpdateFromRecord(record, args.spec, { agentId: args.agentId, locationId: args.locationId });
      } catch (error) {
        return fail(CODES.ENGINE_ABORT, `update rejected (${error.code ?? 'ENGINE_ABORT'}): ${error.message}`,
          'The spec was rejected before any request was sent — nothing was written.');
      }
      const changingKeys = Object.keys(plan.body).filter((k) => !plan.collateralKeys.includes(k));
      const preview = { body: plan.body, changingKeys, collateralKeys: plan.collateralKeys };
      if (args.confirm !== true) {
        return withFailureData(fail(CODES.CONFIRM_REQUIRED,
          'Agent update preview is ready; no write was made.',
          'Review data.preview.changingKeys and data.preview.collateralKeys, then repeat with confirm:true.'), { preview });
      }
      // WRITE-ONLY keys are excluded from the read-back comparison: `actions` is sent as null the
      // way the UI sends it, and the record always reads back the real list — holding it to the
      // null reported a mismatch on every successful update (live-proven 2026-09-07).
      const writeOnly = new Set(plan.writeOnlyKeys ?? []);
      const expected = {};
      for (const k of changingKeys) if (!writeOnly.has(k)) expected[k] = plan.body[k];
      const report = await executeAgentUpdate({
        plan: { update: { method: 'PUT', path, body: plan.body }, collateralKeys: plan.collateralKeys, before: record, expected },
        gw,
      });
      const data = { preview, verification: report.verification, collateral: report.collateral };
      return report.ok
        ? ok(data)
        : withFailureData(fail(report.code ?? CODES.ENGINE_ABORT,
          report.detail ?? 'The agent update did not verify.',
          'Inspect data.collateral and data.verification; the record is live, so re-read before retrying.'), data);
    }, args),
  },
  {
    name: 'create_voiceai_agent',
    description: `${describe('create_voiceai_agent', 'Create Voice AI agent — proof: documented; risk: write')}. Live-proven end-to-end on GROM AU 2026-07-21 (create → full-replace update → verified). Confirmation-gated: preview compiles a no-write plan.`,
    inputSchema: schema({ locationId: z.string(), spec: z.object({}).passthrough(), confirm: z.boolean().default(false) }),
    capabilities: [
      { method: 'POST', path: '/voice-ai/agents' },
      { method: 'PUT', path: '/voice-ai/agents/{agentId}?publishAgent=true&mode=update' },
      { method: 'POST', path: '/voice-ai/actions' },
      { method: 'GET', path: '/voice-ai/agents/{agentId}' },
    ],
    handler: async (args, deps) => guard(async () => {
      const plan = compileAiAgentPlan('voiceai', args);
      const preview = aiPlanPreview(plan);
      if (args.confirm !== true) return withFailureData(fail(
        CODES.CONFIRM_REQUIRED,
        'Voice AI agent preview is ready; no gateway call or write was made.',
        'Review data.preview, then repeat the same locationId and spec with confirm:true for a throwaway validation run.',
      ), { preview });
      const report = await executeAgentPlan({ plan, gw: deps.makeGw({ loc: args.locationId, rail: 'ai', state: deps.state }) });
      const data = { preview, created: { agentId: report.agentId, actionIds: report.actionIds }, followUps: report.followUps, actions: report.actions, verification: report.verification };
      return report.ok ? ok(data) : withFailureData(fail(report.code, 'Voice AI creation did not complete and verify.',
        'This unproven path may have partially created a canary. Inspect data.created and clean it up before retrying.'), data);
    }, args),
  },
  {
    name: 'create_studio_agent',
    description: `${describe('create_studio_agent', 'Create Agent Studio agent — proof: documented; risk: write')}. Live-proven end-to-end on GROM AU 2026-07-21 (SSE build → follow-up PUT → verified). Provide buildPrompt (the AI build instruction) and/or systemPrompt (the exact runtime prompt) — either alone works; both keeps their distinct roles. Confirmation-gated: preview compiles a no-write plan.`,
    inputSchema: schema({ locationId: z.string(), companyId: z.string().optional(), spec: z.object({}).passthrough(), confirm: z.boolean().default(false) }),
    capabilities: [
      { method: 'SSE', path: '/agent-studio/super-agents/build' },
      { method: 'PUT', path: '/agent-studio/super-agent/agents/{agentId}' },
      { method: 'GET', path: '/agent-studio/super-agent/agents/{agentId}' },
    ],
    handler: async (args, deps) => guard(async () => {
      const plan = compileAiAgentPlan('studio', args);
      const preview = aiPlanPreview(plan);
      if (args.confirm !== true) return withFailureData(fail(
        CODES.CONFIRM_REQUIRED,
        'Agent Studio preview is ready; no gateway call or write was made.',
        'Review data.preview, then repeat the same locationId, companyId, and spec with confirm:true for a throwaway validation run.',
      ), { preview });
      const report = await executeAgentPlan({ plan, gw: deps.makeGw({ loc: args.locationId, rail: 'ai', state: deps.state }) });
      const data = { preview, created: { agentId: report.agentId, actionIds: report.actionIds }, followUps: report.followUps, actions: report.actions, verification: report.verification };
      return report.ok ? ok(data) : withFailureData(fail(report.code, 'Agent Studio creation did not complete and verify.',
        'This unproven SSE path may have partially created a canary. Inspect data.created and clean it up before retrying.'), data);
    }, args),
  },
  {
    name: 'get_contact_ai_status',
    description: describe(
      'get_contact_ai_status',
      'Read per-contact Conversation AI status — proof: live-runtime (2026-08-08); risk: read',
    )
      + '. This is the sparkles toggle in the conversation composer (Conversation AI Bot → Active/Inactive → '
      + 'Reactivate after N). Returns configId, status, sleepingTill, the reactivation pair and the assigned '
      + 'employee id. NOT purely read-only: the GET AUTO-CREATES the config when the contact has none, which is '
      + 'exactly why it works on a contact that has never been messaged and why it is the way to obtain the '
      + 'configId that set_contact_ai_status writes to. conversationId is optional — omitted and empty both '
      + 'return the same config.',
    inputSchema: schema({
      locationId: z.string(),
      contactId: z.string(),
      conversationId: z.string().optional().describe('Optional — the config is per-contact, not per-conversation'),
    }),
    capabilities: [{ method: 'GET', path: '/conversations-ai/employeeConfigs' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, rail: 'ai', state: deps.state });
      const response = await gw.call('GET', contactAiConfigQuery(args), undefined, { base: AI_BASE });
      if (!response.ok) return fromHttp(response.status, response.json);
      return ok({ ...summarizeContactAiConfig(response.json), config: response.json });
    }, args),
  },
  {
    name: 'set_contact_ai_status',
    description: describe(
      'set_contact_ai_status',
      'Set per-contact Conversation AI status — proof: live-runtime (2026-08-08); risk: write',
    )
      + '. This is how you silence one agent for one contact while testing a live account, without touching the '
      + 'agent, the workflows, or DND. DND is the method this replaces and it is worse on every count: it blocks '
      + 'the whole channel including your own real outbound, and set within a second of a send it makes the send '
      + 'itself fail. This touches only the bot, for only this contact. Resolves the configId itself via the '
      + 'read (which creates the config if the contact has none), then reads the state back after the write and '
      + 'reports it — a clean 200 is not proof. Omitting the reactivation pair means OFF INDEFINITELY, which the '
      + 'API allows and the UI forbids (the UI forces a reactivation of at least 1). The PUT REPLACES that pair '
      + 'rather than merging it, so this tool always sends the whole intent. Confirmation-gated: without '
      + 'confirm:true it previews the exact body and makes no call at all.',
    inputSchema: schema({
      locationId: z.string(),
      contactId: z.string(),
      // Modeled as a free string, not z.enum, for the same reason as list_workflows#status:
      // the SDK's invalid_enum_value error echoes the received value BEFORE our scrubber
      // runs. The allowed set is enforced in compileContactAiIntent, downstream of the scrub.
      status: z.string().describe('"active" or "inactive"'),
      conversationId: z.string().optional(),
      reactivateAfterTimeValue: z.number().int().nonnegative().nullable().optional()
        .describe('Omit (or null, or 0) for off indefinitely — the API allows what the UI forbids'),
      reactivateAfterTimeUnit: z.string().optional().describe('"hour" or "day" — both live-verified'),
      confirm: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'GET', path: '/conversations-ai/employeeConfigs' },
      { method: 'PUT', path: '/conversations-ai/employeeConfigs/{configId}' },
    ],
    handler: async (args, deps) => guard(async () => {
      const intent = compileContactAiIntent(args);
      if (intent.error) return intent.error;
      // The preview deliberately makes NO call — not even the read. That read auto-creates
      // the config, so a preview that resolved the id would leave a config behind on a
      // contact the caller only asked to see a plan for.
      const preview = {
        method: 'PUT',
        path: `${CONTACT_AI_CONFIGS_PATH}/{configId}`,
        configIdResolvedBy: `GET ${contactAiConfigQuery(args)}`,
        body: { locationId: args.locationId, data: intent.data },
        note: intent.expectSleeping
          ? 'The bot goes off and reactivates itself after the given window.'
          : 'The bot goes off indefinitely — no reactivation is scheduled (sleepingTill: null).',
      };
      if (args.confirm !== true) {
        return withFailureData(fail(
          CODES.CONFIRM_REQUIRED,
          'Per-contact Conversation AI toggle preview is ready; no gateway call and no write were made.',
          'Review data.preview, then repeat the same arguments with confirm:true to apply it.',
        ), { preview });
      }

      const gw = deps.makeGw({ loc: args.locationId, rail: 'ai', state: deps.state });
      const configQuery = contactAiConfigQuery(args);
      const partialProgress = { write: { phase: 'employeeConfig_put', attempted: false, acknowledged: false, ambiguous: false } };

      // 1. Resolve the config id (and capture the before-state) — this GET creates the
      //    config if the contact has none.
      const readBefore = await gw.call('GET', configQuery, undefined, { base: AI_BASE });
      if (!readBefore.ok) return fromHttp(readBefore.status, readBefore.json);
      const before = summarizeContactAiConfig(readBefore.json);
      if (typeof before.configId !== 'string' || before.configId.length === 0) {
        return withFailureData(fail(CODES.ENGINE_ABORT,
          'the employeeConfigs read returned no config id, so there is no write route to take',
          'There is exactly one write route and it needs the id. Inspect data.before; nothing was written.'),
        { preview, before });
      }

      // 2. Write. Both halves of the body are load-bearing: no `data` wrapper is a 422, and
      //    a `data` wrapper without a top-level `locationId` is a 400.
      partialProgress.write.attempted = true;
      const write = await safeGatewayCall(() => gw.call(
        'PUT',
        `${CONTACT_AI_CONFIGS_PATH}/${encodeURIComponent(before.configId)}`,
        { locationId: args.locationId, data: intent.data },
        { base: AI_BASE },
      ));
      if (write.threw) {
        partialProgress.write.ambiguous = true;
        return withFailureData({
          ...write.failure,
          remediation: 'URGENT: the toggle was attempted but not acknowledged, so this contact\'s bot may be in '
            + 'either state. Re-read with get_contact_ai_status before retrying.',
        }, { preview, before, partialProgress });
      }
      if (!write.value.ok) {
        return withFailureData(fromHttp(write.value.status, write.value.json), { preview, before, partialProgress });
      }
      partialProgress.write.acknowledged = true;

      // 3. Read back and ASSERT. The observed state is the answer this tool returns; the
      //    200 above only says the body was accepted.
      const readAfter = await gw.call('GET', configQuery, undefined, { base: AI_BASE });
      if (!readAfter.ok) {
        return withFailureData(fromHttp(readAfter.status, readAfter.json), {
          preview,
          before,
          partialProgress,
          note: 'The write was acknowledged but could not be verified — the observed state is unknown.',
        });
      }
      const after = summarizeContactAiConfig(readAfter.json);
      const sleeping = typeof after.sleepingTill === 'string' && after.sleepingTill.length > 0;
      const mismatches = [];
      if (after.status !== intent.data.status) {
        mismatches.push(`status is "${after.status}", not the requested "${intent.data.status}"`);
      }
      if (intent.expectSleeping && !sleeping) {
        mismatches.push('a reactivation window was requested but sleepingTill came back empty');
      }
      if (!intent.expectSleeping && sleeping) {
        mismatches.push(`no reactivation was requested but sleepingTill came back as ${after.sleepingTill}`);
      }
      const data = { preview, before, after, partialProgress, applied: mismatches.length === 0, mismatches };
      return data.applied ? ok(data) : withFailureData(fail(CODES.ENGINE_ABORT,
        `the write was accepted but the read-back disagrees with the intent: ${mismatches.join('; ')}`,
        'URGENT: this contact\'s bot is in a state you did not ask for. Inspect data.after and re-issue the '
        + 'full intent — the reactivation pair is replaced, not merged, so a partial retry will not repair it.'),
      data);
    }, args),
  },
  {
    name: 'list_workflows',
    description: describe('list_workflows', 'List workflows in a location.'),
    inputSchema: schema({
      locationId: z.string(),
      // Modeled as a free string, not z.enum: the SDK's invalid_enum_value error echoes the
      // received value BEFORE our scrubber runs, so a credential passed here would leak. We
      // validate the allowed set inside the handler, downstream of the secret scrub (SC2).
      status: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().default(100),
      offset: z.number().default(0),
    }),
    capabilities: [{ method: 'GET', path: '/workflow/{loc}/list' }],
    handler: async (args, deps) => guard(async () => {
      if (args.status !== undefined && !['published', 'draft'].includes(args.status)) {
        return fail(CODES.VALIDATION_FAILED, 'status must be "published" or "draft" (value withheld)',
          'Pass status:"published" or status:"draft", or omit it.');
      }
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const q = new URLSearchParams({
        type: 'workflow', limit: String(args.limit ?? 100), offset: String(args.offset ?? 0),
        sortBy: 'name', sortOrder: 'asc', includeCustomObjects: 'true', includeObjectiveBuilder: 'true',
      });
      if (args.status) q.set('status', args.status);
      if (args.search) q.set('search', args.search);
      const r = await gw.call('GET', `/workflow/${encodeURIComponent(args.locationId)}/list?${q}`);
      if (!r.ok) return fromHttp(r.status, r.json);
      const rows = (r.json.rows ?? []).map((w) => ({ id: w._id ?? w.id, name: w.name, status: w.status, version: w.version, updatedAt: w.updatedAt }));
      return ok({ count: r.json.count ?? rows.length, workflows: rows });
    }, args),
  },
  {
    name: 'get_workflow',
    description: describe('get_workflow', 'Get one workflow summary.'),
    inputSchema: schema({
      locationId: z.string(),
      workflowId: z.string(),
    }),
    capabilities: [{ method: 'GET', path: '/workflow/{loc}/{wid}' }],
    handler: async (args, deps) => guard(async () => {
      const locationId = encodeURIComponent(args.locationId);
      const workflowId = encodeURIComponent(args.workflowId);
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const response = await gw.call(
        'GET',
        `/workflow/${locationId}/${workflowId}?includeScheduledPauseInfo=true`,
      );
      if (!response.ok) return fromHttp(response.status, response.json);
      const workflow = response.json;
      return ok({
        id: workflow._id ?? workflow.id,
        name: workflow.name,
        status: workflow.status,
        version: workflow.version,
        stepCount: (workflow.workflowData?.templates ?? []).length,
        updatedAt: workflow.updatedAt,
        note: 'Summary only — use export_workflow for the full graph.',
      });
    }, args),
  },
  {
    // export_workflow returns the raw wire document. For a real workflow that is tens of kilobytes
    // of __customInputFields__ rows and frozen UI-hint arrays, so an agent either burns its context
    // reading it or skips the read — and skipping the read is how an edit gets authored against a
    // graph nobody actually looked at.
    name: 'get_workflow_digest',
    description: describe('get_workflow_digest',
      'A COMPACT read of one workflow — proof: engine; risk: read-only. Identity, version and a '
      + 'structural fingerprint, the trigger set with its conditions, ONE line per step (wiring, '
      + 'outgoing references, merge tags, a text preview, flags, and which branch it sits on), and '
      + 'the linear chains. Roughly a tenth the size of export_workflow. Use it as the READ half of '
      + 'an edit: pass the version back as expectedVersion so a concurrent change is refused rather '
      + 'than overwritten.'),
    inputSchema: schema({
      locationId: z.string(),
      workflowId: z.string(),
      include: z.array(z.string()).optional(),
    }),
    capabilities: [
      { method: 'GET', path: '/workflow/{loc}/{wid}' },
      { method: 'GET', path: '/workflow/{loc}/trigger' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const doc = await getWorkflow(gw, args.locationId, args.workflowId);
      if (!doc.ok) return fromHttp(doc.status, doc.json);
      const listed = await listWorkflowTriggers(gw, args.locationId, args.workflowId);
      const triggers = listed?.response?.ok ? (listed.triggers ?? []) : [];
      const digest = digestWorkflow({ doc: doc.json, triggers, include: args.include ?? [] });
      // Record what this agent actually saw, so a later write can tell whether the graph moved.
      readCache(deps.state).write(args.locationId, args.workflowId, {
        readAt: new Date().toISOString(),
        version: doc.json?.version ?? null,
        updatedAt: doc.json?.dateUpdated ?? null,
        fingerprint: digest.fingerprint,
        templates: doc.json?.workflowData?.templates ?? [],
        triggers,
      });
      return ok({
        ...digest,
        triggersRead: listed?.response?.ok === true,
        note: listed?.response?.ok
          ? 'Pass `version` back as edit_workflow/repair_workflow expectedVersion to make the write concurrency-safe.'
          : 'The trigger list could not be read, so `triggers` is EMPTY rather than known-empty.',
      });
    }, args),
  },
  {
    // The vocabulary is 442 static tags across 27 namespaces plus this location's own fields, and
    // the only way to find one was to already know its name. That is how {{appointment.date}} came
    // to be invented and shipped to real customers for three weeks.
    name: 'search_merge_tags',
    description: describe('search_merge_tags',
      'Search the merge-tag inventory by INTENT — proof: engine; risk: read-only. Returns the '
      + 'builder picker\'s static tags ranked against your phrase, and, given a locationId, this '
      + 'account\'s own custom FIELDS and custom VALUES joined in. A tag GHL cannot resolve renders '
      + 'as literal braces to the customer and nothing in GHL catches it, so author from this list '
      + 'rather than from memory.'),
    inputSchema: schema({
      intent: z.string(),
      namespace: z.string().optional(),
      locationId: z.string().optional(),
      limit: z.number().optional(),
    }),
    capabilities: [
      // Both OPTIONAL: without a locationId the handler makes no gateway call at all.
      { method: 'GET', path: '/locations/{loc}/customFields/search' },
      { method: 'GET', path: '/locations/{loc}/customValues' },
    ],
    handler: async (args, deps) => guard(async () => {
      const catalog = loadCatalog();
      const extra = [];
      let perLocation = false;
      if (args.locationId) {
        const loc = encodeURIComponent(args.locationId);
        const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
        try {
          const cf = await gw.call('GET', `/locations/${loc}/customFields/search?${new URLSearchParams({
            parentId: '', skip: '0', limit: '10000', documentType: 'field', model: 'all', query: '', includeStandards: 'false',
          })}`);
          const rows = Array.isArray(cf?.json) ? cf.json : cf?.json?.customFields;
          if (cf?.ok && Array.isArray(rows)) {
            perLocation = true;
            for (const f of rows) {
              if (!f?.fieldKey) continue;
              extra.push({ tag: `{{${String(f.fieldKey).replace(/\s+/g, '')}}}`, label: f.name ?? null,
                group: f.model === 'opportunity' ? 'opportunity custom fields' : 'contact custom fields',
                source: 'custom-field' });
            }
          }
          const cv = await gw.call('GET', `/locations/${loc}/customValues`);
          const vals = Array.isArray(cv?.json) ? cv.json : cv?.json?.customValues;
          if (cv?.ok && Array.isArray(vals)) {
            perLocation = true;
            for (const v of vals) {
              if (!v?.fieldKey) continue;
              const k = String(v.fieldKey).replace(/\s+/g, '');
              extra.push({ tag: k.startsWith('{{') ? k : `{{custom_values.${k.replace(/^custom_values\./, '')}}}`,
                label: v.name ?? null, group: 'custom values', source: 'custom-value' });
            }
          }
        } catch { /* best effort — the static inventory still answers */ }
      }
      const tags = searchMergeTags(catalog.mergeTags?.tags ?? [], args.intent, {
        namespace: args.namespace, extra, limit: args.limit ?? 10,
      });
      return ok({
        tags,
        searched: { staticTags: catalog.mergeTags?.tags?.length ?? 0, perLocation: extra.length },
        note: perLocation
          ? 'Static picker tags plus this location\'s custom fields and values.'
          : 'Static picker tags only — pass a locationId to include this account\'s custom fields and values.',
      });
    }, args),
  },
  {
    name: 'check_workflow',
    description: describe('check_workflow',
      "Read-only pre-flight: reproduce the workflow builder's \"Resolve N Errors\" list for an existing "
      + 'workflow, without opening the UI (proof: live-reproduction 2026-07-27 — matched the builder exactly '
      + 'on a known-broken workflow: same count, same step, same stepId, same message; risk: read-only). Applies GHL\'s OWN action schema (the marketplace assets '
      + 'catalog the builder itself validates against). NOTE: that catalog omits core native actions '
      + '(add_contact_tag, send_email, sms, if_else, wait, custom_webhook, ...), so a clean result means '
      + '"nothing found in the ~300 marketplace types it describes" (the live count is in coverage.schemaTypes), not "provably publishable". Also reports '
      + '`marketplaceDrift`: whether a stored marketplace TRIGGER\'s version/templateId matches what is '
      + 'installed now — TRIGGERS ONLY, because a stored marketplace ACTION step records no version at all '
      + '(live-captured 2026-08-16: its full key set is id, stepIndex, order, attributes, name, type, '
      + 'isMarketplaceAction — nothing to compare an action against). Always a separate key, never folded '
      + 'into `errorCount`. It also returns `lints`: the engine\'s OWN layers run over the live '
      + 'document (platform), generic authoring hygiene, and this project\'s doctrine pack from '
      + '.ghl/<locationId>/lint-pack.json or an inline lintPack — advisory, never part of '
      + 'errorCount. When the marketplace assets fetch fails the schema layer is skipped and '
      + 'errorCount is null (unknown, not zero) while every other layer still reports.'),
    inputSchema: schema({
      locationId: z.string(),
      workflowId: z.string(),
          // Client policy, inline. Without it the handler looks for .ghl/<locationId>/lint-pack.json.
      lintPack: z.object({}).passthrough().optional(),
    }),
    capabilities: [
      { method: 'GET', path: '/workflow/{loc}/{wid}' },
      { method: 'GET', path: '/workflow/{loc}/trigger' },
      { method: 'GET', path: '/workflows-marketplace/location/{loc}/assets' },
      // Best-effort, for the merge-tag lint's per-location vocabulary. Their absence only
      // demotes that one check to "unverifiable"; it never blocks the read.
      { method: 'GET', path: '/locations/{loc}/customFields/search' },
      { method: 'GET', path: '/locations/{loc}/customValues' },
    ],
    handler: async (args, deps) => guard(async () => {
      const loc = encodeURIComponent(args.locationId);
      const wid = encodeURIComponent(args.workflowId);
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });

      const body = await gw.call('GET', `/workflow/${loc}/${wid}?includeScheduledPauseInfo=true`);
      if (!body.ok) return fromHttp(body.status, body.json);
      const templates = body.json?.workflowData?.templates ?? [];

      const trg = await gw.call('GET', `/workflow/${loc}/trigger?${new URLSearchParams({ workflowId: args.workflowId })}`);
      const triggerList = Array.isArray(trg?.json) ? trg.json : (trg?.json?.triggers ?? trg?.json?.data ?? []);
      const triggerTypes = triggerList.map((t) => t?.type).filter(Boolean);

      // One fetch, two SEPARATE maps — parseActionSchema and parseTriggerSchema never
      // share a namespace (a real observed collision, `contact_engagement_score`, exists
      // as both an action and a trigger in the live catalog; see parseActionSchema's
      // docstring). Same request the tool always made — zero new network calls.
      let actionSchema = null;
      let triggerSchema = null;
      try {
        const assetsResp = await gw.call('GET',
          `/workflows-marketplace/location/${loc}/assets?workflowTypes=default,contacts`);
        if (assetsResp?.ok && assetsResp.json) {
          actionSchema = parseActionSchema(assetsResp.json);
          triggerSchema = parseTriggerSchema(assetsResp.json);
        }
      } catch {
        actionSchema = null;
      }
      // Per-location merge-tag vocabulary, best-effort — an unavailable list only demotes the
      // merge-tag lint to "unverifiable".
      let customFields;
      let customValues;
      try {
        const cf = await gw.call('GET', `/locations/${loc}/customFields/search?${new URLSearchParams({
          parentId: '', skip: '0', limit: '10000', documentType: 'field', model: 'all', query: '', includeStandards: 'false',
        })}`);
        const rows = Array.isArray(cf?.json) ? cf.json : cf?.json?.customFields;
        if (cf?.ok && Array.isArray(rows)) {
          customFields = rows.filter((f) => f && typeof f === 'object')
            .map((f) => ({ id: f.id ?? f._id, name: f.name, fieldKey: f.fieldKey, dataType: f.dataType, model: f.model }));
        }
        const cv = await gw.call('GET', `/locations/${loc}/customValues`);
        const vals = Array.isArray(cv?.json) ? cv.json : cv?.json?.customValues;
        if (cv?.ok && Array.isArray(vals)) {
          customValues = vals.filter((v) => v && typeof v === 'object')
            .map((v) => ({ id: v.id ?? v._id, name: v.name, fieldKey: v.fieldKey }));
        }
      } catch { /* best effort */ }

      // THE LINT PACKS. These are the engine's own layers, run over a LIVE document — the whole
      // point of RC-F. They are advisory findings under their own key and NEVER counted into
      // errorCount, the same contract marketplaceDrift already has.
      const doctrineInput = args.lintPack ?? readProjectLintPack(deps.state, args.locationId);
      const doctrine = doctrineInput ? loadDoctrinePack(doctrineInput) : { rules: null, errors: [] };
      const lints = runLints(
        { templates, triggers: triggerList, settings: { window: body.json?.window }, status: body.json?.status },
        { catalog: loadCatalog(), customFields, customValues,
          doctrinePack: doctrine.rules,
          packs: doctrine.rules ? ['platform', 'hygiene', 'doctrine'] : ['platform', 'hygiene'] },
      );
      for (const e of doctrine.errors) lints.notEvaluable.push(`doctrine pack: ${e}`);

      const lintKeys = {
        lints,
        lintNote: 'lints are ADVISORY findings from the engine\'s own layers (platform), generic '
          + 'authoring hygiene, and this project\'s lint pack — a separate key, never part of '
          + 'errorCount. notEvaluable names what could NOT be checked, which is not the same as clean.',
      };

      // The marketplace schema layer is ONE of ten. When its fetch fails the other nine still have
      // something to say, and returning VALIDATION_FAILED threw all of it away — which is how a
      // recon pass on a live account reported nothing at all.
      if (!actionSchema || !actionSchema.size) {
        return ok({
          workflowId: args.workflowId,
          name: body.json?.name,
          status: body.json?.status,
          steps: templates.length,
          errorCount: null,
          errors: [],
          headline: 'Resolve ? Errors (schema unavailable)',
          schemaChecked: false,
          note: 'The marketplace action schema could not be fetched, so the SCHEMA layer did not run. '
            + 'errorCount is null — unknown, not zero. Every other lint layer below did run.',
          ...lintKeys,
        });
      }

      const errors = checkWorkflow(templates, actionSchema, triggerTypes.length ? { triggerTypes } : {});
      const bv = (() => {
          // GHL's OWN validators, replayed. This is the closest thing to the builder's error
          // panel that exists off the screen — and its `unchecked` list is the honest half,
          // because GHL ships no validator for the types authors use most.
          const bag = builderValidatorBag();
          if (!bag) return { ran: false, why: 'the recovered validator bodies are missing from this build or failed their shape check' };
          const vname = validatorNamesFor(typeCards(), bag);
          const r = runBuilderValidators(templates, bag, vname);
          return {
            ran: true,
            validated: r.validated,
            // Findings carry a `message` and are what the builder's panel would show.
            findings: r.findings,
            // Entries with `resource` and `value` and NO message are deferred existence lookups
            // the builder posts to the server — "does this pipeline still exist?". They are
            // normal, they are numerous, and counting them as problems is the first mistake.
            resourceLookups: r.lookups.length,
            resourceLookupKinds: [...new Set(r.lookups.map((l) => l.resource))],
            uncheckedByType: Object.fromEntries(Object.entries(r.unchecked).map(([t, xs]) => [t, xs.length])),
            uncheckedSteps: Object.values(r.unchecked).reduce((n, xs) => n + xs.length, 0),
            crashed: r.crashed,
            mappedTypes: Object.keys(vname).length,
            helperFidelity: HELPER_FIDELITY,
            note: 'A validator body exists for 61 step types. 57 more name one in the catalogue whose body was '
              + 'never captured — mostly TRIGGER validators, which this capture does not cover — and the rest have '
              + 'none at all. Read uncheckedByType before reading findings: zero findings over few validated steps '
              + 'is not a clean workflow.',
          };
      })();

      return ok({
        schemaChecked: true,
        ...lintKeys,
        workflowId: args.workflowId,
        name: body.json?.name,
        status: body.json?.status,
        steps: templates.length,
        errorCount: errors.length,
        errors,
        // The scope is IN the headline on purpose. It used to read exactly "Resolve N Errors",
        // reproducing the builder's own banner word for word — and on 2026-09-07 it said
        // "Resolve 0 Errors" about a workflow whose builder banner said "Resolve 1 Errors" at
        // that same moment. The coverage note below was honest and was read past, because the
        // headline looked like the builder's verdict. It now states what it actually measured.
        headline: bv.ran
          ? `Resolve ${errors.length} Errors (marketplace schema: ${templates.filter((t) => actionSchema.has(t.type)).length} of ${templates.length} steps) · GHL validators: ${bv.findings.length} finding(s) over ${bv.validated} of ${templates.length}`
          : `Resolve ${errors.length} Errors (${templates.filter((t) => actionSchema.has(t.type)).length} of ${templates.length} steps checked)`,
        // Native steps the marketplace catalog does not describe, checked against the ONE thing
        // the type cards state exactly: their inner attributes.type. This is what a card-driven
        // pass over native steps catches, and it is the class the headline missed.
        nativeShapeIssues: templates.flatMap((t) => {
          const want = INNER_ATTRIBUTE_TYPE[t.type];
          if (!want) return [];
          const got = t.attributes?.type;
          if (got === want) return [];
          return [{
            stepId: t.id ?? null,
            name: t.name ?? null,
            type: t.type,
            field: 'attributes.type',
            expected: want,
            found: got ?? null,
            why: 'The step saves, publishes and round-trips clean with the wrong token — GHL\'s publish '
              + 'validator does not inspect native step attribute shapes. The builder\'s drawer then '
              + 'cannot bind its model and reports its FIRST required field as missing, so the operator '
              + 'sees a complaint about a field that is present.',
          }];
        }),
        // Marketplace TRIGGER-only version/templateId drift (see the tool description for
        // why actions are out of scope). A separate key, deliberately never folded into
        // errorCount above. Consumes triggerSchema, never actionSchema.
        marketplaceDrift: marketplaceDrift(triggerList, triggerSchema),
        builderValidators: bv,
        coverage: {
          schemaTypes: actionSchema.size,
          stepsDescribed: templates.filter((t) => actionSchema.has(t.type)).length,
          stepsNotDescribed: templates.filter((t) => !actionSchema.has(t.type)).length,
          note: 'Steps not described by the marketplace catalog (core native actions) are SKIPPED, '
            + 'not asserted clean. A zero errorCount is not proof the workflow is publishable.',
          // The deeper reason a clean check proves little, and it is GHL's hole rather than ours.
          // Of 385 step types, only 51 carry a validator GHL actually enforces. 18 more have rules
          // that never fire, and 316 have none at all — including the types authors use most:
          // if_else, task-notification, goto, transition, find_opportunity,
          // internal_update_opportunity, workflow_ai_decision_maker. Independently measured on our
          // mined rule set 2026-09-07 and corroborated by another operator replaying GHL's own 67
          // validator bodies over 853 live steps: 528 validated, 325 had no validator to run.
          // So "Check Errors" showing zero in the BUILDER is not evidence either. task-notification
          // has no GHL validator at all — the "Due date is a required field" message that exposed
          // the inner-type bug comes from the drawer's Vue form, which runs only when a human opens
          // the step. nativeShapeIssues below exists precisely because that gap is not ours to close
          // by reproducing GHL more faithfully.
          nativeValidatorGap: 'GHL enforces a validator on 51 of 385 step types. if_else and '
            + 'task-notification have none, so neither this tool nor the builder\'s own Check Errors '
            + 'will fault them however they are shaped. Read nativeShapeIssues, and for anything '
            + 'else on those types, open the step in the builder — the drawer form is the only oracle.',
        },
      });
    }),
  },
  {
    name: 'validate_workflow',
    description: describe('validate_workflow',
      "Ask GHL's OWN server validator whether a workflow would pass: the check the builder runs live, "
      + 'debounced, on every edit (POST /workflow/{loc}/{wid}/validate-workflows). Validates the STORED '
      + 'document, or the stored document with `templates` swapped in, so a planned edit can be checked '
      + 'BEFORE it is saved. Writes nothing (proof: live 2026-09-11 on the sandbox: the document read '
      + 'back byte-identical after five calls, and a dangling next, stripped attributes and an unbound '
      + 'flow trigger each came back valid:false naming the rule, the step and the message; risk: '
      + 'read-only). READ `layer`: a failing call reports ONE layer. A structural or an action failure '
      + 'was reported IN PLACE OF a trigger failure the same document also had, so fix what it names '
      + 'and call again until valid. valid:true is not exhaustive either: an unknown step type passed.'),
    inputSchema: schema({
      locationId: z.string(),
      workflowId: z.string(),
      // The builder validates its IN-MEMORY tree. Passing templates is that: the stored document
      // with this array in place of workflowData.templates.
      templates: z.array(z.object({}).passthrough()).optional(),
    }),
    capabilities: [
      { method: 'GET', path: '/workflow/{loc}/{wid}' },
      { method: 'GET', path: '/workflow/{loc}/trigger' },
      { method: 'POST', path: '/workflow/{loc}/{wid}/validate-workflows' },
    ],
    handler: async (args, deps) => guard(async () => {
      const loc = encodeURIComponent(args.locationId);
      const wid = encodeURIComponent(args.workflowId);
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const doc = await gw.call('GET', `/workflow/${loc}/${wid}`);
      if (!doc.ok) return fromHttp(doc.status, doc.json);
      // The document holds no triggers; the server validates them only from `newTriggers`. Sent
      // without them the same unbound flow trigger came back valid:true, so an unreadable trigger
      // list stops here rather than producing a verdict that skipped a layer.
      const trg = await gw.call('GET', `/workflow/${loc}/trigger?${new URLSearchParams({ workflowId: args.workflowId })}`);
      if (!trg.ok) return fromHttp(trg.status, trg.json);
      const triggers = Array.isArray(trg.json) ? trg.json : (trg.json?.triggers ?? trg.json?.data ?? []);
      const body = { ...doc.json, newTriggers: triggers };
      if (args.templates) body.workflowData = { ...(doc.json?.workflowData ?? {}), templates: args.templates };
      const r = await gw.call('POST', `/workflow/${loc}/${wid}/validate-workflows`, body);
      const verdict = readServerValidation(r.json);
      if (!verdict) return fromHttp(r.status, r.json);
      return ok({
        workflowId: args.workflowId,
        validated: args.templates ? 'the stored document with the supplied templates' : 'the stored document',
        triggersSent: triggers.length,
        ...verdict,
      });
    }, args),
  },
  {
    name: 'export_workflow',
    description: describe('export_workflow', 'Export the full workflow body, triggers and sticky notes.')
      + ' stepIds narrows workflowData.templates to those steps (triggers and notes untouched); writeTo writes the full, scrubbed export to an absolute path and returns a summary — a 110-step flow exceeds the inline result cap.',
    inputSchema: schema({
      locationId: z.string(),
      workflowId: z.string(),
      stepIds: z.array(z.string()).optional(),
      writeTo: z.string().optional(),
    }),
    capabilities: [
      { method: 'GET', path: '/workflow/{loc}/{wid}' },
      { method: 'GET', path: '/workflow/{loc}/trigger' },
      { method: 'GET', path: '/workflows/sticky-notes-all' },
    ],
    handler: async (args, deps) => guard(async () => {
      const locationId = encodeURIComponent(args.locationId);
      const workflowId = encodeURIComponent(args.workflowId);
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const body = await gw.call(
        'GET',
        `/workflow/${locationId}/${workflowId}?includeScheduledPauseInfo=true`,
      );
      if (!body.ok) return fromHttp(body.status, body.json);

      const query = new URLSearchParams({ workflowId: args.workflowId });
      const notesQuery = new URLSearchParams({
        workflowId: args.workflowId,
        locationId: args.locationId,
      });
      const [triggers, notes] = await Promise.all([
        gw.call('GET', `/workflow/${locationId}/trigger?${query}`),
        gw.call('GET', `/workflows/sticky-notes-all?${notesQuery}`),
      ]);
      if (!triggers.ok) return fromHttp(triggers.status, triggers.json);
      if (!notes.ok) return fromHttp(notes.status, notes.json);

      // LIVE-VERIFIED envelopes (GROM AU 2026-07-20): sticky notes come back as
      // { data: [], count: n, traceId } — NOT { notes: [] }. The old accessor fell
      // through to the raw envelope object, so callers got a non-array. Unit tests
      // missed it because they stubbed an invented shape. Always land on an array.
      const asArray = (payload, ...keys) => {
        if (Array.isArray(payload)) return payload;
        for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
        return [];
      };
      let workflow = body.json;
      const allTemplates = Array.isArray(workflow?.workflowData?.templates) ? workflow.workflowData.templates : null;
      if (Array.isArray(args.stepIds) && args.stepIds.length && allTemplates) {
        const wanted = new Set(args.stepIds);
        const missing = args.stepIds.filter((id) => !allTemplates.some((t) => t?.id === id));
        workflow = {
          ...workflow,
          workflowData: { ...workflow.workflowData, templates: allTemplates.filter((t) => wanted.has(t?.id)) },
          exportFilter: { stepIds: args.stepIds, totalSteps: allTemplates.length, ...(missing.length ? { missing } : {}) },
        };
      }
      const result = {
        workflow,
        triggers: asArray(triggers.json, 'triggers', 'data'),
        stickyNotes: asArray(notes.json, 'data', 'notes'),
      };
      if (args.writeTo) {
        const written = writeResultFile(args.writeTo, result);
        if (written.failure) return written.failure;
        return ok({
          ...written,
          workflowId: args.workflowId, name: workflow?.name ?? null, status: workflow?.status ?? null, version: workflow?.version ?? null,
          stepCount: workflow?.workflowData?.templates?.length ?? null, triggerCount: result.triggers.length, stickyNoteCount: result.stickyNotes.length,
          ...(workflow?.exportFilter ? { exportFilter: workflow.exportFilter } : {}),
          note: 'Full export written to writeTo. It is SCRUBBED: any value under a credential-named key '
            + '(a custom_webhook\'s attributes.authorization, for one) is replaced with "<redacted>" on the KEY '
            + 'NAME, without reading the value. repair_workflow reads this file via templatesPath but REFUSES a '
            + 'document still carrying placeholders, because writing one back replaces the stored value with the '
            + 'literal string. Restore those paths first, or use edit_workflow, which only touches fields you name.',
        });
      }
      return ok(result);
    }, args),
  },
  {
    name: 'get_workflow_logs',
    description: describe('get_workflow_logs', 'Read executions, enrollment and per-step contact counts; executionId returns one run\'s full step trace.'),
    inputSchema: schema({
      locationId: z.string(),
      workflowId: z.string(),
      limit: z.number().int().positive().default(20),
      // Optional runtime-corpus filters — forwarded to BOTH /logs/v2 and the
      // enrollment roster (both accept them per 11-runtime-logs.md §1/§4).
      contactId: z.string().optional(),
      fromDate: z.number().int().nonnegative().optional(),
      toDate: z.number().int().nonnegative().optional(),
      eventType: z.string().optional(),
      // Per-run TRACE: every log row of ONE execution (the `workflowStatusId` of any log row /
      // enrollment `id`). logs/v2 only — the roster rejects unknown params. Live-proven GROM AU
      // 2026-08-22 (6 rows for one run incl. the remove_from_workflow exit row).
      executionId: z.string().optional(),
      // Walk the enrollment roster to completion via the action=next cursor
      // instead of returning only page one. Bounded by maxEnrollmentPages.
      allEnrollments: z.boolean().default(false),
      maxEnrollmentPages: z.number().int().positive().default(50),
      // Opt-in enrollment totals ({ total, finished }) from the cache endpoint.
      enrollmentTotals: z.boolean().default(false),
      // Write the full result to this ABSOLUTE path (scrubbed like the inline result) and return a
      // summary instead — a busy flow's log read exceeds the tool-result cap (backlog 27).
      writeTo: z.string().optional(),
    }),
    capabilities: [
      { method: 'GET', path: '/workflows/logs/v2' },
      { method: 'GET', path: '/workflows/status/search/count-per-step' },
      { method: 'GET', path: '/workflows/status/search/workflow-with-filter' },
      { method: 'GET', path: '/workflows/status/search/enroll-stats-cache' },
      { method: 'GET', path: '/workflows/status/enroll-stats' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const limit = args.limit ?? 20;
      const base = { workflowId: args.workflowId, locationId: args.locationId };

      // Shared filter set. logs/v2 and workflow-with-filter both accept
      // contactId / fromDate / toDate / eventType (epoch ms for the dates).
      const filters = {};
      if (typeof args.contactId === 'string' && args.contactId.length) filters.contactId = args.contactId;
      if (Number.isFinite(args.fromDate)) filters.fromDate = String(args.fromDate);
      if (Number.isFinite(args.toDate)) filters.toDate = String(args.toDate);
      if (typeof args.eventType === 'string' && args.eventType.length) filters.eventType = args.eventType;
      const withFilters = (params) => {
        const q = new URLSearchParams(params);
        for (const [key, value] of Object.entries(filters)) q.set(key, value);
        return q;
      };

      const logsQuery = withFilters(base);
      logsQuery.set('limit', String(limit));
      if (typeof args.executionId === 'string' && args.executionId.length) logsQuery.set('executionId', args.executionId);

      const [logs, counts] = await Promise.all([
        gw.call('GET', `/workflows/logs/v2?${logsQuery}`),
        gw.call('GET', `/workflows/status/search/count-per-step?${new URLSearchParams(base)}`),
      ]);
      if (!logs.ok) return fromHttp(logs.status, logs.json);
      if (!counts.ok) return fromHttp(counts.status, counts.json);

      // Enrollment roster. One page by default (backwards compatible); the full
      // cursor walk only when allEnrollments — required for a complete corpus on
      // a busy workflow. The roster endpoint reports isLocationRateLimited when
      // throttled; that page may be partial, so we stop and flag it.
      const rosterOf = (json) => json?.rows ?? json?.statuses ?? (Array.isArray(json) ? json : []);
      // `action=next` is INCLUSIVE of the cursor row: it re-returns the referenced row as the
      // page's first row, so a page carries at most `limit - 1` genuinely NEW rows. At limit=1
      // it carries none, the cursor recomputes to the same _id, and the walk cannot advance —
      // it just re-reads page one until the page cap stops it.
      //
      // MEASURED live on Grom UK yoQVVJFp6wyjxcxilA2H 2026-08-02. `02.5 Submitted for Review`
      // (fd0f444f, enrolled by pipeline_stage_updated with an opportunity-scoped sourceId) and
      // `08 Lead Nurture` (0c13ae43, contact_tag, contact-scoped) BOTH re-serve the same row at
      // limit=1, and fd0f444f advances normally at limit=2 — one echoed row plus one new one.
      // So the stall is the page size, not the enrollment's source, which the reported symptom
      // (50 copies of one opportunity-sourced record) made it look like.
      //
      // Paging the roster at >= 2 keeps forward progress structurally possible. It is scoped to
      // the walk: a single-page read returns whatever the caller asked for.
      const rosterLimit = args.allEnrollments ? Math.max(limit, 2) : limit;
      // The cap is a backstop against an unbounded walk, so it cannot rely on the schema default
      // having been applied — a caller reaching the handler directly would otherwise compare
      // against undefined and loop forever.
      const pageCap = Number.isFinite(args.maxEnrollmentPages) && args.maxEnrollmentPages > 0
        ? args.maxEnrollmentPages
        : 50;
      const enrollments = [];
      const seenIds = new Set();
      let action = 'first';
      let cursor = null;
      let pages = 0;
      let enrollmentsComplete = true;
      let rateLimited = false;
      for (;;) {
        const q = withFilters(base);
        q.set('action', action);
        q.set('limit', String(rosterLimit));
        if (cursor?.referenceId) q.set('referenceId', cursor.referenceId);
        if (cursor?.referenceCreatedAt) q.set('referenceCreatedAt', String(cursor.referenceCreatedAt));
        if (cursor?.referenceSid) q.set('referenceSid', cursor.referenceSid);
        const page = await gw.call('GET', `/workflows/status/search/workflow-with-filter?${q}`);
        if (!page.ok) return fromHttp(page.status, page.json);
        const batch = rosterOf(page.json);
        // Drop the echoed cursor row rather than counting it again. Rows without an id cannot be
        // de-duplicated — keying those on content would collapse two genuinely distinct rows into
        // one — so they are always retained, and they always count as progress.
        let fresh = 0;
        for (const row of batch) {
          const id = row?._id ?? row?.id;
          const key = id === undefined || id === null ? '' : String(id);
          if (key !== '' && seenIds.has(key)) continue;
          if (key !== '') seenIds.add(key);
          enrollments.push(row);
          fresh += 1;
        }
        pages += 1;
        if (page.json?.isLocationRateLimited) { rateLimited = true; enrollmentsComplete = false; break; }
        if (!args.allEnrollments) break;
        if (batch.length === 0) break; // the server ran out of rows
        // A page that contributed nothing new cannot move the cursor, so continuing would re-read
        // it until the cap. A SHORT such page is simply the tail — only the echoed row was left,
        // which is what exhaustion looks like here. A FULL one means the walk is genuinely stuck,
        // and saying so beats reporting the cap's worth of copies as a roster.
        if (fresh === 0) {
          if (batch.length >= rosterLimit) enrollmentsComplete = false;
          break;
        }
        if (pages >= pageCap) { enrollmentsComplete = false; break; }
        const last = batch[batch.length - 1];
        const next = {
          referenceId: last?._id ?? last?.id,
          referenceCreatedAt: last?.createdAt,
          referenceSid: last?.sid,
        };
        // No cursor to advance on = we cannot prove completeness; stop honestly.
        if (!next.referenceId && !next.referenceSid) { enrollmentsComplete = false; break; }
        cursor = next;
        action = 'next';
      }

      // Enrollment totals ({ total, finished }) — live-proven (GROM AU 2026-07-24:
      // total=81/finished=79). Supplementary + best-effort: a stats miss never
      // fails the proven core payload.
      let enrollmentStats = null;
      if (args.enrollmentTotals) {
        // Documented path uses a literal workflowIds[] key; URLSearchParams would
        // percent-encode the brackets, which GHL's backend may not accept.
        const cacheQ = `workflowIds[]=${encodeURIComponent(args.workflowId)}`
          + `&locationId=${encodeURIComponent(args.locationId)}`;
        let statsRes = await gw.call('GET', `/workflows/status/search/enroll-stats-cache?${cacheQ}`);
        let source = statsRes.ok ? 'enroll-stats-cache' : null;
        if (!statsRes.ok) {
          statsRes = await gw.call('GET', `/workflows/status/enroll-stats?${new URLSearchParams(base)}`);
          source = statsRes.ok ? 'enroll-stats' : null;
        }
        if (statsRes.ok) {
          const payload = statsRes.json;
          const arr = Array.isArray(payload)
            ? payload
            : (payload?.stats ?? payload?.data ?? (payload ? [payload] : []));
          const mine = arr.find((stat) => stat?.workflowId === args.workflowId) ?? arr[0] ?? null;
          if (mine) enrollmentStats = { ...mine, source, proof: 'live-runtime (2026-07-24)' };
        }
      }

      // GHL emits LIFECYCLE rows alongside the rows for authored steps: add_to_workflow,
      // added_to_workflow and remove_from_workflow. They carry a `stepName` that reads like a
      // real step ("Add to workflow", "Remove from workflow") and a `stepId` that matches NO
      // entry in workflowData.templates, so anything correlating log rows to steps reports steps
      // that do not exist. Proven live 2026-08-25 on a two-step workflow whose log had five rows.
      //
      // They are NOT dropped — added_to_workflow is the only proof a trigger fired, which the
      // note below has always said. They are LABELLED, so a consumer can tell a lifecycle row
      // from a step row without knowing the vocabulary.
      const LIFECYCLE_TYPES = new Set(['add_to_workflow', 'added_to_workflow', 'remove_from_workflow']);
      const rawLogs = logs.json?.logs ?? logs.json ?? [];
      // A removal's CHANNEL is the only thing that distinguishes an outside API call from the
      // workflow removing the contact itself: the roster says `finished` for both completion and
      // removal (F5-35, proven live 2026-08-29 with a private integration token). So an exit
      // reason read from the roster alone is unknowable, and a run ended by an integration looks
      // exactly like one that ran to the end.
      // Opportunity steps route through the premium-actions-worker, and a row that really ran
      // carries `meta.actionFrom: {channel:"premium-actions-worker", ...}` — even a `skipped` one,
      // because the skip verdict came FROM the worker (3/3 live rows). A `success` whose
      // actionFrom is EMPTY never reached the worker at all: measured live on a manual enrolment
      // into an opportunity-triggered workflow, where "Mark the card LOST" logged success twice
      // and the card never moved. Scoped to exactly these two types — internal_notification runs
      // successfully with an empty actionFrom, so a broader label would cry wolf on every row.
      const PREMIUM_ACTION_TYPES = new Set(['internal_create_opportunity', 'internal_update_opportunity']);
      const emptyActionFrom = (r) => {
        const af = r?.meta?.actionFrom;
        return af == null || (typeof af === 'object' && Object.keys(af).length === 0);
      };
      // A conversationai_objective row whose actionFrom.response.msg says "Objective met but field
      // update failed - proceeding due to allowPartialSuccess" is the ONLY trace of a write the
      // Conversation AI service refused: the flow moves on as if met, the chat shows nothing, and
      // the field keeps its old value. It happens in short bursts on every account and every
      // field type (D-86, D-90: 10/108 rows on one account, 2/45 on another, over a week). Labelled
      // per row and counted at the top so a run's "written" fields can be trusted, or not.
      const OBJECTIVE_WRITE_FAILED = /field update failed/i;
      const objectiveWriteFailed = (r) => {
        if (r?.type !== 'conversationai_objective') return false;
        const msg = (r?.meta?.actionFrom ?? r?.actionFrom)?.response?.msg;
        return typeof msg === 'string' && OBJECTIVE_WRITE_FAILED.test(msg);
      };
      const labelledLogs = Array.isArray(rawLogs)
        ? rawLogs.map((r) => {
          if (objectiveWriteFailed(r)) {
            return {
              ...r,
              objectiveWriteFailed: true,
              objectiveWriteNote: 'the objective was met but the Conversation AI service REFUSED the field write and moved on '
                + '(allowPartialSuccess) — the field keeps its old value; a platform transient seen in bursts on every account, '
                + 'not tied to the field, the contact or the wording. Read the field before trusting it.',
            };
          }
          if (PREMIUM_ACTION_TYPES.has(r?.type) && r?.status === 'success' && emptyActionFrom(r)) {
            return {
              ...r,
              actionDispatched: false,
              actionDispatchNote: 'success with an EMPTY meta.actionFrom — the write never reached '
                + 'the premium-actions-worker, so nothing was written. Seen when the run holds no '
                + 'bound opportunity (manual/API enrolment into an opportunity-triggered workflow). '
                + 'Treat this row as a NO-OP, not a successful card write.',
            };
          }
          if (!LIFECYCLE_TYPES.has(r?.type)) return r;
          const channel = r?.removedFrom?.channel ?? null;
          return {
            ...r,
            isLifecycleRow: true,
            ...(r.type === 'remove_from_workflow'
              ? { removalOrigin: channel === 'OAUTH' ? 'external-api' : (channel ? 'workflow' : 'unknown') }
              : {}),
          };
        })
        : rawLogs;
      const externalRemovals = Array.isArray(labelledLogs)
        ? labelledLogs.filter((r) => r?.removalOrigin === 'external-api').length
        : 0;

      const objectiveWriteFailures = Array.isArray(labelledLogs) ? labelledLogs.filter((r) => r?.objectiveWriteFailed).length : 0;
      const result = {
        logs: labelledLogs,
        // Counted separately because the roster cannot tell them apart: it says `finished` for a
        // completed run AND for one an outside call ended.
        ...(externalRemovals ? { externalRemovals } : {}),
        ...(objectiveWriteFailures ? { objectiveWriteFailures } : {}),
        perStepCounts: counts.json?.counts ?? counts.json ?? [],
        enrollments,
        // Only meaningful when the caller asked for the full walk; undefined keeps
        // the single-page response shape unchanged for existing callers.
        ...(args.allEnrollments ? { enrollmentsComplete, enrollmentPages: pages } : {}),
        ...(rateLimited ? { rateLimited: true } : {}),
        ...(enrollmentStats ? { enrollmentStats } : {}),
        note: 'added_to_workflow in logs is the ONLY proof a trigger fired. '
            + 'Rows flagged isLifecycleRow are GHL-generated, not authored steps — do not '
            + 'correlate them to workflowData.templates. '
            + 'A roster status of "finished" means the contact LEFT the workflow, which covers '
            + 'both completing it and being removed from it — it is not a completion signal.',
      };
      if (args.writeTo) {
        const written = writeResultFile(args.writeTo, result);
        if (written.failure) return written.failure;
        return ok({
          ...written, logCount: Array.isArray(labelledLogs) ? labelledLogs.length : null, enrollmentCount: enrollments.length,
          ...(objectiveWriteFailures ? { objectiveWriteFailures } : {}), ...(externalRemovals ? { externalRemovals } : {}),
          ...(args.allEnrollments ? { enrollmentsComplete, enrollmentPages: pages } : {}),
          note: 'Full result written to writeTo (scrubbed). Re-read the file for the rows; this summary carries the counts only.',
        });
      }
      return ok(result);
    }, args),
  },
  {
    name: 'get_workflow_runtime_window',
    description: describe(
      'get_workflow_runtime_window',
      'Collect one workflow\'s complete runtime window — proof: external-receipt-required; risk: read. `complete` covers runtime event coverage only; configurationBinding records that nothing proves the captured definition governed those events. Live canary required before Full audit.',
    ),
    inputSchema: schema({
      locationId: z.string(),
      workflowId: z.string(),
      // Epoch milliseconds, half-open [fromDate, toDate). Bounded HERE as well as in the
      // collector because the log descriptors carry no numeric bounds on either key.
      fromDate: z.number().int().nonnegative(),
      toDate: z.number().int().positive(),
      contactId: z.string().optional(),
      // `eventType` is not repeatable upstream, so each entry costs its own cursor walk
      // against the one shared maxLogPages budget.
      eventTypes: z.array(z.string()).max(20).default([]),
      stepIds: z.array(z.string()).max(20).default([]),
      // Throughput, not correctness: the cursor walk terminates on a page contributing no
      // new ids, which is sound at any page size. Bounded to the range measured live.
      //
      // `pageSize`, `maxLogPartitions` and `minPartitionMs` are GONE, not defaulted — the
      // registration guard refuses undeclared keys, so a caller still passing one gets an
      // error rather than a silent drop. See RETIRED_RUNTIME_WINDOW_INPUTS.
      logPageSize: z.number().int().min(1).max(5000).default(100),
      maxLogPages: z.number().int().min(1).max(2048).default(200),
      // Wide windows on /workflows/logs/v2 intermittently 500 and then serve the identical
      // request cleanly. Retry is part of the contract, not a workaround.
      maxLogRetries: z.number().int().min(0).max(10).default(3),
      maxEnrollmentPages: z.number().int().min(1).max(1000).default(200),
      maxStepRosterPages: z.number().int().min(1).max(1000).default(200),
    }),
    capabilities: [
      { method: 'GET', path: '/workflow/{loc}/{wid}' },
      { method: 'GET', path: '/workflow/{loc}/trigger' },
      { method: 'GET', path: '/workflows/sticky-notes-all' },
      { method: 'GET', path: '/workflows/logs/v2' },
      { method: 'GET', path: '/workflows/status/search/count-per-step' },
      { method: 'GET', path: '/workflows/status/search/workflow-with-filter' },
      { method: 'GET', path: '/workflows/status/search/details-by-step' },
      { method: 'GET', path: '/workflows/status/search/enroll-stats-cache' },
      { method: 'GET', path: '/workflows/status/enroll-stats' },
    ],
    handler: async (args, deps) => guard(async () => {
      // Validated BEFORE the gateway is constructed: building one first would spend a
      // credential read (and register an audit trace) for a window that was never legal.
      const config = validateRuntimeWindowInput(args ?? {});
      if (typeof deps?.makeGw !== 'function') {
        return fail(CODES.ENGINE_ABORT, 'the runtime-window tool was invoked without a gateway factory',
          'Register the tool with { state, makeGw } dependencies before calling it.');
      }
      // Throttling is disabled on the per-gateway rail because the shared audit limiter
      // owns pacing; leaving the default double-throttles every read. `makeGw` must
      // therefore FORWARD these options — see makeGatewayFactory for the version that
      // dropped them.
      const backend = deps.makeGw({ loc: config.locationId, rail: 'jwt', state: deps.state, throttleMs: 0, jitterMs: 0 });
      // An injected pair wins (Task 5's driver, and tests that need an isolated circuit);
      // otherwise the PROCESS-wide pair, never a fresh one per call. A per-call circuit
      // forgets a 429 the instant the call that earned it returns.
      const pacing = processAuditPacing();
      const auditGateway = makeAuditGateway({
        gateways: { backend },
        locationId: config.locationId,
        limiter: deps.auditLimiter ?? pacing.limiter,
        circuit: deps.auditCircuit ?? pacing.circuit,
      });
      return ok(await collectWorkflowRuntimeWindow({ auditGateway, input: args }));
    }, args),
  },
  {
    name: 'list_workflows_complete',
    description: describe(
      'list_workflows_complete',
      'Walk the workflow roster to a reconciled terminal proof — proof: external-receipt-required; risk: read. A failed, contradicted or budget-exhausted walk is complete:false with a coded warning and a null roster, never an empty list. Live canary required before Full audit.',
    ),
    inputSchema: schema({
      locationId: z.string(),
      // Bounded HERE as well as in the composite: the descriptor's own limit bound is 100,
      // and a schema that admitted more would hand the composite a budget its own validator
      // would then refuse — two copies of one rule disagreeing.
      pageSize: z.number().int().min(1).max(100).default(100),
      maxPages: z.number().int().min(1).max(1000).default(100),
    }),
    capabilities: [
      // NOTE FOR TASK 5. This row's path template is `{loc}` — the placeholder vocabulary the
      // whole capability manifest has always used — while the audit DESCRIPTOR for the same
      // route (`workflow_roster_list` in core/audit-capabilities.mjs) spells its
      // `normalizedPath` `/workflow/{locationId}/list`. They address one route. Task 5's rule
      // "a descriptor and its capability row differ => fail" therefore needs an explicit
      // NORMALIZATION step before the comparison (map the descriptor's binding names onto the
      // manifest's placeholders, or vice versa), or it will fail every audit capability that
      // carries a path binding at all. This is the first row where the two vocabularies meet.
      { method: 'GET', path: '/workflow/{loc}/list' },
    ],
    handler: async (args, deps) => guard(async () => {
      // Validated BEFORE the gateway is constructed, for the same reason the runtime window
      // is: building one first spends a credential read for a request that was never legal.
      const config = validateRosterInput(args ?? {});
      if (typeof deps?.makeGw !== 'function') {
        return fail(CODES.ENGINE_ABORT, 'the roster composite was invoked without a gateway factory',
          'Register the tool with { state, makeGw } dependencies before calling it.');
      }
      // Only the rail this composite actually reads. The roster capability is backend/jwt,
      // and constructing an AI rail it never calls would widen the credential surface of a
      // read that has no business touching it.
      const backend = deps.makeGw({ loc: config.locationId, rail: 'jwt', state: deps.state, throttleMs: 0, jitterMs: 0 });
      const pacing = processAuditPacing();
      const auditGateway = makeAuditGateway({
        gateways: { backend },
        locationId: config.locationId,
        limiter: deps.auditLimiter ?? pacing.limiter,
        circuit: deps.auditCircuit ?? pacing.circuit,
      });
      return ok(await listWorkflowsComplete({ auditGateway, input: args }));
    }, args),
  },
  {
    name: 'get_ai_configuration_bundle',
    description: describe(
      'get_ai_configuration_bundle',
      'Sweep Conversation AI, Voice AI and Agent Studio discovery plus detail — proof: external-receipt-required; risk: read. All three surfaces are always attempted; a failed or malformed component is complete:false with null items, never an empty agent list. Per Conversation AI agent it also reads the Agent-Deployment routing rows (one row per channel, published verbatim); rows pinned to specific identifiers (allIdentifiers:false) are summarised in routingPinned — legal live config reported for review, never a failure. Live canary required before Full audit.',
    ),
    inputSchema: schema({
      locationId: z.string(),
      // Optional because a missing agency context is a real operating condition, answered
      // per component by AI_COMPANY_CONTEXT_UNAVAILABLE with zero reads. There is
      // deliberately NO surface selector: callers cannot omit a surface, so there must be no
      // field through which they could try.
      companyId: z.string().optional(),
      maxPages: z.number().int().min(1).max(1000).default(100),
    }),
    capabilities: [
      // `/ai-employees/agents` 404s ("Cannot GET", i.e. no such route) — use
      // `/ai-employees/employees/search` instead (see core/audit-capabilities.mjs).
      { method: 'GET', path: '/ai-employees/employees/search' },
      { method: 'GET', path: '/ai-employees/employees/{agentId}' },
      // The Agent-Deployment routing rows, read once per Conversation AI agent (a live
      // Live_Chat row pinned to a deleted widget id is a silently mute agent — the whole
      // reason this read exists). Conversation AI only; no routing capture exists for the
      // other two products.
      { method: 'GET', path: '/agent-deployment/routing-config/configs' },
      // The /simple discovery route, never the legacy bare `/voice-ai/agents` that
      // list_account_entities reads: a different capability with a different receipt.
      { method: 'GET', path: '/voice-ai/agents/simple' },
      { method: 'GET', path: '/voice-ai/agents/{agentId}' },
      { method: 'GET', path: '/agent-studio/agents/agents-with-folders' },
      { method: 'GET', path: '/agent-studio/super-agent/agents/{agentId}' },
    ],
    handler: async (args, deps) => guard(async () => {
      const config = validateAiBundleInput(args ?? {});
      if (typeof deps?.makeGw !== 'function') {
        return fail(CODES.ENGINE_ABORT, 'the AI configuration bundle was invoked without a gateway factory',
          'Register the tool with { state, makeGw } dependencies before calling it.');
      }
      // ONLY the ai rail, for the same reason the roster builds only jwt: ALL SEVEN of this
      // bundle's capabilities declare `authRail:'ai'`, and `makeGateway` reads credentials at
      // construction, so a backend gateway this composite can never call would widen the
      // credential surface of a read that has no business touching it. (It also cannot help:
      // an absent slot fails closed at call time with MISSING_AUTH_RAIL, and no capability
      // here would ever reach that slot to trigger it.)
      const ai = deps.makeGw({ loc: config.locationId, rail: 'ai', state: deps.state, throttleMs: 0, jitterMs: 0 });
      const pacing = processAuditPacing();
      const auditGateway = makeAuditGateway({
        gateways: { ai },
        locationId: config.locationId,
        limiter: deps.auditLimiter ?? pacing.limiter,
        circuit: deps.auditCircuit ?? pacing.circuit,
      });
      return ok(await getAiConfigurationBundle({ auditGateway, input: args }));
    }, args),
  },
  {
    name: 'get_contacts_at_step',
    description: describe(
      'get_contacts_at_step',
      'List the contacts parked at / processed by one workflow step, paginated to the full total.',
    ),
    inputSchema: schema({
      locationId: z.string(),
      workflowId: z.string(),
      stepId: z.string(),
      // Walk details-by-step to totalCount (default) or return a single page.
      all: z.boolean().default(true),
      skip: z.number().int().nonnegative().default(0),
      limit: z.number().int().positive().default(50),
    }),
    capabilities: [
      { method: 'GET', path: '/workflows/status/search/details-by-step' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      // Reuse the fast-forward engine's live-proven details-by-step walker — it
      // pages at pageSize and walks to the reported totalCount, throwing (→ the
      // error contract via guard) if pagination stalls.
      const ff = makeFF({ gw });
      if (args.all !== false) {
        const contacts = await ff.allParked(args.workflowId, args.stepId, { pageSize: args.limit ?? 50 });
        return ok({ stepId: args.stepId, contacts, total: contacts.length, complete: true });
      }
      const page = await ff.parkedAt(args.workflowId, args.stepId, {
        skip: args.skip ?? 0,
        limit: args.limit ?? 50,
      });
      const rows = Array.isArray(page?.rows) ? page.rows : [];
      const reported = Number(page?.totalCount);
      const total = Number.isFinite(reported) && reported >= 0 ? reported : rows.length;
      return ok({
        stepId: args.stepId,
        contacts: rows,
        total,
        complete: (args.skip ?? 0) + rows.length >= total,
      });
    }, args),
  },
  {
    name: 'get_workflow_stats',
    description: describe(
      'get_workflow_stats',
      'The builder\'s Stats view as data: per-step SMS/email delivery aggregates, per-trigger attempted/matched counts, contacts per step (last 30 days max).',
    ),
    inputSchema: schema({
      locationId: z.string(),
      workflowId: z.string(),
      // GHL keeps these stats for the last 30 days ("Stats are only available for the last 30 days").
      days: z.number().int().positive().max(30).default(30),
      // Which step types get a message aggregate: the UI shows stats for sms + email steps.
      stepTypes: z.array(z.string()).default(['sms', 'email']),
      includeTriggers: z.boolean().default(true),
      includeContactsPerStep: z.boolean().default(true),
    }),
    capabilities: [
      { method: 'GET', path: '/workflow/{loc}/{wid}' },
      { method: 'GET', path: '/workflow/{loc}/trigger' },
      { method: 'GET', path: '/conversations-reporting/messages/aggregate' },
      { method: 'GET', path: '/conversations-reporting/emails/aggregate' },
      { method: 'GET', path: '/workflows/trigger/logs/count-by-triggerId' },
      { method: 'GET', path: '/workflows/status/search/count-per-step' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const loc = encodeURIComponent(args.locationId);
      const wid = encodeURIComponent(args.workflowId);
      const wf = await gw.call('GET', `/workflow/${loc}/${wid}?includeScheduledPauseInfo=true`);
      if (!wf.ok) return fromHttp(wf.status, wf.json);
      const templates = Array.isArray(wf.json?.workflowData?.templates) ? wf.json.workflowData.templates : [];
      // The builder's own window: endDate = today 23:59:59.999Z, startDate = N days earlier 00:00Z
      // (captured 2026-08-22: startDate=2026-07-23T00:00:00.000+00:00&endDate=2026-08-22T23:59:59.999+00:00).
      const now = deps.now ? new Date(deps.now) : new Date();
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (args.days ?? 30), 0, 0, 0, 0));
      const iso = (d) => d.toISOString().replace('Z', '+00:00');
      const window = { startDate: iso(start), endDate: iso(end), fromDate: start.getTime(), toDate: end.getTime(), days: args.days ?? 30 };
      const stepTypes = new Set(args.stepTypes ?? ['sms', 'email']);
      const steps = [];
      for (const t of templates) {
        if (!t || !stepTypes.has(t.type)) continue;
        const channel = t.type === 'email' ? 'emails' : 'messages';
        const q = new URLSearchParams({ startDate: window.startDate, endDate: window.endDate, source: 'workflow', sourceId: args.workflowId, subSourceId: t.id, locationId: args.locationId });
        const r = await gw.call('GET', `/conversations-reporting/${channel}/aggregate?${q}`);
        if (!r.ok) { steps.push({ id: t.id, name: t.name ?? null, type: t.type, channel, error: { status: r.status } }); continue; }
        const results = r.json?.results ?? {};
        const metrics = Object.fromEntries(Object.entries(results).filter(([, v]) => v && typeof v === 'object' && 'value' in v).map(([k, v]) => [k, v.value]));
        steps.push({ id: t.id, name: t.name ?? null, type: t.type, channel, total: r.json?.total ?? null, metrics, rates: results.rates ?? null });
      }
      let triggers = [];
      if (args.includeTriggers !== false) {
        const tr = await gw.call('GET', `/workflow/${loc}/trigger?${new URLSearchParams({ workflowId: args.workflowId })}`);
        if (!tr.ok) return fromHttp(tr.status, tr.json);
        const list = Array.isArray(tr.json) ? tr.json : (tr.json?.triggers ?? tr.json?.data ?? []);
        for (const trig of list) {
          const q = new URLSearchParams({ triggerId: trig.id, locationId: args.locationId, fromDate: String(window.fromDate), toDate: String(window.toDate), recordId: '', dateType: 'custom' });
          const r = await gw.call('GET', `/workflows/trigger/logs/count-by-triggerId?${q}`);
          const row = Array.isArray(r.json) ? (r.json[0] ?? null) : (r.json && typeof r.json === 'object' ? r.json : null);
          const attempted = Number(row?.total ?? 0), matched = Number(row?.matched ?? 0);
          triggers.push({ id: trig.id, name: trig.name ?? null, type: trig.type, active: trig.active ?? null, attempted, matched, unmatched: Math.max(0, attempted - matched), ...(r.ok ? {} : { error: { status: r.status } }) });
        }
      }
      let contactsPerStep = null;
      if (args.includeContactsPerStep !== false) {
        const r = await gw.call('GET', `/workflows/status/search/count-per-step?${new URLSearchParams({ workflowId: args.workflowId, locationId: args.locationId })}`);
        if (r.ok) contactsPerStep = recordsFrom(r.json, 'data', 'rows').map((x) => ({ stepId: x.currentStepId ?? x.stepId ?? null, total: x.total ?? null }));
      }
      return ok({
        workflowId: args.workflowId, status: wf.json?.status ?? null, window,
        steps, stepsWithoutStats: templates.filter((t) => t && !stepTypes.has(t.type)).map((t) => ({ id: t.id, type: t.type })).length,
        triggers, contactsPerStep,
        note: 'Same endpoints as the builder\'s Stats view (rail toggle, pie icon); GHL keeps these for the last 30 days only. SMS "failed" = metrics.unfulfilled; email "bounced" = metrics.permanentFail.',
      });
    }, args),
  },
  {
    name: 'list_workflow_versions',
    description: describe(
      'list_workflow_versions',
      'Version history (the clock-icon rail panel): every saved/published snapshot\'s metadata, newest first.',
    ),
    inputSchema: schema({
      locationId: z.string(),
      workflowId: z.string(),
      // history/v2 is paged; the unpaged /history returns everything (GHL keeps 30 days or the last 10).
      limit: z.number().int().positive().max(100).default(20),
      all: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'GET', path: '/workflow/{loc}/{wid}/history' },
      { method: 'GET', path: '/workflow/{loc}/{wid}/history/v2' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const loc = encodeURIComponent(args.locationId), wid = encodeURIComponent(args.workflowId);
      const r = await gw.call('GET', args.all ? `/workflow/${loc}/${wid}/history` : `/workflow/${loc}/${wid}/history/v2?${new URLSearchParams({ limit: String(args.limit ?? 20) })}`);
      if (!r.ok) return fromHttp(r.status, r.json);
      const rows = recordsFrom(r.json, 'data', 'versions');
      const versions = rows.map((v) => ({
        versionId: v._id ?? v.id ?? null, version: v.version ?? null, status: v.status ?? null, name: v.name ?? null,
        updatedBy: v.updatedBy ?? null, updatedAt: v.updatedAt ?? null, createdAt: v.createdAt ?? null,
        isRestore: v.meta?.versionRestore ? v.meta.versionRestore : null,
      }));
      return ok({
        workflowId: args.workflowId, versions, count: versions.length,
        nextPage: Array.isArray(r.json) ? null : (r.json?.nextPage ?? null),
        note: 'LIVE (GROM AU 2026-08-22): version records exist for the CREATE (v1) and for each PUBLISH — the publish PUT wrote the pre-publish state as its own version AND the published state; draft saves (the UI Save button, API PUTs, autosave) created none. Retention: 30 days or the last 10. Fetch a snapshot with get_workflow_version; restore is PUT /workflow/{loc}/{wid} with isRestoreRequest:true (always lands as draft) — not exposed as a tool.',
      });
    }, args),
  },
  {
    name: 'get_workflow_version',
    description: describe(
      'get_workflow_version',
      'One version-history snapshot with its full step graph (by version number or version id).',
    ),
    inputSchema: schema({
      locationId: z.string(),
      workflowId: z.string(),
      version: z.number().int().positive().optional(),
      versionId: z.string().optional(),
    }),
    capabilities: [
      { method: 'GET', path: '/workflow/{loc}/{wid}/history-by-number/{n}' },
      { method: 'GET', path: '/workflow/{loc}/{wid}/history/{versionId}' },
    ],
    handler: async (args, deps) => guard(async () => {
      if (args.version === undefined && !args.versionId) {
        return fail(CODES.VALIDATION_FAILED, 'get_workflow_version needs version (a number) or versionId.', 'Pass the version number from list_workflow_versions, or its versionId.');
      }
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const loc = encodeURIComponent(args.locationId), wid = encodeURIComponent(args.workflowId);
      const path = args.version !== undefined
        ? `/workflow/${loc}/${wid}/history-by-number/${encodeURIComponent(String(args.version))}`
        : `/workflow/${loc}/${wid}/history/${encodeURIComponent(args.versionId)}`;
      const r = await gw.call('GET', path);
      if (!r.ok) return fromHttp(r.status, r.json);
      const v = r.json ?? {};
      const templates = Array.isArray(v.workflowData?.templates) ? v.workflowData.templates : [];
      return ok({
        workflowId: args.workflowId, versionId: v._id ?? v.id ?? null, version: v.version ?? null, status: v.status ?? null,
        name: v.name ?? null, updatedBy: v.updatedBy ?? null, updatedAt: v.updatedAt ?? null,
        settings: { allowMultiple: v.allowMultiple ?? null, allowMultipleOpportunity: v.allowMultipleOpportunity ?? null, stopOnResponse: v.stopOnResponse ?? null, autoMarkAsRead: v.autoMarkAsRead ?? null, timezone: v.timezone ?? null, window: v.window ?? null, senderAddress: v.senderAddress ?? null, eventStartDate: v.eventStartDate ?? null },
        stepCount: templates.length, templates, meta: v.meta ?? null,
      });
    }, args),
  },
  {
    name: 'get_trigger_logs',
    description: describe(
      'get_trigger_logs',
      'Why a trigger did or did not fire: per-contact attempt rows with qualified / failedReason / actualValue vs expectedValue, plus the ranked top-failed-reasons — for every trigger of a workflow or one trigger.',
    ),
    inputSchema: schema({
      locationId: z.string(),
      // Either a workflowId (all its triggers) or an explicit triggerId + triggerType pair.
      workflowId: z.string().optional(),
      triggerId: z.string().optional(),
      // The list + reasons endpoints REQUIRE triggerType (422 "triggerType must be a string"
      // without it); count-by-triggerId does not.
      triggerType: z.string().optional(),
      days: z.number().int().positive().max(90).default(30),
      // qualified=false → only the attempts that did NOT match (the "why not" view).
      qualified: z.boolean().optional(),
      limit: z.number().int().positive().max(200).default(25),
      includeFailedReasons: z.boolean().default(true),
    }),
    capabilities: [
      { method: 'GET', path: '/workflow/{loc}/trigger' },
      { method: 'GET', path: '/workflows/trigger/logs/count-by-triggerId' },
      { method: 'GET', path: '/workflows/trigger/logs/triggerId' },
      { method: 'GET', path: '/workflows/trigger/logs/top-failed-reasons' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const loc = encodeURIComponent(args.locationId);
      let triggers = [];
      if (args.triggerId) {
        if (!args.triggerType) return fail(CODES.VALIDATION_FAILED, 'triggerType is required with triggerId (the trigger-log endpoints reject the call without it); pass workflowId instead to have it resolved.');
        triggers = [{ id: args.triggerId, type: args.triggerType, name: null }];
      } else if (args.workflowId) {
        const tr = await gw.call('GET', `/workflow/${loc}/trigger?${new URLSearchParams({ workflowId: args.workflowId })}`);
        if (!tr.ok) return fromHttp(tr.status, tr.json);
        const list = Array.isArray(tr.json) ? tr.json : (tr.json?.triggers ?? tr.json?.data ?? []);
        triggers = list.map((t) => ({ id: t.id ?? t._id, type: t.type, name: t.name ?? null, active: t.active ?? null }));
      } else {
        return fail(CODES.VALIDATION_FAILED, 'pass workflowId (all its triggers) or triggerId + triggerType.');
      }
      const now = deps.now ? new Date(deps.now) : new Date();
      const toDate = now.getTime();
      const fromDate = toDate - (args.days ?? 30) * 86_400_000;
      const base = { locationId: args.locationId, dateType: 'custom', fromDate: String(fromDate), toDate: String(toDate) };
      const parseMaybeJson = (v) => { if (typeof v !== 'string') return v ?? null; try { return JSON.parse(v); } catch { return v; } };
      const out = [];
      // Conversation-AI triggers keep NO attempt stats: 0 attempts on every account, minutes after
      // a demonstrable fire (R-150, D-84, 2026-09-06). The only proof of a conv-AI fire is the
      // `added_to_workflow` enrolment row in get_workflow_logs. Flagged per trigger so a zero
      // here is never read as "the trigger did not fire".
      const NO_STATS_TYPES = new Set(['conv_ai_trigger', 'conv_ai_autonomous_trigger']);
      for (const trig of triggers) {
        const item = { id: trig.id, name: trig.name, type: trig.type, active: trig.active ?? null };
        if (NO_STATS_TYPES.has(trig.type)) {
          item.noStats = true;
          item.note = `${trig.type} keeps no attempt stats (every account reads 0 even after a proven fire). Proof of a fire is the added_to_workflow enrolment row: get_workflow_logs with contactId, or its enrollments roster.`;
        }
        const c = await gw.call('GET', `/workflows/trigger/logs/count-by-triggerId?${new URLSearchParams({ ...base, triggerId: trig.id, recordId: '' })}`);
        const row = Array.isArray(c.json) ? (c.json[0] ?? null) : null;
        item.attempted = Number(row?.total ?? 0); item.matched = Number(row?.matched ?? 0); item.unmatched = Math.max(0, item.attempted - item.matched);
        if (!c.ok) item.countError = { status: c.status };
        const lq = new URLSearchParams({ ...base, triggerId: trig.id, triggerType: trig.type, limit: String(args.limit ?? 25), action: 'first' });
        if (typeof args.qualified === 'boolean') lq.set('qualified', String(args.qualified));
        const l = await gw.call('GET', `/workflows/trigger/logs/triggerId?${lq}`);
        if (l.ok) {
          const rows = Array.isArray(l.json) ? l.json : recordsFrom(l.json, 'rows', 'data');
          item.attempts = rows.map((r) => ({
            id: r._id ?? r.id ?? null, at: r.createdAt ?? null, contactId: r.recordId ?? r.contactId ?? null,
            qualified: r.qualified ?? null, failedReason: r.failedReason ?? null,
            actualValue: parseMaybeJson(r.actualValue), expectedValue: parseMaybeJson(r.expectedValue),
          }));
          item.attemptsTruncated = rows.length >= (args.limit ?? 25);
        } else item.attemptsError = { status: l.status, body: l.json ?? null };
        if (args.includeFailedReasons !== false) {
          const f = await gw.call('GET', `/workflows/trigger/logs/top-failed-reasons?${new URLSearchParams({ ...base, triggerId: trig.id, triggerType: trig.type })}`);
          item.failedReasons = f.ok ? (Array.isArray(f.json) ? f.json : []).map((r) => ({ reason: r.failedReason ?? null, failures: Number(r.failures ?? 0) })) : null;
          if (!f.ok) item.failedReasonsError = { status: f.status };
        }
        out.push(item);
      }
      return ok({
        window: { fromDate, toDate, days: args.days ?? 30 }, triggers: out,
        note: 'Same endpoints as the builder\'s trigger Stats modal. contactId is the attempt\'s recordId; actualValue/expectedValue are the filter comparison that decided qualified. Nine trigger types keep no stats: mailgun_email_event, opportunity_decay, call_status, custom_date_reminder, customer_appointment, birthday_reminder, task_due_date_reminder, and the two Conversation-AI types conv_ai_trigger and conv_ai_autonomous_trigger (flagged noStats per trigger) — for those, an added_to_workflow enrolment row in get_workflow_logs is the only proof of a fire.',
      });
    }, args),
  },
  // ── Agent Logs (services/agent-logs) — read-only rail, mapped 2026-09-03 ─────────────
  {
    name: 'list_agent_sessions',
    description: describe(
      'list_agent_sessions',
      'The AI Agents → Agent Logs Sessions table: one row per agent session with product, channel, agent, contact, tokens, latency and duration. Read-only despite being a POST — this endpoint reads, so it does not take the raw-write confirmation gate.',
    ),
    inputSchema: schema({
      locationId: z.string(),
      products: z.array(z.enum(AGENT_LOG_PRODUCTS)).optional(),
      agentId: z.string().optional(),
      agentName: z.string().optional(),
      contactId: z.string().optional(),
      contactName: z.string().optional(),
      conversationId: z.string().optional(),
      channel: z.string().optional(),
      voiceName: z.string().optional(),
      traceId: z.string().optional(),
      // `search` matches row metadata (agent / channel / contact); `contentSearch` matches the
      // message body. They are different searches — live-proven on the same phrase.
      search: z.string().optional(),
      contentSearch: z.string().optional(),
      metadataText: z.string().optional(),
      // Only `exists` behaves differently server-side; every other op is treated as equality,
      // and `not_exists` does NOT negate. The enum reflects what actually works.
      metadataFilters: z.array(z.object({
        key: z.string(),
        value: z.string().optional(),
        op: z.enum(['equals', 'exists']).default('equals'),
      })).optional(),
      skillId: z.string().optional(),
      timeRange: z.enum(AGENT_LOG_TIME_RANGES).optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      sortBy: z.enum(AGENT_LOG_SORT_FIELDS).default('timestamp'),
      sortOrder: z.enum(['asc', 'desc']).default('desc'),
      page: z.number().int().positive().optional(),
      limit: z.number().int().positive().max(1000).default(50),
      // Walk the cursor internally to `maxRows`. This is the only way past the offset-500 ceiling.
      all: z.boolean().default(false),
      maxRows: z.number().int().positive().max(5000).default(1000),
    }),
    capabilities: [{ method: 'POST', path: '/agent-logs/logs' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, rail: 'ai', state: deps.state });
      const sortBy = args.sortBy ?? 'timestamp';
      const limit = args.limit ?? 50;
      if (args.dateFrom && /^\d+$/.test(args.dateFrom)) {
        return fail(CODES.VALIDATION_FAILED, 'dateFrom/dateTo must be calendar dates (YYYY-MM-DD). Epoch milliseconds are accepted by the server and silently match zero rows.');
      }
      const body = agentLogSessionBody(args);
      const notes = [];

      if (args.all) {
        // The cursor is keyed on timestamp; under any other sort it returns the same rows forever.
        if (sortBy !== 'timestamp') {
          return fail(CODES.VALIDATION_FAILED, `all:true walks the pageToken cursor, which is keyed on timestamp — under sortBy:"${sortBy}" it never advances and would loop on the same rows. Use sortBy:"timestamp" with all:true, or drop all:true and page (offset is capped at ${AGENT_LOG_MAX_OFFSET}).`);
        }
        const maxRows = args.maxRows ?? 1000;
        const w = await walkAgentSessions(gw, body, { maxRows });
        if (w.error) return fromHttp(w.error.status, w.error.json);
        if (w.dupes) notes.push(`sortOrder:"asc" uses an inclusive cursor; ${w.dupes} repeated row(s) were de-duplicated by agentSessionId.`);
        const total = Number(w.meta?.totalRecords ?? w.rows.length);
        if (w.rows.length < total) notes.push(`Stopped at maxRows=${maxRows} of ${total} — raise maxRows for the rest.`);
        return ok({
          sessions: w.rows, count: w.rows.length, totalRecords: total, hops: w.hops,
          filtersApplied: w.meta?.filtersApplied ?? null,
          note: 'Walked the pageToken cursor — the only way past the offset-500 page ceiling.',
          notes: notes.length ? notes : undefined,
        });
      }

      const page = args.page ?? 1;
      const offset = (page - 1) * limit;
      if (offset > AGENT_LOG_MAX_OFFSET) {
        return fail(CODES.VALIDATION_FAILED, `page ${page} at limit ${limit} means offset ${offset}, and the server refuses any offset above ${AGENT_LOG_MAX_OFFSET} ("Page too deep"). Raise limit (it is uncapped) or pass all:true to walk the cursor.`);
      }
      const r = await gw.call('POST', '/agent-logs/logs', { ...body, page });
      if (!r.ok) return fromHttp(r.status, r.json);
      const meta = r.json?.meta ?? {};
      const rows = recordsFrom(r.json, 'data').map(agentLogSessionRow);
      if (r.json?.tokenDataVisible === false) notes.push('tokenDataVisible:false — this account hides token counts.');
      const total = Number(meta.totalRecords ?? rows.length);
      if (total > AGENT_LOG_MAX_OFFSET + limit) notes.push(`${total} rows match; paging stops at offset ${AGENT_LOG_MAX_OFFSET}. Use all:true or a larger limit.`);
      return ok({
        sessions: rows, count: rows.length, page, limit,
        totalRecords: total, totalPages: meta.totalPages ?? null,
        filtersApplied: meta.filtersApplied ?? null,
        nextPageToken: meta.nextPageToken ? '<redacted>' : null,
        hasMore: Boolean(meta.nextPageToken) && rows.length > 0,
        notes: notes.length ? notes : undefined,
      });
    }, args),
  },
  {
    name: 'get_agent_session',
    description: describe(
      'get_agent_session',
      'One agent session end to end: its summary (channel, agent, product, tokens, latency, duration, per-product customConfigs) plus every interaction, paged internally. Each interaction carries the traceId that get_agent_message_trace expands.',
    ),
    inputSchema: schema({
      locationId: z.string(),
      // NOT `sessionId`: that key is in the server's credential scrubber (SECRET_KEYS), so an
      // argument by that name is refused before the handler runs and the value would be
      // redacted out of the response. The agent-log session id is not a credential.
      agentSessionId: z.string(),
      includeMetrics: z.boolean().default(true),
    }),
    capabilities: [
      { method: 'GET', path: '/agent-logs/logs/{sessionId}/summary' },
      { method: 'GET', path: '/agent-logs/logs/{sessionId}/interactions' },
      { method: 'GET', path: '/agent-logs/logs/{sessionId}/metrics' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, rail: 'ai', state: deps.state });
      const sid = encodeURIComponent(args.agentSessionId);
      const lq = new URLSearchParams({ locationId: args.locationId });
      const sum = await gw.call('GET', `/agent-logs/logs/${sid}/summary?${lq}`);
      if (!sum.ok) {
        // A trace id here 404s "No conversation data found for conversation"; the spans route is
        // the one that takes a trace id. Say so rather than passing the raw 404 up.
        if (sum.status === 404) {
          return fail(CODES.VALIDATION_FAILED, `no session ${args.agentSessionId} on this location. Note the session id is NOT the CRM conversation id, and it is not a message/trace id — if you have a message id, use get_agent_message_trace instead.`);
        }
        return fromHttp(sum.status, sum.json);
      }
      const summary = sum.json?.summary ?? {};

      const interactions = [];
      let page = 1; let meta = null;
      while (page <= 50) {
        const q = new URLSearchParams({ locationId: args.locationId, page: String(page), limit: '100' });
        const r = await gw.call('GET', `/agent-logs/logs/${sid}/interactions?${q}`);
        if (!r.ok) return fromHttp(r.status, r.json);
        meta = r.json?.meta ?? null;
        const rows = recordsFrom(r.json, 'interactions');
        for (const i of rows) {
          interactions.push({
            traceId: i.traceId ?? null, timestamp: i.timestamp ?? null, lastSpanName: i.lastSpanName ?? null,
            contactId: i.contactId ?? null, contactName: i.contactName ?? null,
            userQuery: i.userQuery ?? null, aiResponse: i.aiResponse ?? null,
            attachments: i.allAttachments ?? [], metrics: i.metrics ?? null,
          });
        }
        if (!rows.length || page >= Number(meta?.totalPages ?? 1)) break;
        page++;
      }

      const out = {
        agentSessionId: args.agentSessionId,
        summary: {
          channel: summary.channel ?? null, agentName: summary.agentName ?? null,
          productName: summary.productName ?? null, totalTokens: summary.totalTokens ?? null,
          totalLatencyMs: summary.totalLatencyMs ?? null, durationMs: summary.durationMs ?? null,
          totalInteractions: summary.totalInteractions ?? null,
        },
        // Per-product extras: voice_ai ships voice_ai_call_summary here with call_outcome,
        // disconnection_reason, in_voicemail and user_sentiment.
        customConfigs: (summary.customConfigs ?? []).map((c) => ({
          key: `${c.productName ?? '?'}.${c.stepType ?? '?'}`,
          data: parseAgentLogMeta(c.metadata),
        })),
        interactions, interactionCount: interactions.length,
        tokenDataVisible: sum.json?.tokenDataVisible !== false,
      };
      if (args.includeMetrics !== false) {
        const m = await gw.call('GET', `/agent-logs/logs/${sid}/metrics?${lq}`);
        out.metrics = m.ok ? { overview: m.json?.overview ?? null, perInteraction: m.json?.perInteraction ?? [] } : null;
        if (!m.ok) out.metricsError = { status: m.status };
      }
      out.note = 'Each interaction is one inbound message; its traceId IS that message\'s CRM id. Expand it with get_agent_message_trace.';
      return ok(out);
    }, args),
  },
  {
    name: 'get_agent_message_trace',
    description: describe(
      'get_agent_message_trace',
      'Why the AI said what it said, for one message: the ordered node-by-node execution path — splitter branch and its reasoning, knowledge chunks by source title, tool calls, which node actually spoke, model and tokens. The digest is the point; raw spans are opt-in.',
    ),
    inputSchema: schema({
      locationId: z.string(),
      // Either the inbound message id directly, or a session + which message in it.
      messageId: z.string().optional(),
      conversationId: z.string().optional(),
      messageIndex: z.number().int().optional(),
      timestamp: z.string().optional(),
      // Names splitter branch ids. The flow-builder workflow is the one whose trigger carries
      // convTriggerBotId = the agent; without it branch names come back null.
      workflowId: z.string().optional(),
      includePrompt: z.boolean().default(false),
      includeRawSpans: z.boolean().default(false),
      // The UI sends conversationId on the spans call. It DROPS the ai_splitter span, so we
      // default to off; set true only to reproduce exactly what the UI shows.
      narrowToSession: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'GET', path: '/agent-logs/logs/{traceId}/spans' },
      { method: 'GET', path: '/agent-logs/logs/{sessionId}/interactions' },
      // The branch-name resolution leg is the only one on the backend rail: the flow is a
      // workflow, not an agent-logs object. Declared explicitly so host parity stays checkable.
      { method: 'GET', path: '/workflow/{loc}/{wid}', origin: 'https://backend.leadconnectorhq.com' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, rail: 'ai', state: deps.state });
      const notes = [];
      let traceId = args.messageId ?? null;
      let picked = null;

      if (!traceId) {
        if (!args.conversationId) {
          return fail(CODES.VALIDATION_FAILED, 'pass messageId (the inbound CRM message id, which is the traceId), or conversationId plus messageIndex or timestamp.');
        }
        const q = new URLSearchParams({ locationId: args.locationId, limit: '100' });
        const r = await gw.call('GET', `/agent-logs/logs/${encodeURIComponent(args.conversationId)}/interactions?${q}`);
        if (!r.ok) return fromHttp(r.status, r.json);
        const rows = recordsFrom(r.json, 'interactions');
        if (!rows.length) return fail(CODES.VALIDATION_FAILED, `session ${args.conversationId} has no interactions (or that id is not a session id — the spans route takes a message id, the summary route takes a session id).`);
        if (args.timestamp) {
          const want = Date.parse(args.timestamp.replace(' ', 'T'));
          picked = rows.slice().sort((a, b) => Math.abs(Date.parse(String(a.timestamp).replace(' ', 'T')) - want) - Math.abs(Date.parse(String(b.timestamp).replace(' ', 'T')) - want))[0];
        } else {
          const idx = args.messageIndex ?? 0;
          picked = idx < 0 ? rows[rows.length + idx] : rows[idx];
          if (!picked) return fail(CODES.VALIDATION_FAILED, `messageIndex ${idx} is out of range; this session has ${rows.length} interactions (0-based, negatives count from the end).`);
        }
        traceId = picked.traceId;
      }

      const sq = new URLSearchParams({ locationId: args.locationId });
      if (args.narrowToSession && args.conversationId) sq.set('conversationId', args.conversationId);
      const sp = await gw.call('GET', `/agent-logs/logs/${encodeURIComponent(traceId)}/spans?${sq}`);
      if (!sp.ok) {
        if (sp.status === 404) {
          return fail(CODES.VALIDATION_FAILED, `no spans for trace ${traceId}. This route takes the INBOUND MESSAGE id, not a session id — if you passed a session id, use get_agent_session, or pass it as conversationId with a messageIndex.`);
        }
        return fromHttp(sp.status, sp.json);
      }
      const spans = recordsFrom(sp.json, 'spans') ?? [];
      if (!spans.length) return fail(CODES.VALIDATION_FAILED, `trace ${traceId} returned no spans.`);
      if (args.narrowToSession) notes.push('narrowToSession:true — the ai_splitter span is dropped by the server when conversationId is sent. This reproduces the UI, not the full trace.');

      let branchNames = null;
      if (args.workflowId) {
        const wf = deps.makeGw({ loc: args.locationId, state: deps.state });
        const b = await wf.call('GET', `/workflow/${encodeURIComponent(args.locationId)}/${encodeURIComponent(args.workflowId)}`);
        if (b.ok) branchNames = agentLogBranchNames(b.json);
        else notes.push(`could not read workflow ${args.workflowId} to name branches (status ${b.status}); branch names are null.`);
      }

      const d = digestAgentSpans(spans, { includePrompt: args.includePrompt === true, branchNames });
      const out = {
        traceId,
        messageId: d.inbound?.messageId ?? traceId,
        crmConversationId: d.inbound?.conversationId ?? null,
        agentSessionId: args.conversationId ?? null,
        employeeMode: d.inbound?.employeeMode ?? null,
        interaction: picked ? { timestamp: picked.timestamp, userQuery: picked.userQuery, aiResponse: picked.aiResponse } : null,
        digest: { steps: d.steps, delivered: d.delivered, totals: d.totals },
        spokenButDiscarded: d.spoken.slice(0, -1),
        notes: [...d.notes, ...notes],
      };
      if (!args.includePrompt) out.promptNote = 'metadata.prompt is stripped; pass includePrompt:true for the full assembled prompt.';
      if (args.includeRawSpans) out.spans = spans;
      return ok(out);
    }, args),
  },
  {
    name: 'get_ai_response_details',
    description: describe(
      'get_ai_response_details',
      'The assembled prompt and conversation history behind one OUTBOUND AI message, plus its retrieved knowledge by type and its action logs. Complements get_agent_message_trace: that one is keyed by the human message and shows the decision path, this one is keyed by the AI message and shows what the model was given.',
    ),
    inputSchema: schema({
      locationId: z.string(),
      outboundMessageId: z.string(),
      includePrompt: z.boolean().default(false),
      includeHistory: z.boolean().default(true),
    }),
    capabilities: [{ method: 'GET', path: '/ai-employees/interactions/responseDetails' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, rail: 'ai', state: deps.state });
      // `source` is required (422 without it) and validated to bot_trial|workflow|conversation.
      // conversation and workflow return identical payloads for a flow bot; bot_trial keys a
      // different Mongo model entirely, so it is not interchangeable and is not exposed here.
      const q = new URLSearchParams({
        locationId: args.locationId, messageId: args.outboundMessageId, source: 'conversation',
      });
      const r = await gw.call('GET', `/ai-employees/interactions/responseDetails?${q}`);
      if (!r.ok) return fromHttp(r.status, r.json);
      const j = r.json ?? {};
      // This endpoint reports failure as 200 + a message string, not an HTTP error.
      if (typeof j.message === 'string' && /error while fetching/i.test(j.message)) {
        return fail(CODES.VALIDATION_FAILED, `no AI response details for message ${args.outboundMessageId}. This route is keyed by the OUTBOUND (AI) message id — an inbound/human message id returns nothing. Server said: ${j.message}`);
      }
      const out = {
        messageId: args.outboundMessageId,
        traceId: j.traceId ?? null,
        employeeId: j.employeeId ?? null,
        mode: j.mode ?? null,
        intent: j.intent ?? null,
        input: j.input ?? null,
        responseMessage: j.responseMessage ?? null,
        actionLogs: j.actionLogs ?? [],
        knowledge: {
          faqs: j.faqs ?? null, website: j.website ?? null,
          richText: j.richText ?? null, file: j.file ?? null, table: j.table ?? null,
        },
      };
      if (args.includeHistory !== false) out.history = j.history ?? [];
      if (args.includePrompt) out.prompt = j.prompt ?? null;
      else out.promptNote = 'prompt stripped; pass includePrompt:true for the full assembled prompt.';
      if (!j.prompt && !j.intent) out.note = 'No model ran for this message — a custom_message node sent fixed copy. Only actionLogs / history / mode / traceId are populated.';
      return ok(out);
    }, args),
  },
  {
    name: 'list_agent_contacts',
    description: describe(
      'list_agent_contacts',
      'The Agent Logs Contacts tab: one row per contact who has talked to an AI agent, with the products and channels they used, how many sessions, total tokens and last activity. Aggregates per contact — list_agent_sessions is per session. Read-only despite being a POST.',
    ),
    inputSchema: schema({
      locationId: z.string(),
      products: z.array(z.enum(AGENT_LOG_PRODUCTS)).optional(),
      contactName: z.string().optional(),
      channel: z.string().optional(),
      conversationId: z.string().optional(),
      search: z.string().optional(),
      timeRange: z.enum(AGENT_LOG_TIME_RANGES).optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      sortBy: z.enum(['lastActive', 'contactName']).default('lastActive'),
      sortOrder: z.enum(['asc', 'desc']).default('desc'),
      page: z.number().int().positive().default(1),
      limit: z.number().int().positive().max(1000).default(50),
    }),
    capabilities: [{ method: 'POST', path: '/agent-logs/contacts' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, rail: 'ai', state: deps.state });
      const limit = args.limit ?? 50;
      const page = args.page ?? 1;
      // This tab emits no cursor at all, so the offset ceiling is a hard wall here.
      if ((page - 1) * limit > AGENT_LOG_MAX_OFFSET) {
        return fail(CODES.VALIDATION_FAILED, `page ${page} at limit ${limit} exceeds the server's offset cap of ${AGENT_LOG_MAX_OFFSET}. Unlike the sessions table this endpoint returns no pageToken, so a larger limit is the only way deeper.`);
      }
      const body = { locationId: args.locationId, page, limit, sortBy: args.sortBy ?? 'lastActive', sortOrder: args.sortOrder ?? 'desc' };
      for (const k of ['products', 'contactName', 'channel', 'conversationId', 'search', 'timeRange', 'dateFrom', 'dateTo']) {
        if (args[k] !== undefined && args[k] !== '') body[k] = args[k];
      }
      const r = await gw.call('POST', '/agent-logs/contacts', body);
      if (!r.ok) return fromHttp(r.status, r.json);
      const meta = r.json?.meta ?? {};
      return ok({
        contacts: recordsFrom(r.json, 'data').map((c) => ({
          contactId: c.contactId ?? null, contactName: c.contactName ?? null,
          products: c.products ?? [], channels: c.channels ?? [],
          totalConversations: c.totalConversations ?? null, totalTokens: c.totalTokens ?? null,
          lastActivity: c.lastActivity ?? null,
        })),
        page, limit, totalRecords: meta.totalRecords ?? null, totalPages: meta.totalPages ?? null,
        filtersApplied: meta.filtersApplied ?? null,
        note: 'filtersApplied omits timeRange even when a time range is applied. This tab ignores the logs-only filters (contentSearch, metadataFilters, agentId, agentName, contactId).',
      });
    }, args),
  },
  {
    name: 'get_agent_metrics',
    description: describe(
      'get_agent_metrics',
      'The Agent Logs Metrics dashboard as data: token and latency totals, success/failure rates, top models, tools, agents and contacts, per-day time series, and the Voice AI call-outcome block. Account-wide aggregates, filterable by product, channel, agent or contact. Read-only despite being a POST.',
    ),
    inputSchema: schema({
      locationId: z.string(),
      products: z.array(z.enum(AGENT_LOG_PRODUCTS)).optional(),
      channel: z.string().optional(),
      agentName: z.string().optional(),
      contactName: z.string().optional(),
      timeRange: z.enum(AGENT_LOG_TIME_RANGES).optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      // Omit for the full set. Any non-empty value drops the two voice blocks.
      sections: z.array(z.string()).optional(),
    }),
    capabilities: [{ method: 'POST', path: '/agent-logs/metrics' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, rail: 'ai', state: deps.state });
      const body = { locationId: args.locationId, widgetIds: [] };
      for (const k of ['products', 'channel', 'agentName', 'contactName', 'timeRange', 'dateFrom', 'dateTo']) {
        if (args[k] !== undefined && args[k] !== '') body[k] = args[k];
      }
      const r = await gw.call('POST', '/agent-logs/metrics', body);
      if (!r.ok) return fromHttp(r.status, r.json);
      const { status: _s, traceId: _t, tokenDataVisible, ...rest } = r.json ?? {};
      // Drop the empty datasets rather than shipping 20 empty arrays: on an account with no
      // Voice AI every call block comes back [] or all-zero.
      const isEmpty = (v) => v == null || (Array.isArray(v) && v.length === 0);
      const data = {}; const empty = [];
      for (const [k, v] of Object.entries(rest)) {
        if (isEmpty(v)) empty.push(k); else data[k] = v;
      }
      const picked = args.sections?.length
        ? Object.fromEntries(Object.entries(data).filter(([k]) => args.sections.includes(k)))
        : data;
      return ok({
        metrics: picked,
        emptyDatasets: empty,
        availableSections: Object.keys(data),
        tokenDataVisible: tokenDataVisible !== false,
        note: 'Sections are filtered locally — the server\'s own widgetIds is not a whitelist (any non-empty value silently drops voiceAiCallStats and callSentimentStats), so this tool always requests the full set.',
      });
    }, args),
  },
  {
    name: 'get_account_workflow_overview',
    description: describe(
      'get_account_workflow_overview',
      'The Workflow Overview page as data: location-wide counts, weekly enrollment series, the Needs-Review list (workflows with failing steps) + error-email settings, and batched enrolled/finished totals for given workflowIds.',
    ),
    inputSchema: schema({
      locationId: z.string(),
      // Batched { total, finished } per workflow — from the list-page endpoints.
      workflowIds: z.array(z.string()).default([]),
      needsReviewLimit: z.number().int().positive().max(100).default(25),
    }),
    capabilities: [
      { method: 'GET', path: '/workflows/statistics' },
      { method: 'GET', path: '/workflows/logs/weekly-enrollment-data' },
      { method: 'GET', path: '/workflow/{loc}/error-notification/count' },
      { method: 'GET', path: '/workflow/{loc}/error-notification/list' },
      { method: 'GET', path: '/workflow/{loc}/error-notification/settings' },
      { method: 'GET', path: '/workflows/status/search/enroll-stats' },
      { method: 'GET', path: '/workflows/status/search/enroll-stats-cache' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const loc = encodeURIComponent(args.locationId);
      const lq = new URLSearchParams({ locationId: args.locationId });
      const [stats, weekly, count, list, settings] = await Promise.all([
        gw.call('GET', `/workflows/statistics?${lq}`),
        gw.call('GET', `/workflows/logs/weekly-enrollment-data?${lq}`),
        gw.call('GET', `/workflow/${loc}/error-notification/count`),
        gw.call('GET', `/workflow/${loc}/error-notification/list?${new URLSearchParams({ skip: '0', limit: String(args.needsReviewLimit ?? 25) })}`),
        gw.call('GET', `/workflow/${loc}/error-notification/settings`),
      ]);
      if (!stats.ok) return fromHttp(stats.status, stats.json);
      const { traceId: _t, ...statistics } = stats.json ?? {};
      const enrollment = [];
      const ids = Array.isArray(args.workflowIds) ? args.workflowIds.filter(Boolean) : [];
      for (let i = 0; i < ids.length; i += 20) {
        const chunk = ids.slice(i, i + 20);
        const q = new URLSearchParams({ locationId: args.locationId });
        for (const id of chunk) q.append('workflowIds[]', id);
        const [live, cache] = await Promise.all([
          gw.call('GET', `/workflows/status/search/enroll-stats?${q}`),
          gw.call('GET', `/workflows/status/search/enroll-stats-cache?${q}`),
        ]);
        const byId = new Map();
        for (const r of (cache.ok && Array.isArray(cache.json) ? cache.json : [])) byId.set(r.workflowId, { workflowId: r.workflowId, total: Number(r.total ?? 0), finished: Number(r.finished ?? 0), source: 'cache' });
        for (const r of (live.ok && Array.isArray(live.json) ? live.json : [])) byId.set(r.workflowId, { workflowId: r.workflowId, total: Number(r.total ?? 0), finished: Number(r.finished ?? 0), source: 'live' });
        for (const id of chunk) enrollment.push(byId.get(id) ?? { workflowId: id, total: null, finished: null, source: null });
      }
      return ok({
        statistics,
        weeklyEnrollment: weekly.ok ? (Array.isArray(weekly.json) ? weekly.json : recordsFrom(weekly.json, 'data')) : null,
        needsReview: {
          count: count.ok ? (typeof count.json === 'number' ? count.json : Number(count.json?.count ?? count.json ?? 0)) : null,
          totalCount: list.ok ? (list.json?.totalCount ?? null) : null,
          workflows: list.ok ? (list.json?.list ?? []).map((w) => ({ workflowId: w.workflowId, name: w.name ?? null, lastOccurred: w.lastOccurred ?? null })) : null,
          errorEmailSettings: settings.ok ? (settings.json ?? null) : null,
        },
        enrollment,
        note: 'Needs Review = workflows with a recent failing step (the list page\'s tab badge). errorEmailSettings.users are who GHL emails on failures; null = never configured. Clearing a flag is a DELETE on error-notification/{workflowId} — deliberately not exposed here.',
      });
    }, args),
  },
  {
    name: 'test_custom_code',
    description: describe(
      'test_custom_code',
      'Run a Custom Code step\'s code in GHL\'s sandbox with sample inputData (the builder\'s "Test code" button) and report output / console / errors — no workflow or contact is touched.',
    ),
    inputSchema: schema({
      locationId: z.string(),
      code: z.string(),
      language: z.enum(['javascript', 'python']).default('javascript'),
      // Sample values for the step's custom-input variables, keyed by variable name.
      inputData: z.record(z.unknown()).default({}),
    }),
    capabilities: [
      { method: 'POST', path: '/workflow/custom-code/run-test' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const r = await gw.call('POST', '/workflow/custom-code/run-test', {
        location_id: args.locationId,
        attributes: { language: args.language ?? 'javascript', code: args.code, inputData: args.inputData ?? {} },
      });
      if (!r.ok) return fromHttp(r.status, r.json);
      const j = r.json ?? {};
      const output = j.output;
      // The builder only accepts a NON-EMPTY OBJECT as a valid output: primitives are dropped
      // by the sandbox (no `output` key comes back) and `{}` would silently unblock save. Its
      // keys are what the step's output merge-tag picker ({{custom_code.N.<key>}}) offers.
      const outputValid = output !== null && typeof output === 'object' && !Array.isArray(output) && Object.keys(output).length > 0;
      return ok({
        passed: j.hasError !== true && outputValid,
        hasError: j.hasError === true,
        errorMessage: j.errorMessage ?? null,
        output: output ?? null,
        outputValid,
        outputKeys: outputValid ? Object.keys(output) : [],
        consoleLogs: j.consoleLogs ?? [], consoleWarnings: j.consoleWarnings ?? [], consoleErrors: j.consoleErrors ?? [],
        memoryUsage: j.memoryUsage ?? null, processTime: j.processTime ?? null,
        note: outputValid ? 'Store this output on the step (attributes.output) so downstream {{custom_code.N.<key>}} refs are pickable in the UI.' : 'Not a valid step output: assign a non-empty object to `output` (JS) / `output = {...}` (Python).',
      });
    }, args),
  },
  {
    name: 'list_account_entities',
    description: describe(
      'list_account_entities',
      'Sweep the account objects a workflow spec may name: pipelines (+stages), calendars, users, forms, '
      + 'custom fields (all models), AI agents, workflows, custom values, trigger links, membership offers '
      + '+ products, SMS/WhatsApp templates, email-builder templates, store products, coupons, phone numbers, '
      + 'funnels, Facebook pages, document templates, custom-object schemas, opportunity LOST REASONS '
      + 'and call DISPOSITIONS — the same entity kinds the build resolver uses. One row per kind in '
      + "engine/entities.mjs, so the list here cannot drift from what the sweep actually returns.",
    ),
    inputSchema: schema({ locationId: z.string() }),
    capabilities: [
      { method: 'GET', path: '/opportunities/pipelines' },
      { method: 'GET', path: '/calendars/' },
      { method: 'GET', path: '/users/' },
      { method: 'GET', path: '/forms/' },
      { method: 'GET', path: '/locations/{loc}/customFields/search' },
      { method: 'GET', path: '/locations/{loc}/customValues' },
      { method: 'GET', path: '/voice-ai/agents' },
      { method: 'GET', path: '/ai-employees/employees/search' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      return ok(await fetchEntities(gw));
    }, args),
  },
  {
    name: 'list_marketplace_apps',
    description: describe('list_marketplace_apps',
      'List the third-party marketplace apps INSTALLED in a sub-account, with each app\'s triggers and '
      + 'actions — key, version, templateId, and the full customVars / inputs schema — proof: live-runtime '
      + '(2026-08-16: the endpoint and its dual-credential rail were called against a real sub-account and '
      + 'returned the installed app with appId/publisher; the handler itself is unit-tested against a mocked '
      + 'gateway, not live-invoked); '
      + 'risk: read. The workflow builder renders its own Add-trigger and Add-action panels from these two '
      + 'reads, so the list is complete by construction ONLY when both GETs succeed; a failed leg reports '
      + '`complete:false` with that leg\'s data as null (never a silently empty list) and names which leg '
      + 'failed in `sources`, so a partial read can never be misread as "this app has none". Use it for '
      + 'account recon, to confirm an app is installed before building a workflow that references it, and to '
      + 'read the current version/templateId a marketplace step must bind to. compact:true (the default) '
      + 'returns identity plus keys and versions only — a single app\'s full schema is large.'),
    inputSchema: schema({
      locationId: z.string(),
      type: z.enum(['triggers', 'actions', 'both']).default('both'),
      appId: z.string().optional(),
      compact: z.boolean().default(true),
    }),
    capabilities: [
      { method: 'GET', path: '/marketplace/core/search/module' },
    ],
    handler: async (args, deps) => guard(async () => {
      const loc = encodeURIComponent(args.locationId);
      const want = args.type ?? 'both';
      // The module endpoint answers on the AI host with the dual credential rail (what this tool
      // uses) AND on backend with the plain location JWT (what the builder itself and
      // orchestrate.fetchMarketplace use — recovered WorkflowMarketplaceService.ts:377, live ledger).
      // Base is passed explicitly below so this handler never depends on the gateway's rail default.
      const gw = deps.makeGw({ loc: args.locationId, rail: 'ai', state: deps.state });
      // Each leg reports its own outcome rather than collapsing straight to rows, the same
      // convention get_ai_configuration_bundle uses for its three components: a leg that
      // was never asked for is 'skipped' (not a defect, does not touch `complete`); a leg
      // that was asked for and came back non-ok is 'failed' (does count against `complete`,
      // and MUST publish rows:null — coercing that to [] would read as "this account has no
      // triggers/actions", the exact false-empty sentence audit-configuration.mjs already
      // warns about). Only a leg that was actually read end to end is 'ok'.
      const page = async (type) => {
        if (want !== 'both' && want !== type) return { status: 'skipped', rows: null };
        const r = await gw.call('GET',
          `/marketplace/core/search/module?locationId=${loc}&type=${type}&isInstalled=true&skip=0&limit=200`,
          undefined, { base: AI_BASE });
        if (!r?.ok) return { status: 'failed', rows: null };
        return { status: 'ok', rows: Array.isArray(r.json) ? r.json : (r.json?.modules ?? r.json?.data ?? []) };
      };
      const actionsPage = await page('actions');
      const triggersPage = await page('triggers');
      if (actionsPage.status === 'failed' && triggersPage.status === 'failed') {
        return fail(CODES.VALIDATION_FAILED,
          'the marketplace module endpoint could not be read, so no app list was produced.',
          'Retry; if it persists, confirm the token file carries both the Bearer JWT and token-id.');
      }
      const sources = { actions: actionsPage.status, triggers: triggersPage.status };
      // 'skipped' is a caller choice (type:'triggers'/'actions'), not an outage — only a
      // 'failed' leg may falsify the "complete by construction" claim in the description.
      const complete = actionsPage.status !== 'failed' && triggersPage.status !== 'failed';
      const actions = actionsPage.rows;
      const triggers = triggersPage.rows;
      const apps = parseInstalledModules({ actions: actions ?? [], triggers: triggers ?? [] });

      // Re-walk the raw rows for the per-key schema — parseInstalledModules keeps identity
      // plus key lists, deliberately, so the index stays cheap for the compiler.
      const schemaFor = (rows, appId, field) => {
        // rows is null for a skipped or failed leg: there is no read to re-walk, and an app
        // that legitimately has zero entries for this field is indistinguishable from a leg
        // we never got to read, so this must stay null rather than default to [].
        if (rows === null) return null;
        const row = rows.find((a) => a.appId === appId);
        return (row?.[field] ?? []).map((item) => (args.compact === false
          ? { key: item.key, version: item.version, templateId: item.templateId,
              inputs: item.inputs ?? [], customVars: item.customVars ?? [],
              branchesConfig: item.branchesConfig ?? null, info: item.info ?? null }
          : { key: item.key, version: item.version }));
      };

      const out = [...apps.values()]
        .filter((a) => !args.appId || a.appId === args.appId)
        .map((a) => ({
          appId: a.appId, appName: a.appName, companyName: a.companyName,
          totalInstallations: a.totalInstallations, averageRating: a.averageRating,
          isInstalled: a.isInstalled,
          actions: schemaFor(actions, a.appId, 'actions'),
          triggers: schemaFor(triggers, a.appId, 'triggers'),
        }));

      return ok({
        locationId: args.locationId,
        complete,
        sources,
        appCount: out.length,
        apps: out,
        note: args.compact === false ? undefined
          : 'compact:true — keys and versions only. Pass compact:false for the full inputs/customVars schema.',
      });
    }, args),
  },
  {
    name: 'list_courses',
    description: describe('list_courses', 'List course summaries (proof: documented).'),
    inputSchema: schema({ locationId: z.string() }),
    capabilities: [
      { method: 'GET', path: '/membership/locations/{loc}/products?doNotIncludeOffers=true&sendCustomizations=true' },
      { method: 'GET', path: '/membership/locations/{loc}/categories?product_id={productId}&posts=true' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const api = new GhlMembershipsApi({ gw });
      const payload = await api.listProducts();
      const rows = recordsFrom(payload, 'products', 'data', 'rows');
      const courses = [];
      for (const row of rows) {
        const summary = summarizeCourse(row);
        if (summary.id && (summary.counts.chapters === null || summary.counts.lessons === null)) {
          const treeCounts = countCourseTree(await api.getTree(summary.id));
          summary.counts.chapters ??= treeCounts.chapters;
          summary.counts.lessons ??= treeCounts.lessons;
        }
        courses.push(summary);
      }
      return ok({
        count: courses.length,
        courses,
        note: 'Summary only; full course bodies are intentionally omitted.',
      });
    }, args),
  },
  {
    name: 'build_course',
    description: `${describe('build_course', 'Build and verify a GHL Memberships course (proof: documented).')} The proof label describes underlying engine routes; this MCP tool has not completed its human-gated live proof. Confirmation-gated: preview performs no account call. Only free offers are supported; paid offers return 500 without a payment provider. An embed is not a content_type: use lesson.embed, which creates a video post then persists embedJson via PUT. Local video/audio/material upload is exposed because this MCP is a local Node/stdio server; every media path must be absolute and the runtime needs filesystem access (ffprobe is optional).`,
    inputSchema: schema({
      locationId: z.string(),
      spec: z.object({}).passthrough(),
      confirm: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'POST', path: '/membership/locations/{loc}/products' },
      { method: 'POST', path: '/membership/locations/{loc}/categories' },
      { method: 'POST', path: '/membership/locations/{loc}/posts' },
      { method: 'PUT', path: '/membership/locations/{loc}/posts/{postId}' },
      { method: 'GET', path: '/membership/locations/{loc}/posts/{postId}' },
      { method: 'POST', path: '/assets-drm/assets/signed-url/upload' },
      { method: 'POST', path: '/assets-drm/assets' },
      { method: 'POST', path: '/membership/locations/{loc}/videos' },
      { method: 'POST', path: '/membership/locations/{loc}/media/signed-url' },
      { method: 'POST', path: '/membership/locations/{loc}/posts/material' },
      { method: 'POST', path: '/membership/locations/{loc}/offers' },
      { method: 'POST', path: '/membership/locations/{loc}/assessments/quiz' },
      { method: 'POST', path: '/membership/locations/{loc}/assessments/assignment' },
      { method: 'POST', path: '/courses/locations/{loc}/product-themes/{productId}/' },
      { method: 'GET', path: '/courses/locations/{loc}/product-themes/{productId}/theme/{themeId}' },
      { method: 'PUT', path: '/courses/locations/{loc}/product-themes/{productId}/theme/{themeId}' },
      { method: 'PUT', path: '/membership/locations/{loc}/products/apply-theme/{productId}?template_id={templateId}' },
      { method: 'POST', path: '/membership/smart-list/attach-offer-user' },
      { method: 'GET', path: '/membership/locations/{loc}/offers/{offerId}' },
      { method: 'PUT', path: '/membership/locations/{loc}/offers/{offerId}' },
      { method: 'GET', path: '/membership/locations/{loc}/products/user-progress/{productId}?pageLimit={pageLimit}&pageNumber={pageNumber}&email={email}' },
      { method: 'GET', path: '/membership/locations/{loc}/assessments/quiz/{postId}' },
      { method: 'GET', path: '/membership/locations/{loc}/assessments/quiz/questions/{quizId}' },
      { method: 'POST', path: '/membership/locations/{loc}/assessments/quiz/questions' },
      { method: 'GET', path: '/membership/locations/{loc}/assessments/assignment/{postId}' },
      { method: 'POST', path: '/certificates/locations/{loc}/templates' },
      { method: 'POST', path: '/membership/locations/{loc}/certificate-attachments' },
      { method: 'GET', path: '/membership/locations/{loc}/certificate-attachments/products/{productId}?skip={skip}&limit={limit}' },
    ],
    handler: async (args, deps) => guard(async () => {
      const courseSpec = { ...args.spec, locationId: args.locationId };
      const preview = previewCourseSpec(courseSpec, { requireAbsoluteMediaPaths: true });
      if (!preview.valid) {
        return withFailureData(
          fail(
            CODES.VALIDATION_FAILED,
            `Course spec invalid: ${preview.errors.join('; ')}`,
            'Correct the spec using skills/ghl-memberships/references/course-spec.md, then request a fresh preview.',
          ),
          { preview },
        );
      }
      if (args.confirm !== true) {
        return withFailureData(
          fail(
            CODES.CONFIRM_REQUIRED,
            'Course build preview is ready; no account call or write was made.',
            'Review data.preview, then repeat the same locationId and spec with confirm:true to build.',
          ),
          { preview },
        );
      }

      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const report = await buildCourse({
        gw,
        spec: courseSpec,
        requireAbsoluteMediaPaths: true,
      });
      const data = {
        preview,
        created: report.built,
        verification: report.verification,
        failurePhase: report.failurePhase,
        writeOutcomeAmbiguous: report.writeOutcomeAmbiguous,
        uiVerificationPath: `Memberships > Courses > Products > "${courseSpec.course.title}"`,
        cleanup: {
          productId: report.built.productId ?? null,
          offerId: report.built.offerId ?? null,
          credentialTemplateId: report.built.credentialTemplateId ?? null,
          note: 'Deleting the product does not cascade to its offer or credential template; remove those separately when cleaning up.',
        },
      };
      if (report.ok) return ok(data);

      const failure = report.error
        ? fromThrown(report.error)
        : fail(
            CODES.ENGINE_ABORT,
            report.failurePhase === 'verification'
              ? `Course objects were created but ${report.verification.problems} verification check(s) failed.`
              : `Course build stopped during ${report.failurePhase}.`,
            'Inspect the partial object ids and verification evidence before retrying.',
          );
      return withFailureData({
        ...failure,
        remediation: `URGENT: the course may be partially built. Inspect data.created and data.cleanup, remove unintended objects, and re-preview before retrying. ${failure.remediation ?? ''}`.trim(),
      }, data);
    }, args),
  },
  {
    name: 'build_workflow',
    description: describe('build_workflow', 'Build and verify a new workflow draft through the canonical dependency-aware orchestrator. This tool never publishes. A trigger POST that fails after retries is reported in data.triggerIntegrity and flips data.partial to true — the draft then has no working trigger for it.'),
    inputSchema: schema({
      locationId: z.string(),
      spec: z.object({}).passthrough(),
      ignoreUnresolved: z.boolean().default(false),
      // hatch for GHL's WORKFLOW-level rules (graph-rules.mjs): true, or the GHL rule names to skip
      skipWorkflowRules: z.union([z.boolean(), z.array(z.string())]).optional(),
      // Custom-code sandbox pre-flight (on by default): run each custom_code step in GHL's sandbox
      // and save the REAL output; strict → a failing run aborts the build instead of warning.
      strictCustomCode: z.boolean().default(false),
      skipCustomCodeTest: z.boolean().default(false),
      // With spec.sampleWebhookPayload: POST the sample to each inbound_webhook trigger's receiving
      // URL and pin it as the reference so {{inboundWebhookRequest.*}} tags are real.
      pinWebhookSample: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'GET', path: '/opportunities/pipelines' },
      { method: 'GET', path: '/calendars/' },
      { method: 'GET', path: '/users/' },
      { method: 'GET', path: '/forms/' },
      { method: 'GET', path: '/locations/{loc}/customFields/search' },
      { method: 'GET', path: '/locations/{loc}/customValues' },
      { method: 'GET', path: '/voice-ai/agents' },
      { method: 'GET', path: '/ai-employees/employees/search' },
      { method: 'POST', path: '/emails/builder' },
      { method: 'POST', path: '/emails/builder/data' },
      { method: 'GET', path: '/locations/{loc}/tags' },
      { method: 'POST', path: '/locations/{loc}/tags' },
      { method: 'POST', path: '/workflow/{loc}' },
      { method: 'PUT', path: '/workflow/{loc}/{wid}/auto-save' },
      { method: 'POST', path: '/workflow/{loc}/trigger' },
      { method: 'POST', path: '/workflow/custom-code/run-test' },
      { method: 'POST', path: '/hooks/{loc}/webhook-trigger/{triggerId}' },
      { method: 'GET', path: '/hooks/inbound-webhook-request/trigger/{triggerId}' },
      { method: 'PUT', path: '/hooks/inbound-webhook-request/set-as-reference/{requestId}' },
      { method: 'GET', path: '/hooks/inbound-webhook-request/reference/{triggerId}' },
      { method: 'GET', path: '/workflow/{loc}/{wid}' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const report = await orchestrate(args.spec, gw, {
        ignoreUnresolved: args.ignoreUnresolved ?? false,
        skipWorkflowRules: args.skipWorkflowRules,
        strictCustomCode: args.strictCustomCode === true,
        skipCustomCodeTest: args.skipCustomCodeTest === true,
        pinWebhookSample: args.pinWebhookSample === true,
      });
      const data = buildWorkflowData(report, args.locationId);
      if (!report.aborted) return ok(data);

      const unresolved = report.unresolved ?? [];
      const dependencyAbort = report.aborted.startsWith('Missing account dependencies:');
      const httpFailure = Number.isInteger(report.failureHttp?.status)
        ? fromHttp(report.failureHttp.status, report.failureHttp.body)
        : null;
      const code = httpFailure?.code
        ?? (dependencyAbort ? CODES.UNRESOLVED_DEPS : CODES.ENGINE_ABORT);
      const observedResources = [
        report.createdTags?.length ? `createdTags=${JSON.stringify(report.createdTags)}` : null,
        report.createdTemplates?.length ? `createdTemplates=${JSON.stringify(report.createdTemplates)}` : null,
        report.wid ? `workflowId=${report.wid}` : null,
      ].filter(Boolean).join(', ');
      const remediation = unresolved.length
        ? 'Create or rename the unresolved account dependencies, or retry with ignoreUnresolved only if the draft may safely retain unresolved references.'
        : observedResources
          ? `Inspect the partial resources in data (${observedResources}) and the builder URL when present. Clean up any unintended draft resources before retrying.`
          : 'Inspect data.failureHttp and the partial resource report, clean up any observed dependency resources, correct the upstream failure, then retry the draft build.';
      return {
        ...fail(
          code,
          httpFailure?.detail
            ?? `Engine aborted: ${report.aborted}. Unresolved dependencies: ${JSON.stringify(unresolved)}`,
          `${httpFailure?.remediation ?? ''} ${remediation}`.trim(),
        ),
        data,
      };
    }, args),
  },
  {
    name: 'edit_workflow',
    description: describe('edit_workflow', 'Preview or confirmation-gate edits to an existing workflow through the canonical edit engine. '
      + 'Confirmed step edits use only the plain workflow PUT and are round-trip verified. '
      + 'Guard hatches, each named by the guard that refuses: allowGotoLoops, deadBranchAcknowledged, allowFlowTriggerEdit, '
      + 'allowDanglingParentKeys, allowDanglingStepRefs, allowOverCap. '
      + 'OP KEYS ARE STRICT: an unknown key on any op refuses the whole call by name (a dropped key once re-sent the stored record and verified clean — R-96). '
      + 'Ops — steps: appendStep, insertAfter, insertBefore, appendToBranch (anchor: branchEntryId | '
      + 'containerId+branch | branchRef), deleteStep, modifyStep (attrPatch/stepPatch — never `attributes`, never `name`; re-normalised '
      + 'through the compiler), retypeStep (full attributes), renameStep, setStepDisabled, '
      + 'disableStepsByType, moveStep, addBranch (if/else, or an AI splitter: alias addSplitterBranch), deleteContainer, repairParentKeys, addStepNote, '
      + 'duplicateStep, replaceTag, replaceFieldId, replaceInAttributes; triggers: addTrigger, '
      + 'modifyTrigger {triggerId|name, trigger:{name?, filters? (author rows) | conditions? (stored rows, sent verbatim), active?, target?|targetActionId?}} — a top-level conditions/name/status is refused, not ignored; a patch that changes nothing is a NOOP, not a write; the verifier holds the store to what YOU asked for and to the server\'s own date_updated stamp; deleteTrigger, duplicateTrigger; '
      + 'settings: updateSettings (Settings-tab keys plus `name`); notes: addStickyNote, updateStickyNote. '
      + 'Names in steps and triggers resolve to ids against the account (ignoreUnresolved to bypass). '
      + 'Runs the same pre-write validation ladder as build_workflow: workflow + graph-context rules, '
      + "GHL's asset-reference validator (hatch: ignoreAssetErrors), the custom-code sandbox test on "
      + 'custom_code steps this edit touches (skipCustomCodeTest / strictCustomCode), account-readiness '
      + 'signals, and a builder-required-field check on the persisted document.'),
    inputSchema: schema({
      locationId: z.string(),
      workflowId: z.string(),
      ops: z.array(z.object({}).passthrough()),
      assumeAssociated: z.boolean().default(false),
      skipWorkflowRules: z.union([z.boolean(), z.array(z.string())]).optional(),
      // Hatch for editCommitBody's GOTO_LOOP guard (edit.mjs) — a legacy goto that jumps
      // backward to a step it can reach again. Without this the guard names a remedy
      // ("pass allowGotoLoops:true") that no caller could ever reach.
      allowGotoLoops: z.boolean().optional(),
      // The other three editCommitBody hatches (edit.mjs). Each guard NAMES its hatch as the
      // remedy, and a hatch the schema does not declare is refused as "unsupported fields" — so
      // DEAD_BRANCH, dangling parentKeys and dangling step refs were unhatchable from this tool
      // and the only way past them was the hand-rolled PUT that skips every guard (F5-12).
      deadBranchAcknowledged: z.boolean().optional(),
      allowDanglingParentKeys: z.boolean().optional(),
      allowDanglingStepRefs: z.boolean().optional(),
      // The FOURTH one, found the same way on 2026-09-11: guardFlowEntry (edit-driver.mjs) refuses
      // any op touching a conv_ai_trigger and names `ctx.allowFlowTriggerEdit` as the remedy — and
      // the schema did not declare it, so the remedy was unreachable and the error was a dead end.
      // The legitimate case is BINDING a trigger that has no botId yet (a flow built before its
      // agent existed, which is the order the flow-bot build REQUIRES); the dangerous case the
      // guard exists for is REBINDING one that already has an agent.
      allowFlowTriggerEdit: z.boolean().optional(),
      // Same opt-out build_workflow has: proceed with names that resolved to nothing. Rarely what
      // you want — a name on the wire moves nothing — but it is the caller's decision to make.
      ignoreUnresolved: z.boolean().default(false),
      // The build path's validate_assets hatch (orchestrate.mjs opts.ignoreAssetErrors): write the
      // edit even though GHL's own reference validator rejected an asset reference this edit touches.
      ignoreAssetErrors: z.boolean().default(false),
      // Measured field caps (field-caps.mjs) refuse an over-length value on a touched step; this
      // writes it anyway and keeps a FIELD_CAP warning.
      allowOverCap: z.boolean().default(false),
      // The build path's custom-code sandbox pre-flight switches, same names and defaults as
      // build_workflow: strict → a failing sandbox run refuses the edit instead of warning.
      strictCustomCode: z.boolean().default(false),
      skipCustomCodeTest: z.boolean().default(false),
      // Optimistic concurrency. The stale-read window is silent: the PUT carries the whole
      // templates array, so an edit authored against an old graph simply erases the newer one.
      expectedVersion: z.number().int().positive().optional(),
      acknowledgeDrift: z.boolean().optional(),
      confirm: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'GET', path: '/locations/{loc}/customFields/search' },
      { method: 'GET', path: '/locations/{loc}/customValues' },
      // The account entity sweep (the same fetchEntities list_account_entities runs) — read ONLY
      // when an op carries a NAME the resolver must turn into an id. The name kinds an edit op
      // can carry are listed here; the sweep itself fetches all 20 in one pass.
      { method: 'GET', path: '/opportunities/pipelines' },
      { method: 'GET', path: '/calendars/' },
      { method: 'GET', path: '/users/' },
      { method: 'GET', path: '/forms/' },
      { method: 'GET', path: '/workflow/{loc}/{wid}' },
      { method: 'GET', path: '/workflow/{loc}/trigger' },
      // Read ONLY when a deleteStep/deleteContainer op targets a PUBLISHED workflow: contacts
      // parked on a deleted step are ejected (backlog 23), so the preview counts them first.
      { method: 'GET', path: '/workflows/status/search/count-per-step' },
      // Read ONLY for a replaceFieldId op: both ids must resolve on THIS account (backlog 29).
      { method: 'GET', path: '/locations/{loc}/customFields/{id}' },
      // Marketplace index — read ONLY when an op carries marketplace:true.
      { method: 'GET', path: '/workflows-marketplace/location/{loc}/assets' },
      { method: 'GET', path: '/marketplace/core/search/module' },
      { method: 'GET', path: '/locations/{loc}/tags' },
      { method: 'POST', path: '/locations/{loc}/tags' },
      { method: 'PUT', path: '/workflow/{loc}/{wid}' },
      { method: 'POST', path: '/workflow/{loc}/trigger' },
      { method: 'PUT', path: '/workflow/{loc}/trigger/{tid}' },
      { method: 'DELETE', path: '/workflow/{loc}/trigger/{tid}' },
      // Sticky notes (addStickyNote / updateStickyNote ops) — a separate resource, not the document.
      { method: 'POST', path: '/workflows/sticky-note' },
      { method: 'PATCH', path: '/workflows/sticky-note' },
      // The build path's pre-write validators, ported to edit. Asset preflight is stateless
      // (payload in, verdict out — nothing written); the sandbox runs code without touching the
      // account; the readiness reads run ONLY when a touched step's channel needs them.
      { method: 'POST', path: '/workflow/{loc}/validate-assets' },
      { method: 'POST', path: '/workflow/custom-code/run-test' },
      { method: 'GET', path: '/phone-system/numbers' },
      { method: 'GET', path: '/phone-system/whatsapp/location/{loc}/phone-numbers' },
      { method: 'GET', path: '/workflow/{loc}/instagram/connected-accounts' },
      { method: 'GET', path: '/workflow/{loc}/email/location-email-provider' },
    ],
    handler: async (args, deps) => guard(async () => {
      if (!Array.isArray(args.ops) || args.ops.length === 0) {
        return fail(
          CODES.VALIDATION_FAILED,
          'edit_workflow requires at least one operation in ops',
          'Pass the ordered edit operations to preview, then repeat with confirm:true to write them.',
        );
      }

      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const locationPath = encodeURIComponent(args.locationId);
      const warnings = [];

      // This is best-effort in the canonical CLI too: custom fields improve compiler
      // classification, but an unavailable field index must not brick unrelated edits.
      const customFieldQuery = new URLSearchParams({
        parentId: '', skip: '0', limit: '10000', documentType: 'field', model: 'all',
        query: '', includeStandards: 'false',
      });
      let customFields;
      const customFieldResponse = await gw.call(
        'GET',
        `/locations/${locationPath}/customFields/search?${customFieldQuery}`,
      );
      const customFieldRecords = Array.isArray(customFieldResponse.json)
        ? customFieldResponse.json
        : customFieldResponse.json?.customFields;
      const hasValidCustomFieldList = customFieldResponse.ok
        && Array.isArray(customFieldRecords)
        && customFieldRecords.every((field) => (
          field !== null
          && typeof field === 'object'
          && !Array.isArray(field)
          && typeof (field.id ?? field._id) === 'string'
          && (field.id ?? field._id).trim().length > 0
        ));
      if (hasValidCustomFieldList) {
        customFields = customFieldRecords.map((field) => ({
          id: field.id ?? field._id,
          name: field.name,
          fieldKey: field.fieldKey,
          dataType: field.dataType,
          model: field.model,
        }));
      }

      // Custom VALUES, same best-effort contract as custom fields: they are the per-location half
      // of the {{custom_values.*}} merge-tag vocabulary (merge-tags.mjs); an unavailable list only
      // demotes that check to "unverifiable", it never blocks the edit.
      let customValues;
      const customValueResponse = await gw.call('GET', `/locations/${locationPath}/customValues`);
      const customValueRecords = Array.isArray(customValueResponse.json)
        ? customValueResponse.json
        : customValueResponse.json?.customValues;
      if (customValueResponse.ok && Array.isArray(customValueRecords)) {
        customValues = customValueRecords
          .filter((value) => value !== null && typeof value === 'object' && !Array.isArray(value))
          .map((value) => ({ id: value.id ?? value._id, name: value.name, fieldKey: value.fieldKey }));
      }

      const initialResponse = await getWorkflow(gw, args.locationId, args.workflowId);
      if (!initialResponse.ok) return fromHttp(initialResponse.status, initialResponse.json);
      const fresh = initialResponse.json;
      const beforeTemplates = fresh?.workflowData?.templates;
      if (!Array.isArray(beforeTemplates)) {
        return fail(
          CODES.ENGINE_ABORT,
          'workflow GET did not return workflowData.templates',
          'Confirm the workflow id and retry; no edit was written.',
        );
      }

      // VERSION GATE. An explicit expectedVersion is a hard refusal; a cached read that has since
      // been overtaken is a refusal the caller can acknowledge, the same hatch grammar as
      // deadBranchAcknowledged.
      const cache = readCache(deps.state);
      const lastRead = cache.read(args.locationId, args.workflowId);
      const driftOf = () => {
        if (!lastRead?.templates) return null;
        const d = diffTemplates(lastRead.templates, beforeTemplates);
        return {
          versions: [lastRead.version ?? null, fresh.version ?? null],
          readAt: lastRead.readAt ?? null,
          added: d.createdSteps,
          removed: d.deletedSteps,
          modified: d.modifiedSteps,
        };
      };
      if (args.expectedVersion !== undefined && fresh.version !== args.expectedVersion) {
        return withFailureData(fail(CODES.VERSION_CONFLICT,
          `workflow version is ${fresh.version}, not the expected ${args.expectedVersion} — it changed after you read it.`,
          'Re-read the workflow (get_workflow_digest / export_workflow), rebase your ops on the current '
          + 'version, then retry with the new expectedVersion.'), { driftSinceLastRead: driftOf() });
      }
      if (args.expectedVersion === undefined && lastRead?.version != null
          && fresh.version != null && lastRead.version < fresh.version && args.acknowledgeDrift !== true) {
        return withFailureData(fail(CODES.PREVIEW_STALE,
          `this project last read version ${lastRead.version}; the workflow is now at ${fresh.version}, `
          + 'so it changed after you looked.',
          'Re-read it, or pass acknowledgeDrift:true to edit the CURRENT graph anyway. '
          + 'data.driftSinceLastRead lists what moved.'), { driftSinceLastRead: driftOf() });
      }

      const idGen = boundEditIdGen(
        args.locationId,
        args.workflowId,
        fresh.version,
        args.ops,
        beforeTemplates.map((step) => step.id),
      );
      // The marketplace index, gated exactly the way orchestrate() gates it on the build
      // path: fetched ONLY when an op actually carries marketplace:true (walked over the
      // ops' step subgraphs, never string-scanned — see opsUseMarketplace). A native edit
      // therefore stays network-identical to what it was before this feature existed, and
      // still gets a real (empty) index, so an unresolvable key raises the engine's own
      // MARKETPLACE_KEY_UNKNOWN rather than a `.get is not a function` crash.
      const marketplaceRaw = opsUseMarketplace(args.ops)
        ? await fetchMarketplace((m, path, body) => gw.call(m, path, body), args.locationId)
        : { assets: null, modules: { actions: [], triggers: [] } };
      const marketplace = buildMarketplaceIndex(marketplaceRaw);
      const ctx = {
        loc: args.locationId,
        cid: undefined,
        uid: gw.uid,
        companyAge: 0,
        idGen,
        catalog: loadCatalog(),
        marketplace,
        ...(customFields !== undefined ? { customFields } : {}),
        ...(customValues !== undefined ? { customValues } : {}),
        warn: (message) => warnings.push(message),
      };
      // THE ACCOUNT RESOLVER, gated. resolveIR ran on the build path only, so an edit op naming a
      // pipeline, stage, user or calendar had nothing behind it — the name reached the wire
      // verbatim (F5-09) or was refused with no way to satisfy it. Fetching entities is 21 GETs,
      // so this runs ONLY when an op actually carries a name: a native edit stays
      // network-identical to what it was before this existed.
      let editOps = args.ops;
      if (opsNeedResolution(editOps)) {
        const entities = await fetchEntities({ call: (m, path, body) => gw.call(m, path, body), loc: args.locationId });
        const resolved = resolveOps(editOps, buildResolvers(entities), beforeTemplates);
        editOps = resolved.ops;
        if (resolved.unresolved.length && args.ignoreUnresolved !== true) {
          return fail(
            CODES.UNRESOLVED_DEPS,
            `${resolved.unresolved.length} name(s) in these ops matched nothing on this account: `
            + resolved.unresolved.map((u) => `${u.where} '${u.name}'`).join(', '),
            'Check the spelling against list_account_entities, or pass ignoreUnresolved:true to '
            + 'write the op anyway (a name on the wire moves nothing).',
          );
        }
        for (const u of resolved.unresolved) warnings.push(`UNRESOLVED (ignored): ${u.where} '${u.name}'`);
      }
      const { stepOps, triggerOps, settingsOps, stickyOps } = partitionOps(editOps);
      // THE CLONE TRAP (backlog 29, D-86). Field ids — STANDARD fields included — differ per
      // account: `contact.last_name` is one id on account A and another on account B, and both
      // resolve through GET /locations/{loc}/customFields/{id} (dataType STANDARD_FIELD). A
      // cloned objective can therefore carry a foreign id that "works" until the write is refused
      // inside the Conversation AI service, silently. So a replaceFieldId's NEW id must resolve on
      // THIS account before anything is written; the old one is reported for the record. Hatch:
      // ignoreUnresolved, the same switch the name resolver uses.
      for (const op of stepOps.filter((o) => o.op === 'replaceFieldId')) {
        const lookups = await Promise.all([op.newId, op.oldId].map(async (id) => {
          const r = await gw.call('GET', `/locations/${locationPath}/customFields/${encodeURIComponent(id)}`);
          const f = r?.json?.customField ?? r?.json;
          return { id, ok: r?.ok === true && f && typeof f === 'object', fieldKey: f?.fieldKey ?? null, dataType: f?.dataType ?? null };
        }));
        const [next, prev] = lookups;
        if (!next.ok && args.ignoreUnresolved !== true) {
          return fail(
            CODES.UNRESOLVED_DEPS,
            `replaceFieldId: the NEW id '${op.newId}' does not resolve on this account (GET /locations/{loc}/customFields/{id}). `
              + (prev.ok ? `The old id resolves to ${prev.fieldKey ?? prev.id} (${prev.dataType ?? '?'}). ` : '')
              + 'Field ids differ per account even for standard fields, so a cloned reference can look right and write nothing.',
            'Look the field up with list_account_entities or GET /locations/{loc}/customFields/search?model=all on THIS account and use its id, or pass ignoreUnresolved:true to write the foreign id anyway.',
          );
        }
        if (!next.ok) warnings.push(`UNRESOLVED (ignored): replaceFieldId newId '${op.newId}' does not resolve on this account`);
        else warnings.push(`replaceFieldId: '${op.oldId}'${prev.ok ? ` (${prev.fieldKey ?? '?'})` : ' (does not resolve here)'} → '${op.newId}' (${next.fieldKey ?? '?'}, ${next.dataType ?? '?'})`);
      }
      // Settings-tab keys (updateSettings ops) — merged over the stored document at commit.
      const settingsPatch = mergeSettingsOps(settingsOps);
      // Sticky notes — a SEPARATE resource (POST/PATCH /workflows/sticky-note); planned now so a bad
      // note fails the preview, written after the step commit and trigger writes.
      const stickyPlan = stickyOps.map((op) => planStickyNoteOp(op, { loc: args.locationId, wid: args.workflowId }));
      const { templates, diff } = applyOps(beforeTemplates, stepOps, { ctx, idGen });
      // PARKED CONTACTS ON A DELETED STEP ARE EJECTED (backlog 23, D-83): the run ends with
      // `step_was_deleted_by_user`, and an autonomous trigger does not re-fire for them in that
      // session. Counted BEFORE the confirm gate on a PUBLISHED workflow only (a draft has no
      // runs) — one GET, the same count-per-step read get_workflow_logs makes — so the preview
      // says who is about to be thrown out, by step, while the delete can still be reconsidered.
      let parkedOnDeletedSteps = [];
      if (fresh.status === 'published' && diff.deletedSteps?.length) {
        const counts = await safeGatewayCall(() => gw.call('GET',
          `/workflows/status/search/count-per-step?${new URLSearchParams({ workflowId: args.workflowId, locationId: args.locationId })}`));
        const rows = !counts.threw && counts.value?.ok ? (counts.value.json?.counts ?? counts.value.json ?? []) : null;
        if (!Array.isArray(rows)) {
          warnings.push('DELETE_PARKED_UNKNOWN: could not read contacts-per-step, so the number of contacts parked on the deleted step(s) is unknown; read get_contacts_at_step before confirming.');
        } else {
          const byStep = new Map(rows.map((r) => [r?.currentStepId ?? r?.stepId, Number(r?.total ?? r?.count ?? 0)]));
          parkedOnDeletedSteps = diff.deletedSteps
            .map((id) => ({ stepId: id, name: beforeTemplates.find((t) => t.id === id)?.name ?? id, parked: byStep.get(id) ?? 0 }))
            .filter((r) => r.parked > 0);
          for (const r of parkedOnDeletedSteps) {
            warnings.push(`DELETE_EJECTS_PARKED_CONTACTS: ${r.parked} contact(s) are parked on '${r.name}' (${r.stepId}); deleting it ends their run `
              + '(step_was_deleted_by_user) and an autonomous trigger will not re-fire for them in that session. Move them first '
              + '(fast_forward_contacts / get_contacts_at_step), or accept the ejection.');
          }
        }
      }
      // Trigger ops are planned AFTER the step ops land, so a trigger `target` resolves against
      // the POST-EDIT roster — it can point at a step this same call just created.
      ctx.externalRefs = externalRefsOf(templates);
      // triggers are needed for trigger ops AND for the trigger-aware workflow-level rules (an
      // action can be illegal purely because of the trigger above it) — but only when the
      // post-edit document holds a type those rules care about, so plain edits stay network-identical
      let existingTriggers = [];
      if (triggerOps.length || rulesNeedTriggers(templates, ctx.catalog?.workflowRules)) {
        const listed = await listWorkflowTriggers(gw, args.locationId, args.workflowId);
        if (!listed.response.ok) return fromHttp(listed.response.status, listed.response.json);
        existingTriggers = listed.triggers;
      }
      // The steps THIS edit wrote — created or modified. The ported build-path validators below
      // are scoped to this set: an untouched legacy step's debt is someone else's (the same
      // doctrine the intent lints already apply), and re-running GHL's sandbox over code the
      // caller never touched would silently rewrite outputs they did not ask to change.
      const editTouchedIds = new Set([...(diff.createdSteps ?? []), ...(diff.modifiedSteps ?? [])]);
      // The op-class gate the ported validators share with editSchemaViolations: only an op that
      // writes ATTRIBUTES can change what a step references, runs, or needs from the account.
      // A rename or a move still lands its step in diff.modifiedSteps, so gating on the touched
      // set alone would grow the pinned network shape for ops that cannot need these checks.
      const opsWriteAttributes = (args.ops ?? []).some((o) => ATTR_WRITING_OPS.has(o?.op));
      // Custom-code sandbox pre-flight — see customCodePreflight(). Runs before the commit body is
      // built so a passing run's REAL output is what the PUT carries.
      const customCode = await customCodePreflight({
        gw, loc: args.locationId, templates, touchedIds: editTouchedIds,
        strict: args.strictCustomCode, skip: !opsWriteAttributes || args.skipCustomCodeTest === true, warnings,
      });
      if (customCode.refusal) return customCode.refusal;
      const customCodeTests = customCode.tests;
      // Steps this edit ADDED were compiled through compile(), which already ran the
      // update_contact_field actionType advisory via ctx.warn. `modifyStep` merges an
      // attrPatch straight onto a stored step and never reaches the compiler, so the
      // modified set is linted here — scoped to it, so pre-existing steps the caller did
      // not touch stay out of the preview.
      lintContactFieldTemplates(templates, diff.modifiedSteps, ctx.warn);
      const commitBody = editCommitBody(fresh, templates, diff, gw.uid, {
        assumeAssociated: args.assumeAssociated === true,
        // Closes the modifyStep enforcement bypass: field rules run over the steps THIS edit
        // touched, at the same commit point as the parentKey and step-reference checks.
        catalog: ctx.catalog, warn: ctx.warn,
        settingsPatch,
        allowGotoLoops: args.allowGotoLoops === true,
        deadBranchAcknowledged: args.deadBranchAcknowledged === true,
        allowDanglingParentKeys: args.allowDanglingParentKeys === true,
        allowDanglingStepRefs: args.allowDanglingStepRefs === true,
      });
      // WORKFLOW-level rules (GHL's WorkflowValidator): graph-scoped + trigger-aware, evaluated on
      // the post-edit document with the live trigger set. Hatch: args.skipWorkflowRules.
      checkWorkflowRules({ templates, triggers: existingTriggers, settings: { senderAddress: commitBody.senderAddress ?? fresh.senderAddress }, publishing: fresh.status === 'published' },
        ctx.catalog?.workflowRules, { skipWorkflowRules: args.skipWorkflowRules, warn: ctx.warn });
      // Graph-CONTEXT rules (graph-context-rules.mjs): GHL validators that need the whole template
      // list — goto placement, math_operation's upstream reference. Same call the build path makes;
      // warning-severity in GHL, so it warns and never blocks. Whole-document on purpose: a deleted
      // upstream math step is exactly the class of break an edit introduces on a step it never touched.
      checkGraphContextRules(templates, { warn: ctx.warn });
      // GHL's OWN action schema — the marketplace assets catalog the builder validates against,
      // and the only layer that carries per-field rules like a character cap. The build path has
      // run it since v0.9.0; the edit path never did, which is how a 614-character prompt reached
      // a published workflow with a 200, a clean round-trip, and an error badge in the builder.
      // Round-trip cannot catch this by construction: it compares SENT against STORED, and the
      // server stores an over-cap value verbatim. Runs on the MUTATED templates, BEFORE the write,
      // so the confirm preview shows what a human would see on opening the builder.
      // Advisory and fail-open, matching the build path: an unreachable catalog must not become a
      // new way for a working edit to die.
      const schemaViolations = await editSchemaViolations(gw, locationPath, templates, existingTriggers, args.ops, marketplaceRaw.assets);
      // Every schema violation ALSO lands in the warnings channel: on the rails three silent caps
      // showed up only inside this block while the top-level result read ok (backlog 25).
      for (const v of schemaViolations) warnings.push(`SCHEMA: '${v.step ?? v.stepId}' (${v.type}): ${(v.messages ?? []).join('; ')}`);
      const caps = fieldCapGate({ templates, scope: editTouchedIds, allowOverCap: args.allowOverCap, warnings });
      if (caps.refusal) return caps.refusal;
      const triggerPlan = planTriggerOps(triggerOps, {
        ctx: { ...ctx, allowFlowTriggerEdit: args.allowFlowTriggerEdit === true },
        wid: args.workflowId,
        uid: gw.uid,
        existing: existingTriggers,
        // The target workflow's OWN status — addTrigger/duplicateTrigger need it to decide
        // what `status` a freshly-created trigger carries (measured 2026-08-28: `status`
        // follows the target workflow, not a hardcoded default — see edit-driver.mjs).
        workflowStatus: fresh.status,
      });
      for (const r of triggerPlan) {
        if (r.noop) warnings.push(`TRIGGER_NOOP: ${r.op} on ${r.triggerId} — ${r.reason}. If you expected a change, the value you sent equals what is stored; nothing will be written for this op.`);
      }

      // Asset pre-flight (validate_assets) + account readiness (G15) — see the shared helpers.
      // Gated on the same op class as the schema check: only an op that can introduce an asset
      // reference or a channel is worth the calls — the edit path's network shape is a pinned
      // contract. Trigger ops count because a planned trigger body can reference an asset.
      let assetPreflight = null;
      let readiness = [];
      if (opsWriteAttributes || triggerOps.length) {
        const assets = await assetPreflightFor({
          gw, loc: args.locationId, templates,
          triggers: [...existingTriggers, ...triggerPlan.map((request) => request.body).filter(Boolean)],
          companyId: fresh.companyId, touchedIds: editTouchedIds,
          ignoreAssetErrors: args.ignoreAssetErrors, warnings, ops: editOps,
        });
        if (assets.refusal) return assets.refusal;
        assetPreflight = assets.assetPreflight;
        readiness = await readinessFor({
          gw, loc: args.locationId, templates, touchedIds: editTouchedIds,
          triggerTypes: triggerPlan.map((request) => request.body?.type).filter(Boolean),
          settings: settingsPatch ?? {}, catalog: ctx.catalog, warnings,
        });
      }

      const neededTags = collectOpTags(args.ops);
      let tagsToCreate = [];
      if (neededTags.length) {
        const tagResponse = await gw.call('GET', `/locations/${locationPath}/tags`);
        if (!tagResponse.ok) return fromHttp(tagResponse.status, tagResponse.json);
        const existingNames = recordsFrom(tagResponse.json, 'tags').map((tag) => tag.name);
        tagsToCreate = missingTags(neededTags, existingNames);
      }
      const preview = editPreview(
        args.ops, beforeTemplates, templates, diff, triggerPlan, neededTags, tagsToCreate,
        fresh.status,
      );
      // Settings-tab changes (updateSettings ops): the exact values the commit body carries,
      // so a preview shows what the UI's Settings drawer would read back after the PUT.
      if (settingsPatch) {
        preview.settings = Object.fromEntries(Object.keys(settingsPatch)
          .map((k) => [k, k === 'statsView' ? (commitBody.meta?.statsView ?? false) : commitBody[k]]));
      }
      if (stickyPlan.length) preview.stickyNotes = stickyPlan.map(({ op, method, path, body }) => ({ op, method, path, color: body.color, chars: body.content?.length }));
      if (parkedOnDeletedSteps.length) preview.parkedOnDeletedSteps = parkedOnDeletedSteps;
      // The ported build-path pre-flight verdicts, visible while the edit can still be changed.
      if (assetPreflight) preview.assetPreflight = assetPreflight;
      if (customCodeTests.length) preview.customCodeTests = customCodeTests;
      if (readiness.length) preview.readiness = readiness;
      // Named in the preview so an over-cap prompt is visible while the edit can still be
      // changed, not discovered later as a badge in the builder.
      if (schemaViolations.length) {
        preview.schemaViolations = schemaViolations;
        preview.schemaViolationsNote = `GHL's own action schema would show "Resolve `
          + `${schemaViolations.length} Errors" on this document. These are not refused by the `
          + `server — it stores an over-cap or malformed value verbatim — so they will not stop `
          + `the write; the builder will show them to whoever opens the workflow.`;
      }

      if (args.confirm !== true) {
        return withFailureData(
          fail(
            CODES.CONFIRM_REQUIRED,
            'Edit preview is ready; no writes were sent.',
            'Review data.preview, then repeat the same request with confirm:true to commit.',
          ),
          { preview, warnings },
        );
      }

      const partialProgress = {
        writes: [],
        tags: { planned: tagsToCreate.length, created: [] },
        stepCommitted: false,
        triggerWrites: {
          planned: triggerPlan.filter((r) => !r.noop).length, applied: 0,
          noops: triggerPlan.filter((r) => r.noop).map(({ op, triggerId, reason }) => ({ op, triggerId, reason })),
        },
        stickyNotes: { planned: stickyPlan.length, applied: 0, ids: [] },
        verification: {
          attempted: false,
          completed: false,
          roundTrip: null,
          workflowStatus: null,
          triggers: {
            attempted: false,
            completed: false,
            roundTrip: null,
            checks: [],
          },
        },
      };
      const attemptWrite = async (phase, invoke) => {
        const outcome = {
          phase,
          attempted: true,
          acknowledged: false,
          ambiguous: false,
        };
        partialProgress.writes.push(outcome);
        const result = await safeGatewayCall(invoke);
        if (result.threw) outcome.ambiguous = true;
        else if (result.value?.ok) outcome.acknowledged = true;
        return { ...result, outcome };
      };
      const partialFailure = (failure, failurePhase, note, extraData = {}) => {
        partialProgress.failurePhase = failurePhase;
        return editWriteFailure(failure, {
          preview,
          createdTags: partialProgress.tags.created,
          triggerChangesApplied: partialProgress.triggerWrites.applied,
          warnings,
          partialProgress,
          note,
          ...extraData,
        });
      };

      for (const name of tagsToCreate) {
        const createdCall = await attemptWrite(
          'tag_create',
          () => gw.call('POST', `/locations/${locationPath}/tags`, { name }),
        );
        if (createdCall.threw || !createdCall.value.ok) {
          return partialFailure(
            createdCall.threw
              ? createdCall.failure
              : fromHttp(createdCall.value.status, createdCall.value.json),
            'tag_create',
            'Tag pre-creation was attempted; earlier tags in this request may already exist.',
          );
        }
        partialProgress.tags.created.push(name);
      }

      if (stepOps.length || settingsPatch) {
        const committedCall = await attemptWrite(
          'step_commit',
          () => gw.call(
            'PUT',
            workflowPath(args.locationId, args.workflowId),
            commitBody,
          ),
        );
        if (committedCall.threw || !committedCall.value.ok) {
          return partialFailure(
            committedCall.threw
              ? committedCall.failure
              : fromHttp(committedCall.value.status, committedCall.value.json),
            'step_commit',
            'The workflow PUT was attempted but not acknowledged; tag dependencies may already have been created.',
          );
        }
        partialProgress.stepCommitted = true;
      }

      const triggerExpectations = [];
      for (const request of triggerPlan) {
        // Planned as a NOOP by edit-driver.mjs: every requested value already matches the store.
        // Nothing is sent and nothing is verified — the preview and the warning already say so.
        if (request.noop) continue;
        const responseCall = await attemptWrite(
          'trigger_write',
          () => gw.call(request.method, request.path, request.body),
        );
        if (responseCall.threw || !responseCall.value.ok) {
          return partialFailure(
            responseCall.threw
              ? responseCall.failure
              : fromHttp(responseCall.value.status, responseCall.value.json),
            'trigger_write',
            'Earlier tag, step, or trigger writes may already be committed; inspect before retrying.',
          );
        }
        partialProgress.triggerWrites.applied++;
        triggerExpectations.push({ request, returnedId: returnedResourceId(responseCall.value) });
      }

      // Hoisted: the intent lint below reads the round-tripped trigger rows, which are otherwise
      // scoped to this block.
      let roundTripTriggers = [];
      if (triggerExpectations.length) {
        partialProgress.verification.triggers.attempted = true;
        const triggerRoundTripCall = await safeGatewayCall(
          () => listWorkflowTriggers(gw, args.locationId, args.workflowId),
        );
        if (triggerRoundTripCall.threw || !triggerRoundTripCall.value.response.ok) {
          return partialFailure(
            triggerRoundTripCall.threw
              ? triggerRoundTripCall.failure
              : fromHttp(
                triggerRoundTripCall.value.response.status,
                triggerRoundTripCall.value.response.json,
              ),
            'trigger_round_trip_get',
            'Trigger writes were acknowledged, but their persisted state could not be re-read.',
            { requiresPublish: false, publishInstruction: null },
          );
        }
        roundTripTriggers = triggerRoundTripCall.value.triggers ?? [];
        const triggerVerify = verifyTriggerRoundTrip(
          triggerExpectations,
          triggerRoundTripCall.value.triggers,
          existingTriggers,
        );
        partialProgress.verification.triggers.completed = true;
        partialProgress.verification.triggers.roundTrip = triggerVerify.roundTrip;
        partialProgress.verification.triggers.checks = triggerVerify.checks;
        if (!triggerVerify.roundTrip) {
          return partialFailure(
            fail(
              CODES.ENGINE_ABORT,
              'One or more acknowledged trigger writes did not persist on round-trip verification: the store disagrees with what the CALLER asked for, or the server\'s own date_updated stamp did not move after the 200.',
              'Read data.partialProgress.verification.triggers.checks[].mismatches (path, expected, actual; `requestedByCaller` marks a field you named; `date_updated` means the PUT changed nothing). Re-read the trigger with export_workflow before retrying — a retry of a PUT is safe, a retry of an add duplicates the trigger.',
            ),
            'trigger_round_trip_verify',
            'Trigger configuration is unverified, so this edit must not be published.',
            { requiresPublish: false, publishInstruction: null },
          );
        }
      }

      for (const request of stickyPlan) {
        const noteCall = await attemptWrite(
          'sticky_note_write',
          () => gw.call(request.method, request.path, request.body),
        );
        if (noteCall.threw || !noteCall.value.ok) {
          return partialFailure(
            noteCall.threw ? noteCall.failure : fromHttp(noteCall.value.status, noteCall.value.json),
            'sticky_note_write',
            'Step/trigger writes are already committed; only the sticky-note write failed. Re-run the remaining sticky-note ops alone.',
          );
        }
        partialProgress.stickyNotes.applied++;
        const id = noteCall.value.json?._id ?? noteCall.value.json?.id ?? null;
        if (id) partialProgress.stickyNotes.ids.push(id);
      }

      partialProgress.verification.attempted = true;
      const roundTripCall = await safeGatewayCall(
        () => getWorkflow(gw, args.locationId, args.workflowId),
      );
      if (roundTripCall.threw || !roundTripCall.value.ok) {
        return partialFailure(
          roundTripCall.threw
            ? roundTripCall.failure
            : fromHttp(roundTripCall.value.status, roundTripCall.value.json),
          'edit_round_trip_get',
          'One or more writes succeeded, but final graph verification could not be completed.',
        );
      }
      const roundTripResponse = roundTripCall.value;
      const gotTemplates = recordsFrom(roundTripResponse.json?.workflowData?.templates);
      // `templates` is the in-memory edit graph, which correctly keeps `next: null` on
      // terminals (edit.mjs's rootTail/scopeChain/inboundOf all key off that marker). Whether
      // the re-GET (`gotTemplates`) still carries that key depends on what actually reached
      // the wire: editCommitBody strips it (terminals.mjs) when a step PUT was sent, but a
      // trigger-only edit sends no step PUT at all, so the stored document — and this re-GET —
      // keeps whatever it already had. Comparing the raw graph against a STRIPPED store false-
      // flagged every terminal (ENGINE_ABORT on a write that fully succeeded); comparing the
      // unstripped graph against an UNTOUCHED-but-unstripped store works, but only by accident.
      // Stripping BOTH sides is correct either way: it makes the comparison blind to whether
      // this particular edit happened to touch the wire boundary at all.
      // The write succeeded, so what this agent last SAW is now the post-edit graph.
      readCache(deps.state).write(args.locationId, args.workflowId, {
        readAt: new Date().toISOString(),
        version: roundTripResponse.json?.version ?? null,
        updatedAt: roundTripResponse.json?.dateUpdated ?? null,
        fingerprint: fingerprintWorkflow(gotTemplates, roundTripTriggers),
        templates: gotTemplates,
        triggers: roundTripTriggers,
      });
      const verify = verifyEditRoundTrip(stripNullNext(templates), beforeTemplates, stripNullNext(gotTemplates));
      // INTENT, not echo. The round-trip above proves GHL kept the keys; it cannot see a stage
      // NAME, an empty row list or an off-menu operator, because GHL stores those verbatim and
      // echoes them back. Scoped to the steps THIS edit touched: an intent error on an untouched
      // legacy step is someone else's debt and must not fail this caller's edit, but an error on
      // a step this edit wrote is a live-but-wrong document, and reporting ok is how eight dead
      // stage moves shipped.
      const touchedIds = editTouchedIds;
      // The WHOLE persisted document, scoped to the touched steps for REPORTING: the path rule walks
      // parentKey up to the binder and needs every step to do it (D-85/D-89 false positive).
      const intentFindings = [
        ...lintOpportunityWrites(gotTemplates, { scope: touchedIds }),
        ...lintTriggerRows(roundTripTriggers, ctx.catalog),
      ];
      verify.intent = intentFindings;
      verify.missingRequired = persistedMissingRequired(gotTemplates, touchedIds, warnings);
      // The reference validator AGAIN, over what is now STORED — same gate as the pre-check, so
      // the network shape grows only where the pre-check already ran. A pre-write error that is
      // still here after the write is not a stale cache; it is the write not having landed.
      if (assetPreflight) {
        verify.assetPreflightAfter = await assetPostcheck({
          gw, loc: args.locationId, templates: gotTemplates, triggers: roundTripTriggers,
          companyId: fresh.companyId, touchedIds, warnings,
        });
      }
      const intentErrors = intentFindings.filter((f) => f.severity === 'error');
      partialProgress.verification.completed = true;
      partialProgress.verification.roundTrip = verify.roundTrip;
      partialProgress.verification.workflowStatus = roundTripResponse.json?.status ?? null;
      const requiresPublish = triggerPlan.some((request) => triggerRequiresPublish(request, fresh.status));
      const data = {
        workflowId: args.workflowId,
        status: roundTripResponse.json?.status,
        stepCount: { before: beforeTemplates.length, after: gotTemplates.length },
        idsAdded: preview.idsAdded,
        idsRemoved: preview.idsRemoved,
        diff,
        createdTags: partialProgress.tags.created,
        triggerChangesApplied: partialProgress.triggerWrites.applied,
        stickyNotesApplied: partialProgress.stickyNotes.applied,
        stickyNoteIds: partialProgress.stickyNotes.ids,
        requiresPublish,
        publishInstruction: triggerPublishInstruction(triggerPlan, fresh.status, { committed: true }),
        verify,
        // What the builder's own panel will say about the document this edit just wrote. Advisory
        // by construction: the server accepted every one of these, so they are the class a
        // round-trip can never see.
        schemaViolations,
        schemaHeadline: `Resolve ${schemaViolations.length} Errors`,
        // The other ported build-path pre-flight verdicts, carried on the committed result the
        // same way the build report carries them.
        assetPreflight,
        customCodeTests,
        readiness,
        warnings,
        partialProgress,
        builderUrl: `https://app.gohighlevel.com/v2/location/${encodeURIComponent(args.locationId)}/automation/workflow/${encodeURIComponent(args.workflowId)}`,
        runtimeProofNote: 'edit_workflow never publishes. After confirmed publish_workflow, only added_to_workflow in runtime logs proves that a trigger fired.',
      };

      if (!verify.roundTrip || intentErrors.length) {
        return editWriteFailure(
          fail(
            CODES.ENGINE_ABORT,
            intentErrors.length
              ? `The write persisted, but the stored document does not express the intent: `
                + intentErrors.map((f) => `${f.code} on '${f.name}' — ${f.msg}`).join('; ')
              : 'Workflow PUT returned but the edited graph did not round-trip cleanly.',
            'Inspect data.verify (including verify.intent) and the workflow canvas before making further edits.',
          ),
          data,
        );
      }
      return ok(data);
    }, args),
  },
  {
    // THE SANCTIONED REPLACEMENT FOR A HAND-ROLLED PUT (RC-A). When the ops cannot express a
    // change, the fallback was always "GET the workflow, edit the JSON, PUT it back" — which
    // skips every guard the edit path has: opportunity association, required fields, dangling
    // refs and parentKeys, goto loops, dead branches, workflow rules, merge tags. Eight client
    // workflows carried a dead stage NAME through exactly that route. This tool takes the same
    // whole document and runs all of it.
    name: 'repair_workflow',
    description: describe('repair_workflow',
      'Full-document REPAIR of workflowData.templates — proof: engine; risk: write. Runs every edit guard: opportunity association, '
      + 'required fields, dangling refs/parentKeys, goto loops, dead branches, workflow rules and merge '
      + 'tags — then the plain PUT and a round-trip verify. The sanctioned replacement for a hand-rolled '
      + 'PUT when the ops in edit_workflow cannot express the change; prefer edit_workflow when they can. '
      + 'Previews by default; confirm:true writes. expectedVersion refuses a stale read (VERSION_CONFLICT). '
      + 'Guard hatches: allowGotoLoops, deadBranchAcknowledged, allowDanglingParentKeys, allowDanglingStepRefs. '
      + 'Also runs the build path\'s pre-write ladder over the steps the repair changes: graph-context rules, '
      + "GHL's action schema and asset-reference validator (hatch: ignoreAssetErrors), the custom-code sandbox "
      + '(skipCustomCodeTest / strictCustomCode), account-readiness signals, and a builder-required-field + '
      + 'opportunity-intent check on the persisted document.'),
    inputSchema: schema({
      locationId: z.string(),
      workflowId: z.string(),
      // Either inline, or read from an ABSOLUTE path (an export_workflow writeTo file, a raw
      // workflow GET body, {templates}, or a bare array) — a finished flow bot is above what a
      // client passes inline (backlog 21).
      templates: z.array(z.object({}).passthrough()).optional(),
      // 🔴 templatesPath is not a convenience — for many workflows it is the ONLY path that works.
      // `authorization` (a custom_webhook attribute) is a credential-named key, and the argument
      // scanner refuses a credential-named key in a tool ARGUMENT whatever it holds, including the
      // {type:"NONE", data:null} object GHL actually stores there. A FILE is not a tool argument.
      // So any workflow containing a webhook step must be repaired through templatesPath.
      templatesPath: z.string().optional(),
      // The build path's hatches, same names and defaults as build_workflow / edit_workflow.
      ignoreAssetErrors: z.boolean().default(false),
      allowOverCap: z.boolean().default(false),
      strictCustomCode: z.boolean().default(false),
      skipCustomCodeTest: z.boolean().default(false),
      // Optimistic concurrency: a repair is written against a document the caller has already
      // read and edited, so a version that moved underneath means their edit was built on a
      // stale graph. Optional — omitted, the tool trusts the caller's read.
      expectedVersion: z.number().optional(),
      assumeAssociated: z.boolean().default(false),
      skipWorkflowRules: z.union([z.boolean(), z.array(z.string())]).optional(),
      allowGotoLoops: z.boolean().optional(),
      deadBranchAcknowledged: z.boolean().optional(),
      allowDanglingParentKeys: z.boolean().optional(),
      allowDanglingStepRefs: z.boolean().optional(),
      confirm: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'GET', path: '/workflow/{loc}/{wid}' },
      { method: 'GET', path: '/workflow/{loc}/trigger' },
      { method: 'GET', path: '/locations/{loc}/customFields/search' },
      { method: 'GET', path: '/locations/{loc}/customValues' },
      { method: 'PUT', path: '/workflow/{loc}/{wid}' },
      // The pre-write ladder (shared helpers above edit_workflow): the action-schema catalog, the
      // stateless asset validator, the sandbox, and the readiness reads — read ONLY when the
      // repair actually changes a step (a no-op document sends nothing new).
      { method: 'GET', path: '/workflows-marketplace/location/{loc}/assets' },
      { method: 'POST', path: '/workflow/{loc}/validate-assets' },
      { method: 'POST', path: '/workflow/custom-code/run-test' },
      { method: 'GET', path: '/phone-system/numbers' },
      { method: 'GET', path: '/phone-system/whatsapp/location/{loc}/phone-numbers' },
      { method: 'GET', path: '/workflow/{loc}/instagram/connected-accounts' },
      { method: 'GET', path: '/workflow/{loc}/email/location-email-provider' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const locationPath = encodeURIComponent(args.locationId);
      const warnings = [];
      const warn = (message) => warnings.push(message);

      if (args.templatesPath !== undefined) {
        if (Array.isArray(args.templates)) {
          return fail(CODES.VALIDATION_FAILED, 'pass either templates (inline) or templatesPath (a file) — not both.', 'Drop one of them.');
        }
        const read = readTemplatesFile(args.templatesPath);
        if (read.failure) return read.failure;
        args = { ...args, templates: read.templates };
      }
      if (!Array.isArray(args.templates) || !args.templates.length) {
        return fail(CODES.ENGINE_ABORT, 'templates must be a non-empty array of step objects.',
          'Pass the full workflowData.templates you want stored (inline, or via templatesPath). To empty a workflow, delete its steps with edit_workflow.');
      }
      // 🔴 A SCRUBBED EXPORT IS NOT A REPAIRABLE DOCUMENT, and the tool used to recommend exactly
      // that round trip: export_workflow --writeTo writes a SCRUBBED file, and this tool's own note
      // said "repair_workflow accepts this file as templatesPath".
      //
      // Measured 2026-09-10: GHL stores a custom_webhook's attributes.authorization as
      // {type:"NONE", data:null} — a structured object with no credential in it. The scrub replaces
      // it with the string "<redacted>" on the KEY NAME alone, without looking at the value. PUT
      // that back and a step whose authorization is genuinely configured has its auth replaced by a
      // seven-character placeholder. Full-document PUT, no validator on the far side, silent.
      //
      // So this refuses, and names the steps. A repair is for changing what you meant to change;
      // writing a redaction placeholder is never that.
      const redacted = [];
      const findRedacted = (v, t, path) => {
        if (v === REDACTED) { redacted.push({ step: t.name ?? t.id, type: t.type, at: path }); return; }
        if (Array.isArray(v)) return v.forEach((x, i) => findRedacted(x, t, `${path}[${i}]`));
        if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) findRedacted(x, t, `${path}.${k}`);
      };
      for (const t of args.templates) findRedacted(t.attributes, t, 'attributes');
      if (redacted.length) {
        return fail(CODES.ENGINE_ABORT,
          `${redacted.length} value(s) in this document are the redaction placeholder, not real values: `
          + `${redacted.slice(0, 4).map((r) => `'${r.step}' (${r.type}) ${r.at}`).join('; ')}`
          + `${redacted.length > 4 ? `, and ${redacted.length - 4} more` : ''}. Writing them back would `
          + 'REPLACE the stored value with the literal string "<redacted>".',
          'export_workflow scrubs on the KEY NAME without reading the value, so a webhook\'s '
          + 'authorization comes back redacted even when it holds {type:"NONE"} and no credential at '
          + 'all. Restore the real values on those paths before repairing — read the untouched '
          + 'document from the workflow\'s own fileUrl — or use edit_workflow, whose ops only touch '
          + 'the fields you name and leave the rest of the document alone.');
      }
      const badIds = args.templates.filter((t) => !t || typeof t !== 'object' || typeof t.id !== 'string' || !t.id);
      if (badIds.length) {
        return fail(CODES.ENGINE_ABORT, `${badIds.length} template(s) have no string 'id'.`,
          'Every step needs the id GHL stores it under; copy them from export_workflow rather than minting new ones.');
      }

      const initialResponse = await getWorkflow(gw, args.locationId, args.workflowId);
      if (!initialResponse.ok) return fromHttp(initialResponse.status, initialResponse.json);
      const fresh = initialResponse.json;
      const beforeTemplates = recordsFrom(fresh?.workflowData?.templates);
      if (!Array.isArray(beforeTemplates)) {
        return fail(CODES.ENGINE_ABORT, 'workflow GET did not return workflowData.templates',
          'Confirm the workflow id and retry; nothing was written.');
      }
      if (args.expectedVersion !== undefined && fresh.version !== args.expectedVersion) {
        return fail(CODES.VERSION_CONFLICT,
          `workflow version is ${fresh.version}, not the expected ${args.expectedVersion} — it changed after you read it.`,
          'Re-read the workflow, re-apply your change to the current graph, and retry.');
      }

      const diff = diffTemplates(beforeTemplates, args.templates);
      const catalog = loadCatalog();
      // The steps this repair changed. A whole document is being replaced, so there is no op
      // class to gate on — the diff IS the gate: an unchanged document sends nothing new, and a
      // renamed custom_code step is re-run (there is no way to tell a rename from a code change
      // here without the ops edit_workflow has).
      const touchedIds = new Set([...diff.createdSteps, ...diff.modifiedSteps]);
      const customCode = await customCodePreflight({
        gw, loc: args.locationId, templates: args.templates, touchedIds,
        strict: args.strictCustomCode, skip: args.skipCustomCodeTest === true, warnings,
      });
      if (customCode.refusal) return customCode.refusal;
      let commitBody;
      try {
        commitBody = editCommitBody(fresh, args.templates, diff, gw.uid, {
          assumeAssociated: args.assumeAssociated,
          allowGotoLoops: args.allowGotoLoops,
          deadBranchAcknowledged: args.deadBranchAcknowledged,
          allowDanglingParentKeys: args.allowDanglingParentKeys,
          allowDanglingStepRefs: args.allowDanglingStepRefs,
          catalog,
          warn,
        });
      } catch (error) {
        return fail(CODES.ENGINE_ABORT, `repair rejected (${error.code ?? 'ENGINE_ABORT'}): ${error.message}`,
          'The document was rejected before any request was sent — nothing was written.');
      }
      lintContactFieldTemplates(args.templates, [...diff.createdSteps, ...diff.modifiedSteps], { warn });

      // WORKFLOW-level rules (GHL's WorkflowValidator) — the description promised these since
      // the tool shipped, but only the commit guards actually ran until 0.48.0. Trigger-aware, so
      // the live trigger set is read when (and only when) the document holds a type the rules
      // care about. Hatch: skipWorkflowRules.
      let existingTriggers = [];
      if (rulesNeedTriggers(args.templates, catalog?.workflowRules)) {
        const listed = await listWorkflowTriggers(gw, args.locationId, args.workflowId);
        if (!listed.response.ok) return fromHttp(listed.response.status, listed.response.json);
        existingTriggers = listed.triggers;
      }
      try {
        checkWorkflowRules({ templates: args.templates, triggers: existingTriggers, settings: { senderAddress: fresh.senderAddress }, publishing: fresh.status === 'published' },
          catalog?.workflowRules, { skipWorkflowRules: args.skipWorkflowRules, warn });
      } catch (error) {
        return fail(CODES.ENGINE_ABORT, `repair rejected (${error.code ?? 'WORKFLOW_RULE'}): ${error.message}`,
          'The document was rejected before any request was sent — nothing was written.');
      }
      checkGraphContextRules(args.templates, { warn });
      // Measured field caps on the steps this repair changed (see fieldCapGate).
      const caps = fieldCapGate({ templates: args.templates, scope: touchedIds, allowOverCap: args.allowOverCap, warnings });
      if (caps.refusal) return caps.refusal;
      // The rest of the ladder, gated on the diff: an unchanged document sends nothing new.
      let schemaViolations = [];
      let assetPreflight = null;
      let readiness = [];
      if (touchedIds.size) {
        schemaViolations = await schemaViolationsFor(gw, locationPath, args.templates, existingTriggers, null);
        for (const v of schemaViolations) warnings.push(`SCHEMA: '${v.step ?? v.stepId}' (${v.type}): ${(v.messages ?? []).join('; ')}`);
        const assets = await assetPreflightFor({
          gw, loc: args.locationId, templates: args.templates, triggers: existingTriggers,
          companyId: fresh.companyId, touchedIds, ignoreAssetErrors: args.ignoreAssetErrors, warnings,
        });
        if (assets.refusal) return assets.refusal;
        assetPreflight = assets.assetPreflight;
        readiness = await readinessFor({ gw, loc: args.locationId, templates: args.templates, touchedIds, catalog, warnings });
      }

      const preview = {
        diff,
        stepCount: { before: beforeTemplates.length, after: args.templates.length },
        version: fresh.version,
        warnings,
        ...(assetPreflight ? { assetPreflight } : {}),
        ...(customCode.tests.length ? { customCodeTests: customCode.tests } : {}),
        ...(readiness.length ? { readiness } : {}),
      };
      if (schemaViolations.length) {
        preview.schemaViolations = schemaViolations;
        preview.schemaViolationsNote = `GHL's own action schema would show "Resolve `
          + `${schemaViolations.length} Errors" on this document. These are not refused by the `
          + `server — it stores an over-cap or malformed value verbatim — so they will not stop `
          + `the write; the builder will show them to whoever opens the workflow.`;
      }
      if (args.confirm !== true) {
        return withFailureData(fail(CODES.CONFIRM_REQUIRED,
          'Repair preview is ready; no write was made.',
          'Review data.preview.diff and data.preview.warnings, then repeat with confirm:true to write.'), { preview });
      }

      const putResponse = await gw.call('PUT', workflowPath(args.locationId, args.workflowId), commitBody);
      if (!putResponse.ok) return fromHttp(putResponse.status, putResponse.json);

      const roundTripResponse = await getWorkflow(gw, args.locationId, args.workflowId);
      if (!roundTripResponse.ok) {
        return withFailureData(fail(CODES.ENGINE_ABORT,
          'The repair PUT succeeded but the verification GET did not.',
          'Re-read the workflow and inspect the canvas before editing further.'), { preview });
      }
      const gotTemplates = recordsFrom(roundTripResponse.json?.workflowData?.templates);
      // Both sides stripped, for the reason edit_workflow's own call documents: the comparison
      // must not depend on whether this write happened to cross the terminal-stripping boundary.
      const verify = verifyEditRoundTrip(stripNullNext(args.templates), beforeTemplates, stripNullNext(gotTemplates));
      // INTENT, not echo — the exact class this tool exists for (F5-09: a stage NAME stored
      // verbatim and echoed back clean). Scoped to the steps this repair changed, same as
      // edit_workflow; an intent error on a step this write wrote is a live-but-wrong document.
      // Trigger rows are not linted here: a repair writes no triggers, so any finding there
      // would be legacy debt.
      verify.intent = lintOpportunityWrites(gotTemplates, { scope: touchedIds });
      verify.missingRequired = persistedMissingRequired(gotTemplates, touchedIds, warnings);
      // Post-write reference re-check, same gate as the pre-check (see edit_workflow).
      if (assetPreflight) {
        verify.assetPreflightAfter = await assetPostcheck({
          gw, loc: args.locationId, templates: gotTemplates, triggers: existingTriggers,
          companyId: fresh.companyId, touchedIds, warnings,
        });
      }
      const intentErrors = verify.intent.filter((f) => f.severity === 'error');
      const data = {
        workflowId: args.workflowId,
        status: roundTripResponse.json?.status,
        stepCount: { before: beforeTemplates.length, after: gotTemplates.length },
        diff,
        verify,
        schemaViolations,
        schemaHeadline: `Resolve ${schemaViolations.length} Errors`,
        assetPreflight,
        customCodeTests: customCode.tests,
        readiness,
        warnings,
        builderUrl: `https://app.gohighlevel.com/v2/location/${encodeURIComponent(args.locationId)}/automation/workflow/${encodeURIComponent(args.workflowId)}`,
        runtimeProofNote: 'repair_workflow never publishes. A clean round trip proves the document stored, not that anything fires.',
      };
      if (!verify.roundTrip || intentErrors.length) {
        return withFailureData(fail(CODES.ENGINE_ABORT,
          intentErrors.length
            ? `The write persisted, but the stored document does not express the intent: `
              + intentErrors.map((f) => `${f.code} on '${f.name}' — ${f.msg}`).join('; ')
            : 'Workflow PUT returned but the repaired graph did not round-trip cleanly.',
          'Inspect data.verify (including verify.intent) and the workflow canvas before making further edits.'), data);
      }
      return ok(data);
    }, args),
  },
  {
    // THE STAND-DOWN CALL. Built 2026-09-08 out of bl-056, and deliberately built BEFORE any
    // snapshot-push tool rather than alongside one.
    //
    // On 2026-09-08 a snapshot load put 26 workflows live on an account taking roughly 230
    // enrollments a week. Loaded workflows arrive PUBLISHED when the source is published; the
    // wizard does not warn and the push response does not mention it, so the first sign is
    // contacts moving. The remedy was a raw PUT that nobody had wrapped, which meant the fastest
    // path during an incident was also the least verified one.
    //
    // A push tool is the dangerous half of bl-056 and is NOT in this release. The brake ships
    // first: whoever ends up building the push can hand this back as the stand-down call, which
    // is what the finding asks for.
    name: 'unpublish_workflows',
    description: `${describe('unpublish_workflows', 'Stand published workflows back down to draft, in bulk — risk: write')}. `
      + 'Preview by default; confirm:true writes. Built for the minute after a snapshot load goes live: '
      + 'loaded workflows arrive PUBLISHED when the source was published, and nothing warns you. '
      + 'Sets status to draft, which stops new enrollments. What it does to contacts ALREADY in '
      + 'flight is unproven — do not assume they keep running, and do not assume they stop. '
      + '`updatedBy` is required by the API and is filled from the credential, not the caller. '
      + 'Reversible in STATUS, not in version: standing one down and republishing it mints a new '
      + 'version (6 -> 7 observed), which cannot be put back. '
      + 'Every id is read back individually afterwards, because the bulk response reports its own success '
      + 'count and that is not the same as the status having changed — and because a REFUSAL here still '
      + 'carries a full results envelope, so the shape of the body cannot tell you it worked.',
    inputSchema: schema({
      locationId: z.string(),
      workflowIds: z.array(z.string()).min(1).max(200),
      confirm: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'PUT', path: '/workflow/{loc}/change-status' },
      { method: 'GET', path: '/workflow/{loc}/{wid}' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const ids = [...new Set(args.workflowIds)];

      // Read first, so the preview says what is actually published rather than what was asked for.
      const before = [];
      for (const id of ids) {
        const r = await getWorkflow(gw, args.locationId, id);
        before.push({
          workflowId: id,
          found: r.ok,
          status: r.ok ? (r.json?.status ?? null) : null,
          name: r.ok ? (r.json?.name ?? null) : null,
        });
      }
      const published = before.filter((w) => w.status === 'published');
      const missing = before.filter((w) => !w.found);

      if (args.confirm !== true) {
        return withFailureData(
          fail(
            CODES.CONFIRM_REQUIRED,
            `Stand-down preview: ${published.length} of ${ids.length} are published; no write was sent.`,
            'Review data.preview, then repeat with confirm:true to set them to draft.',
          ),
          {
            preview: {
              wouldChange: published.map((w) => ({ workflowId: w.workflowId, name: w.name, from: 'published', to: 'draft' })),
              alreadyDraft: before.filter((w) => w.found && w.status !== 'published').map((w) => w.workflowId),
              notFound: missing.map((w) => w.workflowId),
              note: 'Draft stops NEW enrollments. What happens to contacts ALREADY in flight is UNPROVEN — do not assume either way.',
            },
          },
        );
      }
      if (published.length === 0) {
        return { ok: true, data: { locationId: args.locationId, changed: [], note: 'Nothing was published; no write sent.' } };
      }

      const targets = published.map((w) => w.workflowId);
      const r = await gw.call('PUT', `/workflow/${encodeURIComponent(args.locationId)}/change-status`, {
        status: 'draft',
        updatedBy: gw.uid,
        workflowIds: targets,
      });
      if (!r.ok) return fromHttp(r.status, r.json);

      // The bulk call answers "Processed N workflows: N successful". That is the service counting
      // its own work, not evidence the status moved — so every id is re-read.
      const after = [];
      for (const id of targets) {
        const v = await getWorkflow(gw, args.locationId, id);
        after.push({ workflowId: id, status: v.ok ? (v.json?.status ?? null) : null });
      }
      const stillLive = after.filter((w) => w.status === 'published').map((w) => w.workflowId);
      if (stillLive.length) {
        return withFailureData(
          fail(
            CODES.VERIFY_FAILED,
            `${stillLive.length} of ${targets.length} are STILL PUBLISHED after the write.`,
            'These are live and enrolling. Re-run, or stand them down in the UI now.',
          ),
          { stillPublished: stillLive, response: r.json ?? null },
        );
      }
      return { ok: true, data: {
        locationId: args.locationId,
        stoodDown: after.map((w) => w.workflowId),
        verified: true,
        notFound: missing.map((w) => w.workflowId),
        note: 'All verified draft by individual read-back. What happens to contacts ALREADY in flight is UNPROVEN.',
      } };
    }),
  },
  {
    name: 'publish_workflow',
    description: describe('publish_workflow', 'Preview or confirmation-gate a version-safe workflow publish using the full active trigger envelope. Publishing is round-trip verified, and any trigger still inactive after the publish PUT\'s own draft→published cascade gets a repair write (one per-trigger status PUT, verified by a fresh read-back) before failure is ever reported. Runtime firing still requires logs.'),
    inputSchema: schema({
      locationId: z.string(),
      workflowId: z.string(),
      confirm: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'GET', path: '/workflow/{loc}/{wid}' },
      { method: 'GET', path: '/workflow/{loc}/trigger' },
      { method: 'PUT', path: '/workflow/{loc}/{wid}' },
      // REPAIR (added 2026-08-28): one per-trigger status write for any trigger still
      // inactive after the document PUT's own cascade — see the handler's measurement note.
      { method: 'PUT', path: '/workflow/{loc}/trigger/{tid}' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const currentResponse = await getWorkflow(gw, args.locationId, args.workflowId);
      if (!currentResponse.ok) return fromHttp(currentResponse.status, currentResponse.json);
      const current = currentResponse.json;
      const listed = await listWorkflowTriggers(gw, args.locationId, args.workflowId);
      if (!listed.response.ok) return fromHttp(listed.response.status, listed.response.json);

      const preview = {
        current: { status: current?.status ?? null, version: current?.version ?? null },
        changes: {
          status: { from: current?.status ?? null, to: 'published' },
          triggers: {
            total: listed.triggers.length,
            willActivate: listed.triggers.filter((trigger) => trigger.active !== true).length,
          },
          strips: ['autoSaveSession', 'autoSaveSessionId'].filter((key) => key in (current ?? {})),
        },
      };

      if (args.confirm !== true) {
        return withFailureData(
          fail(
            CODES.CONFIRM_REQUIRED,
            'Publish preview is ready; no write was sent.',
            'Review data.preview, then repeat the request with confirm:true to publish.',
          ),
          { preview },
        );
      }

      const partialProgress = {
        writes: [],
        putAttempted: false,
        putApplied: false,
        putOutcome: null,
        verification: { attempted: false, completed: false },
        // REPAIR (added 2026-08-28 — see the measurement note below): tracks the per-trigger
        // status writes sent for any trigger that still reads inactive after the publish
        // PUT's own cascade. `attempted` stays false when the cascade already covered
        // everything — the common case — so this is easy to tell apart from "ran and fixed
        // nothing" (`stillInactive.length > 0` after `completed`).
        triggerRepair: { attempted: false, completed: false, planned: 0, applied: 0, stillInactive: [] },
      };
      let publishedWithVersion = null;
      const publishPartialFailure = (failure, failurePhase, note) => {
        partialProgress.failurePhase = failurePhase;
        const data = {
          preview,
          partialProgress,
          publishedWithVersion,
          note,
        };
        return partialProgress.writes.some(({ attempted }) => attempted)
          ? urgentPartialFailure(
            failure,
            data,
            partialProgress.verification.status === 'published',
          )
          : withFailureData(failure, data);
      };
      // `phase` defaults to 'publish_put' (the original, only caller before 2026-08-28) so
      // that call keeps updating putAttempted/putOutcome exactly as before; the repair PUTs
      // added the same day pass their own phase and land only in `writes`, never overwriting
      // the document PUT's own outcome slot.
      const attemptPublishWrite = async (invoke, phase = 'publish_put') => {
        const outcome = {
          phase,
          attempted: true,
          acknowledged: false,
          ambiguous: false,
        };
        partialProgress.writes.push(outcome);
        if (phase === 'publish_put') {
          partialProgress.putAttempted = true;
          partialProgress.putOutcome = outcome;
        }
        const result = await safeGatewayCall(invoke);
        if (result.threw) outcome.ambiguous = true;
        else if (result.value?.ok) outcome.acknowledged = true;
        return { ...result, outcome };
      };
      // Refresh trigger state first, then re-GET the workflow LAST so no account call
      // can make its optimistic-concurrency version stale before the PUT.
      const latestTriggersCall = await safeGatewayCall(
        () => listWorkflowTriggers(gw, args.locationId, args.workflowId),
      );
      if (latestTriggersCall.threw || !latestTriggersCall.value.response.ok) {
        return publishPartialFailure(
          latestTriggersCall.threw
            ? latestTriggersCall.failure
            : fromHttp(latestTriggersCall.value.response.status, latestTriggersCall.value.response.json),
          'publish_preflight_triggers',
          'No write was attempted because the latest trigger envelope could not be read.',
        );
      }
      const latestTriggers = latestTriggersCall.value;

      // NO PER-TRIGGER ACTIVATION WRITE *BEFORE* THE DOCUMENT PUT. The document PUT's own
      // trigger-diff fields (oldTriggers/newTriggers) do not persist trigger CONTENT — the
      // working rail for content is the separate per-trigger PUT
      // /workflow/{loc}/trigger/{triggerId} (modifyTrigger, see edit-driver.mjs). Activation
      // works differently: the document PUT's own draft→published transition activates every
      // trigger as a side effect, sub-second, regardless of anything in its body — not the
      // oldTriggers/newTriggers field. A per-trigger PUT carrying `active` does nothing in
      // either direction (silently accepted, ignored); only `status` governs it (`active` is
      // a read-only projection: `active === (status !== "draft")`). Sending
      // `status:"published"` on that same per-trigger PUT DOES activate a trigger already on
      // a published workflow, verified by read-back.
      //
      // What flips `active` in the COMMON case is still the document PUT below, by virtue of
      // its own draft→published cascade — not any field in ITS body. Nothing is sent
      // per-trigger before it, and nothing in this preflight section changes. What DOES exist
      // is a REPAIR, sent AFTER the document PUT and its round-trip re-list, for any trigger
      // the cascade did not reach — see below, after `checkedTriggers` is computed. The
      // round-trip verification itself is mandatory either way: re-listing triggers and
      // failing loudly on any still inactive (now: still inactive AFTER the repair) remains
      // the only thing in this handler that tells the truth about activation.
      const freshCall = await safeGatewayCall(
        () => getWorkflow(gw, args.locationId, args.workflowId),
      );
      if (freshCall.threw || !freshCall.value.ok) {
        return publishPartialFailure(
          freshCall.threw
            ? freshCall.failure
            : fromHttp(freshCall.value.status, freshCall.value.json),
          'publish_preflight_workflow_get',
          'No write was attempted because the version-bearing workflow refresh failed.',
        );
      }
      const freshResponse = freshCall.value;
      const publishable = { ...freshResponse.json };
      delete publishable.autoSaveSession;
      delete publishable.autoSaveSessionId;
      // publish echoes the stored document back as a PUT, so it inherits every stored
      // `next: null` AND every stored add_to_workflow step still missing
      // `input_trigger_params` — including ones written before this fix, and ones written by
      // the builder's own older versions. Normalise before the wire or the publish 400s on a
      // step nobody touched. Same composition as editCommitBody (edit.mjs). See terminals.mjs.
      if (Array.isArray(publishable.workflowData?.templates)) {
        publishable.workflowData = {
          ...publishable.workflowData,
          templates: fillInputTriggerParams(stripNullNext(publishable.workflowData.templates)),
        };
      }
      // ECHO, not a write: this is the unchanged roster the builder always sends on publish —
      // the roster exactly as it was READ above. It carries whatever `active` those triggers
      // currently show (often false); that is fine and expected, because `active` is not a
      // field this PUT's body controls at all (see the measurement note above the preflight
      // GET). The document PUT flips `active` by virtue of the publish transition itself, not
      // by anything in oldTriggers/newTriggers — a full-document PUT's trigger fields are
      // proven inert for changing content, so this must never be mistaken for the mechanism.
      const triggerRosterEcho = latestTriggers.triggers;
      const body = {
        ...publishable,
        status: 'published',
        version: freshResponse.json.version,
        triggersChanged: false,
        oldTriggers: triggerRosterEcho,
        newTriggers: triggerRosterEcho,
        createdSteps: [],
        modifiedSteps: [],
        deletedSteps: [],
      };
      publishedWithVersion = body.version;
      const publishedCall = await attemptPublishWrite(
        () => gw.call(
          'PUT',
          workflowPath(args.locationId, args.workflowId),
          body,
        ),
      );
      if (publishedCall.threw || !publishedCall.value.ok) {
        return publishPartialFailure(
          publishedCall.threw
            ? publishedCall.failure
            : fromHttp(publishedCall.value.status, publishedCall.value.json),
          'publish_put',
          'The publish PUT was attempted but not acknowledged; its outcome may be ambiguous.',
        );
      }
      partialProgress.putApplied = true;

      partialProgress.verification.attempted = true;
      const checkCall = await safeGatewayCall(
        () => getWorkflow(gw, args.locationId, args.workflowId),
      );
      if (checkCall.threw || !checkCall.value.ok) {
        return publishPartialFailure(
          checkCall.threw
            ? checkCall.failure
            : fromHttp(checkCall.value.status, checkCall.value.json),
          'publish_verify_workflow_get',
          'The publish PUT was acknowledged, but its resulting workflow status could not be read.',
        );
      }
      const checkResponse = checkCall.value;
      partialProgress.verification.status = checkResponse.json?.status ?? null;
      const checkedTriggersCall = await safeGatewayCall(
        () => listWorkflowTriggers(gw, args.locationId, args.workflowId),
      );
      if (checkedTriggersCall.threw || !checkedTriggersCall.value.response.ok) {
        return publishPartialFailure(
          checkedTriggersCall.threw
            ? checkedTriggersCall.failure
            : fromHttp(checkedTriggersCall.value.response.status, checkedTriggersCall.value.response.json),
          'publish_verify_triggers',
          'The publish PUT was acknowledged, but resulting trigger state could not be read.',
        );
      }
      let checkedTriggers = checkedTriggersCall.value;
      let inactiveTriggers = checkedTriggers.triggers
        .filter((trigger) => trigger.active !== true)
        .map((trigger) => trigger.name ?? trigger.id ?? trigger._id);

      // REPAIR — measured 2026-08-28 (see the "NO PER-TRIGGER ACTIVATION WRITE HERE" note
      // above): a trigger's `active` is a read-only projection of its own `status` field, and
      // a per-trigger PUT carrying `status:'published'` DOES activate one the publish PUT's
      // own cascade did not reach. Send exactly one such PUT per trigger still reading
      // inactive here — the FULL record, not a patch — then re-list and let THAT read-back
      // decide; a bogus/ignored `status` is silently accepted (200, unchanged), so the write's
      // own 200 is never trusted. Only a trigger still inactive after this repair fails loudly.
      if (checkResponse.json?.status === 'published' && inactiveTriggers.length) {
        const toRepair = checkedTriggers.triggers.filter((trigger) => trigger.active !== true);
        partialProgress.triggerRepair.attempted = true;
        partialProgress.triggerRepair.planned = toRepair.length;
        for (const trigger of toRepair) {
          const tid = triggerIdOf(trigger);
          const repairCall = await attemptPublishWrite(
            () => gw.call('PUT', `/workflow/${encodeURIComponent(args.locationId)}/trigger/${encodeURIComponent(tid)}`, { ...trigger, status: 'published' }),
            'trigger_repair_put',
          );
          if (repairCall.threw || !repairCall.value.ok) {
            return publishPartialFailure(
              repairCall.threw
                ? repairCall.failure
                : fromHttp(repairCall.value.status, repairCall.value.json),
              'trigger_repair_put',
              'The publish PUT was acknowledged, but a repair write for a still-inactive trigger failed.',
            );
          }
          partialProgress.triggerRepair.applied++;
        }
        const repairVerifyCall = await safeGatewayCall(
          () => listWorkflowTriggers(gw, args.locationId, args.workflowId),
        );
        if (repairVerifyCall.threw || !repairVerifyCall.value.response.ok) {
          return publishPartialFailure(
            repairVerifyCall.threw
              ? repairVerifyCall.failure
              : fromHttp(repairVerifyCall.value.response.status, repairVerifyCall.value.response.json),
            'trigger_repair_verify_get',
            'Repair writes were attempted, but resulting trigger state could not be re-read.',
          );
        }
        checkedTriggers = repairVerifyCall.value;
        inactiveTriggers = checkedTriggers.triggers
          .filter((trigger) => trigger.active !== true)
          .map((trigger) => trigger.name ?? trigger.id ?? trigger._id);
        partialProgress.triggerRepair.completed = true;
        partialProgress.triggerRepair.stillInactive = inactiveTriggers;
      }

      const verify = {
        roundTrip: checkResponse.json?.status === 'published' && inactiveTriggers.length === 0,
        status: checkResponse.json?.status ?? null,
        version: checkResponse.json?.version ?? null,
        activeTriggers: checkedTriggers.triggers.length - inactiveTriggers.length,
        totalTriggers: checkedTriggers.triggers.length,
        inactiveTriggers,
      };
      partialProgress.verification.completed = true;
      partialProgress.verification.roundTrip = verify.roundTrip;
      partialProgress.verification.inactiveTriggers = inactiveTriggers;
      const data = {
        workflowId: args.workflowId,
        previous: preview.current,
        publishedWithVersion: body.version,
        verify,
        partialProgress,
        builderUrl: `https://app.gohighlevel.com/v2/location/${encodeURIComponent(args.locationId)}/automation/workflow/${encodeURIComponent(args.workflowId)}`,
        runtimeProofNote: 'active: true and a clean round trip are not proof that a trigger fires; only added_to_workflow in runtime logs proves firing.',
      };
      if (!verify.roundTrip) {
        partialProgress.failurePhase = 'publish_verify_state';
        return urgentPartialFailure(
          fail(
            CODES.ENGINE_ABORT,
            'Publish PUT returned but the workflow did not round-trip as published with every trigger active.',
            'Inspect the workflow and runtime logs before relying on it.',
          ),
          data,
          verify.status === 'published',
        );
      }
      return ok(data);
    }, args),
  },
  // ---------------------------------------------------------------------------
  // Workflow ORGANISATION: folders, duplication, filing.
  //
  // Every route below was recovered from the workflows-list bundle
  // (`sniffs/bundle/recovered-source/src/services/WorkflowService.ts` in the research
  // corpus) and then verified LIVE 2026-08-18 against a real sub-account, including the
  // negative cases. Two facts that the source alone would not have settled, and which the
  // shape of these tools depends on:
  //
  //   - Folders are `type: 'directory'` — NOT 'folder'. `?type=folder` returns count 0, not
  //     an error, which reads exactly like "this account has no folders" if you don't check
  //     the type.
  //   - The BULK move (`PUT /move`) cannot move anything to root: parentId null, '' and
  //     the sentinel 'root' all 404 "Parent directory not found". Only the SINGLE-item
  //     `PUT /move-directory/{id}` accepts `parentId: null`. move_workflows therefore uses
  //     one batch call to file INTO a folder and fans out per id to move OUT to root.
  //
  // `company_id` / `company_age` are accepted but NOT required on either write (verified
  // by omitting both: the server fills them from the location and the created record comes
  // back carrying the right values), so no tool here makes a caller supply them and none
  // Two catalog tools. Neither touches an account — no gateway, no auth, no location. They
  // exist so a builder can see the REAL field set for a step or trigger type instead of
  // mirroring a single captured example, which teaches one value of every discriminator.
  {
    name: 'search_step_types',
    description: `${describe('search_step_types', 'Search workflow step and trigger types — risk: read')}. `
      + 'Ranked search over all 284 documented GHL workflow step and trigger types. Returns compact '
      + 'STUBS — type, family, one-line summary, field count. Call describe_step_type on the ONE type '
      + 'you pick to get its field table. Do not build a step from a stub, and do not copy a captured '
      + 'example without checking the card: an example pins one value of every discriminator field. '
      + 'Reads no account data.',
    inputSchema: schema({
      intent: z.string().describe('what the step should DO, in plain words — e.g. "send an sms", "wait until a date", "update a contact field"'),
      family: z.enum(['steps', 'triggers', 'steps-marketplace', 'triggers-marketplace']).optional(),
      limit: z.number().default(10),
    }),
    capabilities: [],
    handler: async (args) => guard(async () => {
      const terms = cardWords(args.intent);
      let pool = typeCards();
      if (args.family) pool = pool.filter(c => c.family === args.family);
      const ranked = pool
        .map(c => ({ c, score: scoreCard(c, terms) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score
          || a.c.type.length - b.c.type.length          // the plainer slug is usually the one meant
          || a.c.type.localeCompare(b.c.type))
        .slice(0, args.limit ?? 10);
      if (!ranked.length) {
        return {
          ok: true,
          data: { results: [], total: 0,
            note: `No type matched "${args.intent}". Try the action in GHL's own words (the UI label), or drop the family filter. `
                + `${pool.length} types are documented${args.family ? ` in ${args.family}` : ''}.` },
        };
      }
      return {
        ok: true,
        data: {
          results: ranked.map(x => cardStub(x.c)),
          total: pool.filter(c => scoreCard(c, terms) > 0).length,
          next: 'describe_step_type with the type you want — the stub is not enough to build from',
        },
      };
    }),
  },
  {
    name: 'describe_step_type',
    description: `${describe('describe_step_type', 'Describe one workflow step or trigger type — risk: read')}. `
      + 'The full card for ONE step or trigger type: every field with its type, whether it is required, '
      + 'its default, and the notes that matter (discriminators, validator rules, stored-as-string traps). '
      + 'Also carries filter rows for triggers, custom variables the type exposes downstream, and the '
      + 'validator name. This is the union of valid values — a captured example is one sample of it. '
      + 'Reads no account data.',
    inputSchema: schema({
      type: z.string().describe('the exact type slug, e.g. "chatgpt", "send_sms", "contact_changed"'),
    }),
    capabilities: [],
    handler: async (args) => guard(async () => {
      const cards = typeCards();
      const card = cards.find(c => c.type === args.type)
        ?? cards.find(c => c.type.toLowerCase() === String(args.type).toLowerCase());
      if (!card) {
        const near = cards.filter(c => c.type.includes(String(args.type).toLowerCase())).slice(0, 5).map(c => c.type);
        return {
          ok: false, code: 'UNKNOWN_TYPE',
          detail: `No card for type "${args.type}".`,
          remediation: near.length ? `Did you mean: ${near.join(', ')}?` : 'Use search_step_types to find the right slug.',
        };
      }
      // MEASURED character caps ride on the card (field-caps.mjs). The catalog's own field rows do
      // not carry them — only the builder's live action schema does — and four of them were crossed
      // silently in one week on the rails (backlog 25). edit_workflow/repair_workflow refuse an
      // over-cap value on a touched step (hatch: allowOverCap).
      const caps = FIELD_CAPS[card.type];
      return { ok: true, data: caps
        ? { ...card, caps, capsNote: 'Character caps measured live (the server stores an over-length value verbatim; the builder flags it). edit_workflow and repair_workflow refuse an over-cap value on a step they touch unless allowOverCap:true.' }
        : card };
    }),
  },
  // spends a read fetching them.
  {
    name: 'list_workflow_folders',
    description: `${describe('list_workflow_folders', 'List workflow folders — risk: read')}. `
      + 'List the workflow FOLDERS in a sub-account, with each folder\'s id and name. '
      + 'Folders are `type: "directory"` on the list endpoint — `type: "folder"` silently returns an empty set. '
      + 'Pass parentId to list the CONTENTS of one folder instead; that response also carries the folder\'s own '
      + 'name, which is the only way to confirm a folder id means what you think before filing anything into it.',
    inputSchema: schema({
      locationId: z.string(),
      parentId: z.string().optional(),
      limit: z.number().default(100),
      offset: z.number().default(0),
    }),
    capabilities: [{ method: 'GET', path: '/workflow/{loc}/list' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const loc = encodeURIComponent(args.locationId);
      const q = new URLSearchParams({
        limit: String(args.limit ?? 100), offset: String(args.offset ?? 0),
        sortBy: 'name', sortOrder: 'asc',
      });
      // No parentId => list the folders themselves. With one => list that folder's contents,
      // which is also how the folder's NAME is confirmed (the response echoes folderName).
      if (args.parentId === undefined) q.set('type', 'directory');
      else q.set('parentId', args.parentId);
      const r = await gw.call('GET', `/workflow/${loc}/list?${q}`);
      if (!r.ok) return fromHttp(r.status, r.json);
      const rows = (r.json?.rows ?? []).map((row) => ({
        id: row.id ?? row._id,
        name: row.name,
        type: row.type,
        parentId: row.parentId ?? null,
        ...(row.type === 'workflow' ? { status: row.status ?? null } : {}),
      }));
      return ok({
        count: r.json?.count ?? rows.length,
        ...(args.parentId === undefined
          ? { folders: rows }
          : { folderId: args.parentId, folderName: r.json?.folderName ?? null, contents: rows }),
      });
    }, args),
  },
  {
    name: 'create_workflow_folder',
    description: `${describe('create_workflow_folder', 'Create workflow folder — risk: write')}. `
      + 'Preview by default; '
      + 'pass confirm:true to write. Returns the new folder id, verified by reading it back out of the '
      + 'folder list — the create response is a bare id and echoes nothing else.',
    inputSchema: schema({
      locationId: z.string(),
      name: z.string(),
      parentId: z.string().optional(),
      confirm: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'POST', path: '/workflow/{loc}/directory' },
      { method: 'GET', path: '/workflow/{loc}/list' },
    ],
    handler: async (args, deps) => guard(async () => {
      if (typeof args.name !== 'string' || args.name.trim() === '') {
        return fail(CODES.VALIDATION_FAILED, 'name must be a non-empty string',
          'Pass the folder name to create.');
      }
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const loc = encodeURIComponent(args.locationId);
      const preview = { creates: { name: args.name, parentId: args.parentId ?? null } };
      if (args.confirm !== true) {
        return withFailureData(
          fail(CODES.CONFIRM_REQUIRED, 'Folder create preview is ready; no write was sent.',
            'Repeat the request with confirm:true to create it.'),
          { preview },
        );
      }
      const created = await gw.call('POST', `/workflow/${loc}/directory`, {
        type: 'directory', name: args.name, updatedBy: gw.uid, parentId: args.parentId ?? null,
      });
      if (!created.ok) return fromHttp(created.status, created.json);
      const folderId = created.json?.id ?? created.json?._id ?? null;
      if (!folderId) {
        return withFailureData(
          fail(CODES.ENGINE_ABORT, 'Folder create returned 2xx but no folder id.',
            'Run list_workflow_folders to see whether the folder was created before retrying — a retry would create a second one.'),
          { preview, response: created.json ?? null },
        );
      }
      // The POST echoes ONLY the id, so it proves nothing about the stored record. Read the
      // folder back and confirm the name that actually landed.
      // POLLED read-back. The folder index lags the POST by a second or two, so a single immediate
      // read reported verified:false on folders that had in fact been created — and a flag that
      // cries wolf is a flag callers learn to ignore.
      const found = await gw.readBackUntil(async () => {
        const listed = await gw.call('GET', `/workflow/${loc}/list?type=directory&limit=200&offset=0`);
        return (listed.json?.rows ?? []).find((row) => (row.id ?? row._id) === folderId) ?? null;
      }, { pollMs: 1000, maxPolls: 3 });
      const hit = found.hit;
      return ok({
        folderId,
        verified: Boolean(hit),
        readBackAttempts: found.attempts,
        folder: hit ? { id: folderId, name: hit.name, parentId: hit.parentId ?? null } : null,
        ...(hit ? {} : { note: `Created, but the folder did not appear in the folder list after ${found.attempts} read-backs. Confirm before filing anything into it.` }),
      });
    }, args),
  },
  {
    name: 'duplicate_workflow',
    description: `${describe('duplicate_workflow', 'Duplicate workflow — risk: write')}. `
      + 'Preview by default; pass confirm:true '
      + 'to write. The clone lands status:"draft", version 1, originType "duplicate-workflow", and can be placed '
      + 'straight into a folder with parentId. TRIGGERS DO CLONE — name, type and conditions all carry over — but '
      + 'they land active:false. `active` is a server-managed projection of the trigger\'s own `status` field '
      + '(measured 2026-08-28) — publishing the clone is what turns triggers on via its draft→published cascade, '
      + 'and publish_workflow now self-repairs (one per-trigger status write, verified by read-back) any trigger '
      + 'that cascade does not reach, reporting loudly — never silently — if one still reads inactive afterward. '
      + 'Treat a freshly duplicated workflow as '
      + 'unverified until that post-publish check comes back clean. (The clone\'s triggersFilePath ends in "NaN" rather than a '
      + 'version integer; that is cosmetic — the trigger records themselves are present and readable.) '
      + 'The create response is a bare id, so the clone is read back and returned as a record.',
    inputSchema: schema({
      locationId: z.string(),
      workflowId: z.string(),
      newName: z.string(),
      parentId: z.string().optional(),
      confirm: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'GET', path: '/workflow/{loc}/{wid}' },
      { method: 'GET', path: '/workflow/{loc}/trigger' },
      { method: 'POST', path: '/workflow/{loc}' },
    ],
    handler: async (args, deps) => guard(async () => {
      if (typeof args.newName !== 'string' || args.newName.trim() === '') {
        return fail(CODES.VALIDATION_FAILED, 'newName must be a non-empty string',
          'Pass the name for the duplicate.');
      }
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const loc = encodeURIComponent(args.locationId);
      const sourceResponse = await getWorkflow(gw, args.locationId, args.workflowId);
      if (!sourceResponse.ok) return fromHttp(sourceResponse.status, sourceResponse.json);
      const source = sourceResponse.json;
      const sourceTriggers = await listWorkflowTriggers(gw, args.locationId, args.workflowId);
      const sourceTriggerCount = sourceTriggers.response.ok ? sourceTriggers.triggers.length : null;

      const preview = {
        source: {
          id: args.workflowId, name: source?.name ?? null, status: source?.status ?? null,
          steps: source?.workflowData?.templates?.length ?? null, triggers: sourceTriggerCount,
        },
        creates: { name: args.newName, parentId: args.parentId ?? null, status: 'draft' },
        note: 'Duplicating READS the source; the source workflow is never modified.',
      };
      if (args.confirm !== true) {
        return withFailureData(
          fail(CODES.CONFIRM_REQUIRED, 'Duplicate preview is ready; no write was sent.',
            'Review data.preview, then repeat the request with confirm:true to duplicate.'),
          { preview },
        );
      }

      const created = await gw.call('POST', `/workflow/${loc}`, {
        new_workflow_name: args.newName,
        parentId: args.parentId ?? null,
        workflow_id: args.workflowId,
      });
      if (!created.ok) return fromHttp(created.status, created.json);
      const newId = created.json?.id ?? created.json?._id ?? null;
      if (!newId) {
        return withFailureData(
          fail(CODES.ENGINE_ABORT, 'Duplicate returned 2xx but no workflow id.',
            'Run list_workflows to see whether a copy was created before retrying — a retry would create a second one. Nothing is ever deleted for you.'),
          { preview, response: created.json ?? null },
        );
      }
      const cloneResponse = await getWorkflow(gw, args.locationId, newId);
      const clone = cloneResponse.ok ? cloneResponse.json : null;
      const cloneTriggers = await listWorkflowTriggers(gw, args.locationId, newId);
      const cloneTriggerList = cloneTriggers.response.ok ? cloneTriggers.triggers : [];
      return ok({
        workflowId: newId,
        preview,
        workflow: clone ? {
          id: newId, name: clone.name, status: clone.status, version: clone.version,
          parentId: clone.parentId ?? null, originType: clone.originType ?? null,
          steps: clone.workflowData?.templates?.length ?? null,
        } : null,
        triggers: {
          source: sourceTriggerCount,
          clone: cloneTriggerList.length,
          match: sourceTriggerCount === null ? null : sourceTriggerCount === cloneTriggerList.length,
          inactive: cloneTriggerList.filter((trigger) => trigger.active !== true).length,
          note: 'Cloned triggers land active:false. They fire only after the clone is published.',
        },
        verified: Boolean(clone),
        builderUrl: `https://app.gohighlevel.com/v2/location/${loc}/automation/workflow/${encodeURIComponent(newId)}`,
      });
    }, args),
  },
  {
    name: 'move_workflows',
    description: `${describe('move_workflows', 'Move workflows between folders and root — risk: write')}. `
      + 'File workflows into a folder, or move them back to root. '
      + 'Preview by default; pass confirm:true to write. Pass parentId for a folder, or toRoot:true for root — '
      + 'the two are different endpoints upstream: the batch move CANNOT reach root (parentId null, "" and "root" '
      + 'all 404), so root moves fan out one call per workflow. PUBLISHED workflows are refused unless '
      + 'allowPublished:true, because moving a live workflow is how a production automation ends up filed in a '
      + 'staging folder. Every move is verified by reading parentId back off each record — the move endpoint '
      + 'returns only "Updated successfully", which proves nothing on its own.',
    inputSchema: schema({
      locationId: z.string(),
      workflowIds: z.array(z.string()),
      parentId: z.string().optional(),
      toRoot: z.boolean().default(false),
      allowPublished: z.boolean().default(false),
      confirm: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'GET', path: '/workflow/{loc}/{wid}' },
      { method: 'GET', path: '/workflow/{loc}/list' },
      { method: 'PUT', path: '/workflow/{loc}/move' },
      { method: 'PUT', path: '/workflow/{loc}/move-directory/{wid}' },
    ],
    handler: async (args, deps) => guard(async () => {
      const ids = Array.isArray(args.workflowIds) ? args.workflowIds : [];
      if (!ids.length) {
        return fail(CODES.VALIDATION_FAILED, 'workflowIds must contain at least one workflow id',
          'Pass the ids to move.');
      }
      const toRoot = args.toRoot === true;
      if (toRoot === Boolean(args.parentId)) {
        return fail(CODES.VALIDATION_FAILED,
          toRoot ? 'pass either parentId or toRoot:true, not both' : 'a destination is required',
          'Pass parentId to file into a folder, or toRoot:true to move to root.');
      }
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const loc = encodeURIComponent(args.locationId);

      // Resolve the DESTINATION by name before touching anything. A folder id that does not
      // resolve, or resolves to a folder whose name the caller did not expect, is the whole
      // "filed into the wrong folder" failure mode — so the name travels in the preview.
      let destination = { toRoot: true, parentId: null, name: '(root)' };
      if (!toRoot) {
        const folders = await gw.call('GET', `/workflow/${loc}/list?type=directory&limit=200&offset=0`);
        if (!folders.ok) return fromHttp(folders.status, folders.json);
        const hit = (folders.json?.rows ?? []).find((row) => (row.id ?? row._id) === args.parentId);
        if (!hit) {
          return withFailureData(
            fail(CODES.VALIDATION_FAILED,
              'the destination folder id does not exist in this sub-account',
              'Run list_workflow_folders to get a real folder id. Nothing was moved.'),
            { knownFolders: (folders.json?.rows ?? []).map((row) => ({ id: row.id ?? row._id, name: row.name })) },
          );
        }
        destination = { toRoot: false, parentId: args.parentId, name: hit.name };
      }

      // Read every subject up front: the preview names each workflow and its status, and the
      // published guard needs the status before any write.
      const subjects = [];
      for (const id of ids) {
        const response = await getWorkflow(gw, args.locationId, id);
        if (!response.ok) return fromHttp(response.status, response.json);
        subjects.push({
          id, name: response.json?.name ?? null,
          status: response.json?.status ?? null,
          parentIdBefore: response.json?.parentId ?? null,
        });
      }
      const published = subjects.filter((subject) => subject.status === 'published');
      const preview = { destination, moves: subjects, publishedCount: published.length };

      if (published.length && args.allowPublished !== true) {
        return withFailureData(
          fail(CODES.CONFIRM_REQUIRED,
            `${published.length} of ${subjects.length} workflow(s) are PUBLISHED: `
            + `${published.map((subject) => `'${subject.name ?? subject.id}'`).join(', ')}. Nothing was moved.`,
            'Moving a live workflow reorganises production. Drop them from workflowIds, or pass allowPublished:true with confirm:true if the move is intended.'),
          { preview },
        );
      }
      if (args.confirm !== true) {
        return withFailureData(
          fail(CODES.CONFIRM_REQUIRED, 'Move preview is ready; no write was sent.',
            'Review data.preview — especially destination.name — then repeat the request with confirm:true.'),
          { preview },
        );
      }

      const writes = [];
      if (destination.toRoot) {
        // No batch route reaches root; one call per workflow is the only way.
        for (const subject of subjects) {
          const response = await gw.call('PUT', `/workflow/${loc}/move-directory/${encodeURIComponent(subject.id)}`, { parentId: null });
          writes.push({ id: subject.id, status: response.status, ok: response.ok });
        }
      } else {
        const response = await gw.call('PUT', `/workflow/${loc}/move`, {
          parentId: destination.parentId, type: 'workflow', updatedBy: gw.uid, workflowIds: ids,
        });
        writes.push({ ids, status: response.status, ok: response.ok, batch: true });
      }

      // "Updated successfully" is all the endpoint says. Read parentId back off each record.
      const verified = [];
      for (const subject of subjects) {
        const response = await getWorkflow(gw, args.locationId, subject.id);
        const parentIdAfter = response.ok ? (response.json?.parentId ?? null) : undefined;
        verified.push({
          id: subject.id, name: subject.name,
          parentIdBefore: subject.parentIdBefore,
          parentIdAfter: parentIdAfter === undefined ? null : parentIdAfter,
          readable: response.ok,
          moved: response.ok && (parentIdAfter ?? null) === destination.parentId,
        });
      }
      const failed = verified.filter((row) => !row.moved);
      const data = { destination, writes, verified, movedCount: verified.length - failed.length, failed };
      if (failed.length) {
        return withFailureData(
          fail(CODES.ENGINE_ABORT,
            `${failed.length} of ${verified.length} workflow(s) did not read back in the destination.`,
            'Inspect data.verified. Nothing is deleted or retried for you; re-issue the move for the ids that did not land.'),
          data,
        );
      }
      return ok(data);
    }, args),
  },
  // Custom-field FOLDERS. A different surface from everything above: the write lives on the
  // AI host (services.leadconnectorhq.com), not the workflow backend — but on the plain
  // Bearer rail, NOT the dual-credential `ai` rail. Verified live 2026-08-18 by sending the
  // captured call with the `token-id` header REMOVED: still 201. That matters, because
  // rail:'ai' would demand an agency-admin token-id this endpoint never needed, and every
  // caller holding only a location JWT would have been locked out of a write that works.
  //
  // Reads are available on BOTH hosts and answer under `customFieldFolders` — NOT
  // `customFields`, which is the sibling key for the FIELDS themselves and comes back empty
  // for a folder query. Reading the wrong key makes a freshly created folder look like it
  // was never created.
  {
    name: 'create_custom_field_folder',
    description: `${describe('create_custom_field_folder', 'Create custom field folder — risk: write')}. `
      + 'Create a folder to group custom fields in, on the contact or opportunity object. Preview by '
      + 'default; pass confirm:true to write. `model` must be "contact" or "opportunity" — the server '
      + 'rejects anything else outright (other models such as "business" exist on EXISTING folders but '
      + 'cannot be created here). Folder names are UNIQUE per location: creating one that already exists '
      + 'fails and this tool reports the existing folder\'s id rather than a bare 400, so a re-run is safe '
      + 'and tells you what to reuse. The create returns the full stored record, which is then confirmed '
      + 'by reading the folder list back.',
    inputSchema: schema({
      locationId: z.string(),
      name: z.string(),
      model: z.string().default('contact'),
      confirm: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'GET', path: '/locations/{loc}/customFields/search' },
      { method: 'POST', path: '/locations/{loc}/customFields' },
    ],
    handler: async (args, deps) => guard(async () => {
      if (typeof args.name !== 'string' || args.name.trim() === '') {
        return fail(CODES.VALIDATION_FAILED, 'name must be a non-empty string',
          'Pass the folder name to create.');
      }
      // Checked here as well as upstream: the server's own 400 is clear, but spending a
      // write to learn a typo is worse than refusing locally, and the accepted set is short
      // and stable enough to state.
      const model = args.model ?? 'contact';
      if (!['contact', 'opportunity'].includes(model)) {
        return fail(CODES.VALIDATION_FAILED,
          `model must be "contact" or "opportunity" (got ${JSON.stringify(model)})`,
          'Custom-field folders can only be created on the contact or opportunity object.');
      }

      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const loc = encodeURIComponent(args.locationId);
      const folderQuery = (forModel) => new URLSearchParams({
        parentId: '', skip: '0', limit: '1000', documentType: 'folder',
        model: forModel, query: '', includeStandards: 'true',
      });
      // `customFieldFolders`, never `customFields` — see the note above this tool.
      const listFolders = async (forModel) => {
        const response = await gw.call(
          'GET', `/locations/${loc}/customFields/search?${folderQuery(forModel)}`,
          undefined, { base: AI_BASE });
        return { response, folders: recordsFrom(response.json, 'customFieldFolders') };
      };

      const existingList = await listFolders(model);
      if (!existingList.response.ok) return fromHttp(existingList.response.status, existingList.response.json);
      // Names are unique per location, so a collision is knowable BEFORE the write. Reporting
      // it from the preview costs nothing and turns a failed run into an answer.
      const clash = existingList.folders.find((folder) => folder.name === args.name);
      const preview = {
        creates: { name: args.name, model, documentType: 'folder' },
        existingFolders: existingList.folders.map((folder) => ({ id: folder.id, name: folder.name, model: folder.model })),
        ...(clash ? { alreadyExists: { id: clash.id, name: clash.name, model: clash.model } } : {}),
      };
      if (clash) {
        return withFailureData(
          fail(CODES.VALIDATION_FAILED,
            `a ${model} custom-field folder named '${args.name}' already exists (id ${clash.id})`,
            'Folder names are unique per location. Reuse that id, or create the folder under a different name. Nothing was written.'),
          { preview },
        );
      }
      if (args.confirm !== true) {
        return withFailureData(
          fail(CODES.CONFIRM_REQUIRED, 'Custom-field folder preview is ready; no write was sent.',
            'Review data.preview, then repeat the request with confirm:true to create it.'),
          { preview },
        );
      }

      const created = await gw.call(
        'POST', `/locations/${loc}/customFields`,
        { documentType: 'folder', model, name: args.name },
        { base: AI_BASE });
      if (!created.ok) {
        // The server's own uniqueness check is the authority — the pre-check above can lose a
        // race, and it hands back the existing id, which is more useful than the raw status.
        const existingId = created.json?.meta?.existingId;
        if (existingId) {
          return withFailureData(
            fail(CODES.VALIDATION_FAILED,
              `a custom-field folder named '${args.name}' already exists (id ${existingId})`,
              'Folder names are unique per location. Reuse that id, or pick a different name.'),
            { preview, existingId },
          );
        }
        return fromHttp(created.status, created.json);
      }
      const folder = created.json?.customFieldFolder ?? null;
      const folderId = folder?.id ?? folder?._id ?? null;
      if (!folderId) {
        return withFailureData(
          fail(CODES.ENGINE_ABORT, 'Folder create returned 2xx but no folder record.',
            'Re-read the custom-field folders before retrying — a retry would attempt a second folder of the same name.'),
          { preview, response: created.json ?? null },
        );
      }
      const after = await listFolders(model);
      const verified = after.response.ok
        && after.folders.some((row) => (row.id ?? row._id) === folderId);
      return ok({
        folderId,
        folder,
        verified,
        ...(verified ? {} : { note: 'Created, but the folder did not appear in the folder list on read-back. Confirm before filing fields into it.' }),
      });
    }, args),
  },
  {
    name: 'pin_webhook_sample',
    description: describe(
      'pin_webhook_sample',
      'Make an inbound_webhook trigger\'s merge tags real: POST a sample payload to its receiving URL, wait for GHL to record it, pin it as the trigger\'s REFERENCE, and return the {{inboundWebhookRequest.*}} tags it now offers.',
    ),
    inputSchema: schema({
      locationId: z.string(),
      // From build_workflow's report.webhookUrls[].triggerId / report.triggers.ids, or get_workflow.
      triggerId: z.string(),
      samplePayload: z.record(z.unknown()),
      // Skip the POST and pin the newest already-received request instead (e.g. the real system
      // already fired once).
      pinLatestExisting: z.boolean().default(false),
      pollMs: z.number().int().positive().max(20_000).default(1500),
      maxPolls: z.number().int().positive().max(20).default(8),
      confirm: z.boolean().default(false),
    }),
    capabilities: [
      // Explicit, because the handler dials services (below) and an undeclared origin reads as
      // backend — so the capability manifest and the host-parity test described a call this tool
      // never makes. Surfaced 2026-09-11 when the catalogue first carried a row for this path.
      { method: 'POST', path: '/hooks/{loc}/webhook-trigger/{triggerId}', origin: 'https://services.leadconnectorhq.com' },
      { method: 'GET', path: '/hooks/inbound-webhook-request/trigger/{triggerId}' },
      { method: 'PUT', path: '/hooks/inbound-webhook-request/set-as-reference/{requestId}' },
      { method: 'GET', path: '/hooks/inbound-webhook-request/reference/{triggerId}' },
    ],
    handler: async (args, deps) => guard(async () => {
      // Pinning REPLACES the trigger's active reference — on a live workflow that changes which
      // merge-tag paths resolve. Preview first; confirm:true executes.
      const loc = args.locationId;
      const tid = encodeURIComponent(args.triggerId);
      const receivingUrl = `https://services.leadconnectorhq.com/hooks/${encodeURIComponent(loc)}/webhook-trigger/${tid}`;
      if (args.confirm !== true) {
        return ok({ preview: true, receivingUrl, plan: [
          args.pinLatestExisting ? 'skip POST (pinLatestExisting)' : `POST samplePayload → ${receivingUrl} (unauthenticated by design)`,
          `poll GET /hooks/inbound-webhook-request/trigger/${args.triggerId} until the request is recorded`,
          'PUT /hooks/inbound-webhook-request/set-as-reference/{requestId} (REPLACES the active reference)',
          `GET /hooks/inbound-webhook-request/reference/${args.triggerId} and derive the merge tags`,
        ], note: 'Re-run with confirm:true to execute. The reference decides which {{inboundWebhookRequest.*}} paths exist at runtime for this trigger.' });
      }
      const gw = deps.makeGw({ loc, state: deps.state });
      const lq = new URLSearchParams({ locationId: loc });
      let posted = null;
      if (args.pinLatestExisting !== true) {
        const p = await gw.call('POST', `/hooks/${encodeURIComponent(loc)}/webhook-trigger/${tid}`, args.samplePayload, 'https://services.leadconnectorhq.com');
        posted = { status: p.status, body: p.json ?? null };
        if (!p.ok) return fromHttp(p.status, p.json);
      }
      const sortKeysDeep = (o) => Array.isArray(o) ? o.map(sortKeysDeep) : (o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeysDeep(o[k])])) : o);
      const canon = (o) => JSON.stringify(sortKeysDeep(o));
      const sig = canon(args.samplePayload);
      const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
      let request = null;
      for (let i = 0; i < (args.maxPolls ?? 8); i++) {
        if (i > 0 || args.pinLatestExisting !== true) await sleep(args.pollMs ?? 1500);
        const l = await gw.call('GET', `/hooks/inbound-webhook-request/trigger/${tid}?${new URLSearchParams({ limit: '10', locationId: loc })}`);
        if (!l.ok) return fromHttp(l.status, l.json);
        const rows = Array.isArray(l.json) ? l.json : [];
        request = args.pinLatestExisting === true
          ? (rows[0] ?? null)
          : (rows.find((r) => { const { headers: _h, ...rest } = r?.payload ?? {}; return canon(rest) === sig; }) ?? null);
        if (request) break;
      }
      if (!request) return fail(CODES.VALIDATION_FAILED, 'the sample was not recorded against this trigger within the poll window (or no request exists for pinLatestExisting)', 'check the triggerId is an inbound_webhook trigger of THIS location; re-run with a longer pollMs/maxPolls');
      const s = await gw.call('PUT', `/hooks/inbound-webhook-request/set-as-reference/${encodeURIComponent(request._id)}?${lq}`, { locationId: loc });
      if (!s.ok) return fromHttp(s.status, s.json);
      const g = await gw.call('GET', `/hooks/inbound-webhook-request/reference/${tid}?${lq}`);
      if (!g.ok) return fromHttp(g.status, g.json);
      const ref = g.json ?? {};
      const tags = {};
      const walk = (v, path) => {
        if (v !== null && typeof v === 'object') {
          if (Array.isArray(v)) v.forEach((x, i) => walk(x, path ? `${path}.${i}` : String(i)));
          else for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
        } else tags[path] = `{{inboundWebhookRequest.${path}}}`;
      };
      walk(ref.payload ?? {}, '');
      const mergeTags = Object.fromEntries(Object.entries(tags).filter(([k]) => k !== 'headers' && !k.startsWith('headers.')));
      return ok({
        receivingUrl, posted, requestId: request._id, referenceId: typeof s.json === 'string' ? s.json : (ref._id ?? null),
        reference: { id: ref._id ?? null, requestId: ref.requestId ?? null, triggerId: ref.triggerId ?? null, updatedAt: ref.updatedAt ?? null },
        mergeTags, headerTagsOmitted: Object.keys(tags).length - Object.keys(mergeTags).length,
        note: 'These paths are what {{inboundWebhookRequest.*}} resolves to for this trigger now. Live-proven GROM AU 2026-08-22: POST → {"status":"Success: test request received"}, set-as-reference → the reference id.',
      });
    }, args),
  },
  {
    name: 'fast_forward_contacts',
    description: describe('fast_forward_contacts', 'Preview or confirm moving parked workflow enrollments past one step (proof: documented).'),
    inputSchema: schema({
      locationId: z.string(),
      workflowId: z.string(),
      stepId: z.string(),
      contactId: z.string().optional(),
      statusIds: z.array(z.string()).optional(),
      all: z.boolean().optional(),
      previewToken: z.string().optional(),
      confirm: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'GET', path: '/workflows/status/search/count-per-step' },
      { method: 'GET', path: '/workflows/status/search/details-by-step' },
      { method: 'POST', path: '/workflow/{loc}/{wid}/requeue-stuck-statuses/{stepId}' },
    ],
    handler: async (args, deps) => guard(async () => {
      const selector = fastForwardSelector(args);
      if (!selector) {
        return fail(
          CODES.VALIDATION_FAILED,
          'fast_forward_contacts requires exactly one selector: a nonempty contactId, a nonempty statusIds array, or all:true',
          'Pass exactly one valid selector, preview without confirm, then repeat with confirm:true to move it.',
        );
      }
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const ff = makeFF({ gw });
      // Confirmation is a compare-and-write boundary: always resolve the current
      // parked roster immediately before deciding whether a POST is still safe.
      const parked = await ff.allParked(args.workflowId, args.stepId);
      const envelopeProblem = malformedParkedEnvelope(parked);
      if (envelopeProblem) {
        return fail(
          CODES.VALIDATION_FAILED,
          `Malformed parked-enrollment response: ${envelopeProblem}.`,
          'No preview or write was produced. Re-read the parked roster after the upstream response is repaired.',
        );
      }
      const selectedRows = selectParkedRows(parked, selector);
      const selectedProblem = malformedSelectedParkedRows(selectedRows);
      if (selectedProblem) {
        return fail(
          CODES.VALIDATION_FAILED,
          `Malformed selected parked-enrollment response: ${selectedProblem}.`,
          'No preview or write was produced. Re-read the parked roster after the upstream response is repaired.',
        );
      }
      const preview = fastForwardPreview(selectedRows, selector, args);
      if (args.confirm !== true) {
        return withFailureData(
          fail(
            CODES.CONFIRM_REQUIRED,
            'Fast-forward preview is ready; no write was sent.',
            'Review data.preview, then repeat the same selector with confirm:true to move these enrollments.',
          ),
          { preview },
        );
      }

      if (typeof args.previewToken !== 'string' || args.previewToken !== preview.previewToken) {
        return withFailureData(
          fail(
            CODES.PREVIEW_STALE,
            'Fast-forward confirmation was refused because its preview token is missing or no longer matches the current parked roster.',
            'Review data.preview, then reconfirm with its fresh previewToken. No write was sent.',
          ),
          { preview },
        );
      }

      const statusIds = preview.statusIds;
      const partialProgress = {
        write: {
          phase: 'requeue',
          attempted: false,
          acknowledged: false,
          ambiguous: false,
        },
      };
      if (statusIds.length === 0) {
        return ok({
          moved: 0,
          statusIds: [],
          statusIdsAttempted: [],
          statusIdsMoved: [],
          partialProgress,
          note: 'Nobody parked matched that selector at this step; no write was sent.',
        });
      }

      partialProgress.write.attempted = true;
      const requeueCall = await safeGatewayCall(
        () => ff.moveToNextStep(args.workflowId, args.stepId, statusIds),
      );
      if (requeueCall.threw) {
        if (requeueCall.error?.gatewayResponse) {
          return withFailureData(requeueCall.failure, {
            moved: 0,
            statusIds: [],
            statusIdsAttempted: statusIds,
            statusIdsMoved: [],
            partialProgress,
            note: 'The requeue POST received a known upstream rejection and did not acknowledge a move.',
          });
        }
        partialProgress.write.ambiguous = true;
        return fastForwardAmbiguousFailure(requeueCall.failure, {
          moved: null,
          statusIds: null,
          statusIdsAttempted: statusIds,
          statusIdsMoved: null,
          partialProgress,
          note: 'The requeue POST was attempted but not acknowledged; its outcome is ambiguous.',
        }, selectedRows);
      }
      partialProgress.write.acknowledged = true;
      return ok({
        moved: statusIds.length,
        statusIds,
        statusIdsAttempted: statusIds,
        statusIdsMoved: statusIds,
        partialProgress,
        upstream: requeueCall.value,
      });
    }, args),
  },
  {
    name: 'raw_request',
    description: 'Escape hatch for internal endpoints the typed tools do not cover. GET remains read-only; non-GET requests require confirm:true and report ambiguous transport outcomes. host:"ai" targets services.leadconnectorhq.com on the dual-credential AI rail (Bearer + token-id); default "workflow" hits backend.leadconnectorhq.com on the Bearer rail.',
    inputSchema: schema({
      locationId: z.string(),
      method: z.string().trim().regex(HTTP_METHOD_TOKEN).transform((method) => method.toUpperCase()),
      path: z.string().startsWith('/').describe('Internal path beginning with / — the gateway adds the base URL'),
      body: z.unknown().optional(),
      // Which internal host + auth rail. Without this, AI-host endpoints
      // (services.leadconnectorhq.com, needs token-id too) were unreachable through this
      // tool — its own guard rejected them, which during cleanup looked like "gone" when
      // the object was still there (live-caught 2026-07-21).
      // Modeled as a free string, not z.enum: the SDK's invalid_enum_value error echoes the
      // received value before our scrubber runs, so a credential passed here would leak. We
      // validate the allowed set inside the handler, downstream of the secret scrub (SC2).
      host: z.string().default('workflow'),
      confirm: z.boolean().default(false),
    }),
    capabilities: [],
    handler: async (args, deps) => guard(async () => {
      // Default in-handler (not only via zod) so a direct call with host omitted still
      // resolves to the workflow rail; then validate the set downstream of the secret scrub.
      const host = args.host ?? 'workflow';
      if (!['workflow', 'ai'].includes(host)) {
        return fail(CODES.VALIDATION_FAILED, 'host must be "workflow" or "ai" (value withheld)',
          'Pass host:"workflow" (default) or host:"ai", or omit it.');
      }
      const method = normalizeHttpMethod(args.method);
      if (!method) {
        return fail(
          CODES.VALIDATION_FAILED,
          'raw_request method must be a syntactically valid HTTP method token',
          'Pass one HTTP method token without whitespace or header/path content.',
        );
      }

      // DOUBLE-ENCODING GUARD. The gateway serializes every body with JSON.stringify, and
      // `body` here is z.unknown() — so a caller that hands over an already-serialized JSON
      // STRING (the natural thing to do when hand-writing an escape-hatch payload) got it
      // stringified a second time. The wire carried "{\"locationId\":...}" — a JSON string
      // whose contents are JSON — and upstream answered
      //   Unexpected token '"', ""{\"locati"... is not valid JSON
      // Reproduced on three separate payloads; it blocked every non-GET escape-hatch call.
      // Normalize BEFORE the confirm gate so the preview shows what will actually be sent.
      let body = args.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          return fail(
            CODES.VALIDATION_FAILED,
            'raw_request body was a string that is not valid JSON',
            'Pass body as an object — the gateway serializes it for you. A pre-serialized '
            + 'JSON string is accepted and parsed back, but a non-JSON string has no valid '
            + 'encoding on these endpoints, which all take JSON.',
          );
        }
      }

      // R-95 (backlog 10): `POST /workflow/{loc}/trigger` binds the trigger to its workflow from a
      // camelCase root `workflowId` ONLY. The STORED shape (what export_workflow returns and the
      // per-trigger PUT takes) carries snake `workflow_id`, and a POST of that shape returns 200
      // with a fresh id that is attached to nothing — invisible in the builder, absent from every
      // list, unreachable by id. Four orphans were minted on a client account before the cause was
      // found. Refused here, before the confirm gate, because there is no legitimate version of
      // this call: the fix is the key name.
      if (method === 'POST' && /^\/workflow\/[^/?]+\/trigger\/?(?:\?|$)/.test(args.path)
          && body && typeof body === 'object' && !Array.isArray(body)
          && Object.hasOwn(body, 'workflow_id') && !Object.hasOwn(body, 'workflowId')) {
        return fail(
          CODES.VALIDATION_FAILED,
          'trigger POST carries a root `workflow_id` and no `workflowId` — the create route binds from camelCase `workflowId` only, so this would return 200 with an id and mint an ORPHAN trigger attached to no workflow (R-95).',
          'Send the WRITE shape: root `workflowId` (camelCase) plus `actions:[{workflow_id, type:"add_to_workflow"}]`, `location_id`, `company_age`, `status` matching the workflow — or use edit_workflow addTrigger, which builds that envelope. To edit an EXISTING trigger use PUT /workflow/{loc}/trigger/{id}, which does take the stored shape.',
        );
      }

      if (method !== 'GET' && args.confirm !== true) {
        return withFailureData(
          fail(
            CODES.CONFIRM_REQUIRED,
            'Raw write preview is ready; no gateway call was sent.',
            'Review data.preview, then repeat the same request with confirm:true to send it.',
          ),
          { preview: { method, path: args.path, ...(body === undefined ? {} : { body }) } },
        );
      }

      // host:'ai' switches BOTH the base and the auth rail together — the AI host rejects
      // a Bearer-only call, so a base override without the rail would just 401.
      const onAi = host === 'ai';
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state, ...(onAi ? { rail: 'ai' } : {}) });
      // `sourceid` is pinned by the memberships front-end on every one of its requests, and without
      // it that whole surface -- 160 catalogued endpoints, the entire course and certificate rail --
      // is unreachable through this tool. Its value is the locationId, which this tool already
      // requires, so there is nothing to ask the caller for.
      //
      // Sent on every call rather than only the membership prefixes: it is a header the other rails
      // ignore, and a prefix allowlist here would be a second place to keep in sync with the
      // catalogue. The gateway still strips authorization/token-id from overrides, so this cannot
      // reach the credential rails.
      const callOpts = {
        ...(onAi ? { base: 'https://services.leadconnectorhq.com' } : {}),
        headers: { sourceid: args.locationId },
      };
      if (method === 'GET') {
        const response = await gw.call('GET', args.path, undefined, callOpts);
        return response.ok
          ? ok({ status: response.status, json: response.json })
          : fromHttp(response.status, response.json);
      }

      const partialProgress = {
        write: {
          phase: 'raw_request',
          attempted: true,
          acknowledged: false,
          ambiguous: false,
        },
      };
      const writeCall = await safeGatewayCall(
        () => gw.call(method, args.path, body, callOpts),
      );
      if (writeCall.threw) {
        partialProgress.write.ambiguous = true;
        return rawWriteFailure(writeCall.failure, {
          partialProgress,
          note: 'The raw write was attempted but not acknowledged; its outcome is ambiguous.',
        }, { ambiguous: true });
      }
      if (!writeCall.value.ok) {
        return rawWriteFailure(
          fromHttp(writeCall.value.status, writeCall.value.json),
          {
            partialProgress,
            note: 'The raw write reached the upstream service but was not accepted.',
          },
        );
      }
      partialProgress.write.acknowledged = true;
      return ok({
        status: writeCall.value.status,
        json: writeCall.value.json,
        partialProgress,
      });
    }, args),
  },
  {
    name: 'search_endpoints',
    description: `${describe('search_endpoints', 'Search the internal API surface — risk: read')}. `
      + `Ranked search over ${endpoints().length} internal endpoints across EVERY GHL surface this `
      + 'project knows: the workflow builder, memberships and courses, conversation AI, voice AI, '
      + 'agent studio, funnels, calendars, media, billing. Not workflows only. '
      + 'Returns compact stubs — id, method, path, kind, and where known a one-line summary, the '
      + 'typed tool that already covers it, the one trap worth knowing, and whether a location '
      + 'token has been proven to reach it. Call describe_endpoint with the id you pick. '
      + 'Use this whenever no typed tool obviously covers what you need, BEFORE reaching for '
      + 'raw_request. Reads no account data. '
      + 'A hit proves a GHL front-end calls that path — NOT that your token reaches it, and not '
      + 'that calling it is safe.',
    inputSchema: schema({
      intent: z.string().describe('what you want to do, in plain words — e.g. "list workflow folders", "erroring workflows", "scheduled pause"'),
      method: z.string().trim().optional().describe('filter to one HTTP method, e.g. GET'),
      limit: z.number().default(10),
    }),
    capabilities: [],
    handler: async (args) => guard(async () => {
      const terms = cardWords(args.intent);
      let pool = endpoints();
      if (!pool.length) {
        return fail(CODES.VALIDATION_FAILED,
          'the internal endpoint catalog is missing or unreadable',
          'Regenerate it: node knowledge/scripts/build-endpoint-catalog.mjs');
      }
      const wanted = args.method ? String(args.method).toUpperCase() : null;
      if (wanted) pool = pool.filter((e) => e.method === wanted);
      const verbs = intentVerbs(terms);
      const ranked = pool
        .map((e) => ({ e, score: scoreEndpoint(e, terms, verbs) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.e.path.length - b.e.path.length)
        .slice(0, args.limit ?? 10);
      if (!ranked.length) {
        return { ok: true, data: { results: [], total: 0,
          note: `No endpoint matched "${args.intent}"${wanted ? ` with method ${wanted}` : ''}. `
              + `${pool.length} endpoints are catalogued. Try GHL's own noun for the thing `
              + `(the URL segment), or drop the method filter.` } };
      }
      return { ok: true, data: {
        results: ranked.map((x) => endpointStub(x.e)),
        total: pool.filter((e) => scoreEndpoint(e, terms, verbs) > 0).length,
        next: 'describe_endpoint with the method and path you want',
      } };
    }),
  },
  {
    name: 'describe_endpoint',
    description: `${describe('describe_endpoint', 'Detail for one internal endpoint — risk: read')}. `
      + 'Full record for ONE endpoint: the absolute url, its path parameters, every query key known '
      + '(including ones learned by CALLING it and reading what GHL asked for), the request body and '
      + 'response shape where the source declares them, and the typed tools that already cover it. '
      + 'Ends with callWith — a copy-pasteable raw_request path — EXCEPT where raw_request cannot '
      + 'make the call at all (multipart, blob, SSE, or a header it has no way to set), where it '
      + 'says so instead. Address it by `id` from search_endpoints; method+path still works. '
      + 'Reads no account data.',
    inputSchema: schema({
      id: z.string().trim().optional().describe('the endpoint id from search_endpoints — the preferred key'),
      method: z.string().trim().optional().describe('HTTP method, if addressing by method+path'),
      path: z.string().optional().describe('the full wire path, if addressing by method+path'),
    }),
    capabilities: [],
    handler: async (args) => guard(async () => {
      const pool = endpoints();
      // Addressed by id first. method+path was the only key, and it is fragile: a path is what the
      // miner CORRECTS when it learns something, so anything holding one goes stale by design.
      let hit = args.id ? pool.find((e) => e.id === args.id) : null;
      if (!hit && args.method && args.path) {
        const want = String(args.method).toUpperCase();
        const norm = (p) => String(p).replace(/\{[A-Za-z0-9_]+\}/g, '{p}');
        hit = pool.find((e) => e.method === want && e.path === args.path)
          ?? pool.find((e) => e.method === want && norm(e.path) === norm(args.path));
      }
      if (!hit) {
        return fail(CODES.VALIDATION_FAILED,
          `no catalogued endpoint matches ${args.id ?? `${args.method} ${args.path}`}`,
          'Run search_endpoints first and copy the id from a result.');
      }
      const w = endpointWords(hit);
      const query = (hit.query ?? []).filter((q) => q.name !== '…spread');
      const qs = query.length ? `?${query.map((q) => `${q.name}=<${q.name}>`).join('&')}` : '';
      return { ok: true, data: {
        id: hit.id,
        method: hit.method,
        url: hit.url ?? `${hit.origin ?? ''}${hit.path}`,
        path: hit.path,
        kind: endpointKind(hit),
        ...(w.summary ? { summary: w.summary } : {}),
        ...(w.note ? { note: w.note } : {}),
        reach: w.reach ?? 'source-only',
        status: 'source-derived',
        meaning: 'The GHL builder calls this path. That is NOT proof your token reaches it, nor '
               + 'that calling it is safe — some rows are permission-gated.',
        pathParams: hit.pathParams ?? [],
        query,
        body: hit.body ?? null,
        returns: hit.returns ?? null,
        confidence: hit.confidence ?? null,
        // A typed tool carries the compiler, the required query switches, the cursor walk and the
        // read-back. raw_request carries none of them, so when something covers this row it is
        // named FIRST and by name.
        ...(hit.coveredBy?.length
          ? { coveredBy: { tools: hit.coveredBy, why: 'Prefer these: they carry the required query switches, the cursor walk and the read-back verification. raw_request does none of that.' } }
          : {}),
        // Absent, not empty, when raw_request cannot make the call — an instruction that cannot
        // work is worse than silence. 17 rows are multipart, blob, or need a header raw_request
        // has no way to set.
        ...(hit.rawCallable === false
          ? { notRawCallable: `raw_request cannot make this call: transport=${hit.transport}, response=${hit.responseMode}`
              + `${(hit.extraHeaders ?? []).length ? `, needs headers ${hit.extraHeaders.join(', ')}` : ''}.` }
          : { callWith: {
              tool: 'raw_request',
              host: hit.rail ?? 'workflow',
              path: `${hit.path}${qs}`,
              note: 'path is the FULL wire path. Auth and the marketplace headers are added for you — do not set them.',
            } }),
      } };
    }),
  },

  {
    name: 'find_ghl_site',
    description: describe('find_ghl_site',
      'Resolve a domain, slug or name to the GHL surface that owns it — AI Studio project or funnel. '
      + 'Call this FIRST for any "work on <site>" request: AI Studio projects and funnels are disjoint '
      + 'collections, so querying the wrong one returns an empty list that reads as "does not exist" '
      + '— proof: live-runtime (2026-09-04); risk: read. Disjointness measured 2026-09-04 '
      + '(knowledge/sniffs/ai-studio-2026-09-04/sweep-19.mjs); the funnels leg runs on the token-id '
      + 'rail — the same sweep called it live and it succeeded, and '
      + 'knowledge/corpus/funnels/20-api/funnels-api.md documents the rail as proven-live 2026-08-25.'),
    inputSchema: schema({ locationId: z.string(), site: z.string() }),
    capabilities: [
      { method: 'GET', path: '/vibe-ai/projects' },
      { method: 'GET', path: '/funnels/funnel/list' },
    ],
    handler: async (args, deps) => guard(async () => {
      const { api } = studioDeps(args, deps);
      const studio = (await api.listProjects()).json;

      // THE FUNNELS RAIL IS DISPUTED, so this tries both rather than betting on either.
      // knowledge/corpus/funnels/20-api/funnels-api.md (proven-live 2026-08-25) and
      // .../00-overview/index.md both state "/funnels/* is authenticated with token-id — not
      // Authorization: Bearer. The workflow-builder rail's token is rejected here."
      // A live differential on 2026-09-04 (one agency-admin token, one sub-account) DISAGREED:
      // the identical GET returned 200 and the same 12 funnels on BOTH rails. One of the two is
      // account- or token-class-specific and we cannot tell which from here, so the tool stops
      // guessing: it attempts the primary rail, falls back to the other, and reports which
      // answered in `funnelsRail`. AI Studio itself is Bearer-only (/vibe-ai 401s on token-id
      // alone) — auth on this product is per-surface, not global.
      //
      // NO `type` or `category` query param — deliberately. knowledge/sniffs/ai-studio-2026-09-04/
      // sweep-19.mjs is the probe that produced the disjointness finding this whole tool rests on:
      // it issues one call with `type=website` and one with NO `type` at all, then compares the
      // UNTYPED result ("funnels(all)") against the typed one ("websites-only") to prove AI Studio
      // projects never appear in the funnels collection. `type` FILTERS the collection — a classic
      // GHL website is `type=website`, not `type=funnel` — so filtering here would silently exclude
      // exactly the record class someone is most likely to ask this resolver about, reintroducing
      // the false "does not exist" this tool exists to prevent, through a different door.
      const funnelsPath = `/funnels/funnel/list?locationId=${encodeURIComponent(args.locationId)}&limit=100`;
      let funnelRes = null;
      let funnelsRail = null;
      for (const rail of ['token-id', 'jwt']) {
        try {
          const res = await deps.makeGw({ loc: args.locationId, state: deps.state, rail }).call('GET', funnelsPath);
          if (res?.ok) { funnelRes = res; funnelsRail = rail; break; }
          funnelRes ??= res;                       // keep the first failure to report its status
        } catch {
          // A missing credential for one rail is not fatal — that is what the other is for.
        }
      }
      const funnelsChecked = Boolean(funnelRes?.ok);
      const funnels = funnelsChecked ? (funnelRes?.json?.funnels ?? funnelRes?.json?.data ?? []) : [];

      // A failed funnels call must NEVER be read as "the site does not exist" — an empty list
      // from the wrong rail (or a dead one) is indistinguishable from a genuinely empty
      // collection unless the caller is told the check did not actually run.
      if (!funnelsChecked) {
        const studioHit = classifySite(args.site, Array.isArray(studio) ? studio : [], []);
        // A studio HIT still stands — it was resolved with no dependency on funnels. A studio
        // MISS must never surface as 'not-found': the funnels half never ran, so "not on either
        // surface" was never actually established. Report 'unknown' instead.
        const surface = studioHit.surface === 'not-found' ? 'unknown' : studioHit.surface;
        return ok({ ...studioHit, surface, locationId: args.locationId, funnelsChecked: false, funnelsRail: null,
          warning: `The funnels sweep failed on BOTH rails (last status ${funnelRes?.status ?? 'unknown'}). `
            + 'This result reflects AI Studio only — it does NOT prove the site is not a funnel.' });
      }

      const hit = classifySite(args.site, Array.isArray(studio) ? studio : [], funnels);
      return ok({ ...hit, locationId: args.locationId, funnelsChecked: true, funnelsRail,
        note: hit.surface === 'not-found'
          ? 'Not on this location. AI Studio has no agency-level list — sweep each bound location before concluding it does not exist.'
          : undefined });
    }, args),
  },
  {
    name: 'list_studio_sites',
    description: describe('list_studio_sites', 'List AI Studio (vibe) projects and folders for a sub-account — proof: live-runtime (2026-09-04); risk: read.'),
    inputSchema: schema({ locationId: z.string() }),
    capabilities: [{ method: 'GET', path: '/vibe-ai/projects' }, { method: 'GET', path: '/vibe-ai/folders' }],
    handler: async (args, deps) => guard(async () => {
      const { api } = studioDeps(args, deps);
      const projects = (await api.listProjects()).json ?? [];
      const folders = (await api.getFolders()).json ?? [];
      return ok({
        count: projects.length,
        folders,
        projects: projects.map((p) => ({
          id: p.id, name: p.name, slug: p.slug, folderId: p.folder_id,
          domains: p.custom_domains ?? [], primaryDomain: p.primary_custom_domain ?? null,
          published: Boolean(p.published_at), publishedAt: p.published_at,
          publishedVersionId: p.published_version_id, updatedAt: p.updated_at,
        })),
        note: 'AI Studio is per-location; there is no agency-level list. Project ids are 19-digit strings — keep them strings.',
      });
    }, args),
  },
  {
    name: 'get_studio_site',
    description: describe('get_studio_site', 'One AI Studio project: detail plus its page routes — proof: live-runtime (2026-09-04); risk: read.'),
    inputSchema: schema({ locationId: z.string(), projectId: z.string() }),
    capabilities: [
      { method: 'GET', path: '/vibe-ai/projects/{projectId}' },
      { method: 'GET', path: '/vibe-ai/projects/{projectId}/routes' },
    ],
    handler: async (args, deps) => guard(async () => {
      const { api } = studioDeps(args, deps);
      const { project, error } = await assertProjectLocation(api, args.projectId, args.locationId);
      if (error) return error;
      const routes = filterRoutes((await api.getRoutes(args.projectId)).json);
      return ok({ project, routes, routeCount: routes.length,
        note: 'Soft-deleted routes were filtered out; the endpoint returns them. '
            + 'project.thumbnail_url is a public, UNAUTHENTICATED link that renders the site even '
            + 'when unpublished — do not paste it anywhere you would not paste the draft itself.' });
    }, args),
  },
  {
    name: 'read_studio_site_content',
    description: describe('read_studio_site_content',
      'Read an AI Studio site\'s source — every file with its content. This is how you read a site\'s '
      + 'copy as structured text instead of scraping the published HTML — proof: live-runtime (2026-09-04); risk: read.'),
    inputSchema: schema({ locationId: z.string(), projectId: z.string(),
      pathContains: z.string().optional(), maxBytes: z.number().optional() }),
    capabilities: [
      { method: 'GET', path: '/vibe-ai/projects/{projectId}' },
      { method: 'GET', path: '/vibe-ai/projects/{projectId}/files' },
    ],
    handler: async (args, deps) => guard(async () => {
      const { api } = studioDeps(args, deps);
      const { error } = await assertProjectLocation(api, args.projectId, args.locationId);
      if (error) return error;
      let files = (await api.getFiles(args.projectId)).json ?? [];
      if (args.pathContains) files = files.filter((f) => String(f.path).includes(args.pathContains));
      const cap = args.maxBytes ?? 400_000;
      let used = 0; const out = []; let truncated = false;
      for (const f of files) {
        const len = String(f.content ?? '').length;
        if (used + len > cap) { truncated = true; out.push({ path: f.path, bytes: len, content: null }); continue; }
        used += len; out.push({ path: f.path, bytes: len, content: f.content });
      }
      return ok({ fileCount: files.length, returnedBytes: used, truncated, files: out,
        note: truncated ? 'Some files were listed without content to stay under maxBytes; narrow with pathContains.' : undefined });
    }, args),
  },
  {
    name: 'get_studio_site_history',
    description: describe('get_studio_site_history',
      'The build history of an AI Studio site: every prompt, every assistant turn, the versions each '
      + 'minted, and the publish journal. Read from Firestore — there is no REST endpoint for this '
      + '— proof: live-runtime (2026-09-04); risk: read.'),
    inputSchema: schema({ locationId: z.string(), projectId: z.string(), limit: z.number().optional() }),
    capabilities: [
      { method: 'GET', path: '/vibe-ai/projects/{projectId}' },
      { method: 'POST', path: '/v1/projects/highlevel-backend/databases/vibe-platform/documents:runQuery' },
    ],
    handler: async (args, deps) => guard(async () => {
      const { api, history } = studioDeps(args, deps);
      const { error } = await assertProjectLocation(api, args.projectId, args.locationId);
      if (error) return error;
      const rows = await history(MESSAGES, args.projectId, 'order', args.limit ?? 300);
      const versions = rows.filter((r) => r.versionId)
        .map((r) => ({ versionId: r.versionId, messageId: r.id, buildStatus: r.buildStatus,
                       summary: r.completionSummary, at: r.timestamp }));
      const publishes = rows.filter((r) => r.role === 'system' && r.type === 'publish')
        .map((r) => ({ liveUrl: r.liveUrl, publishedVersionId: r.publishedVersionId, at: r.timestamp }));
      return ok({
        messageCount: rows.length,
        turns: rows.map((r) => ({ id: r.id, role: r.role, order: r.order, at: r.timestamp,
          buildStatus: r.buildStatus, versionId: r.versionId,
          summary: r.completionSummary, hasQuestion: Boolean(r.question) })),
        versions, publishes,
        note: 'Publishes are journaled; UNPUBLISHES ARE NOT. For current state read published_at on the project.',
      });
    }, args),
  },
  {
    name: 'get_studio_site_diffs',
    description: describe('get_studio_site_diffs',
      'The per-file unified diffs a generation produced — exactly what the AI changed, file by file '
      + '— proof: live-runtime (2026-09-04); risk: read.'),
    inputSchema: schema({ locationId: z.string(), projectId: z.string(), messageId: z.string().optional() }),
    capabilities: [
      { method: 'GET', path: '/vibe-ai/projects/{projectId}' },
      { method: 'POST', path: '/v1/projects/highlevel-backend/databases/vibe-platform/documents:runQuery' },
    ],
    handler: async (args, deps) => guard(async () => {
      const { api, history } = studioDeps(args, deps);
      const { error } = await assertProjectLocation(api, args.projectId, args.locationId);
      if (error) return error;
      let rows = await history(DIFFS, args.projectId, null, 300);
      if (args.messageId) rows = rows.filter((r) => r.messageId === args.messageId);
      return ok({ count: rows.length,
        diffs: rows.map((r) => ({ messageId: r.messageId, file: r.file, toolType: r.toolType,
                                  action: r.action, description: r.description, diff: r.diff })) });
    }, args),
  },
  {
    name: 'get_studio_preview',
    description: describe('get_studio_preview',
      'Get the sandbox preview URL for an AI Studio site, provisioning it if needed. Open it in a '
      + 'BROWSER to check the work — a plain HTTP fetch returns a Cloudflare challenge '
      + '— proof: live-runtime (2026-09-04); risk: read.'),
    inputSchema: schema({ locationId: z.string(), projectId: z.string() }),
    capabilities: [
      { method: 'GET', path: '/vibe-ai/projects/{projectId}' },
      { method: 'GET', path: '/vibe-ai/projects/{projectId}/sandbox' },
      { method: 'POST', path: '/vibe-ai/projects/{projectId}/sandbox' },
    ],
    handler: async (args, deps) => guard(async () => {
      const { api } = studioDeps(args, deps);
      const { error } = await assertProjectLocation(api, args.projectId, args.locationId);
      if (error) return error;
      let sb = (await api.getSandbox(args.projectId)).json ?? {};
      let provisioning = false;
      if (!sb.ready || !sb.url) {
        provisioning = true;
        await api.ensureSandbox(args.projectId);
        // ensureSandbox's own response is a provisioning ack, not the sandbox record — re-read
        // so a caller never sees the PRE-provision ready/url after a provisioning call ran.
        sb = (await api.getSandbox(args.projectId)).json ?? sb;
      }
      const stillNotReady = provisioning && (!sb.ready || !sb.url);
      return ok({ ready: Boolean(sb.ready), provisioning,
        url: sb.url || `https://${args.projectId}.vibepreview.com`,
        note: (stillNotReady
              ? 'Provisioning was triggered but the re-read still shows not-ready — sandboxes can '
                + 'take a moment to come up; poll again shortly. '
              : '')
            + 'Sandbox host is keyed on the PROJECT ID; a published site is {slug}.vibepreview.com. '
            + 'Sandboxes expire (ready:false with an empty url while has_builds stays true). '
            + 'Verify by opening it in a browser: curl gets a Cloudflare 403 regardless of site state.' });
    }, args),
  },
  {
    name: 'create_studio_site',
    description: describe('create_studio_site',
      'Create an AI Studio project. WARNING: the server REWRITES the name you send and derives the '
      + 'slug from the rewrite — this tool reports both so you can see it happen '
      + '— proof: live-runtime (2026-09-04); risk: write.'),
    inputSchema: schema({ locationId: z.string(), name: z.string(), description: z.string().optional() }),
    capabilities: [{ method: 'POST', path: '/vibe-ai/projects' }],
    handler: async (args, deps) => guard(async () => {
      const { api } = studioDeps(args, deps);
      const res = await api.createProject({ name: args.name, description: args.description ?? '' });
      const project = res.json?.project ?? {};
      const warning = nameWarning(args.name, project.name);
      return ok({ projectId: project.id, requestedName: args.name, storedName: project.name,
        slug: project.slug, techStack: project.tech_stack, warning,
        note: 'A new project is NOT empty — it ships a vite_react_shadcn_ts scaffold (77 files, 1 route).' });
    }, args),
  },
  {
    name: 'generate_studio_site',
    description: describe('generate_studio_site',
      'Send a prompt to the AI Studio builder and wait for the build. Preflights usage and reports '
      + 'what the turn cost. This SPENDS money on the sub-account, metered in USD '
      + '— proof: live-runtime (2026-09-04); risk: write.'),
    inputSchema: schema({ locationId: z.string(), projectId: z.string(), prompt: z.string(),
      waitSeconds: z.number().optional() }),
    capabilities: [
      { method: 'GET', path: '/vibe-ai/projects/{projectId}' },
      { method: 'GET', path: '/vibe-ai/projects/{projectId}/usage/policy' },
      { method: 'POST', path: '/vibe-ai/projects/{projectId}/chat' },
      { method: 'POST', path: '/v1/projects/highlevel-backend/databases/vibe-platform/documents:runQuery' },
    ],
    handler: async (args, deps) => guard(async () => {
      const { api, history } = studioDeps(args, deps);
      // C3: verify BEFORE spending money on the account. generate_studio_site is the write with
      // the sharpest cost of a wrong-account bug — the account boundary is worth the extra GET.
      const { error } = await assertProjectLocation(api, args.projectId, args.locationId);
      if (error) return error;
      const policy = (await api.usagePolicy(args.projectId)).json ?? {};
      if (policy.allowed === false) {
        return fail(CODES.VALIDATION_FAILED,
          `AI Studio refused this generation: ${policy.reasonCode ?? 'not allowed'}`,
          'Usage policy says no. Do not retry; resolve the plan or usage limit first.');
      }
      const before = await api.usageSnapshotUsd();
      const sessionId = sessionFor(deps.state, args.projectId);
      const started = await api.chat(args.projectId, {
        message: args.prompt, session_id: sessionId, thread_id: 'main',
        alt_id: args.locationId, alt_type: 'location',
      });
      const messageId = started.json?.message_id ?? null;
      // Without a message_id there is nothing to resume with: get_studio_generation_status
      // REQUIRES messageId, so polling to the ceiling here would return a pending handle that
      // can never be redeemed. Refuse immediately rather than burn ~120s and claim "nothing was
      // lost" — the handle needed to recover it is exactly what is missing.
      if (!messageId) {
        return fail(CODES.VALIDATION_FAILED,
          'AI Studio accepted the generation (the chat call returned 202) but the receipt carried '
          + 'no message_id, so this turn\'s progress cannot be tracked or resumed',
          'There is no messageId to pass get_studio_generation_status — do not poll for one. Check '
          + 'the project\'s history directly with get_studio_site_history to see whether the turn landed.');
      }
      const turn = await awaitTurn({
        firestore: { messages: (pid) => history(MESSAGES, pid, 'order', 300) },
        projectId: args.projectId, messageId, waitMs: (args.waitSeconds ?? 120) * 1000,
      });
      const after = await api.usageSnapshotUsd();
      const spendUsd = (typeof before === 'number' && typeof after === 'number')
        ? Number((after - before).toFixed(6)) : null;
      deps.state.studioSpendUsd = Number(((deps.state.studioSpendUsd ?? 0) + (spendUsd ?? 0)).toFixed(6));
      if (turn.pending) {
        return ok({ ...turn, messageId: turn.messageId ?? messageId, spendUsd,
          sessionSpendUsd: deps.state.studioSpendUsd });
      }
      const a = turn.assistant ?? {};
      const diffs = await history(DIFFS, args.projectId, null, 300);
      return ok({
        messageId: a.id ?? messageId, versionId: a.versionId ?? null, buildStatus: a.buildStatus,
        summary: a.completionSummary ?? null, toolsUsed: a.completionToolsCount ?? null,
        thinkingSeconds: a.thinkingDurationSec ?? null, totalSeconds: a.totalDurationSec ?? null,
        question: a.question ?? null,
        diffs: diffs.filter((d) => d.messageId === a.id)
                    .map((d) => ({ file: d.file, toolType: d.toolType, action: d.action, diff: d.diff })),
        spendUsd, sessionSpendUsd: deps.state.studioSpendUsd,
        previewUrl: `https://${args.projectId}.vibepreview.com`,
        note: a.question
          ? 'The build paused on a question — answer it with answer_studio_question.'
          : 'Open previewUrl in a BROWSER before publishing. Source can read clean while the page fails at runtime.',
      });
    }, args),
  },
  {
    name: 'get_studio_generation_status',
    description: describe('get_studio_generation_status',
      'Resume a generation that had not finished when generate_studio_site (or a prior call to '
      + 'this tool) returned pending. Pass the SAME messageId — the chat receipt\'s message_id — '
      + 'so this only ever resolves the turn you started, never a stale terminal row already '
      + 'sitting in the project\'s history — proof: live-runtime (2026-09-04); risk: read.'),
    inputSchema: schema({ locationId: z.string(), projectId: z.string(), messageId: z.string(),
      waitSeconds: z.number().optional() }),
    capabilities: [
      { method: 'GET', path: '/vibe-ai/projects/{projectId}' },
      { method: 'POST', path: '/v1/projects/highlevel-backend/databases/vibe-platform/documents:runQuery' },
    ],
    handler: async (args, deps) => guard(async () => {
      const { api, history } = studioDeps(args, deps);
      const { error } = await assertProjectLocation(api, args.projectId, args.locationId);
      if (error) return error;
      const turn = await awaitTurn({
        firestore: { messages: (pid) => history(MESSAGES, pid, 'order', 300) },
        projectId: args.projectId, messageId: args.messageId, waitMs: (args.waitSeconds ?? 120) * 1000,
      });
      if (turn.pending) return ok(turn);
      const a = turn.assistant ?? {};
      return ok({ messageId: a.id, versionId: a.versionId ?? null, buildStatus: a.buildStatus,
        summary: a.completionSummary ?? null, question: a.question ?? null });
    }, args),
  },
  {
    name: 'answer_studio_question',
    description: describe('answer_studio_question',
      'Answer a question the AI Studio builder asked mid-build. Pass the answer; the tool reads the '
      + 'stored question and picks the right continuation shape itself. For an INTEGRATION question '
      + '(question.kind is integration_input), `answer` is not free text — pass the id of the '
      + 'integration item the question offered (from question.integrationPrompt.items[].id), or the '
      + 'literal string "dismiss" to decline the integration; the item id itself IS the answer '
      + '— proof: live-runtime (2026-09-04); risk: write.'),
    inputSchema: schema({ locationId: z.string(), projectId: z.string(),
      questionMessageId: z.string(), answer: z.string() }),
    capabilities: [
      { method: 'GET', path: '/vibe-ai/projects/{projectId}' },
      { method: 'POST', path: '/vibe-ai/projects/{projectId}/chat' },
    ],
    handler: async (args, deps) => guard(async () => {
      const { api, history } = studioDeps(args, deps);
      const { error } = await assertProjectLocation(api, args.projectId, args.locationId);
      if (error) return error;
      const rows = await history(MESSAGES, args.projectId, 'order', 300);
      const asked = rows.find((r) => r.id === args.questionMessageId);
      if (!asked?.question) {
        return fail(CODES.VALIDATION_FAILED,
          `message ${args.questionMessageId} carries no question block`,
          'Read get_studio_site_history and answer a message whose hasQuestion is true.');
      }
      const body = answerBodyFor({ question: asked.question, answer: args.answer,
        sessionId: sessionFor(deps.state, args.projectId),
        questionMessageId: args.questionMessageId, loc: args.locationId });
      const res = await api.chat(args.projectId, body);
      return ok({ status: res.status, messageId: res.json?.message_id ?? null,
        answerType: body.answer_type ?? 'plain',
        note: 'A plain answer resumes on the SAME message id. A 409 means this question was already answered.' });
    }, args),
  },
  {
    name: 'cancel_studio_generation',
    description: describe('cancel_studio_generation',
      'Cancel a running AI Studio generation — proof: live-runtime (2026-09-04); risk: write.'),
    inputSchema: schema({ locationId: z.string(), projectId: z.string(), messageId: z.string() }),
    capabilities: [
      { method: 'GET', path: '/vibe-ai/projects/{projectId}' },
      { method: 'POST', path: '/vibe-ai/projects/{projectId}/chat/cancel' },
    ],
    handler: async (args, deps) => guard(async () => {
      const { api } = studioDeps(args, deps);
      const { error } = await assertProjectLocation(api, args.projectId, args.locationId);
      if (error) return error;
      const res = await api.cancelChat(args.projectId, args.messageId);
      return ok({ status: res.json?.status ?? res.status,
        note: 'A cancelled turn is stored with cancelledByUser:true and mints NO version.' });
    }, args),
  },
  {
    name: 'set_studio_secrets',
    description: describe('set_studio_secrets',
      'Set project secrets for an AI Studio site. The write MERGES into the existing map, and values '
      + 'are write-only — reads return names and timestamps only, never values '
      + '— proof: live-runtime (2026-09-04); risk: write.'),
    inputSchema: schema({ locationId: z.string(), projectId: z.string(), secrets: z.record(z.string()) }),
    capabilities: [
      { method: 'GET', path: '/vibe-ai/projects/{projectId}' },
      { method: 'PUT', path: '/vibe-ai/projects/{projectId}/secrets' },
      { method: 'GET', path: '/vibe-ai/projects/{projectId}/secrets' },
    ],
    handler: async (args, deps) => guard(async () => {
      const { api } = studioDeps(args, deps);
      const { error } = await assertProjectLocation(api, args.projectId, args.locationId);
      if (error) return error;
      await api.putSecrets(args.projectId, args.secrets);
      const back = (await api.getSecrets(args.projectId)).json ?? {};
      const names = (back.secrets ?? []).map((s) => s.name);
      const missing = Object.keys(args.secrets).filter((k) => !names.includes(k));
      return ok({ names, missing,
        note: missing.length ? 'Some keys did not appear on read-back.' : 'All keys present. Values are never returned.' });
    }, args),
  },
  {
    name: 'publish_studio_site',
    description: describe('publish_studio_site',
      'Publish an AI Studio site to {slug}.vibepreview.com or its custom domain. OUTWARD-FACING: '
      + 'this puts the site on the public internet. Requires confirm:true — proof: live-runtime (2026-09-04); risk: write.'),
    inputSchema: schema({ locationId: z.string(), projectId: z.string(),
      versionId: z.string(), confirm: z.boolean().optional() }),
    capabilities: [
      { method: 'POST', path: '/vibe-ai/projects/{projectId}/publish' },
      { method: 'GET', path: '/vibe-ai/projects/{projectId}' },
    ],
    handler: async (args, deps) => guard(async () => {
      if (args.confirm !== true) {
        return fail(CODES.VALIDATION_FAILED,
          'publish_studio_site is outward-facing and needs confirm:true',
          'Publishing puts this site on the public internet. Check the preview in a browser and get '
          + 'the operator\'s word, then retry with confirm:true.');
      }
      const { api } = studioDeps(args, deps);
      const { error } = await assertProjectLocation(api, args.projectId, args.locationId);
      if (error) return error;
      const res = await api.publish(args.projectId, args.versionId);
      const back = (await api.getProject(args.projectId)).json ?? {};
      return ok({ status: res.json?.status, liveUrl: res.json?.live_url,
        publishedAt: back.published_at, publishedVersionId: back.published_version_id,
        appliedVerified: Boolean(back.published_at),
        note: 'liveUrl is keyed on the SLUG. Read-back is from the project, not the journal.' });
    }, args),
  },
  {
    name: 'unpublish_studio_site',
    description: describe('unpublish_studio_site',
      'Take an AI Studio site off the public internet. Requires confirm:true — proof: live-runtime (2026-09-04); risk: write.'),
    inputSchema: schema({ locationId: z.string(), projectId: z.string(), confirm: z.boolean().optional() }),
    capabilities: [
      { method: 'POST', path: '/vibe-ai/projects/{projectId}/unpublish' },
      { method: 'GET', path: '/vibe-ai/projects/{projectId}' },
    ],
    handler: async (args, deps) => guard(async () => {
      if (args.confirm !== true) {
        return fail(CODES.VALIDATION_FAILED,
          'unpublish_studio_site takes a live site down and needs confirm:true',
          'Get the operator\'s word, then retry with confirm:true.');
      }
      const { api } = studioDeps(args, deps);
      const { error } = await assertProjectLocation(api, args.projectId, args.locationId);
      if (error) return error;
      const res = await api.unpublish(args.projectId);
      const back = (await api.getProject(args.projectId)).json ?? {};
      return ok({ status: res.json?.status,
        publishedAt: back.published_at, publishedVersionId: back.published_version_id,
        appliedVerified: back.published_at === null,
        note: 'Unpublish journals NOTHING in Firestore — this read-back is the only evidence it happened.' });
    }, args),
  },

  // ── forms ────────────────────────────────────────────────────────────────────────────────────
  //
  // The surface was mapped and live-proven on 2026-09-06 (corpus/forms/**, 133 saved probes) and
  // until now reached an agent only through raw_request, which carries none of the four traps that
  // make this collection hostile:
  //
  //   1. The save is a whole-document REPLACE. Keys you do not send are gone. There is no PATCH —
  //      PUT and PATCH both 404 — so every edit is read-modify-write or it is data loss.
  //   2. A save issued right after the create answers `404 Form does not exist or is deleted`,
  //      seven times out of seven. The replica needs ~5s. A human in the builder never sees it.
  //   3. Reads lag writes by ~4s, so an immediate read-back returns the PREVIOUS document and a
  //      naive verifier reports success on a write that has not landed.
  //   4. Two keys are renamed on write (`formAction.redirect_url` → `redirectUrl`,
  //      `style.ac_branding` → `acBranding`), so a field-by-field read-back comparison that does
  //      not know this reports a mismatch on a correct write.
  //
  // Nothing inside `formData` is validated by the server — an invented key is stored and read back
  // — and `GET /forms/data/{id}` answers with NO credentials, so everything in the document is
  // public. There is no draft state: a form is live at its widget URL the moment it exists.
  {
    name: 'list_forms',
    description: `${describe('list_forms', 'List forms in a sub-account — risk: read')}. `
      + 'Lists forms with their ids, names and folder. `type: "form"` returns forms only — ANY other '
      + 'value, including omitting it, returns forms AND folders in one array, because `type` selects '
      + 'the row kind rather than the productType. Quizzes live on this collection too '
      + '(productType "quiz"); surveys do not. Offset paging via skip/limit. `query` is a '
      + 'case-insensitive substring match on the name. The count endpoint counts forms PLUS folders, '
      + 'so it will not agree with the number of rows here.',
    inputSchema: schema({
      locationId: z.string(),
      query: z.string().optional(),
      parentId: z.string().optional(),
      includeFolders: z.boolean().default(false),
      skip: z.number().default(0),
      limit: z.number().default(20),
    }),
    capabilities: [
      { method: 'GET', path: '/forms/' },
      { method: 'GET', path: '/forms/count' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const q = new URLSearchParams({
        locationId: args.locationId,
        skip: String(args.skip ?? 0),
        limit: String(args.limit ?? 20),
      });
      // Omitting `type` is what returns folders as well — that is the documented switch, not a
      // separate endpoint.
      if (args.includeFolders !== true) q.set('type', 'form');
      if (args.query) q.set('query', args.query);
      if (args.parentId) q.set('parentId', args.parentId);
      const r = await gw.call('GET', `/forms/?${q}`);
      if (!r.ok) return fromHttp(r.status, r.json);
      const rows = (r.json?.forms ?? []).map((f) => ({
        id: f._id ?? f.id,
        name: f.name,
        productType: f.productType ?? null,
        parentId: f.parentId ?? null,
        source: f.source ?? null,
        version: f.version ?? null,
        updatedAt: f.updatedAt ?? f.dateUpdated ?? null,
        versions: Array.isArray(f.versionHistory) ? f.versionHistory.length : null,
      }));
      return ok({
        total: r.json?.total ?? rows.length,
        returned: rows.length,
        forms: rows,
        note: 'List rows carry no formData — read one with get_form to see the document.',
      });
    }, args),
  },
  {
    name: 'get_form',
    description: `${describe('get_form', 'Read one form and its stored document — risk: read')}. `
      + 'Returns the form record plus the whole `formData` document — the fields, the submit action, '
      + 'styling and every key the builder ever wrote. An unknown id answers 400 "Form does not '
      + 'exist", NOT 404. Everything in formData is world-readable through the widget rail, so treat '
      + 'it as public. Pass publicView:true to read exactly what the widget renders instead.',
    inputSchema: schema({
      locationId: z.string(),
      formId: z.string(),
      publicView: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'GET', path: '/forms/{id}' },
      { method: 'GET', path: '/forms/data/{id}' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const id = encodeURIComponent(args.formId);
      const r = await gw.call('GET', args.publicView === true ? `/forms/data/${id}` : `/forms/${id}`);
      if (!r.ok) {
        // GHL answers 400 for an id that does not exist on this collection. Passing that through
        // as a bare 400 reads as "bad request" and sends a caller looking at their own arguments.
        if (r.status === 400 && /does not exist/i.test(JSON.stringify(r.json ?? ''))) {
          return fail(CODES.VALIDATION_FAILED, `no form with id ${args.formId} on this sub-account`,
            'GHL answers 400 (not 404) for an unknown form id. Run list_forms to find the right one.');
        }
        return fromHttp(r.status, r.json);
      }
      const form = r.json?.form ?? r.json ?? {};
      if (args.publicView === true) {
        return ok({ formId: args.formId, name: r.json?.name ?? null, publicDocument: form,
          note: 'This is the widget\'s own read — it answers with NO credentials, so anything here is public.' });
      }
      const fields = form.formData?.form?.fields ?? [];
      return ok({
        formId: form._id ?? args.formId,
        name: form.name,
        productType: form.productType ?? null,
        parentId: form.parentId ?? null,
        version: form.version ?? null,
        versionHistory: Array.isArray(form.versionHistory) ? form.versionHistory.length : null,
        fieldTags: fields.map((f) => f.tag).filter(Boolean),
        formData: form.formData ?? {},
      });
    }, args),
  },
  {
    name: 'create_form',
    description: `${describe('create_form', 'Create a form and save its document — risk: write')}. `
      + 'Preview by default; confirm:true writes. Runs the whole proven sequence: create, WAIT for the '
      + 'replica (a save sent immediately answers 404 "Form does not exist or is deleted", seven times '
      + 'out of seven), save the document, then poll a read-back until the tags you sent come back. '
      + 'A form is LIVE at its public widget URL the moment it exists — there is no draft state — and '
      + 'everything in formData is world-readable, so never put anything private in it.',
    inputSchema: schema({
      locationId: z.string(),
      name: z.string(),
      fields: z.array(z.record(z.any())).optional(),
      formAction: z.record(z.any()).optional(),
      style: z.record(z.any()).optional(),
      parentId: z.string().optional(),
      source: z.string().default('landing_page'),
      confirm: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'POST', path: '/forms/' },
      { method: 'POST', path: '/forms/{id}' },
      { method: 'GET', path: '/forms/{id}' },
    ],
    handler: async (args, deps) => guard(async () => {
      if (typeof args.name !== 'string' || args.name.trim() === '') {
        return fail(CODES.VALIDATION_FAILED, 'name must be a non-empty string', 'Pass the form name.');
      }
      const fields = args.fields ?? [];
      const untagged = fields.map((f, i) => (f && typeof f.tag === 'string' && f.tag ? null : i)).filter((i) => i !== null);
      if (untagged.length) {
        return fail(CODES.VALIDATION_FAILED, `fields[${untagged.join(', ')}] have no 'tag'`,
          'Every element needs a tag: it is the field key the widget renders and the read-back compares on. '
          + 'Standard fields use their name (first_name, email, phone); a custom-field question uses the custom field id.');
      }
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const document = {
        form: {
          fields,
          ...(args.formAction ? { formAction: args.formAction } : {}),
          ...(args.style ? { style: args.style } : {}),
        },
      };
      const preview = {
        creates: { name: args.name, productType: 'form', source: args.source ?? 'landing_page', parentId: args.parentId ?? null },
        document,
        fieldTags: fields.map((f) => f.tag),
        warning: 'The form is PUBLIC the moment it is created — there is no draft state, and formData is readable with no credentials.',
      };
      if (args.confirm !== true) {
        return withFailureData(
          fail(CODES.CONFIRM_REQUIRED, 'Form create preview is ready; no write was sent.',
            'Repeat with confirm:true to create it.'),
          { preview },
        );
      }
      const created = await gw.call('POST', '/forms/', {
        locationId: args.locationId,
        name: args.name,
        productType: 'form',
        source: args.source ?? 'landing_page',
        ...(args.parentId ? { parentId: args.parentId } : {}),
      });
      if (!created.ok) return fromHttp(created.status, created.json);
      const formId = created.json?.form?._id ?? created.json?._id ?? created.json?.id ?? null;
      if (!formId) {
        return withFailureData(
          fail(CODES.ENGINE_ABORT, 'Form create returned 2xx but no form id.',
            'Run list_forms before retrying — a retry would create a second form.'),
          { preview, response: created.json ?? null },
        );
      }
      // THE WAIT. Not defensive padding: seven of seven saves sent immediately after a create
      // answered 404, and the identical bodies succeeded once the id was a minute old. The
      // read-back primitive is the only sleep in this codebase, so the first save runs as its
      // predicate rather than hand-rolling a timer.
      const saved = await gw.readBackUntil(async () => {
        const s = await gw.call('POST', `/forms/${encodeURIComponent(formId)}`, { name: args.name, formData: document });
        return s.ok ? s : null;
      }, { pollMs: 3000, maxPolls: 4 });
      if (!saved.hit) {
        return withFailureData(
          fail(CODES.ENGINE_ABORT, `The form was created (${formId}) but every save attempt failed.`,
            'The form exists and is EMPTY. Do not create another — call update_form_data on this id.'),
          { formId, preview, attempts: saved.attempts },
        );
      }
      // Reads lag writes by seconds; a single immediate read returns the PREVIOUS document, which
      // is how a verifier reports success on a write that has not landed. Compare on tags.
      const want = fields.map((f) => f.tag).filter(Boolean);
      const back = await gw.readBackUntil(async () => {
        const g = await gw.call('GET', `/forms/${encodeURIComponent(formId)}`);
        const got = (g.json?.form?.formData?.form?.fields ?? []).map((f) => f.tag).filter(Boolean);
        return want.every((t) => got.includes(t)) ? got : null;
      }, { pollMs: 2000, maxPolls: 4 });
      return ok({
        formId,
        verified: Boolean(back.hit),
        readBackAttempts: back.attempts,
        fieldTags: back.hit ?? want,
        widgetUrl: `https://api.leadconnectorhq.com/widget/form/${formId}`,
        ...(back.hit ? {} : { note: `Saved, but the document had not appeared after ${back.attempts} read-backs. Reads lag writes by seconds — read it again with get_form before assuming it is wrong.` }),
      });
    }, args),
  },
  {
    name: 'update_form_data',
    description: `${describe('update_form_data', 'Edit a form\'s stored document safely — risk: write')}. `
      + 'Preview by default; confirm:true writes. THE SAVE IS A WHOLE-DOCUMENT REPLACE and there is no '
      + 'PATCH — PUT and PATCH both 404 — so this reads the current document first, merges your change '
      + 'into it and writes the whole thing back. The preview shows exactly which top-level keys of '
      + '`formData.form` would change. Two keys are renamed by the server on write '
      + '(formAction.redirect_url → redirectUrl, style.ac_branding → acBranding), so the read-back '
      + 'compares on the names GHL stores, not the ones you sent.',
    inputSchema: schema({
      locationId: z.string(),
      formId: z.string(),
      fields: z.array(z.record(z.any())).optional(),
      formAction: z.record(z.any()).optional(),
      style: z.record(z.any()).optional(),
      name: z.string().optional(),
      confirm: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'GET', path: '/forms/{id}' },
      { method: 'POST', path: '/forms/{id}' },
    ],
    handler: async (args, deps) => guard(async () => {
      const patch = ['fields', 'formAction', 'style'].filter((k) => args[k] !== undefined);
      if (!patch.length && args.name === undefined) {
        return fail(CODES.VALIDATION_FAILED, 'nothing to change',
          'Pass at least one of fields, formAction, style or name.');
      }
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const id = encodeURIComponent(args.formId);
      const current = await gw.call('GET', `/forms/${id}`);
      if (!current.ok) {
        if (current.status === 400 && /does not exist/i.test(JSON.stringify(current.json ?? ''))) {
          return fail(CODES.VALIDATION_FAILED, `no form with id ${args.formId} on this sub-account`,
            'GHL answers 400 (not 404) for an unknown form id.');
        }
        return fromHttp(current.status, current.json);
      }
      const form = current.json?.form ?? {};
      const before = form.formData?.form ?? {};
      const after = { ...before };
      for (const k of patch) after[k] = args[k];
      const name = args.name ?? form.name;
      const preview = {
        formId: args.formId,
        name,
        changes: patch.map((k) => ({
          key: k,
          from: k === 'fields' ? `${(before.fields ?? []).length} element(s)` : (before[k] === undefined ? '(absent)' : 'present'),
          to: k === 'fields' ? `${(args.fields ?? []).length} element(s)` : 'replaced',
        })),
        ...(args.name !== undefined && args.name !== form.name ? { rename: { from: form.name, to: args.name } } : {}),
        preservedKeys: Object.keys(before).filter((k) => !patch.includes(k)),
        note: 'Keys under preservedKeys are re-sent verbatim. Without that they would be DELETED — the save replaces the document.',
      };
      if (args.confirm !== true) {
        return withFailureData(
          fail(CODES.CONFIRM_REQUIRED, 'Form update preview is ready; no write was sent.',
            'Repeat with confirm:true to apply it.'),
          { preview },
        );
      }
      // The whole document, including every key we are not touching. This is the entire reason the
      // tool exists: a bare POST of just the changed key silently deletes the rest.
      const saved = await gw.call('POST', `/forms/${id}`, {
        name,
        formData: { ...(form.formData ?? {}), form: after },
      });
      if (!saved.ok) return fromHttp(saved.status, saved.json);
      // GHL renames two keys on write. Comparing on the names we SENT would report a mismatch on a
      // perfectly good save, which is how a verifier trains people to ignore it.
      const RENAMED = { redirect_url: 'redirectUrl', ac_branding: 'acBranding' };
      const stored = (obj) => Object.fromEntries(Object.entries(obj ?? {}).map(([k, v]) => [RENAMED[k] ?? k, v]));
      const wantTags = (args.fields ?? after.fields ?? []).map((f) => f.tag).filter(Boolean);
      const wantAction = args.formAction ? Object.keys(stored(args.formAction)) : [];
      const back = await gw.readBackUntil(async () => {
        const g = await gw.call('GET', `/forms/${id}`);
        const doc = g.json?.form?.formData?.form ?? {};
        const tags = (doc.fields ?? []).map((f) => f.tag).filter(Boolean);
        const tagsOk = wantTags.every((t) => tags.includes(t));
        const actionOk = wantAction.every((k) => (doc.formAction ?? {})[k] !== undefined);
        return tagsOk && actionOk ? { tags, formAction: doc.formAction ?? null } : null;
      }, { pollMs: 2000, maxPolls: 4 });
      return ok({
        formId: args.formId,
        verified: Boolean(back.hit),
        readBackAttempts: back.attempts,
        fieldTags: back.hit?.tags ?? wantTags,
        preservedKeys: preview.preservedKeys,
        ...(back.hit ? {} : { note: `Saved, but the change had not appeared after ${back.attempts} read-backs. Reads lag writes by seconds — read it again with get_form before re-sending.` }),
      });
    }, args),
  },
  {
    name: 'list_form_submissions',
    description: `${describe('list_form_submissions', 'List form submissions — risk: read')}. `
      + 'Submissions for one form, or for the whole sub-account when formId is omitted. This endpoint '
      + 'pages with `page`, NOT `skip` — sending skip is a 422. The separate count endpoint takes a '
      + 'date range and refuses formId, so a per-form count is the length of these rows.',
    inputSchema: schema({
      locationId: z.string(),
      formId: z.string().optional(),
      page: z.number().default(1),
      limit: z.number().default(20),
    }),
    capabilities: [{ method: 'GET', path: '/forms/submissions' }],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const q = new URLSearchParams({
        locationId: args.locationId,
        page: String(args.page ?? 1),
        limit: String(args.limit ?? 20),
      });
      if (args.formId) q.set('formId', args.formId);
      const r = await gw.call('GET', `/forms/submissions?${q}`);
      if (!r.ok) return fromHttp(r.status, r.json);
      const rows = r.json?.submissions ?? r.json?.data ?? [];
      return ok({
        page: args.page ?? 1,
        returned: Array.isArray(rows) ? rows.length : 0,
        meta: r.json?.meta ?? null,
        submissions: rows,
      });
    }, args),
  },
  // ── smart lists ──────────────────────────────────────────────────────────────────────────────
  //
  // READ ONLY, deliberately. A smart list create is effectively PERMANENT — `DELETE
  // /contacts/smartlist/{id}` is 404 no-such-route, `PUT {deleted:true}` is refused 422, and
  // `DELETE /lists/dynamic/{loc}/{id}` answers 200 while the record survives in the projection the
  // contacts screen actually reads. Removal is UI-only. So the write half needs the operator's
  // word, and what this tool does instead is find the lists that are ALREADY broken.
  //
  // WHY IT EXISTS. `filterSpecs.filters` must be nested TWO levels — an outer group whose children
  // are groups, leaves inside those. A one-level shape (a single group holding leaves directly,
  // which is exactly what POST /contacts/search/2 takes and what any reasonable caller writes) is
  // accepted with a 201, reads back byte-identical, returns the right rows from the search
  // endpoint, and is DISCARDED by the contacts screen at load. The list then renders the ENTIRE
  // account: header count is the account total, untagged contacts at the top. Five lists across
  // three client accounts were in that state on 2026-09-07 and every API check agreed they were
  // fine.
  //
  // That is a failure class no read-back can catch, so it is caught structurally here instead: the
  // stored shape is compared against the one a human built in the UI. The corpus page's own create
  // example still shows the one-level shape, which is the best argument that prose does not
  // prevent this.
  // ── Snapshots ───────────────────────────────────────────────────────────────────────────────
  // AGENCY-scoped, unlike everything else here: a mistake is not confined to one sub-account.
  // Every tool resolves companyId from the location rather than guessing it — it is NOT in the JWT.
  {
    name: 'list_snapshots',
    description: `${describe('list_snapshots', 'List the agency\'s snapshots — risk: read')}. `
      + 'Agency-scoped: the companyId is resolved from the sub-account you name, because it is not '
      + 'carried in the credential. Reports each snapshot\'s processing state, since a snapshot reads '
      + '`processing` for a while after it is made and reading its contents too early answers '
      + '400 "Can\'t find account data".',
    inputSchema: schema({
      locationId: z.string(),
      limit: z.number().int().min(1).max(100).default(20),
      skip: z.number().int().min(0).default(0),
    }),
    capabilities: [
      { method: 'GET', path: '/locations/{locationId}' },
      { method: 'GET', path: '/snapshots/v2/{companyId}' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const companyId = await resolveCompanyId(gw, args.locationId);
      if (!companyId) {
        return fail(CODES.VALIDATION_FAILED, 'could not resolve the agency id for this sub-account',
          'Snapshots are agency-scoped and every route needs ?companyId=. It is not in the credential, so it is read from '
          + 'GET /locations/{locationId}; that read did not return one. Check the location id.');
      }
      const q = new URLSearchParams({ companyId, skip: String(args.skip ?? 0), limit: String(args.limit ?? 20), type: 'own' });
      const r = await gw.call('GET', `/snapshots/v2/${encodeURIComponent(companyId)}?${q}`);
      if (!r.ok) return fromHttp(r.status, r.json);
      const rows = r.json?.snapshots ?? r.json?.data ?? (Array.isArray(r.json) ? r.json : []);
      return ok({
        companyId,
        count: Array.isArray(rows) ? rows.length : 0,
        snapshots: (Array.isArray(rows) ? rows : []).map((s) => ({
          id: s.id ?? s._id ?? null,
          name: s.name ?? null,
          status: s.status ?? null,
          locationId: s.location_id ?? s.locationId ?? null,
          updatedAt: s.updatedAt ?? s.dateUpdated ?? null,
        })),
        note: 'A snapshot in `processing` is not readable yet — its contents answer 400 "Can\'t find account data" until dehydration finishes.',
      });
    }, args),
  },
  {
    name: 'get_snapshot_manifest',
    description: `${describe('get_snapshot_manifest', 'Read everything a sub-account could put in a snapshot — risk: read')}. `
      + 'One call returns every category: preFetchAssets with NO assetType returns the lot, which is '
      + 'the shape to build a selection from. Workflow folders live inside `workflow`, field folders '
      + 'inside `custom_fields`. Read this BEFORE create_snapshot — an id that is not in here is '
      + 'accepted by the create with a 200 and silently produces an empty snapshot.',
    inputSchema: schema({ locationId: z.string() }),
    capabilities: [
      { method: 'GET', path: '/locations/{locationId}' },
      { method: 'GET', path: '/snapshots/v2/preFetchAssets/{locationId}' },
      { method: 'GET', path: '/snapshots/assets/asset-names' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const companyId = await resolveCompanyId(gw, args.locationId);
      if (!companyId) return fail(CODES.VALIDATION_FAILED, 'could not resolve the agency id for this sub-account', 'See list_snapshots.');
      const pre = await gw.call('GET', `/snapshots/v2/preFetchAssets/${encodeURIComponent(args.locationId)}?companyId=${encodeURIComponent(companyId)}`);
      if (!pre.ok) return fromHttp(pre.status, pre.json);
      const names = await gw.call('GET', `/snapshots/assets/asset-names?locationId=${encodeURIComponent(args.locationId)}&companyId=${encodeURIComponent(companyId)}`);
      const index = manifestIndex(pre.json);
      const categories = Object.entries(index)
        .map(([category, ids]) => ({ category, count: ids.size }))
        .filter((c) => c.count > 0)
        .sort((a, b) => b.count - a.count);
      return ok({
        companyId,
        categories,
        totalAssets: categories.reduce((n, c) => n + c.count, 0),
        assetNames: names.ok ? (names.json?.assets ?? names.json?.data ?? names.json ?? null) : null,
        ...(names.ok ? {} : { assetNamesNote: `the category-name read answered ${names.status}; the manifest above is still usable` }),
        note: 'These are the ids create_snapshot validates against. Anything outside this set is accepted by the create and captured as nothing.',
      });
    }, args),
  },
  {
    name: 'check_snapshot_conflicts',
    description: `${describe('check_snapshot_conflicts', 'See what loading a snapshot would collide with — risk: read')}. `
      + 'Non-destructive, and the safe way to preview a load. It refuses the key names the UI itself '
      + 'shows: `locationIds` and `selectedAssets` answer 400 ["Required","Required"]. The real names '
      + 'are `selectedLocationIds` and `selectedSnapshotAssets`, and this tool sends those. '
      + '`assets` is REQUIRED — there is no "check everything" call; an empty selection answers '
      + '400 ["selectedSnapshotAssets must contain at least one asset key"]. Get the ids from '
      + 'get_snapshot_manifest. '
      + '🔴 A conflict means "this snapshot has been pushed to this account BEFORE" — NOT "the '
      + 'target already has something like this". Settled 2026-09-09 by a four-cell differential: '
      + 'the snapshot\'s own source account, which holds every asset by the same id and name, '
      + 'reported ZERO conflicts, while the one account previously loaded from it reported all ten. '
      + 'So this NEVER reports an asset the operator built by hand, and an EMPTY result means only '
      + '"not loaded here before" — which is exactly when a first load is most likely to land on '
      + 'top of hand-built work. Treat empty as no information, never as clearance.',
    inputSchema: schema({
      locationId: z.string(),
      snapshotId: z.string(),
      targetLocationIds: z.array(z.string()).min(1),
      // Required by the API, not optional: an empty selection is a 400. Kept as a distinct
      // refusal rather than a default {} so the caller sees WHY rather than a bare upstream 400.
      assets: z.record(z.any()),
    }),
    capabilities: [
      { method: 'GET', path: '/locations/{locationId}' },
      { method: 'POST', path: '/snapshots/{snapshotId}/conflicts' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const companyId = await resolveCompanyId(gw, args.locationId);
      if (!companyId) return fail(CODES.VALIDATION_FAILED, 'could not resolve the agency id for this sub-account', 'See list_snapshots.');
      if (!args.assets || Object.keys(args.assets).length === 0) {
        return fail(CODES.VALIDATION_FAILED,
          'assets must name at least one category — there is no "check everything" call',
          'Read the snapshot with get_snapshot_manifest and pass e.g. {"workflow": ["<id>"]}.');
      }
      const body = {
        [CONFLICT_KEYS.locations]: args.targetLocationIds,
        [CONFLICT_KEYS.assets]: args.assets,
      };
      const r = await gw.call('POST', `/snapshots/${encodeURIComponent(args.snapshotId)}/conflicts?companyId=${encodeURIComponent(companyId)}`, body);
      if (!r.ok) return fromHttp(r.status, r.json);
      return ok({
        companyId,
        snapshotId: args.snapshotId,
        sentKeys: Object.keys(body),
        conflicts: r.json?.conflicts ?? r.json?.data ?? r.json ?? null,
        note: 'This call changes nothing. It is the only way to see what a load would overwrite before running one.',
      });
    }, args),
  },
  {
    name: 'push_snapshot',
    description: `${describe('push_snapshot', 'Load a snapshot into sub-accounts — risk: destructive')}. `
      + 'Preview by default; confirm:true writes. THE MOST DANGEROUS CALL HERE — it writes into OTHER '
      + 'sub-accounts, and the response is only "queued", so nothing can be read back to confirm it. '
      + '`assets` is REQUIRED and explicit: the wizard shows no Workflows row while the body it sends '
      + 'carries every workflow id in the snapshot, so a tool that mirrors the UI ships workflows '
      + 'nobody chose. This one loads exactly what you name. '
      + '🔴 LOADED WORKFLOWS ARRIVE PUBLISHED when the source workflow is published — that is how 26 '
      + 'went live on an account taking ~230 enrollments a week. This refuses to load published '
      + 'workflows unless allowPublishedWorkflows:true, and either way hands back the stand-down plan. '
      + 'Conflicts NEVER cover assets the operator built by hand: a conflict means "this snapshot '
      + 'was pushed here before" (settled 2026-09-09), so an empty result is not clearance. '
      + 'Duplicate anything customised on the target BEFORE loading — that is the only protection.',
    inputSchema: schema({
      locationId: z.string(),
      snapshotId: z.string(),
      targetLocationIds: z.array(z.string()).min(1).max(50),
      assets: z.record(z.any()),
      allowPublishedWorkflows: z.boolean().default(false),
      overwriteConflicts: z.boolean().default(false),
      confirm: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'GET', path: '/locations/{locationId}' },
      { method: 'GET', path: '/snapshots-appengine/snapshot/{snapshotId}/get_assets' },
      { method: 'GET', path: '/snapshots/v2/{companyId}' },
      { method: 'GET', path: '/workflow/{loc}/{wid}' },
      { method: 'POST', path: '/snapshots/snapshot-push/v2/{snapshotId}/set_assets_to_locations' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const companyId = await resolveCompanyId(gw, args.locationId);
      if (!companyId) return fail(CODES.VALIDATION_FAILED, 'could not resolve the agency id for this sub-account', 'See list_snapshots.');

      const categories = nonEmptyCategories(args.assets);
      if (categories.length === 0) {
        return fail(CODES.VALIDATION_FAILED,
          'assets must name at least one id — a push with nothing selected is never what you meant',
          'Read the snapshot with get_snapshot_manifest and pass e.g. {"workflow": ["<id>"]}.');
      }

      // The snapshot's own manifest. An id that is not in it is accepted by the push and silently
      // loads nothing, so it is caught here rather than discovered on the target account.
      const man = await gw.call('GET', `/snapshots-appengine/snapshot/${encodeURIComponent(args.snapshotId)}/get_assets?type=own&companyId=${encodeURIComponent(companyId)}`);
      if (!man.ok) {
        // fromHttp takes (status, body) only — a third "remediation" argument is silently dropped,
        // which is how a caller ends up with a bare 400 and no idea a dehydrating snapshot is the
        // usual cause. So the guidance is attached explicitly.
        const base = fromHttp(man.status, man.json);
        return {
          ...base,
          remediation: man.status === 400
            ? 'The snapshot is unreadable. A snapshot still dehydrating answers 400 "Can\'t find account data" — check its status with list_snapshots and retry once it is not processing.'
            : base.remediation,
        };
      }
      const index = manifestIndex(man.json);
      const check = checkSelection(args.assets, index, new Set(Object.keys(index)));
      if (check.unknownIds.length || check.unknownCategories.length) {
        return withFailureData(
          fail(CODES.VALIDATION_FAILED,
            `${check.unknownIds.length} id(s) and ${check.unknownCategories.length} category(ies) are not in this snapshot`,
            'The push accepts them with a 201 and loads nothing. Fix the selection against get_snapshot_manifest.'),
          { unknownIds: check.unknownIds, unknownCategories: check.unknownCategories });
      }

      // RAIL 1 — published workflows. The source account is the snapshot's own location, and a
      // workflow that is published THERE arrives published on every target.
      const wanted = [...(args.assets.workflow ?? [])];
      const workflows = [];
      // WHERE THE SOURCE ACCOUNT COMES FROM, and it is not where you would look first.
      // get_assets returns the snapshot's CONTENTS and carries no locationId, so reading it there
      // silently yields null and the published-workflow rail degrades to "undetermined" for every
      // id — safe, but inert. The snapshot LIST is what carries `locationId` per row.
      let sourceLoc = null;
      if (wanted.length) {
        const list = await gw.call('GET', `/snapshots/v2/${encodeURIComponent(companyId)}?limit=100&skip=0`);
        const rows = list.json?.snapshots ?? list.json?.data ?? (Array.isArray(list.json) ? list.json : []);
        const row = (Array.isArray(rows) ? rows : []).find((x) => (x?._id ?? x?.id) === args.snapshotId);
        sourceLoc = row?.locationId ?? man.json?.locationId ?? man.json?.data?.locationId ?? null;
      }
      let sourceReadable = false;
      if (wanted.length && sourceLoc) {
        for (const id of wanted) {
          const r = await getWorkflow(gw, sourceLoc, id);
          if (r.ok) sourceReadable = true;
          workflows.push({ workflowId: id, status: r.ok ? (r.json?.status ?? null) : null, name: r.ok ? (r.json?.name ?? null) : null });
        }
      }
      const published = workflows.filter((w) => w.status === 'published');
      // A folder id sits in `workflow` too and never reads as a workflow, so "unknown" here is not
      // the same as "not published" and is reported separately rather than folded into either.
      const undetermined = wanted.length && (!sourceLoc || !sourceReadable)
        ? wanted
        : workflows.filter((w) => w.status === null).map((w) => w.workflowId);

      const standDown = {
        why: 'Loaded workflows arrive PUBLISHED when the source is published, and the push response never says so.',
        howToFind: 'The load mints NEW ids on each target, so the pushed ids below cannot be used there. After the load finishes, list each target with list_workflows and match by NAME.',
        names: workflows.filter((w) => w.name).map((w) => w.name),
        then: 'unpublish_workflows({locationId: "<target>", workflowIds: [...], confirm: true})',
      };

      if (published.length && args.allowPublishedWorkflows !== true) {
        return withFailureData(
          fail(CODES.VALIDATION_FAILED,
            `${published.length} of ${wanted.length} selected workflows are PUBLISHED on the source and will arrive live on every target.`,
            'Stand them down on the SOURCE first, or pass allowPublishedWorkflows:true and use the returned standDown plan immediately after the load.'),
          { publishedOnSource: published, targets: args.targetLocationIds, standDown });
      }

      const body = buildPushBody(args.targetLocationIds, args.assets, { overwriteConflicts: args.overwriteConflicts });

      if (args.confirm !== true) {
        return withFailureData(
          fail(CODES.CONFIRM_REQUIRED,
            `Push preview: ${check.requested} asset(s) across ${categories.length} category(ies) into ${args.targetLocationIds.length} sub-account(s). No write was sent.`,
            'Review data.preview, then repeat with confirm:true.'),
          {
            preview: {
              companyId,
              snapshotId: args.snapshotId,
              targets: args.targetLocationIds,
              categories,
              assetCount: check.requested,
              workflows: workflows.length ? workflows : undefined,
              publishedOnSource: published.length ? published : undefined,
              undeterminedWorkflows: undetermined.length ? undetermined : undefined,
              overwriteConflicts: args.overwriteConflicts,
              standDown: wanted.length ? standDown : undefined,
              warnings: [
                'The push answers "queued". Nothing here can be read back to confirm what it wrote.',
                'Conflicts only cover what THIS snapshot loaded here before — never assets built by hand on the target. An empty result is not clearance.',
                ...(undetermined.length ? [`${undetermined.length} selected workflow id(s) could not be read on the source, so their published state is UNKNOWN — a folder id looks like this too.`] : []),
              ],
            },
          },
        );
      }

      const r = await gw.call('POST', `/snapshots/snapshot-push/v2/${encodeURIComponent(args.snapshotId)}/set_assets_to_locations?companyId=${encodeURIComponent(companyId)}`, body);
      if (!r.ok) return fromHttp(r.status, r.json);

      // Deliberately NO read-back claim. The push is queued; the assets do not exist on the target
      // yet, and reporting "verified" from a 201 would be the exact failure this plugin refuses
      // everywhere else.
      return ok({
        companyId,
        snapshotId: args.snapshotId,
        targets: args.targetLocationIds,
        categories,
        assetCount: check.requested,
        queued: true,
        verified: false,
        response: r.json ?? null,
        standDown: wanted.length ? standDown : undefined,
        note: 'QUEUED, NOT APPLIED. The response says nothing about what was written. Check each target before assuming the load landed'
            + (wanted.length ? ', and stand down the loaded workflows now — see standDown.' : '.'),
      });
    }, args),
  },
  {
    name: 'create_snapshot',
    description: `${describe('create_snapshot', 'Capture a sub-account into an agency snapshot — risk: write')}. `
      + 'Preview by default; confirm:true writes. AGENCY-SCOPED — this creates an object on the agency, '
      + 'not inside one sub-account. Uses the appengine create, NOT /snapshots/create: the legacy one '
      + 'returns 201, hangs in `processing`, captures any category you OMIT whole, and ignores '
      + 'exemptClone. Every id you name is checked against the account\'s own manifest first, because '
      + 'a bad id, a bad category or a mismatched location answers 200 and produces an EMPTY snapshot '
      + 'with nothing reported. After the write it polls until dehydration finishes and DIFFS the '
      + 'stored contents against what you asked for — that diff is the only thing that catches it.',
    inputSchema: schema({
      locationId: z.string(),
      name: z.string(),
      selectedAssets: z.record(z.array(z.string())),
      confirm: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'GET', path: '/locations/{locationId}' },
      { method: 'GET', path: '/snapshots/v2/preFetchAssets/{locationId}' },
      { method: 'POST', path: '/snapshots-appengine/v2/snapshots' },
      { method: 'GET', path: '/snapshots-appengine/snapshot/{snapshotId}/get_assets' },
    ],
    handler: async (args, deps) => guard(async () => {
      if (typeof args.name !== 'string' || args.name.trim() === '') {
        return fail(CODES.VALIDATION_FAILED, 'name must be a non-empty string', 'Snapshot names are unvalidated by the server, so a blank one is accepted and unusable.');
      }
      const categories = Object.keys(args.selectedAssets ?? {});
      if (!categories.length) {
        return fail(CODES.VALIDATION_FAILED, 'selectedAssets is empty',
          'A snapshot with no selection is not "everything" on the appengine path — it is nothing. Name the categories and ids you want; '
          + 'get_snapshot_manifest lists what this account has.');
      }
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const companyId = await resolveCompanyId(gw, args.locationId);
      if (!companyId) return fail(CODES.VALIDATION_FAILED, 'could not resolve the agency id for this sub-account', 'See list_snapshots.');

      // THE PREFLIGHT that trap 3 requires. Nothing else catches a bad id.
      const pre = await gw.call('GET', `/snapshots/v2/preFetchAssets/${encodeURIComponent(args.locationId)}?companyId=${encodeURIComponent(companyId)}`);
      const index = pre.ok ? manifestIndex(pre.json) : {};
      const known = new Set(Object.keys(index));
      const check = checkSelection(args.selectedAssets, index, known);
      if (pre.ok && (check.unknownIds.length || check.unknownCategories.length)) {
        return withFailureData(
          fail(CODES.VALIDATION_FAILED,
            `${check.unknownIds.length} id(s) and ${check.unknownCategories.length} category name(s) are not in this account's manifest`,
            'The create would answer 200 and capture them as NOTHING — an empty snapshot with no error. Read get_snapshot_manifest '
            + 'and use ids from it. Nothing was written.'),
          { unknownIds: check.unknownIds, unknownCategories: check.unknownCategories, knownCategories: [...known] },
        );
      }

      const body = {
        name: args.name,
        location_id: args.locationId,
        company_id: companyId,
        selectedAssets: args.selectedAssets,
        exemptClone: [],
      };
      const preview = {
        endpoint: 'POST /snapshots-appengine/v2/snapshots (NOT /snapshots/create)',
        creates: body,
        requestedAssets: check.requested,
        manifestChecked: pre.ok,
        ...(pre.ok ? {} : { manifestNote: `the account manifest could not be read (${pre.status}), so the ids were NOT validated — a bad one would produce an empty snapshot silently` }),
        scope: 'AGENCY-LEVEL. This object belongs to the agency, not to the sub-account it captures.',
      };
      if (args.confirm !== true) {
        return withFailureData(
          fail(CODES.CONFIRM_REQUIRED, 'Snapshot create preview is ready; no write was sent.', 'Repeat with confirm:true to create it.'),
          { preview },
        );
      }
      const created = await gw.call('POST', `/snapshots-appengine/v2/snapshots?companyId=${encodeURIComponent(companyId)}`, body);
      if (!created.ok) return fromHttp(created.status, created.json);
      const snapshotId = created.json?.snapshot?.id ?? created.json?.id ?? created.json?._id ?? null;
      if (!snapshotId) {
        return withFailureData(
          fail(CODES.ENGINE_ABORT, 'the create returned 2xx but no snapshot id.',
            'Run list_snapshots before retrying — a retry would create a second snapshot on the agency.'),
          { preview, response: created.json ?? null },
        );
      }
      // Dehydration is asynchronous; reading contents too early answers 400 "Can't find account data".
      const back = await gw.readBackUntil(async () => {
        const g = await gw.call('GET', `/snapshots-appengine/snapshot/${encodeURIComponent(snapshotId)}/get_assets?type=own&companyId=${encodeURIComponent(companyId)}`);
        return g.ok ? g.json : null;
      }, { pollMs: 4000, maxPolls: 6 });
      const storedIndex = back.hit ? manifestIndex(back.hit) : {};
      const missing = back.hit ? diffStored(args.selectedAssets, storedIndex) : null;
      return ok({
        snapshotId,
        companyId,
        name: args.name,
        readBack: Boolean(back.hit),
        readBackAttempts: back.attempts,
        ...(missing ? { requestedButNotStored: missing } : {}),
        ...(missing && missing.length
          ? { alarm: `${missing.length} requested asset(s) are NOT in the stored snapshot. The create reported success anyway — this is the silent-empty case, and the diff is the only thing that shows it.` }
          : {}),
        ...(back.hit ? {} : { note: `contents were still not readable after ${back.attempts} polls. That is normal while it dehydrates — read it again with list_snapshots, then verify the contents yourself.` }),
        verification: 'A 200 from this endpoint does not mean the assets were captured. The diff above is the check that matters.',
      });
    }, args),
  },
  {
    name: 'refresh_snapshot',
    description: `${describe('refresh_snapshot', 'Re-capture a snapshot without losing its curation — risk: write')}. `
      + 'Preview by default; confirm:true writes. 🔴 A refresh with an EMPTY `extras` re-captures the '
      + 'WHOLE account and silently replaces a carefully curated snapshot with everything. This tool '
      + 'will not send one: you must pass the selection to keep, and the preview shows exactly what '
      + 'will be re-sent.',
    inputSchema: schema({
      locationId: z.string(),
      snapshotId: z.string(),
      selectedAssets: z.record(z.array(z.string())),
      exemptClone: z.array(z.string()).default([]),
      confirm: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'GET', path: '/locations/{locationId}' },
      { method: 'POST', path: '/snapshots-appengine/v2/snapshots/{snapshotId}/refresh' },
    ],
    handler: async (args, deps) => guard(async () => {
      if (!Object.keys(args.selectedAssets ?? {}).length) {
        return fail(CODES.VALIDATION_FAILED, 'selectedAssets is empty, and an empty refresh is destructive',
          'A refresh whose `extras` carries no selection re-captures the WHOLE account and overwrites the curation this '
          + 'snapshot was made for. Re-send the selection you want kept — read the current contents first if you do not know it.');
      }
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const companyId = await resolveCompanyId(gw, args.locationId);
      if (!companyId) return fail(CODES.VALIDATION_FAILED, 'could not resolve the agency id for this sub-account', 'See list_snapshots.');
      const body = { extras: { selectedAssets: args.selectedAssets, exemptClone: args.exemptClone ?? [] } };
      const preview = {
        resends: body,
        categories: Object.keys(args.selectedAssets),
        warning: 'A refresh REPLACES the snapshot\'s contents. Anything not in the selection above will not be in it afterwards.',
        scope: 'AGENCY-LEVEL.',
      };
      if (args.confirm !== true) {
        return withFailureData(
          fail(CODES.CONFIRM_REQUIRED, 'Snapshot refresh preview is ready; no write was sent.', 'Repeat with confirm:true to refresh it.'),
          { preview },
        );
      }
      const r = await gw.call('POST', `/snapshots-appengine/v2/snapshots/${encodeURIComponent(args.snapshotId)}/refresh?companyId=${encodeURIComponent(companyId)}`, body);
      if (!r.ok) return fromHttp(r.status, r.json);
      return ok({
        snapshotId: args.snapshotId,
        companyId,
        resentCategories: Object.keys(args.selectedAssets),
        note: 'Dehydration is asynchronous. The snapshot will read `processing` for a while; verify its contents once it settles rather than assuming.',
      });
    }, args),
  },
  {
    name: 'create_smart_list',
    description: `${describe('create_smart_list', 'Create a smart list whose filter the contacts screen will actually apply — risk: write')}. `
      + 'Preview by default; confirm:true writes. You pass FLAT conditions and this builds the envelope: '
      + '`filterSpecs.filters` has to be nested TWO levels (an outer group whose children are groups) '
      + 'and the one-level shape any reasonable caller writes — the same one POST /contacts/search/2 '
      + 'takes — is accepted with a 201, reads back byte-identical, and is then DISCARDED by the '
      + 'contacts screen, which renders the entire account. Because no read-back can catch that, this '
      + 'refuses to write a filter naming a field the account does not offer, checks the built envelope '
      + 'with the same classifier check_smart_lists audits with, and runs a count differential through '
      + 'the search endpoint first so you see how many contacts the filter matches against the account '
      + 'total. Removal is UI-only: DELETE 404s on this rail and PUT {deleted:true} is refused.',
    inputSchema: schema({
      locationId: z.string(),
      listName: z.string(),
      conditions: z.array(z.record(z.any())).optional(),
      groups: z.array(z.object({
        match: z.enum(['AND', 'OR']).optional(),
        conditions: z.array(z.record(z.any())),
      })).optional(),
      outerMatch: z.enum(['AND', 'OR']).default('OR'),
      columns: z.array(z.string()).optional(),
      confirm: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'POST', path: '/contacts/smartlist/' },
      { method: 'GET', path: '/contacts/smartlist/{id}' },
      { method: 'POST', path: '/contacts/search/2' },
      { method: 'GET', path: '/locations/{locationId}/customFields' },
    ],
    handler: async (args, deps) => guard(async () => {
      if (typeof args.listName !== 'string' || args.listName.trim() === '') {
        return fail(CODES.VALIDATION_FAILED, 'listName must be a non-empty string',
          'The field is `listName`, not `name` — `name` is refused outright by the DTO validator, and an empty string 422s.');
      }
      if (args.conditions && args.groups) {
        return fail(CODES.VALIDATION_FAILED, 'pass either conditions or groups, not both',
          'Use `conditions` for a single AND group. Use `groups` when you need several groups combined by outerMatch.');
      }
      const groups = args.groups?.length
        ? args.groups
        : (args.conditions?.length ? [{ match: 'AND', conditions: args.conditions }] : null);
      if (!groups) {
        return fail(CODES.VALIDATION_FAILED, 'a smart list needs at least one condition',
          'An empty filter is not "unconfigured" on this surface — it means SHOW EVERY CONTACT, which is '
          + 'exactly what the screen\'s broken Copy/Save-as path produces. Pass conditions, e.g. '
          + '[{field:"tags", operator:"eq", value:["my-tag"], options:{minimumMatch:"all"}}].');
      }
      const allLeaves = groups.flatMap((g) => g.conditions ?? []);
      if (!allLeaves.length) {
        return fail(CODES.VALIDATION_FAILED, 'every group is empty', 'Each group needs at least one condition.');
      }
      const nameless = allLeaves.map((c, i) => (c && typeof c.field === 'string' && c.field ? null : i)).filter((i) => i !== null);
      if (nameless.length) {
        return fail(CODES.VALIDATION_FAILED, `condition(s) ${nameless.join(', ')} have no 'field'`,
          'Every leaf needs a `field` from the contact filter DSL, e.g. "tags", "email", or "custom_fields.<customFieldId>".');
      }

      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });

      // THE FIELD CATALOGUE, rebuilt exactly as the browser builds it. No endpoint serves it: the
      // contacts screen unions a static list compiled into its own chunk with the account's own
      // custom fields, and DROPS any filter naming something outside that union — rendering the
      // whole account and keeping a removedCount it never shows. On a create this is a refusal
      // rather than a warning, because the resulting list looks correct through every API read.
      const statics = staticFilterFields();
      const known = baseKnownFields(statics);
      let fieldsUsable = Boolean(statics?.staticFieldKeys?.length);
      let hasTextboxList = false;
      if (fieldsUsable) {
        const cf = await gw.call('GET', `/locations/${encodeURIComponent(args.locationId)}/customFields?model=contact`);
        if (!cf.ok) fieldsUsable = false;
        else {
          for (const f of (cf.json?.customFields ?? [])) {
            if (!f?.id || EXCLUDED_FIELD_TYPES.has(f.dataType)) continue;
            known.add(`custom_fields.${f.id}`);
            if (f.dataType === 'TEXTBOX_LIST') hasTextboxList = true;
          }
        }
      }
      // A TEXTBOX_LIST field contributes one key per OPTION id and none for itself, and the
      // customFields read returns picklistOptions as bare strings with no ids — so those keys
      // cannot be enumerated here. Unverifiable, not wrong: it goes through with a warning rather
      // than blocking a legitimate create.
      const graded = [...new Set(allLeaves.map((c) => c.field))].map((field) => ({
        field,
        status: known.has(field) ? 'known'
          : !fieldsUsable ? 'unverified'
            : (hasTextboxList && field.startsWith('custom_fields.')) ? 'unverified'
              : 'unknown',
      }));
      const unknownFields = graded.filter((g) => g.status === 'unknown').map((g) => g.field);
      if (unknownFields.length) {
        return withFailureData(
          fail(CODES.VALIDATION_FAILED,
            `${unknownFields.length === 1 ? 'this field is' : 'these fields are'} not in this account's filter-field catalogue: ${unknownFields.join(', ')}`,
            'The contacts screen validates every stored filter against a set it assembles in the browser and '
            + 'silently discards what it does not recognise — a list filtered only on an unknown field renders '
            + 'the WHOLE account while reading back perfectly. Writing this would create exactly the state '
            + 'check_smart_lists exists to find. Use a static key from the DSL, or custom_fields.<customFieldId> '
            + 'for a field that exists on this account.'),
          { fieldStatus: graded, knownKeyCount: known.size },
        );
      }
      const unverified = graded.filter((g) => g.status === 'unverified').map((g) => g.field);

      // BUILD the envelope. The caller never supplies it: handing over `filterSpecs` is how the
      // one-level shape gets written, and it is the only thing on this surface that matters.
      const columnKeys = args.columns?.length ? args.columns : ['name', 'email', 'phone', 'tags'];
      const filterSpecs = buildFilterSpec({ groups, outerMatch: args.outerMatch ?? 'OR' });
      const columns = buildColumns(columnKeys);
      const mistranslated = columnKeys
        .filter((k) => Object.hasOwn(DSL_COLUMN_MISTRANSLATIONS, k))
        .map((k) => `${k} → ${DSL_COLUMN_MISTRANSLATIONS[k]}`);

      // Self-check: the thing we built must satisfy the auditor. If this ever fires the builder and
      // the classifier have drifted apart, which is the failure this surface invites.
      const selfCheck = classifyFilterSpec(filterSpecs);
      if (selfCheck.verdict !== 'ok') {
        return withFailureData(
          fail(CODES.ENGINE_ABORT, `the envelope this tool built does not pass its own classifier (${selfCheck.cause})`,
            'This is a bug in create_smart_list, not in your input. Nothing was written.'),
          { filterSpecs, selfCheck },
        );
      }

      // THE DIFFERENTIAL, before the write. A filter matching the account total is not filtering,
      // and that is the one symptom of this whole failure class you can see without a browser.
      // pageLimit:0 returns the count alone. Note the envelope here is the SEARCH endpoint's — a
      // single group holding leaves — which is deliberately NOT the one stored on the list.
      const countMatching = async (body) => {
        const r = await gw.call('POST', '/contacts/search/2', body);
        return r.ok ? (r.json?.total ?? r.json?.count ?? null) : null;
      };
      const searchFilters = groups.map((g) => ({ group: (g.match ?? 'AND').toUpperCase(), filters: g.conditions }));
      const matched = await countMatching({
        filters: searchFilters, locationId: args.locationId, page: 1, pageLimit: 0, sort: [], includeTotal: true,
      });
      const accountTotal = await countMatching({
        filters: [], locationId: args.locationId, page: 1, pageLimit: 0, sort: [], includeTotal: true,
      });
      const differential = {
        matched, accountTotal,
        ...(matched != null && accountTotal != null && matched === accountTotal && accountTotal > 0
          ? { warning: 'the filter matches EVERY contact on the account — it is not narrowing anything. Check the condition before creating a list that looks broken to the operator.' }
          : {}),
        ...(matched === 0 ? { note: 'the filter matches nothing right now. That may be correct for a list meant to fill up later.' } : {}),
        ...(matched == null ? { note: 'the search preflight did not answer, so the match count is unknown. The create is unaffected.' } : {}),
      };

      const body = { locationId: args.locationId, listName: args.listName, filterSpecs, columns };
      const preview = {
        creates: body,
        nesting: 'TWO levels — outer group whose children are groups. This is the whole point of the tool.',
        fieldStatus: graded,
        differential,
        ...(unverified.length ? { unverifiedFields: unverified, unverifiedNote: 'this account has a TEXTBOX_LIST custom field, whose option ids are valid filter keys but are not enumerable from the customFields read. These could not be confirmed either way.' } : {}),
        ...(mistranslated.length ? { columnWarning: `these column keys are filter-DSL spellings and will not render as columns: ${mistranslated.join(', ')}. Columns use the contacts-screen ids (${DEFAULT_COLUMN_KEYS.join(', ')}); they do not affect filtering.` } : {}),
        removal: 'There is no delete on this rail — DELETE 404s and PUT {deleted:true} is refused. The list can be removed from the interface.',
      };
      if (args.confirm !== true) {
        return withFailureData(
          fail(CODES.CONFIRM_REQUIRED, 'Smart list create preview is ready; no write was sent.',
            'Repeat with confirm:true to create it.'),
          { preview },
        );
      }

      const created = await gw.call('POST', '/contacts/smartlist/', body);
      if (!created.ok) return fromHttp(created.status, created.json);
      const listId = created.json?.smartList?.id ?? created.json?.smartList?._id ?? created.json?.id ?? null;
      if (!listId) {
        return withFailureData(
          fail(CODES.ENGINE_ABORT, 'the create returned 2xx but no smart list id.',
            'Run check_smart_lists before retrying — a retry would create a second list, and there is no delete on this rail.'),
          { preview, response: created.json ?? null },
        );
      }

      // Read back on a SEPARATE request, and re-judge structurally. The read-back proves the record
      // stored; it does NOT prove the screen applies it, because a discarded filter reads back
      // byte-identical. The classifier is the only instrument short of a browser.
      // NOTE the detail route REFUSES locationId — 422 ["property locationId should not exist"].
      const back = await gw.readBackUntil(async () => {
        const g = await gw.call('GET', `/contacts/smartlist/${encodeURIComponent(listId)}`);
        return g.ok ? (g.json?.smartList ?? g.json) : null;
      }, { pollMs: 1500, maxPolls: 3 });
      const stored = back.hit ?? null;
      const storedSpec = stored?.filterSpecs ?? null;
      const verdict = storedSpec ? classifyFilterSpec(storedSpec) : null;
      const identical = storedSpec ? JSON.stringify(storedSpec) === JSON.stringify(filterSpecs) : false;

      return ok({
        listId,
        listName: stored?.listName ?? args.listName,
        readBack: Boolean(stored),
        readBackAttempts: back.attempts,
        storedShape: verdict ? verdict.verdict : 'unread',
        ...(verdict && verdict.verdict !== 'ok' ? { alarm: `the list was created and the shape it stored is BROKEN (${verdict.cause}): ${verdict.reason}` } : {}),
        filterSpecsIdentical: identical,
        ...(stored && !identical ? { note: 'the stored filterSpecs differs from what was sent — the server rewrote something. Compare before trusting the list.' } : {}),
        conditions: filterLeaves({ filters: storedSpec?.filters ?? [] }).length,
        differential,
        ...(unverified.length ? { unverifiedFields: unverified } : {}),
        verification: 'The record stored, and its envelope is the shape the contacts screen requires. That envelope is '
          + 'RENDER-PROVEN: a list built this way showed 5 of 239 contacts with "Filters (1)" and no banner, while the same '
          + 'filter written one level flatter showed all 239 — measured in a browser against that control 2026-09-07. So the '
          + 'nesting is not what you need to check. What an API still cannot tell you is whether YOUR filter selects the '
          + 'contacts you meant: compare the matched count below against what you expected, and if it matters, open the list '
          + 'and confirm the Filters control shows a count with no "unsaved changes" banner.',
        removal: 'No delete exists on this rail. Remove it from the interface if it is not wanted.',
      });
    }, args),
  },
  {
    name: 'check_smart_lists',
    description: `${describe('check_smart_lists', 'Audit smart lists for filters the contacts screen will silently discard — risk: read')}. `
      + 'Reads every smart list on a sub-account and reports which ones render as the WHOLE ACCOUNT '
      + 'despite storing a filter. Three ways that happens, none of them visible to an API read-back: '
      + '`filterSpecs.filters` nested only one level (the screen throws it away), an empty filters '
      + 'array (the Copy/Save-as path produces these — it carries name, columns and sort but no '
      + 'filter), a leaf condition sitting where the screen expects a group, and a filter naming a '
      + 'FIELD the account does not offer — a deleted custom field breaks a list that worked '
      + 'yesterday, and the symptom is identical to bad nesting, so each row says WHICH of the two '
      + 'it found rather than a bare verdict. No endpoint serves the field catalogue: the contacts '
      + 'screen assembles it in the browser from a static list in its own chunk plus the account\'s '
      + 'custom fields, so this reproduces that union and reads the account half live. Read-only: it '
      + 'creates nothing and changes nothing, which matters here because a smart list cannot be '
      + 'deleted through the API at all.',
    inputSchema: schema({
      locationId: z.string(),
      listId: z.string().optional(),
    }),
    capabilities: [
      { method: 'GET', path: '/contacts/smartlist/search' },
      { method: 'GET', path: '/contacts/smartlist/{id}' },
      { method: 'GET', path: '/locations/{locationId}/customFields' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });

      // THE ACCOUNT'S OWN HALF of the field catalogue. custom_fields.<customFieldId> for every
      // contact custom field, minus the two dataTypes the builder excludes — a filter naming a
      // FILE_UPLOAD or SIGNATURE field is dropped exactly like one naming a field that does not
      // exist.
      const statics = staticFilterFields();
      const known = baseKnownFields(statics);
      const EXCLUDED_TYPES = EXCLUDED_FIELD_TYPES;
      let fieldsUsable = Boolean(statics?.staticFieldKeys?.length);
      let hasTextboxList = false;
      if (fieldsUsable) {
        const cf = await gw.call('GET', `/locations/${encodeURIComponent(args.locationId)}/customFields?model=contact`);
        if (!cf.ok) {
          // Without the account half, a custom_fields.<id> filter cannot be judged at all. Degrade
          // to shape-only rather than flag every one of them.
          fieldsUsable = false;
        } else {
          for (const f of (cf.json?.customFields ?? [])) {
            if (!f?.id || EXCLUDED_TYPES.has(f.dataType)) continue;
            known.add(`custom_fields.${f.id}`);
            if (f.dataType === 'TEXTBOX_LIST') hasTextboxList = true;
          }
        }
      }
      // A TEXTBOX_LIST field contributes one key per OPTION, spelled with the option id, and
      // contributes none for itself. This endpoint returns picklistOptions as plain strings with no
      // ids, so those keys cannot be enumerated from here — meaning an unresolved custom_fields.*
      // on an account that HAS a TEXTBOX_LIST field might be a perfectly good option key. It is
      // reported as unverified rather than unknown, because a false "renders everything" sends
      // somebody to fix a list that works.
      const judgeField = (name) => {
        if (known.has(name)) return 'known';
        if (!fieldsUsable) return 'unverified';
        if (hasTextboxList && String(name).startsWith('custom_fields.')) return 'unverified';
        return 'unknown';
      };

      const leaves = filterLeaves;

      const inspect = async (id, name) => {
        const r = await gw.call('GET', `/contacts/smartlist/${encodeURIComponent(id)}`);
        if (!r.ok) {
          // 400 "Invalid SmartList id" is what a UI-DELETED list answers. This surface never
          // returns 404, so reading the 400 as a malformed argument reports a bad request when the
          // truth is that somebody removed the list.
          if (r.status === 400) {
            return { id, name, verdict: 'gone', reason: 'the id answers 400 "Invalid SmartList id" — on this surface that means DELETED from the interface, not a malformed id. There is no 404 here.' };
          }
          return { id, name, verdict: 'unreadable', reason: `detail read answered ${r.status}` };
        }
        const list = r.json?.smartList ?? r.json ?? {};
        const spec = list.filterSpecs ?? {};
        let { verdict, reason, cause } = classifyFilterSpec(spec);
        const fields = [...new Set(leaves({ filters: spec.filters ?? [] }).map((l) => l.field ?? l.uiMeta?.fieldAlias).filter(Boolean))];
        const graded = fields.map((f) => ({ field: f, status: judgeField(f) }));
        const unknown = graded.filter((g) => g.status === 'unknown').map((g) => g.field);
        // An unknown FIELD and a flattened ENVELOPE produce the identical symptom — a full-account
        // render — so the two are reported separately. Told only "renders everything", an operator
        // rewrites the nesting on a list whose nesting was never the problem.
        // BOTH problems at once is a real state — one of the sandbox probes has a flattened envelope
        // AND a field that does not exist — and reporting only the envelope would have someone fix
        // the nesting and find the list still showing everything.
        if (unknown.length && verdict === 'renders-everything') {
          reason += ` ALSO: ${unknown.length === 1 ? 'this field is' : 'these fields are'} not in the account's filter-field catalogue (${unknown.join(', ')}), which breaks the list on its own. Correcting the nesting alone will NOT fix it.`;
          cause = `${cause}+unknown-field`;
        }
        if (unknown.length && verdict === 'ok') {
          verdict = 'renders-everything';
          cause = 'unknown-field';
          reason = `the shape is right, but ${unknown.length === 1 ? 'this field is' : 'these fields are'} not in this account's filter-field catalogue: ${unknown.join(', ')}. `
            + 'The contacts screen drops a filter it does not recognise and renders the whole account, keeping a removedCount it never shows. '
            + 'A deleted custom field does this to a list that worked yesterday. The nesting is NOT the problem here.';
        }
        return {
          id, name: list.listName ?? name ?? null,
          verdict, ...(cause ? { cause } : {}), ...(reason ? { reason } : {}),
          filterFields: fields,
          ...(graded.some((g) => g.status !== 'known') ? { fieldStatus: graded } : {}),
          conditions: leaves({ filters: spec.filters ?? [] }).length,
          sharedWith: list.sharedWith ?? null,
        };
      };

      let rows = [];
      if (args.listId) {
        rows = [await inspect(args.listId, null)];
      } else {
        // userId IS REQUIRED, and its absence is not an error you can see. Without it and WITHOUT
        // `globals`, the route answers 422. Without it and WITH `globals=true` — the spelling the
        // corpus documents — it answers 200 and an EMPTY ARRAY while the account holds lists that
        // read back in full by id. This tool shipped with that exact query and reported a clean
        // account for one holding seven lists, which is the worst possible answer from an audit.
        // Proven on the sandbox 2026-09-07: userId present returns 7 with or without `globals`,
        // absent returns 0 with it and 422 without.
        // An EMPTY or missing userId is as silent as an absent one: `userId=` answers 200 with an
        // empty array, and `gw.uid` is null whenever the token carries no authClassId. That is the
        // shape a caller hits when a variable is undefined rather than absent, and it slips past any
        // "did I include userId" check — so it is refused here instead of reported as an empty
        // account. Measured on the sandbox 2026-09-07: userId= and a missing userId with
        // globals=true both answer 200 + [] while the account holds seven lists.
        if (typeof gw.uid !== 'string' || gw.uid.trim() === '') {
          return fail(CODES.VALIDATION_FAILED,
            'this credential carries no user id, and the roster read needs one',
            'GET /contacts/smartlist/search answers 200 with an EMPTY list when userId is missing or blank, '
            + 'so without it this tool would report a clean account for one full of broken lists. '
            + 'Re-capture the token (uxie-ghl-factory:internal-connect), or pass listId to check one list directly.');
        }
        const q = new URLSearchParams({ locationId: args.locationId, userId: gw.uid, transform: 'true' });
        const search = await gw.call('GET', `/contacts/smartlist/search?${q}`);
        if (!search.ok) return fromHttp(search.status, search.json);
        const roster = search.json?.smartLists ?? [];
        if (!Array.isArray(roster) || roster.length === 0) {
          // NOT read as deletion. The roster is scoped to the CALLING user, so a list another user
          // owns is invisible here while still being readable by id — and an empty answer is what a
          // missing userId used to produce. Say what was actually established, which is only that
          // this credential owns none.
          return ok({
            checked: 0,
            lists: [],
            note: 'No smart lists are visible to THIS user on this sub-account. That is not proof there are none: '
              + 'the roster is scoped to the calling user, so a list owned by someone else does not appear here '
              + 'even though it reads back in full by id. Pass listId to check one directly.',
          });
        }
        for (const row of roster) {
          const id = row._id ?? row.id;
          if (!id) continue;
          rows.push(await inspect(id, row.listName ?? row.name));
        }
      }
      const broken = rows.filter((r) => r.verdict === 'renders-everything');
      return ok({
        checked: rows.length,
        rendersEverything: broken.length,
        lists: rows,
        ...(broken.length
          ? { warning: `${broken.length} list(s) store a filter the contacts screen will discard, and render the ENTIRE account to the operator. Every API check agrees they are fine — this is only visible structurally. Fixing one is a PUT of filterSpecs with the conditions unchanged and the nesting corrected; the PUT merges, so nothing else is touched.` }
          : {}),
        note: 'A row count is NOT the signal: it is correct either way, which is what makes this class expensive.',
        // The field half IS checked now, but it rests on a static list mined from one build of the
        // contacts app, and on `score` being allowed unconditionally. Both are stated rather than
        // assumed away: a stale static list would flag a real field, which is the false positive
        // this tool must never produce quietly.
        fieldCatalogue: fieldsUsable
          ? `checked against ${known.size} known keys — a static list mined from contactsApp build ${statics?.minedFromBuild ?? '2490'} plus this account's own contact custom fields, read live. The set is per ACCOUNT and per BUILD: deleting a custom field, or GHL retiring a static key in a newer chunk, invalidates a stored filter that used to work. Re-derive rather than trusting a cached answer, and re-mine the static half when the drift watch reports contactsApp has moved.`
          : 'NOT CHECKED — the static filter-field list or this account\'s custom fields could not be read, so only the filter SHAPE was judged. A verdict of "ok" here means the envelope is right, not that every field resolves.',
        ...(fieldsUsable ? {} : { notChecked: 'field validity' }),
        scoreCaveat: '`score` is treated as valid without checking. It is only a real field when the account has a PUBLISHED score profile, and nothing here reads that — flagging it would risk breaking a working filter.',
      });
    }, args),
  },
  {
    name: 'build_funnel_page',
    description: `${describe('build_funnel_page', 'Compose a funnel page from native elements and write it — proof: live-roundtrip (2026-09-09); risk: write')}. `
      + 'Preview by default; confirm:true autosaves the DRAFT. Emits the nodes AND the compiled '
      + 'stylesheet together, because the builder canvas styles a page from each node\'s `styles` '
      + 'while the PUBLIC renderer uses the compiled `sectionStyles` string keyed by node id — write '
      + 'only one and the page looks right in the builder and naked in public. Enforces the contract '
      + 'autosave will not: `meta` against the closed set of 60 kinds, every declared `extra` property '
      + 'present (the renderer reads extra.<prop>.value UNGUARDED, so a missing one 500s the whole '
      + 'page while autosave still answers 201), `col.extra.bgImage`, `general.general.fontsToLoad` '
      + 'and `colors`, and child[] holding node IDS that resolve. Verifies by reading the page back on '
      + 'a separate request; pass verifyUrl to also poll the public render for your own copy — one '
      + 'request there is not a measurement, since the first can serve the previous compile.',
    inputSchema: schema({
      locationId: z.string(),
      funnelId: z.string(),
      pageId: z.string(),
      stepId: z.string(),
      sections: z.array(z.record(z.any())).min(1),
      pageStyles: z.string().optional(),
      fonts: z.array(z.string()).optional(),
      colors: z.array(z.record(z.any())).optional(),
      pageVersion: z.number().int().positive().default(1),
      verifyUrl: z.string().optional(),
      publish: z.boolean().default(false),
      confirm: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'POST', path: '/funnels/builder/autosave/{pageId}' },
      { method: 'GET', path: '/funnels/builder/page/data' },
      { method: 'GET', path: '/funnels/builder/get-versions' },
      { method: 'POST', path: '/funnels/builder/publish-version' },
    ],
    handler: async (args, deps) => guard(async () => {
      resetIds();
      let pageData;
      try {
        const sections = args.sections.map((spec, si) => {
          const css = [];
          const columns = (spec.columns ?? []).map((c, ci) => {
            const leaves = (c.elements ?? []).map((e) => {
              const leaf = makeLeaf({
                meta: e.meta,
                extra: { ...(e.html !== undefined ? { text: val(e.html) } : {}), ...(e.extra ?? {}) },
                styles: e.styles ?? {},
                tag: e.tag ?? '',
                salt: `S${si}C${ci}`,
              });
              // An explicit `css` block wins — it can express breakpoints, descendant selectors and
              // pseudo-states that a flat style map cannot. Otherwise the leaf's `styles` are
              // COMPILED, so styling set through `styles` alone reaches the public renderer instead
              // of living only on the builder canvas. See leafStyleCss for what that used to cost.
              if (e.css) css.push(e.meta === 'button' ? buttonCss(leaf.id, e.css) : textCss(leaf.id, e.css));
              else { const auto = leafStyleCss(leaf.id, e.styles); if (auto) css.push(auto); }
              return leaf;
            });
            const widthPct = c.widthPct ?? Math.round(10000 / (spec.columns.length || 1)) / 100;
            return { col: makeColumn({ children: leaves, widthPct, padX: c.padX ?? 20, salt: `S${si}C${ci}` }), leaves, widthPct };
          });
          return makeSection({
            columns, background: spec.background ?? 'transparent', padY: spec.padY ?? 60,
            maxWidth: spec.maxWidth ?? 1100, elementCss: css.join(''),
            pageId: args.pageId, funnelId: args.funnelId, locationId: args.locationId, salt: `S${si}`,
          });
        });
        pageData = buildPageData({
          pageId: args.pageId, stepId: args.stepId, funnelId: args.funnelId, locationId: args.locationId,
          sections, pageStyles: args.pageStyles ?? '', fonts: args.fonts, colors: args.colors,
        });
      } catch (e) {
        // A thrown composer error may carry its own remediation; the default below is only right for
        // the element-kind failure, and was misleading on every other one.
        return fail(CODES.VALIDATION_FAILED, e.message,
          e.remediation ?? `Element kinds are a closed set of ${ELEMENT_KINDS.length}; see the funnels corpus for the list.`);
      }

      const problems = auditPageData(pageData);
      if (problems.length) {
        return withFailureData(
          fail(CODES.VALIDATION_FAILED, `The composed page would save with 201 and then fail: ${problems.length} problem(s).`,
            'Fix the problems listed in data.problems. None of these is reported by the write path.'),
          { problems },
        );
      }

      const nodeCount = pageData.sections.reduce((n, s) => n + s.elements.length + 1, 0);
      const cssBytes = pageData.sections.reduce((n, s) => n + s.general.sectionStyles.length, 0);
      const preview = {
        sections: pageData.sections.length,
        nodes: nodeCount,
        compiledCssBytes: cssBytes,
        kinds: [...new Set(pageData.sections.flatMap((s) => s.elements.filter((e) => e.type === 'element').map((e) => e.meta)))],
        audit: 'clean',
        note: args.publish === true
          ? 'This writes a draft AND PUBLISHES it — the page becomes visible to the public at its mapped path. It does not map a path that does not already exist.'
          : 'This writes a DRAFT. It does not publish, and it does not map a public path.',
        willPublish: args.publish === true,
      };
      if (args.confirm !== true) {
        return withFailureData(
          fail(CODES.CONFIRM_REQUIRED, 'Funnel page compose preview is ready; no write was sent.',
            'Repeat with confirm:true to autosave the draft.'),
          { preview },
        );
      }

      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const saved = await gw.call('POST', `/funnels/builder/autosave/${encodeURIComponent(args.pageId)}`,
        autosaveEnvelope({ funnelId: args.funnelId, pageData, pageVersion: args.pageVersion }));
      if (!saved.ok) return fromHttp(saved.status, saved.json);

      // Read back on a SEPARATE request. A 201 from autosave proves the request parsed, nothing more.
      const readBack = await gw.call('GET', `/funnels/builder/page/data?pageId=${encodeURIComponent(args.pageId)}`);
      const got = readBack.json?.sections ?? [];
      const wantIds = pageData.sections.map((s) => s.id);
      const storedIds = got.map((s) => s.id);
      const missing = wantIds.filter((id) => !storedIds.includes(id));

      // THE PUBLISH STATE IS REPORTED ON EVERY RUN, published or not — because the trap here is
      // invisible until it has already cost you. The public renderer serves the newest `live`
      // version if the page has one, and falls back to the newest draft if the page has NEVER been
      // published (proven 2026-09-10, funnels/40-rules rule 27). So while a page is unpublished
      // every autosave appears publicly within seconds and publishing looks optional; the first
      // publish pins the page to that version and every later autosave stops reaching the public
      // URL, with a 201 on each one. A caller who never sees this state cannot know which regime
      // their `verifyUrl` fetch is measuring.
      //
      // `get-versions` answers a BARE ARRAY, newest first. The id key is snake_case `version_id`
      // — a caller reading `.versions` or `row.versionId` gets undefined, publishes nothing, and
      // sees no error. `updated_at` is a Firestore {_seconds,_nanoseconds} object, not a string.
      //
      // 🔴 "newest first" is the ordering, NOT a guarantee. Two measurements disagree and that IS the
      // finding: 2 of 14 sandbox reads came back non-monotonic, while 19 of 19 pages on a client
      // account had rows[0] == newest by timestamp. So position usually works and cannot be relied
      // on. Separately and always: a freshly published `live` row is APPENDED AT THE END, so
      // `rows[rows.length - 1]` is very often the version that is ALREADY live — publish that and
      // three publishes in a row change nothing, which reads exactly like "the write did not land".
      // This handler is safe because it publishes `versions[0]` immediately after its own autosave,
      // which is that autosave's draft. Anything picking a target in another flow must sort on
      // `updated_at._seconds` — a Firestore object, so sorting it as a string silently does nothing.
      let versions = [];
      const vres = await gw.call('GET', `/funnels/builder/get-versions?pageId=${encodeURIComponent(args.pageId)}`);
      if (Array.isArray(vres.json)) versions = vres.json;
      const liveIdx = versions.findIndex((v) => v.pageType === 'live');
      const newest = versions[0] ?? null;
      const pinnedTo = liveIdx >= 0 ? versions[liveIdx] : null;
      const secs = (v) => v?.updated_at?._seconds ?? 0;
      const publishState = {
        versions: versions.length,
        pinned: liveIdx >= 0,
        // Drafts stacked behind the pinned version: work the public cannot see.
        draftsSincePublish: liveIdx >= 0 ? liveIdx : null,
        staleBySeconds: liveIdx >= 0 ? Math.max(0, secs(newest) - secs(pinnedTo)) : null,
        servingNote: liveIdx >= 0
          ? 'This page is PINNED to a published version. The public URL serves that version, NOT the draft this call just wrote.'
          : 'This page has never been published, so the public URL falls back to the newest draft — the one this call just wrote.',
      };

      let published = null;
      if (args.publish === true) {
        if (missing.length) {
          return withFailureData(
            fail(CODES.VERIFY_FAILED,
              'the draft read back with sections missing, so it was NOT published',
              'Publishing pins the public page to this version. Fix the write first — data.readBack names the missing sections — then re-run.'),
            { readBack: { sections: storedIds.length, missingSections: missing }, publishState },
          );
        }
        // userId is REQUIRED by publish-version and its absence 422s. A blank one is the shape a
        // caller hits when a variable is undefined rather than absent, so refuse it by name.
        if (typeof gw.uid !== 'string' || gw.uid.trim() === '') {
          return withFailureData(
            fail(CODES.VALIDATION_FAILED,
              'this credential carries no user id, and publish-version requires one',
              'Re-capture the token (uxie-ghl-factory:internal-connect), or omit publish and publish from the builder.'),
            { publishState },
          );
        }
        const target = newest;
        if (!target?.version_id) {
          return withFailureData(
            fail(CODES.ENGINE_ABORT,
              'the version list came back without a usable version_id, so nothing was published',
              'The draft IS saved. Read GET /funnels/builder/get-versions?pageId= and publish by hand.'),
            { publishState, versionsSeen: versions.length },
          );
        }
        const pub = await gw.call('POST', '/funnels/builder/publish-version',
          { pageId: args.pageId, versionId: target.version_id, userId: gw.uid });
        if (!pub.ok) return fromHttp(pub.status, pub.json);

        // Read back on a SEPARATE request: a 201 proves the request parsed. Assert THAT version is
        // now `live` — not merely that some version is.
        const after = await gw.call('GET', `/funnels/builder/get-versions?pageId=${encodeURIComponent(args.pageId)}`);
        const rows = Array.isArray(after.json) ? after.json : [];
        const row = rows.find((v) => v.version_id === target.version_id) ?? null;
        published = {
          versionId: target.version_id,
          status: pub.status,
          // A published version is stamped `live`, NOT `published`.
          pageType: row?.pageType ?? null,
          verified: row?.pageType === 'live',
        };
        if (!published.verified) {
          return withFailureData(
            fail(CODES.VERIFY_FAILED,
              'publish-version was accepted but that version did not read back as live',
              'The draft is saved. Re-read get-versions before assuming the public page changed.'),
            { published, publishState },
          );
        }
      }

      let render = null;
      if (args.verifyUrl) {
        const markers = pageData.sections.flatMap((s) => s.elements.filter((e) => e.type === 'element').map((e) => `c${e.id}`));
        const codes = [];
        let found = false;
        for (let i = 0; i < 6 && !found; i++) {
          try {
            const res = await fetch(`${args.verifyUrl}${args.verifyUrl.includes('?') ? '&' : '?'}x=${Math.random()}`);
            codes.push(res.status);
            if (res.status === 200) { const html = await res.text(); found = markers.every((m) => html.includes(m)); }
          } catch (e) { codes.push(String(e.message ?? e)); }
          if (!found) await new Promise((r) => setTimeout(r, 2000));
        }
        // On a PINNED page this fetch is not measuring your write at all — it is measuring the
        // published version. Say so, rather than letting a green 'allNodesPresent' or a puzzling
        // miss be read as evidence about the draft just written.
        const pinnedAndUnpublished = publishState.pinned && args.publish !== true;
        render = { codes, allNodesPresent: found,
          measures: pinnedAndUnpublished ? 'the PUBLISHED version, not this write' : 'this write',
          note: pinnedAndUnpublished
            ? 'This page is pinned to a published version, so the public URL cannot show the draft this call wrote — whatever this fetch found, it is not evidence about your write. Re-run with publish:true, or publish from the builder.'
            : found ? 'every node id appears in the rendered HTML'
              : 'the render did not show every node — a 200 alone is not proof; the first request after a save can serve the previous compile' };
      }

      return ok({
        pageId: args.pageId,
        autosave: saved.status,
        ...preview,
        readBack: { sections: storedIds.length, missingSections: missing },
        stored: missing.length === 0,
        publishState,
        ...(published ? { published } : {}),
        ...(render ? { render } : {}),
        ...(missing.length ? { warning: 'The autosave was accepted but the read-back is missing sections.' } : {}),
        ...(publishState.pinned && args.publish !== true
          ? { warning: `This page is pinned to a published version with ${publishState.draftsSincePublish} draft(s) stacked behind it. This write is NOT visible at the public URL until the page is published again.` }
          : {}),
      });
    }, args),
  },
  {
    name: 'audit_site',
    description: `${describe('audit_site', 'Read-only audit of a GHL funnel or website — dangling references, missing merge tags, foreign locationIds, publish drift')}. `
      + 'Finds the defects that return 2xx everywhere, '
      + 'store correctly, and render a page that looks right to whoever built it. Checks embedded '
      + 'REFERENCES against what the account actually holds (a template or snapshot install leaves them '
      + 'pointing at the SOURCE account — measured 49 of 51 formIds and 4 of 5 calendarIds dangling on one '
      + 'account, each displaying the CORRECT name beside the wrong id, which is why they survive the '
      + 'builder, a screenshot and any name-based grep), merge tags against the location\'s custom values '
      + '(a missing one renders as a blank heading or an empty bullet while every id resolves), foreign '
      + 'locationIds left behind by a clone, and publish state (a page pinned to a published version serves '
      + 'THAT version, so the builder and the public URL show different content). '
      + 'Run it BEFORE attaching a domain: a public path is held per DOMAIN and one domain serves many '
      + 'documents, so the row that takes your path usually belongs to a DIFFERENT funnel or website — and '
      + 'lookup/list requires funnelId, so that claimant is invisible from the document you are attaching. '
      + 'This sweeps every document on the location and names it. The attach resolves a collision silently '
      + 'and arbitrarily (an id-less orphan was measured KEEPING the clean path while the real page was '
      + 'pushed to a suffixed one), and routing is materialised at attach time, so renaming the step '
      + 'afterwards changes nothing in public. Pass includeRender to also '
      + 'fetch the public URLs — some defects exist only in what is SERVED and cannot be seen in stored page '
      + 'data at all. Reports coverage beside findings: a check that could not run is never counted as clean.',
    inputSchema: schema({
      locationId: z.string(),
      funnelId: z.string().optional(),
      includeRender: z.boolean().default(false),
      maxPages: z.number().int().positive().max(200).default(60),
      maxDocuments: z.number().int().positive().max(300).default(120),
    }),
    capabilities: [
      { method: 'GET', path: '/funnels/funnel/list' },
      { method: 'GET', path: '/funnels/funnel/fetch/{funnelId}' },
      { method: 'GET', path: '/funnels/builder/page/data' },
      { method: 'GET', path: '/funnels/builder/get-versions' },
      { method: 'GET', path: '/funnels/lookup/type/{entityId}' },
      { method: 'GET', path: '/funnels/lookup/list' },
      { method: 'GET', path: '/funnels/domain/' },
      { method: 'GET', path: '/forms/' },
      { method: 'GET', path: '/calendars/' },
      { method: 'GET', path: '/surveys' },
      { method: 'GET', path: '/locations/{locationId}/customValues' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const body = (r) => r.json?.data ?? r.json ?? {};
      const pick = (b, ...keys) => { for (const k of keys) if (Array.isArray(b?.[k])) return b[k]; return Array.isArray(b) ? b : []; };

      // COVERAGE IS PART OF THE RESULT. A list that fails to load disables its check; the check is
      // then reported as not-run rather than silently passing. A headline of "0 findings" over
      // checks that never executed is the worst answer an audit can give.
      const coverage = [];
      const known = {};
      const loadList = async (name, path, ...keys) => {
        const r = await gw.call('GET', path);
        if (r.status !== 200) {
          coverage.push({ check: `dangling-references:${name}`, ran: false, why: `the ${name} list answered ${r.status}` });
          return;
        }
        known[name] = new Set(pick(body(r), ...keys).map((x) => x.id ?? x._id).filter(Boolean));
        coverage.push({ check: `dangling-references:${name}`, ran: true, knownIds: known[name].size });
      };
      await loadList('forms', `/forms/?locationId=${encodeURIComponent(args.locationId)}&limit=20`, 'forms');
      await loadList('calendars', `/calendars/?locationId=${encodeURIComponent(args.locationId)}`, 'calendars');
      await loadList('surveys', `/surveys/?locationId=${encodeURIComponent(args.locationId)}&limit=20`, 'surveys');

      const cv = await gw.call('GET', `/locations/${encodeURIComponent(args.locationId)}/customValues`);
      if (cv.status === 200) {
        // The account's fieldKey is the FULL tag and carries inner spaces (`{{ custom_values.x }}`)
        // while pages usually write it without. Normalise both sides or every tag reads as missing.
        known.customValues = new Set(pick(body(cv), 'customValues').map((c) => normaliseTag(c.fieldKey ?? '')).filter(Boolean));
        coverage.push({ check: 'merge-tags', ran: true, knownIds: known.customValues.size });
      } else {
        coverage.push({ check: 'merge-tags', ran: false, why: `customValues answered ${cv.status}` });
      }

      let docs = [];
      if (args.funnelId) {
        const one = await gw.call('GET', `/funnels/funnel/fetch/${encodeURIComponent(args.funnelId)}?locationId=${encodeURIComponent(args.locationId)}`);
        if (one.status !== 200) return fromHttp(one.status, one.json);
        docs = [body(one)];
      } else {
        const all = await gw.call('GET', `/funnels/funnel/list?locationId=${encodeURIComponent(args.locationId)}&limit=100`);
        if (all.status !== 200) return fromHttp(all.status, all.json);
        docs = pick(body(all), 'funnels', 'data');
      }

      const scans = [];
      const findings = [];
      let pagesScanned = 0, pagesFailed = 0, truncated = false;

      let styleChecked = 0;
      let recordsRead = 0, recordsFailed = 0;
      for (const d of docs) {
        for (const st of d.steps ?? []) {
          // Rule 24: a step created without a client-minted id is unrepairable and gets no route.
          if (!st.id) {
            findings.push({ severity: 'high', check: 'step-integrity', pageName: `${d.name} / ${st.name}`,
              detail: 'this step has no id — it cannot be edited (step PUT 400s), cannot be deleted by API, and gets no routing row' });
          }
          for (const pid of st.pages ?? []) {
            if (pagesScanned >= args.maxPages) { truncated = true; continue; }
            const pd = await gw.call('GET', `/funnels/builder/page/data?pageId=${encodeURIComponent(pid)}`);
            if (pd.status !== 200) { pagesFailed++; continue; }
            pagesScanned++;
            scans.push(scanPage({ pageData: pd.json, pageId: pid, pageName: `${d.name} / ${st.name}` }));
            // The compiled-CSS and mirror checks read the SAME document — no extra request.
            findings.push(...judgeStyles({ pageData: pd.json, pageId: pid, pageName: `${d.name} / ${st.name}` }));
            styleChecked++;
            const vs = await gw.call('GET', `/funnels/builder/get-versions?pageId=${encodeURIComponent(pid)}`);
            if (Array.isArray(vs.json)) findings.push(...judgeVersions({ versions: vs.json, pageId: pid, pageName: `${d.name} / ${st.name}` }));
            // The page RECORD is a THIRD surface, holding what neither pageData nor the page list
            // carries: `meta`. 🔴 It comes back at the TOP LEVEL — `r.json?.data ?? {}` yields `{}`
            // and reports every field absent, which is how this record was once written up as
            // "omits meta". One read, three checks.
            const prec = await gw.call('GET', `/funnels/page/${encodeURIComponent(pid)}?locationId=${encodeURIComponent(args.locationId)}`);
            if (prec.status === 200) {
              recordsRead++;
              findings.push(...judgePageRecord({ record: prec.json?.data ?? prec.json, pageId: pid,
                pageName: `${d.name} / ${st.name}`, locationId: args.locationId }));
            } else recordsFailed++;
          }
        }
      }
      // ROUTING. A domain attach reports `pathsUpdated: true` and nothing else, while it silently
      // renames a colliding step path and mints NO ROW AT ALL for one whose path is already held —
      // that step simply 404s. lookup/list is the only way to see what the attach actually did.
      // Compiled-CSS coverage is reported like every other check: how many pages it actually ran on,
      // so "no findings" can never be confused with "did not look".
      coverage.push({ check: 'uncompiled-styles', ran: styleChecked > 0, pages: styleChecked });
      coverage.push({ check: 'mirror-divergence', ran: styleChecked > 0, pages: styleChecked });
      for (const c of ['seo-meta', 'clone-leftover']) {
        coverage.push({ check: c, ran: recordsRead > 0, pages: recordsRead,
          ...(recordsFailed ? { failed: recordsFailed } : {}),
          ...(recordsRead === 0 ? { why: 'no page record could be read, so nothing on the record was checked' } : {}) });
      }
      // 🔴 lookup/list REQUIRES funnelId — `locationId` alone answers 422 — so there is no one call
      // that reads a location's route table. Sweeping one call per document is the only way, and it
      // is the ONLY way to see the cross-document claimant that a domain attach will silently
      // rename. Bounded by `maxDocuments`, and skipped entirely when the location has no domain at
      // all, because then no row exists anywhere and there is nothing any path could collide with.
      // Auditing ONE funnel still has to sweep its NEIGHBOURS: the claimant lives elsewhere.
      let sweepDocs = docs;
      if (args.funnelId) {
        const all = await gw.call('GET', `/funnels/funnel/list?locationId=${encodeURIComponent(args.locationId)}&limit=100`);
        if (all.status === 200) sweepDocs = pick(body(all), 'funnels', 'data');
      }
      const anyDomain = sweepDocs.some((d) => d.domainId);
      const rowsByFunnel = new Map();
      let swept = 0, sweepFailed = 0, sweepTruncated = false;
      if (anyDomain) {
        for (const d of sweepDocs) {
          if (swept >= args.maxDocuments) { sweepTruncated = true; break; }
          // 🔴 NEVER add `limit` or `offset` HERE. Either one, alone, turns 20 rows into `{"data":[]}`
          // behind a 200 — measured on the same funnel seconds apart, with limit=100, limit=500,
          // offset=0 and offset=1 all returning empty. An empty row set on a funnel that HAS a domain
          // is what makes judgeRouting report "this step has NO routing row, so it 404s in public" at
          // HIGH on every step, which is the exact false positive 0.76.0 removed. The route takes
          // funnelId + locationId and nothing else.
          const r = await gw.call('GET', `/funnels/lookup/list?funnelId=${encodeURIComponent(d._id)}&locationId=${encodeURIComponent(args.locationId)}`);
          if (r.status !== 200) { sweepFailed++; continue; }
          rowsByFunnel.set(d._id, pick(body(r), 'lookups', 'data').filter((x) => !x.deleted));
          swept++;
        }
      }

      if (rowsByFunnel.size) {
        // `hasDomain` decides whether an EMPTY row set is evidence or just the account's state.
        for (const d of docs) {
          findings.push(...judgeRouting({ rows: rowsByFunnel.get(d._id) ?? [], steps: d.steps, documentName: d.name, hasDomain: !!d.domainId }));
        }
        const attached = docs.filter((d) => d.domainId).length;
        const totalRows = [...rowsByFunnel.values()].reduce((a, b) => a + b.length, 0);
        coverage.push({ check: 'routing', ran: attached > 0, knownIds: totalRows,
          ...(attached === 0 ? { why: 'no document here has a domain attached; routing rows are materialised at attach time, so there is nothing to check yet' } : {}) });
        findings.push(...judgePathCollisions({ docs: sweepDocs, rowsByFunnel, focusIds: new Set(docs.map((d) => d._id)) }));
        coverage.push({ check: 'path-collision', ran: true, documents: swept,
          ...(sweepTruncated ? { why: `stopped at maxDocuments=${args.maxDocuments}; a claimant in an unswept document would be missed` } : {}),
          ...(sweepFailed ? { failed: sweepFailed } : {}) });
      } else if (!anyDomain) {
        const why = 'no document on this location has a domain attached, so no routing row exists anywhere and no path can collide yet';
        coverage.push({ check: 'routing', ran: false, why });
        coverage.push({ check: 'path-collision', ran: false, why });
      } else {
        const why = `lookup/list answered non-200 for every document tried (${sweepFailed} failed)`;
        coverage.push({ check: 'routing', ran: false, why });
        coverage.push({ check: 'path-collision', ran: false, why });
      }
      coverage.push({ check: 'publish-state', ran: pagesScanned > 0 });
      coverage.push({ check: 'foreign-location', ran: pagesScanned > 0 });
      coverage.push({ check: 'page-local-references', ran: pagesScanned > 0 });
      findings.push(...judge({ scans, known, locationId: args.locationId }));

      // ── the render leg ──────────────────────────────────────────────────────────────────
      // Some defects exist ONLY in what is served. A dead form iframe, a schema block naming a
      // previous publish, a merge tag rendering as a blank bullet — none of them are visible in the
      // stored document, and a page pinned to a published version serves content the document no
      // longer contains. An audit with only a document leg can pass an account whose public pages
      // are stale AND broken, and report clean, because everything it read was self-consistent.
      let rendered = 0;
      if (args.includeRender) {
        // The funnel record carries only `domainId`; the NAME lives in the domain list.
        const dres = await gw.call('GET', `/funnels/domain/?locationId=${encodeURIComponent(args.locationId)}`);
        const domains = new Map(pick(body(dres), 'domains').map((d) => [d.id ?? d._id, d.url]));
        const pageOwner = new Map();
        for (const d of docs) for (const st of d.steps ?? []) for (const pid of st.pages ?? []) pageOwner.set(pid, { doc: d, step: st });

        let noDomain = 0, noRoute = 0, cacheHits = 0;
        for (const sc of scans.slice(0, 12)) {
          const owner = pageOwner.get(sc.pageId);
          const host = domains.get(owner?.doc?.domainId);
          if (!host) { noDomain++; continue; }
          // Funnel, step and page each get a routing row and ALL THREE serve — they are aliases.
          // A page can have no page-row and still be perfectly reachable through its step's, which
          // is what a hand-minted route looks like. Looking up only the page id skips those pages
          // and reports them as unroutable when a visitor can reach them fine.
          let path = body(await gw.call('GET', `/funnels/lookup/type/${encodeURIComponent(sc.pageId)}`))?.path;
          if (!path && owner?.step?.id) {
            path = body(await gw.call('GET', `/funnels/lookup/type/${encodeURIComponent(owner.step.id)}`))?.path;
          }
          if (!path) { noRoute++; continue; }

          // 🔴 The QUERY STRING IS NOT IN CLOUDFLARE'S CACHE KEY, so `?cb=` measures the cache and
          // request-side `no-cache` is ignored. Path SHAPE is in the key and matching is
          // case-insensitive, so a re-cased path is a fresh key onto the same routing row.
          const slug = String(path).replace(/^\//, '');
          const keyed = `https://${host}/${[...slug].map((c, i) => (i % (rendered + 2) === 0 ? c.toUpperCase() : c)).join('')}`;
          try {
            const r = await fetch(keyed, { headers: { 'Cache-Control': 'no-cache' } });
            if (r.headers.get('cf-cache-status') === 'HIT') cacheHits++;
            const html = r.status === 200 ? await r.text() : '';
            rendered++;
            if (r.status !== 200) {
              findings.push({ severity: 'high', check: 'render', pageId: sc.pageId, pageName: sc.pageName,
                value: `https://${host}${path}`, detail: `the public URL answers ${r.status} — this page is not reachable by a visitor` });
              continue;
            }
            for (const f of judgeRendered({ html, url: `https://${host}${path}`, headline: sc.headline })) {
              findings.push({ ...f, pageId: sc.pageId, pageName: sc.pageName });
            }
          } catch (e) {
            findings.push({ severity: 'unknown', check: 'render', pageId: sc.pageId, pageName: sc.pageName,
              notChecked: true, detail: `could not fetch the public URL: ${String(e.message ?? e).slice(0, 80)}` });
          }
        }
        coverage.push({ check: 'render', ran: rendered > 0, knownIds: rendered,
          ...(rendered === 0 ? { why: noDomain ? 'no domain is attached, so no page has a public URL' : 'no routing rows resolved' } : {}),
          ...(noDomain ? { skippedNoDomain: noDomain } : {}),
          ...(noRoute ? { skippedNoRoute: noRoute } : {}),
          // A HIT means that reading measured the CDN, not the origin — say so rather than let it
          // pass as evidence about the page.
          ...(cacheHits ? { cacheHits, cacheNote: 'some reads were served by Cloudflare, not the origin' } : {}),
          ...(scans.length > 12 ? { note: `first 12 of ${scans.length} pages` } : {}) });
      } else {
        coverage.push({ check: 'render', ran: false, why: 'not requested (pass includeRender:true)' });
      }

      const bySeverity = findings.reduce((a, f) => ({ ...a, [f.severity]: (a[f.severity] ?? 0) + 1 }), {});
      const byCheck = findings.reduce((a, f) => ({ ...a, [f.check]: (a[f.check] ?? 0) + 1 }), {});
      const notRun = coverage.filter((c) => !c.ran).map((c) => c.check);
      return ok({
        scope: { documents: docs.length, pagesScanned, pagesFailed, truncated, renderable: rendered },
        coverage,
        checksNotRun: notRun,
        headline: `${findings.length} finding(s) across ${coverage.filter((c) => c.ran).length} check(s) that ran`
          + (notRun.length ? `; ${notRun.length} check(s) did NOT run and are not counted as clean: ${notRun.join(', ')}` : ''),
        bySeverity,
        byCheck,
        findings: findings.slice(0, 200),
        ...(findings.length > 200 ? { truncatedFindings: findings.length - 200 } : {}),
      });
    }, args),
  },
];

export function registerTools(server, deps, tools = TOOLS) {
  for (const t of tools) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.inputSchema },
      async (args) => {
        const safeArgs = args ?? {};
        const result = validateRegisteredArgs(t, safeArgs)
          ?? checkLocationBinding({ tool: t, args: safeArgs, allowed: deps.state?.allowedLocations ?? null, legacyLocationsEnvSet: deps.state?.legacyLocationsEnv ?? false, endpoints: endpoints() })
          ?? await t.handler(safeArgs, deps);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      });
  }
}
