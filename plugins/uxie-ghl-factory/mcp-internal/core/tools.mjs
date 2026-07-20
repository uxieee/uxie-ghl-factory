// Transport-blind tool definitions. Descriptions are pulled from the docs
// repo's generated catalog so proof status and risk reach the agent verbatim.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ok, fail, fromHttp, CODES, containsSecrets } from './errors.mjs';
import { authStatus, DEFAULT_TOKEN_FILE, readCredentials } from './auth.mjs';
import { fetchEntities, orchestrate } from '../../skills/create-ghl-workflow/engine/orchestrate.mjs';
import { editCommitBody } from '../../skills/create-ghl-workflow/engine/edit.mjs';
import {
  applyOps,
  partitionOps,
  planTriggerOps,
} from '../../skills/create-ghl-workflow/engine/edit-driver.mjs';
import { loadCatalog } from '../../skills/create-ghl-workflow/engine/catalog.mjs';
import { makeDeterministicIdGen } from '../../skills/create-ghl-workflow/engine/idgen.mjs';
import { collectOpTags, missingTags } from '../../skills/create-ghl-workflow/engine/tags.mjs';
import { makeFF } from '../../skills/ghl-workflow-fast-forward/engine/ff.mjs';
import { GhlMembershipsApi } from '../../skills/ghl-memberships/engine/api.mjs';
import { buildCourse, previewCourseSpec } from '../../skills/ghl-memberships/engine/course-builder.mjs';

const DOCS_CATALOG = '/Volumes/Xander SSD/Vibe Code/Misc/ghl-workflow-api-docs/catalog/tool-descriptions.json';
let CATALOG = {};
try { CATALOG = JSON.parse(readFileSync(DOCS_CATALOG, 'utf8')); } catch { CATALOG = {}; }
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
  return fail(
    CODES.ENGINE_ABORT,
    error?.message ?? String(error),
    'Gateway transport failed before an HTTP result was available; inspect account state before retrying.',
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
    name: 'list_workflows',
    description: describe('list_workflows', 'List workflows in a location.'),
    inputSchema: schema({
      locationId: z.string(),
      status: z.enum(['published', 'draft']).optional(),
      search: z.string().optional(),
      limit: z.number().default(100),
      offset: z.number().default(0),
    }),
    capabilities: [{ method: 'GET', path: '/workflow/{loc}/list' }],
    handler: async (args, deps) => guard(async () => {
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
    }),
    capabilities: [
      { method: 'GET', path: '/workflows/logs/v2' },
      { method: 'GET', path: '/workflows/status/search/count-per-step' },
      { method: 'GET', path: '/workflows/status/search/workflow-with-filter' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      const limit = args.limit ?? 20;
      const baseQuery = new URLSearchParams({
        workflowId: args.workflowId,
        locationId: args.locationId,
      });
      const logsQuery = new URLSearchParams(baseQuery);
      logsQuery.set('limit', String(limit));
      const enrollmentQuery = new URLSearchParams(baseQuery);
      enrollmentQuery.set('action', 'first');
      enrollmentQuery.set('limit', String(limit));

      const [logs, counts, enrolled] = await Promise.all([
        gw.call('GET', `/workflows/logs/v2?${logsQuery}`),
        gw.call('GET', `/workflows/status/search/count-per-step?${baseQuery}`),
        gw.call('GET', `/workflows/status/search/workflow-with-filter?${enrollmentQuery}`),
      ]);
      if (!logs.ok) return fromHttp(logs.status, logs.json);
      if (!counts.ok) return fromHttp(counts.status, counts.json);
      if (!enrolled.ok) return fromHttp(enrolled.status, enrolled.json);

      return ok({
        logs: logs.json?.logs ?? logs.json ?? [],
        perStepCounts: counts.json?.counts ?? counts.json ?? [],
        enrollments: enrolled.json?.rows ?? enrolled.json?.statuses ?? enrolled.json ?? [],
        note: 'added_to_workflow in logs is the ONLY proof a trigger fired.',
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
      { method: 'GET', path: '/ai-employees/agents' },
    ],
    handler: async (args, deps) => guard(async () => {
      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      return ok(await fetchEntities(gw));
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
      { method: 'GET', path: '/ai-employees/agents' },
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
    description: 'Escape hatch for internal endpoints the typed tools do not cover. GET remains read-only; non-GET requests require confirm:true and report ambiguous transport outcomes.',
    inputSchema: schema({
      locationId: z.string(),
      method: z.string().trim().regex(HTTP_METHOD_TOKEN).transform((method) => method.toUpperCase()),
      path: z.string().startsWith('/').describe('Internal path beginning with / — the gateway adds the base URL'),
      body: z.unknown().optional(),
      confirm: z.boolean().default(false),
    }),
    capabilities: [],
    handler: async (args, deps) => guard(async () => {
      const method = normalizeHttpMethod(args.method);
      if (!method) {
        return fail(
          CODES.VALIDATION_FAILED,
          'raw_request method must be a syntactically valid HTTP method token',
          'Pass one HTTP method token without whitespace or header/path content.',
        );
      }
      if (method !== 'GET' && args.confirm !== true) {
        return withFailureData(
          fail(
            CODES.CONFIRM_REQUIRED,
            'Raw write preview is ready; no gateway call was sent.',
            'Review data.preview, then repeat the same request with confirm:true to send it.',
          ),
          { preview: { method, path: args.path, ...(args.body === undefined ? {} : { body: args.body }) } },
        );
      }

      const gw = deps.makeGw({ loc: args.locationId, state: deps.state });
      if (method === 'GET') {
        const response = await gw.call('GET', args.path);
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
        () => gw.call(method, args.path, args.body),
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
