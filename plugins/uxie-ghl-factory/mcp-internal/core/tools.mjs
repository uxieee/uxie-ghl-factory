// Transport-blind tool definitions. Descriptions are pulled from the generated
// tool-description catalog so proof status and risk reach the agent verbatim.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ok, fail, fromHttp, CODES, containsSecrets } from './errors.mjs';
import { authStatus, DEFAULT_TOKEN_FILE, readCredentials } from './auth.mjs';
import { makeAuditCircuit, makeAuditGateway, makeAuditLimiter } from './audit-gateway.mjs';
import { makeGateway } from './gateway.mjs';
import { collectWorkflowRuntimeWindow, validateRuntimeWindowInput } from './workflow-runtime-window.mjs';
import {
  getAiConfigurationBundle,
  listWorkflowsComplete,
  validateAiBundleInput,
  validateRosterInput,
} from './audit-configuration.mjs';
import { fetchEntities, orchestrate } from '../../skills/create-ghl-workflow/engine/orchestrate.mjs';
import { editCommitBody } from '../../skills/create-ghl-workflow/engine/edit.mjs';
import { fetchActionSchema, checkWorkflow, marketplaceDrift } from '../../skills/create-ghl-workflow/engine/action-schema.mjs';
import {
  applyOps,
  partitionOps,
  planTriggerOps,
} from '../../skills/create-ghl-workflow/engine/edit-driver.mjs';
import { lintContactFieldTemplates } from '../../skills/create-ghl-workflow/engine/contact-field-shapes.mjs';
import { loadCatalog } from '../../skills/create-ghl-workflow/engine/catalog.mjs';
import { makeDeterministicIdGen } from '../../skills/create-ghl-workflow/engine/idgen.mjs';
import { collectOpTags, missingTags } from '../../skills/create-ghl-workflow/engine/tags.mjs';
import { parseInstalledModules } from '../../skills/create-ghl-workflow/engine/marketplace.mjs';
import { makeFF } from '../../skills/ghl-workflow-fast-forward/engine/ff.mjs';
import { GhlMembershipsApi } from '../../skills/ghl-memberships/engine/api.mjs';
import { buildCourse, previewCourseSpec } from '../../skills/ghl-memberships/engine/course-builder.mjs';
import { compileConvaiAgent } from '../../skills/ghl-ai-agents-specialist/engine/convai-compiler.mjs';
import { compileVoiceAiAgent, compileVoiceAiUpdate } from '../../skills/ghl-ai-agents-specialist/engine/voiceai-compiler.mjs';
import { compileSuperAgentCreate, compileSuperAgentUpdate } from '../../skills/ghl-ai-agents-specialist/engine/studio-compiler.mjs';
import { executeAgentPlan } from '../../skills/ghl-ai-agents-specialist/engine/driver.mjs';

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
const describe = (tool, fallback) => CATALOG[tool]?.description ?? fallback;

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
  return (options = {}) => gatewayImpl({ tokenFile: state.tokenFile, ...options });
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
  return ok({
    ...report,
    countIntegrity: {
      mismatch,
      warning: mismatch
        ? `LOUD STEP-COUNT MISMATCH: authored=${report.authored}, compiled=${report.compiled}, persisted steps=${report.steps}. The draft may be incomplete.`
        : 'authored, compiled, and persisted step counts match.',
    },
    builderUrl: report.wid
      ? `https://app.gohighlevel.com/v2/location/${encodeURIComponent(locationId)}/automation/workflow/${encodeURIComponent(report.wid)}`
      : null,
    publicationNote: 'Draft-only operation: nothing was published.',
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

function editPreview(ops, beforeTemplates, templates, diff, triggerPlan, neededTags, tagsToCreate) {
  const beforeIds = new Set(beforeTemplates.map((step) => step.id));
  const afterIds = new Set(templates.map((step) => step.id));
  return {
    opsApplied: ops.map((op) => op?.op ?? null),
    stepCount: { before: beforeTemplates.length, after: templates.length },
    idsAdded: [...afterIds].filter((id) => !beforeIds.has(id)),
    idsRemoved: [...beforeIds].filter((id) => !afterIds.has(id)),
    diff,
    triggerChanges: triggerPlan.map(({ op, method, path, triggerId }) => ({ op, method, path, ...(triggerId ? { triggerId } : {}) })),
    requiresPublish: triggerPlan.length > 0,
    publishInstruction: triggerPlan.length
      ? 'Trigger configuration will be committed without activation. After verifying the edit, invoke publish_workflow with confirm:true to activate it explicitly.'
      : null,
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

function triggerSemanticExpectation(body = {}) {
  const keys = [
    'workflowId', 'type', 'masterType', 'name', 'conditions', 'actions',
    'schedule_config', 'convTriggerBotId',
  ];
  return Object.fromEntries(keys
    .filter((key) => Object.hasOwn(body, key))
    .map((key) => [key, body[key]]));
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

    const expected = triggerSemanticExpectation(request.body);
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
    return {
      op: request.op,
      triggerId: request.triggerId ?? returnedId ?? triggerIdOf(actual),
      matchSource,
      persisted: Boolean(actual) && mismatches.length === 0,
      mismatches,
    };
  });
  return { roundTrip: checks.every((check) => check.persisted), checks };
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
    name: 'check_workflow',
    description: describe('check_workflow',
      "Read-only pre-flight: reproduce the workflow builder's \"Resolve N Errors\" list for an existing "
      + 'workflow, without opening the UI (proof: live-reproduction 2026-07-27 — matched the builder exactly '
      + 'on a known-broken workflow: same count, same step, same stepId, same message; risk: read-only). Applies GHL\'s OWN action schema (the marketplace assets '
      + 'catalog the builder itself validates against). NOTE: that catalog omits core native actions '
      + '(add_contact_tag, send_email, sms, if_else, wait, custom_webhook, ...), so a clean result means '
      + '"nothing found in the 240 types it describes", not "provably publishable". Also reports '
      + '`marketplaceDrift`: whether a stored marketplace TRIGGER\'s version/templateId matches what is '
      + 'installed now — TRIGGERS ONLY, because a stored marketplace ACTION step records no version at all '
      + '(live-captured 2026-08-16: its full key set is id, stepIndex, order, attributes, name, type, '
      + 'isMarketplaceAction — nothing to compare an action against). Always a separate key, never folded '
      + 'into `errorCount`.'),
    inputSchema: schema({
      locationId: z.string(),
      workflowId: z.string(),
    }),
    capabilities: [
      { method: 'GET', path: '/workflow/{loc}/{wid}' },
      { method: 'GET', path: '/workflow/{loc}/trigger' },
      { method: 'GET', path: '/workflows-marketplace/location/{loc}/assets' },
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

      const actionSchema = await fetchActionSchema((m, p) => gw.call(m, p), args.locationId);
      if (!actionSchema) {
        return fail(CODES.VALIDATION_FAILED,
          'Could not fetch the action schema, so no check was performed.',
          'Retry; if it persists the assets endpoint may be unavailable for this location.');
      }

      const errors = checkWorkflow(templates, actionSchema, triggerTypes.length ? { triggerTypes } : {});
      // Steps are actions, never triggers — but actionSchema now also carries trigger
      // entries (parseActionSchema merges assets.triggers into the same map, so
      // marketplaceDrift's trigger lookups work). Exclude kind:'trigger' entries here so a
      // step type that happened to collide with a trigger key can never inflate
      // stepsDescribed/count as "described" for a source that never described any step.
      const isStepSchema = (t) => {
        const spec = actionSchema.get(t.type);
        return spec != null && spec.kind !== 'trigger';
      };
      return ok({
        workflowId: args.workflowId,
        name: body.json?.name,
        status: body.json?.status,
        steps: templates.length,
        errorCount: errors.length,
        errors,
        headline: `Resolve ${errors.length} Errors`,
        // Marketplace TRIGGER-only version/templateId drift (see the tool description for
        // why actions are out of scope). A separate key, deliberately never folded into
        // errorCount above.
        marketplaceDrift: marketplaceDrift(triggerList, actionSchema),
        coverage: {
          schemaTypes: actionSchema.size,
          stepsDescribed: templates.filter(isStepSchema).length,
          stepsNotDescribed: templates.filter((t) => !isStepSchema(t)).length,
          note: 'Steps not described by the marketplace catalog (core native actions) are SKIPPED, '
            + 'not asserted clean. A zero errorCount is not proof the workflow is publishable.',
        },
      });
    }),
  },
  {
    name: 'export_workflow',
    description: describe('export_workflow', 'Export the full workflow body, triggers and sticky notes.'),
    inputSchema: schema({
      locationId: z.string(),
      workflowId: z.string(),
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
      return ok({
        workflow: body.json,
        triggers: asArray(triggers.json, 'triggers', 'data'),
        stickyNotes: asArray(notes.json, 'data', 'notes'),
      });
    }, args),
  },
  {
    name: 'get_workflow_logs',
    description: describe('get_workflow_logs', 'Read executions, enrollment and per-step contact counts.'),
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
      // Walk the enrollment roster to completion via the action=next cursor
      // instead of returning only page one. Bounded by maxEnrollmentPages.
      allEnrollments: z.boolean().default(false),
      maxEnrollmentPages: z.number().int().positive().default(50),
      // Opt-in enrollment totals ({ total, finished }) from the cache endpoint.
      enrollmentTotals: z.boolean().default(false),
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

      return ok({
        logs: logs.json?.logs ?? logs.json ?? [],
        perStepCounts: counts.json?.counts ?? counts.json ?? [],
        enrollments,
        // Only meaningful when the caller asked for the full walk; undefined keeps
        // the single-page response shape unchanged for existing callers.
        ...(args.allEnrollments ? { enrollmentsComplete, enrollmentPages: pages } : {}),
        ...(rateLimited ? { rateLimited: true } : {}),
        ...(enrollmentStats ? { enrollmentStats } : {}),
        note: 'added_to_workflow in logs is the ONLY proof a trigger fired.',
      });
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
      'Sweep Conversation AI, Voice AI and Agent Studio discovery plus detail — proof: external-receipt-required; risk: read. All three surfaces are always attempted; a failed or malformed component is complete:false with null items, never an empty agent list. Live canary required before Full audit.',
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
      // CORRECTED 2026-07-27 from live traffic: `/ai-employees/agents` 404s ("Cannot GET",
      // i.e. no such route), so this component failed every run. The live discovery route is
      // the sibling of the detail route below. See core/audit-capabilities.mjs for the probe.
      { method: 'GET', path: '/ai-employees/employees/search' },
      { method: 'GET', path: '/ai-employees/employees/{agentId}' },
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
      // ONLY the ai rail, for the same reason the roster builds only jwt: ALL SIX of this
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
    name: 'list_account_entities',
    description: describe(
      'list_account_entities',
      'Sweep pipelines, calendars, users, forms, custom fields and AI agents before authoring a workflow spec.',
    ),
    inputSchema: schema({ locationId: z.string() }),
    capabilities: [
      { method: 'GET', path: '/opportunities/pipelines' },
      { method: 'GET', path: '/calendars/' },
      { method: 'GET', path: '/users/' },
      { method: 'GET', path: '/forms/' },
      { method: 'GET', path: '/locations/{loc}/customFields/search' },
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
      + 'actions — key, version, templateId, and the full customVars / inputs schema — proof: documented; '
      + 'risk: read. The workflow builder renders its own Add-trigger and Add-action panels from these two '
      + 'endpoints, so the list is complete by construction ONLY when both GETs succeed; a failed leg reports '
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
      // The module endpoint lives on the AI host, which needs the dual credential rail.
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
          `/marketplace/core/search/module?locationId=${loc}&type=${type}&isInstalled=true&skip=0&limit=200`);
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
    description: describe('list_courses', 'List course summaries (proof: engine source).'),
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
    description: `${describe('build_course', 'Build and verify a GHL Memberships course (proof: engine source).')} The proof label describes underlying engine routes; this MCP tool has not completed its human-gated live proof. Confirmation-gated: preview performs no account call. Only free offers are supported; paid offers return 500 without a payment provider. An embed is not a content_type: use lesson.embed, which creates a video post then persists embedJson via PUT. Local video/audio/material upload is exposed because this MCP is a local Node/stdio server; every media path must be absolute and the runtime needs filesystem access (ffprobe is optional).`,
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
    description: 'Build and verify a new workflow draft through the canonical dependency-aware orchestrator (proof: engine source). This tool never publishes.',
    inputSchema: schema({
      locationId: z.string(),
      spec: z.object({}).passthrough(),
      ignoreUnresolved: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'GET', path: '/opportunities/pipelines' },
      { method: 'GET', path: '/calendars/' },
      { method: 'GET', path: '/users/' },
      { method: 'GET', path: '/forms/' },
      { method: 'GET', path: '/locations/{loc}/customFields/search' },
      { method: 'GET', path: '/voice-ai/agents' },
      { method: 'GET', path: '/ai-employees/employees/search' },
      { method: 'POST', path: '/emails/builder' },
      { method: 'POST', path: '/emails/builder/data' },
      { method: 'GET', path: '/locations/{loc}/tags' },
      { method: 'POST', path: '/locations/{loc}/tags' },
      { method: 'POST', path: '/workflow/{loc}' },
      { method: 'PUT', path: '/workflow/{loc}/{wid}/auto-save' },
      { method: 'POST', path: '/workflow/{loc}/trigger' },
      { method: 'GET', path: '/workflow/{loc}/{wid}' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const report = await orchestrate(args.spec, gw, {
        ignoreUnresolved: args.ignoreUnresolved ?? false,
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
    description: 'Preview or confirmation-gate edits to an existing workflow through the canonical edit engine (proof: engine source). Confirmed step edits use only the plain workflow PUT and are round-trip verified.',
    inputSchema: schema({
      locationId: z.string(),
      workflowId: z.string(),
      ops: z.array(z.object({}).passthrough()),
      assumeAssociated: z.boolean().default(false),
      confirm: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'GET', path: '/locations/{loc}/customFields/search' },
      { method: 'GET', path: '/workflow/{loc}/{wid}' },
      { method: 'GET', path: '/workflow/{loc}/trigger' },
      { method: 'GET', path: '/locations/{loc}/tags' },
      { method: 'POST', path: '/locations/{loc}/tags' },
      { method: 'PUT', path: '/workflow/{loc}/{wid}' },
      { method: 'POST', path: '/workflow/{loc}/trigger' },
      { method: 'PUT', path: '/workflow/{loc}/trigger/{tid}' },
      { method: 'DELETE', path: '/workflow/{loc}/trigger/{tid}' },
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

      const idGen = boundEditIdGen(
        args.locationId,
        args.workflowId,
        fresh.version,
        args.ops,
        beforeTemplates.map((step) => step.id),
      );
      const ctx = {
        loc: args.locationId,
        cid: undefined,
        uid: gw.uid,
        companyAge: 0,
        idGen,
        catalog: loadCatalog(),
        ...(customFields !== undefined ? { customFields } : {}),
        warn: (message) => warnings.push(message),
      };
      const { stepOps, triggerOps } = partitionOps(args.ops);
      let existingTriggers = [];
      if (triggerOps.length) {
        const listed = await listWorkflowTriggers(gw, args.locationId, args.workflowId);
        if (!listed.response.ok) return fromHttp(listed.response.status, listed.response.json);
        existingTriggers = listed.triggers;
      }

      const { templates, diff } = applyOps(beforeTemplates, stepOps, { ctx, idGen });
      // Steps this edit ADDED were compiled through compile(), which already ran the
      // update_contact_field actionType advisory via ctx.warn. `modifyStep` merges an
      // attrPatch straight onto a stored step and never reaches the compiler, so the
      // modified set is linted here — scoped to it, so pre-existing steps the caller did
      // not touch stay out of the preview.
      lintContactFieldTemplates(templates, diff.modifiedSteps, ctx.warn);
      const commitBody = editCommitBody(fresh, templates, diff, gw.uid, {
        assumeAssociated: args.assumeAssociated === true,
      });
      const triggerPlan = planTriggerOps(triggerOps, {
        ctx,
        wid: args.workflowId,
        uid: gw.uid,
        existing: existingTriggers,
      });

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
      );

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
        triggerWrites: { planned: triggerPlan.length, applied: 0 },
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

      if (stepOps.length) {
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
              'One or more acknowledged trigger writes did not persist on round-trip verification.',
              'Inspect data.partialProgress.verification.triggers and the live trigger list before retrying.',
            ),
            'trigger_round_trip_verify',
            'Trigger configuration is unverified, so this edit must not be published.',
            { requiresPublish: false, publishInstruction: null },
          );
        }
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
      const verify = verifyEditRoundTrip(templates, beforeTemplates, gotTemplates);
      partialProgress.verification.completed = true;
      partialProgress.verification.roundTrip = verify.roundTrip;
      partialProgress.verification.workflowStatus = roundTripResponse.json?.status ?? null;
      const data = {
        workflowId: args.workflowId,
        status: roundTripResponse.json?.status,
        stepCount: { before: beforeTemplates.length, after: gotTemplates.length },
        idsAdded: preview.idsAdded,
        idsRemoved: preview.idsRemoved,
        diff,
        createdTags: partialProgress.tags.created,
        triggerChangesApplied: partialProgress.triggerWrites.applied,
        requiresPublish: triggerPlan.length > 0,
        publishInstruction: triggerPlan.length
          ? 'Trigger configuration was committed without activation. After verifying the edit, invoke publish_workflow with confirm:true to activate it explicitly.'
          : null,
        verify,
        warnings,
        partialProgress,
        builderUrl: `https://app.gohighlevel.com/v2/location/${encodeURIComponent(args.locationId)}/automation/workflow/${encodeURIComponent(args.workflowId)}`,
        runtimeProofNote: 'edit_workflow never publishes. After confirmed publish_workflow, only added_to_workflow in runtime logs proves that a trigger fired.',
      };

      if (!verify.roundTrip) {
        return editWriteFailure(
          fail(
            CODES.ENGINE_ABORT,
            'Workflow PUT returned but the edited graph did not round-trip cleanly.',
            'Inspect data.verify and the workflow canvas before making further edits.',
          ),
          data,
        );
      }
      return ok(data);
    }, args),
  },
  {
    name: 'publish_workflow',
    description: 'Preview or confirmation-gate a version-safe workflow publish using the full active trigger envelope (proof: engine source). Publishing is round-trip verified but runtime firing still requires logs.',
    inputSchema: schema({
      locationId: z.string(),
      workflowId: z.string(),
      confirm: z.boolean().default(false),
    }),
    capabilities: [
      { method: 'GET', path: '/workflow/{loc}/{wid}' },
      { method: 'GET', path: '/workflow/{loc}/trigger' },
      { method: 'PUT', path: '/workflow/{loc}/{wid}' },
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
      const attemptPublishWrite = async (invoke) => {
        const outcome = {
          phase: 'publish_put',
          attempted: true,
          acknowledged: false,
          ambiguous: false,
        };
        partialProgress.writes.push(outcome);
        partialProgress.putAttempted = true;
        partialProgress.putOutcome = outcome;
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
      const activeTriggers = latestTriggers.triggers.map((trigger) => ({ ...trigger, active: true }));
      const body = {
        ...publishable,
        status: 'published',
        version: freshResponse.json.version,
        triggersChanged: false,
        oldTriggers: activeTriggers,
        newTriggers: activeTriggers,
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
      const checkedTriggers = checkedTriggersCall.value;
      const inactiveTriggers = checkedTriggers.triggers
        .filter((trigger) => trigger.active !== true)
        .map((trigger) => trigger.name ?? trigger.id ?? trigger._id);
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
  {
    name: 'fast_forward_contacts',
    description: describe('fast_forward_contacts', 'Preview or confirm moving parked workflow enrollments past one step (proof: engine source).'),
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
      const callOpts = onAi ? { base: 'https://services.leadconnectorhq.com' } : undefined;
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
];

export function registerTools(server, deps, tools = TOOLS) {
  for (const t of tools) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.inputSchema },
      async (args) => {
        const safeArgs = args ?? {};
        const result = validateRegisteredArgs(t, safeArgs) ?? await t.handler(safeArgs, deps);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      });
  }
}
