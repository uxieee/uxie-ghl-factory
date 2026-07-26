// Tests for core/audit-capabilities.mjs (Task 2, Step 1) plus the Task 5 build-and-diff
// gate at the foot of this file.
//
// Task 2 left this file validating descriptor uniqueness + schema + the frozen initial
// descriptor set only, with a TODO for Task 5. That TODO is now discharged: the last
// section regenerates the audit capability manifest from THESE descriptors and asserts
// row-for-row equality, so gateway policy and the committed artefact cannot drift. The
// direction of that dependency matters and is asserted, not assumed — the manifest is
// COMPILED FROM the descriptors, never read back into policy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  AUDIT_CAPABILITIES,
  AUDIT_HOSTS,
  capabilityById,
  hostBaseFor,
  resolveCapability,
} from '../core/audit-capabilities.mjs';

// The complete set of typed IDs a descriptor binding may name. A binding target
// outside this set means the composite has no typed value to check against.
const TYPED_BINDING_NAMES = new Set(['agentId', 'companyId', 'locationId', 'stepId', 'workflowId']);
const LEGAL_HOST_RAIL_PAIRS = new Set(['backend/backend', 'services/ai']);
const LEGAL_LOCATION_BINDINGS = new Set(['path', 'query', 'request_scope']);
// `repeatableQueryKeys` and `sealedBy` are policy-bearing and therefore part of the
// descriptor contract Task 5's manifest must carry, even though the plan's prose field
// list predates both.
const DESCRIPTOR_FIELDS = [
  'capabilityId', 'host', 'authRail', 'method', 'normalizedPath', 'pathBindings',
  'queryBindings', 'requiredQueryKeys', 'optionalQueryKeys', 'repeatableQueryKeys',
  'fixedQueryValues', 'allowedQueryValues', 'numericQueryBounds', 'locationBinding',
  'sealedBy',
];

// Order matters: it is the order of the plan's "initial descriptor set is exact" block.
const CAPABILITY_ORDER = [
  'workflow_roster_list',
  'workflow_detail',
  'workflow_triggers',
  'workflow_sticky_notes',
  'workflow_execution_logs',
  'workflow_count_per_step',
  'workflow_enrollment_search',
  'workflow_step_details',
  'workflow_enroll_stats_cache',
  'workflow_enroll_stats',
  'voice_ai_agent_discovery',
  'voice_ai_agent_detail',
  'conversation_ai_agent_discovery',
  'conversation_ai_agent_detail',
  'agent_studio_agent_discovery',
  'agent_studio_agent_detail',
];

// Descriptor defaults. Every plan-derived value is still written out literally below.
const descriptor = (over) => ({
  host: 'backend',
  authRail: 'backend',
  method: 'GET',
  pathBindings: {},
  queryBindings: {},
  requiredQueryKeys: [],
  optionalQueryKeys: [],
  repeatableQueryKeys: [],
  fixedQueryValues: {},
  allowedQueryValues: {},
  numericQueryBounds: {},
  locationBinding: 'query',
  sealedBy: null,
  ...over,
});

// Query values travel the wire as strings, so fixed/allowed values are declared
// as strings and compared after String() coercion.
const EXPECTED = {
  workflow_roster_list: descriptor({
    capabilityId: 'workflow_roster_list',
    normalizedPath: '/workflow/{locationId}/list',
    pathBindings: { locationId: 'locationId' },
    requiredQueryKeys: ['type', 'limit', 'offset', 'sortBy', 'sortOrder', 'includeCustomObjects', 'includeObjectiveBuilder'],
    optionalQueryKeys: ['status', 'search'],
    fixedQueryValues: {
      type: 'workflow',
      sortBy: 'name',
      sortOrder: 'asc',
      includeCustomObjects: 'true',
      includeObjectiveBuilder: 'true',
    },
    allowedQueryValues: { status: ['published', 'draft'] },
    numericQueryBounds: { limit: { min: 1, max: 100 }, offset: { min: 0 } },
    locationBinding: 'path',
  }),
  workflow_detail: descriptor({
    capabilityId: 'workflow_detail',
    normalizedPath: '/workflow/{locationId}/{workflowId}',
    pathBindings: { locationId: 'locationId', workflowId: 'workflowId' },
    requiredQueryKeys: ['includeScheduledPauseInfo'],
    fixedQueryValues: { includeScheduledPauseInfo: 'true' },
    locationBinding: 'path',
  }),
  workflow_triggers: descriptor({
    capabilityId: 'workflow_triggers',
    normalizedPath: '/workflow/{locationId}/trigger',
    pathBindings: { locationId: 'locationId' },
    queryBindings: { workflowId: 'workflowId' },
    requiredQueryKeys: ['workflowId'],
    locationBinding: 'path',
  }),
  workflow_sticky_notes: descriptor({
    capabilityId: 'workflow_sticky_notes',
    normalizedPath: '/workflows/sticky-notes-all',
    queryBindings: { workflowId: 'workflowId' },
    requiredQueryKeys: ['workflowId', 'locationId'],
    locationBinding: 'query',
  }),
  workflow_execution_logs: descriptor({
    capabilityId: 'workflow_execution_logs',
    normalizedPath: '/workflows/logs/v2',
    queryBindings: { workflowId: 'workflowId' },
    requiredQueryKeys: ['workflowId', 'locationId', 'limit', 'fromDate', 'toDate'],
    optionalQueryKeys: ['contactId', 'eventType'],
    fixedQueryValues: { limit: '20' },
    locationBinding: 'query',
  }),
  workflow_count_per_step: descriptor({
    capabilityId: 'workflow_count_per_step',
    normalizedPath: '/workflows/status/search/count-per-step',
    queryBindings: { workflowId: 'workflowId' },
    requiredQueryKeys: ['workflowId', 'locationId'],
    locationBinding: 'query',
  }),
  workflow_enrollment_search: descriptor({
    capabilityId: 'workflow_enrollment_search',
    normalizedPath: '/workflows/status/search/workflow-with-filter',
    queryBindings: { workflowId: 'workflowId' },
    requiredQueryKeys: ['workflowId', 'locationId', 'action', 'limit'],
    optionalQueryKeys: [
      'contactId', 'fromDate', 'toDate', 'eventType',
      'referenceId', 'referenceCreatedAt', 'referenceSid', 'referenceSequence',
    ],
    allowedQueryValues: { action: ['first', 'next'] },
    fixedQueryValues: { limit: '20' },
    locationBinding: 'query',
  }),
  workflow_step_details: descriptor({
    capabilityId: 'workflow_step_details',
    normalizedPath: '/workflows/status/search/details-by-step',
    queryBindings: { workflowId: 'workflowId', currentStepId: 'stepId' },
    requiredQueryKeys: ['workflowId', 'locationId', 'currentStepId', 'skip', 'limit', 'showTotalCount'],
    fixedQueryValues: { showTotalCount: 'true' },
    numericQueryBounds: { limit: { min: 1, max: 50 }, skip: { min: 0 } },
    locationBinding: 'query',
  }),
  workflow_enroll_stats_cache: descriptor({
    capabilityId: 'workflow_enroll_stats_cache',
    normalizedPath: '/workflows/status/search/enroll-stats-cache',
    queryBindings: { 'workflowIds[]': 'workflowId' },
    requiredQueryKeys: ['workflowIds[]', 'locationId'],
    // REWRITTEN (I4). This snapshot used to pin `repeatableQueryKeys: ['workflowIds[]']`,
    // which was dead policy: the key is also BOUND, and a bound key must carry exactly one
    // value (plan line 313 — "contain exactly that workflow"), so every repeat threw
    // BINDING_MISMATCH and the declaration could never be exercised positively. Batching
    // is not authorized, so cardinality 1 is the spec and the correct declaration is empty.
    repeatableQueryKeys: [],
    locationBinding: 'query',
  }),
  workflow_enroll_stats: descriptor({
    capabilityId: 'workflow_enroll_stats',
    normalizedPath: '/workflows/status/enroll-stats',
    queryBindings: { workflowId: 'workflowId' },
    requiredQueryKeys: ['workflowId', 'locationId'],
    locationBinding: 'query',
  }),
  voice_ai_agent_discovery: descriptor({
    capabilityId: 'voice_ai_agent_discovery',
    host: 'services',
    authRail: 'ai',
    normalizedPath: '/voice-ai/agents/simple',
    requiredQueryKeys: ['locationId'],
    locationBinding: 'query',
  }),
  voice_ai_agent_detail: descriptor({
    capabilityId: 'voice_ai_agent_detail',
    host: 'services',
    authRail: 'ai',
    normalizedPath: '/voice-ai/agents/{agentId}',
    pathBindings: { agentId: 'agentId' },
    requiredQueryKeys: ['locationId'],
    locationBinding: 'query',
    sealedBy: 'voice_ai_agent_discovery',
  }),
  conversation_ai_agent_discovery: descriptor({
    capabilityId: 'conversation_ai_agent_discovery',
    host: 'services',
    authRail: 'ai',
    // Snapshot updated 2026-07-27 with the route correction. `/ai-employees/agents` was
    // never a real GHL route — a live read-only probe on GROM AU returned a 404 "Cannot GET",
    // so Conversation AI discovery failed on every run. This snapshot exists to make a
    // descriptor change deliberate rather than incidental, and this change is deliberate:
    // the value it pinned was wrong, and pinning a wrong value only guarantees it stays wrong.
    normalizedPath: '/ai-employees/employees/search',
    requiredQueryKeys: ['locationId'],
    locationBinding: 'query',
  }),
  conversation_ai_agent_detail: descriptor({
    capabilityId: 'conversation_ai_agent_detail',
    host: 'services',
    authRail: 'ai',
    normalizedPath: '/ai-employees/employees/{agentId}',
    pathBindings: { agentId: 'agentId' },
    requiredQueryKeys: ['locationId'],
    locationBinding: 'query',
    sealedBy: 'conversation_ai_agent_discovery',
  }),
  agent_studio_agent_discovery: descriptor({
    capabilityId: 'agent_studio_agent_discovery',
    host: 'services',
    authRail: 'ai',
    normalizedPath: '/agent-studio/agents/agents-with-folders',
    queryBindings: { agencyId: 'companyId' },
    requiredQueryKeys: ['locationId', 'agencyId', 'productId', 'page', 'pageSize', 'groupBy', 'sortBy', 'sortOrder'],
    fixedQueryValues: {
      productId: 'superagent',
      groupBy: 'foldersFirst',
      sortBy: 'lastUpdated',
      sortOrder: 'desc',
    },
    numericQueryBounds: { page: { min: 1 }, pageSize: { min: 1, max: 100 } },
    locationBinding: 'query',
  }),
  agent_studio_agent_detail: descriptor({
    capabilityId: 'agent_studio_agent_detail',
    host: 'services',
    authRail: 'ai',
    normalizedPath: '/agent-studio/super-agent/agents/{agentId}',
    pathBindings: { agentId: 'agentId' },
    requiredQueryKeys: ['locationId'],
    locationBinding: 'query',
    sealedBy: 'agent_studio_agent_discovery',
  }),
};

// Canonicalize both sides identically: sort object keys and sort string arrays so
// declaration order is never part of the contract.
const canonical = (value) => {
  if (Array.isArray(value)) {
    const mapped = value.map(canonical);
    return mapped.every((item) => typeof item === 'string') ? [...mapped].sort() : mapped;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};

const segments = (normalizedPath) => normalizedPath.split('/').filter(Boolean);
const isVariable = (segment) => segment.startsWith('{') && segment.endsWith('}');
const staticCount = (normalizedPath) => segments(normalizedPath).filter((s) => !isVariable(s)).length;

const throwsWithCode = (fn, code) => {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof Error, 'expected an Error instance');
    assert.ok(
      error.code === code || String(error.message).startsWith(code),
      `expected ${code}, got code=${error.code} message=${error.message}`,
    );
    return true;
  });
};

test('AUDIT_CAPABILITIES is a frozen array of descriptors', () => {
  assert.ok(Array.isArray(AUDIT_CAPABILITIES));
  assert.ok(Object.isFrozen(AUDIT_CAPABILITIES));
  assert.equal(AUDIT_CAPABILITIES.length, CAPABILITY_ORDER.length);
});

test('AUDIT_HOSTS pins exactly the two approved hosts', () => {
  assert.deepEqual(AUDIT_HOSTS, {
    backend: 'https://backend.leadconnectorhq.com',
    services: 'https://services.leadconnectorhq.com',
  });
});

// M3: a shallow Object.freeze would pass every other freeze assertion in this file while
// still allowing `capability.requiredQueryKeys.push('anything')` to widen the audit
// surface at runtime, with no test and no manifest change to show for it.
test('descriptors are frozen all the way down, not just at the top level', () => {
  const roster = capabilityById('workflow_roster_list');
  assert.ok(Object.isFrozen(roster), 'descriptor object must be frozen');
  assert.ok(Object.isFrozen(roster.requiredQueryKeys), 'nested array requiredQueryKeys must be frozen');
  assert.ok(Object.isFrozen(roster.optionalQueryKeys), 'nested array optionalQueryKeys must be frozen');
  assert.ok(Object.isFrozen(roster.fixedQueryValues), 'nested object fixedQueryValues must be frozen');
  assert.ok(Object.isFrozen(roster.allowedQueryValues.status), 'array inside allowedQueryValues must be frozen');
  assert.ok(Object.isFrozen(roster.numericQueryBounds), 'nested object numericQueryBounds must be frozen');
  assert.ok(Object.isFrozen(roster.numericQueryBounds.limit), 'bounds object two levels deep must be frozen');

  assert.throws(() => { roster.requiredQueryKeys.push('smuggled'); }, TypeError);
  assert.throws(() => { roster.numericQueryBounds.limit.max = 10_000; }, TypeError);
  assert.equal(roster.requiredQueryKeys.includes('smuggled'), false);
  assert.equal(roster.numericQueryBounds.limit.max, 100);
});

// M1: indexing AUDIT_HOSTS directly yields `undefined` for an unknown token, and
// core/gateway.mjs treats a missing base as "use the backend default" — so a descriptor
// typo would silently send an AI-rail read to the backend host instead of failing.
test('hostBaseFor resolves the two approved hosts and refuses anything else', () => {
  assert.equal(hostBaseFor('backend'), 'https://backend.leadconnectorhq.com');
  assert.equal(hostBaseFor('services'), 'https://services.leadconnectorhq.com');
  for (const host of ['app', 'BACKEND', '', undefined, null, 'constructor', 'toString', '__proto__']) {
    throwsWithCode(() => hostBaseFor(host), 'UNKNOWN_CAPABILITY_HOST');
  }
});

// I10: each detail route names the ONE discovery capability whose sealed result may
// authorize it. A flat seal would let a Voice id probe the other two products' routes.
test('every detail descriptor is sealed by its own product discovery capability', () => {
  const expectedSeals = {
    voice_ai_agent_detail: 'voice_ai_agent_discovery',
    conversation_ai_agent_detail: 'conversation_ai_agent_discovery',
    agent_studio_agent_detail: 'agent_studio_agent_discovery',
  };
  const known = new Set(AUDIT_CAPABILITIES.map((c) => c.capabilityId));
  for (const cap of AUDIT_CAPABILITIES) {
    const bindsAgent = Object.values(cap.pathBindings).includes('agentId');
    if (bindsAgent) {
      assert.equal(cap.sealedBy, expectedSeals[cap.capabilityId], `${cap.capabilityId}: wrong sealedBy`);
      assert.ok(known.has(cap.sealedBy), `${cap.capabilityId}: sealedBy names an unknown capability`);
      assert.notEqual(cap.sealedBy, cap.capabilityId, `${cap.capabilityId}: cannot seal itself`);
    } else {
      assert.equal(cap.sealedBy, null, `${cap.capabilityId}: only agent-detail routes carry a seal`);
    }
  }
});

test('capabilityId is unique across descriptors', () => {
  const ids = AUDIT_CAPABILITIES.map((c) => c.capabilityId);
  assert.equal(new Set(ids).size, ids.length, `duplicate capabilityId in ${JSON.stringify(ids)}`);
});

test('(host, method, normalizedPath) is unique across descriptors', () => {
  const keys = AUDIT_CAPABILITIES.map((c) => `${c.host} ${c.method} ${c.normalizedPath}`);
  assert.equal(new Set(keys).size, keys.length, `duplicate route in ${JSON.stringify(keys)}`);
});

test('every descriptor is schema-valid', () => {
  for (const cap of AUDIT_CAPABILITIES) {
    const where = cap.capabilityId;
    for (const field of DESCRIPTOR_FIELDS) {
      assert.ok(Object.hasOwn(cap, field), `${where}: missing field ${field}`);
    }
    assert.equal(cap.method, 'GET', `${where}: method must be GET`);
    assert.ok(
      LEGAL_HOST_RAIL_PAIRS.has(`${cap.host}/${cap.authRail}`),
      `${where}: illegal host/rail pair ${cap.host}/${cap.authRail}`,
    );
    assert.ok(LEGAL_LOCATION_BINDINGS.has(cap.locationBinding), `${where}: illegal locationBinding`);
    assert.ok(cap.normalizedPath.startsWith('/'), `${where}: normalizedPath must be rooted`);

    const pathVars = segments(cap.normalizedPath).filter(isVariable).map((s) => s.slice(1, -1));
    assert.deepEqual(
      [...pathVars].sort(),
      Object.keys(cap.pathBindings).sort(),
      `${where}: pathBindings must cover exactly the {vars} in normalizedPath`,
    );

    for (const target of [...Object.values(cap.pathBindings), ...Object.values(cap.queryBindings)]) {
      assert.ok(TYPED_BINDING_NAMES.has(target), `${where}: unknown typed-binding target ${target}`);
    }

    const required = new Set(cap.requiredQueryKeys);
    const optional = new Set(cap.optionalQueryKeys);
    assert.equal(required.size, cap.requiredQueryKeys.length, `${where}: duplicate requiredQueryKeys`);
    assert.equal(optional.size, cap.optionalQueryKeys.length, `${where}: duplicate optionalQueryKeys`);
    for (const key of optional) {
      assert.ok(!required.has(key), `${where}: ${key} is both required and optional`);
    }

    const declared = new Set([...required, ...optional]);
    const referenced = [
      ...Object.keys(cap.fixedQueryValues),
      ...Object.keys(cap.allowedQueryValues),
      ...Object.keys(cap.numericQueryBounds),
      ...Object.keys(cap.queryBindings),
      ...cap.repeatableQueryKeys,
    ];
    for (const key of referenced) {
      assert.ok(declared.has(key), `${where}: ${key} is constrained but never declared required/optional`);
    }

    if (cap.locationBinding === 'query') {
      assert.ok(declared.has('locationId'), `${where}: query-bound location needs a locationId key`);
    }
    if (cap.locationBinding === 'path') {
      assert.equal(cap.pathBindings.locationId, 'locationId', `${where}: path-bound location needs {locationId}`);
    }

    for (const [key, values] of Object.entries(cap.allowedQueryValues)) {
      assert.ok(Array.isArray(values) && values.length > 0, `${where}: allowedQueryValues.${key} must be a non-empty array`);
    }
    for (const [key, bounds] of Object.entries(cap.numericQueryBounds)) {
      assert.ok(bounds && typeof bounds === 'object', `${where}: numericQueryBounds.${key} must be an object`);
      for (const boundName of Object.keys(bounds)) {
        assert.ok(['min', 'max'].includes(boundName), `${where}: numericQueryBounds.${key}.${boundName} is not min/max`);
      }
    }
  }
});

test('the descriptor set is exactly the 16 planned capability IDs, in plan order', () => {
  assert.deepEqual(AUDIT_CAPABILITIES.map((c) => c.capabilityId), CAPABILITY_ORDER);
});

test('every descriptor matches the plan snapshot value-for-value', () => {
  for (const capabilityId of CAPABILITY_ORDER) {
    const actual = AUDIT_CAPABILITIES.find((c) => c.capabilityId === capabilityId);
    assert.ok(actual, `missing descriptor ${capabilityId}`);
    const projected = Object.fromEntries(DESCRIPTOR_FIELDS.map((field) => [field, actual[field]]));
    assert.deepEqual(canonical(projected), canonical(EXPECTED[capabilityId]), `descriptor drift: ${capabilityId}`);
  }
});

// I4: `repeatableQueryKeys` is empty on EVERY descriptor, and that is the policy — not an
// oversight. A bound key must carry exactly one value, so any key that is both bound and
// repeatable is unreachable; and no unbound key on this rail has a proven repeat shape.
// The field is still carried on every descriptor (and every Task-5 manifest row) so a
// future non-empty value cannot be introduced without a visible manifest diff.
test('no descriptor declares a repeatable query key, and none is both bound and repeatable', () => {
  for (const capability of AUDIT_CAPABILITIES) {
    assert.deepEqual(
      capability.repeatableQueryKeys, [],
      `${capability.capabilityId}: repeating a key on the audit rail requires a plan revision, not a descriptor edit`,
    );
    // The structural rule that made the old declaration dead. It holds vacuously today,
    // and it is what a future non-empty value must satisfy.
    for (const key of capability.repeatableQueryKeys) {
      assert.ok(
        !Object.hasOwn(capability.queryBindings, key),
        `${capability.capabilityId}: ${key} is both bound and repeatable, so every repeat throws BINDING_MISMATCH`,
      );
    }
  }
});

test('capabilityById returns the descriptor or undefined', () => {
  assert.equal(capabilityById('workflow_execution_logs').normalizedPath, '/workflows/logs/v2');
  assert.equal(capabilityById('agent_studio_agent_detail').host, 'services');
  assert.equal(capabilityById('not_a_capability'), undefined);
  assert.equal(capabilityById(''), undefined);
  assert.equal(capabilityById(undefined), undefined);
});

// I4: the injectable descriptor list is what lets the gateway test exercise
// `repeatableQueryKeys` positively now that it is empty everywhere in the real set.
test('capabilityById honours an injected descriptor list without leaking the real set', () => {
  const synthetic = [{ capabilityId: 'synthetic_only', normalizedPath: '/synthetic' }];
  assert.equal(capabilityById('synthetic_only', synthetic).normalizedPath, '/synthetic');
  // A real id must NOT resolve against an injected list: an injected list is the whole
  // policy for that gateway, not an overlay on top of the shipped descriptors.
  assert.equal(capabilityById('workflow_execution_logs', synthetic), undefined);
  // And the default is still the real set.
  assert.equal(capabilityById('workflow_execution_logs').capabilityId, 'workflow_execution_logs');
});

test('resolveCapability prefers the candidate with the most static segments', () => {
  assert.equal(
    resolveCapability({ host: 'services', method: 'GET', path: '/voice-ai/agents/simple' }).capabilityId,
    'voice_ai_agent_discovery',
  );
  assert.equal(
    resolveCapability({ host: 'services', method: 'GET', path: '/voice-ai/agents/agent-123' }).capabilityId,
    'voice_ai_agent_detail',
  );
  assert.equal(
    resolveCapability({ host: 'backend', method: 'GET', path: '/workflow/LOC1/trigger' }).capabilityId,
    'workflow_triggers',
  );
  assert.equal(
    resolveCapability({ host: 'backend', method: 'GET', path: '/workflow/LOC1/list' }).capabilityId,
    'workflow_roster_list',
  );
  assert.equal(
    resolveCapability({ host: 'backend', method: 'GET', path: '/workflow/LOC1/wf-1' }).capabilityId,
    'workflow_detail',
  );
});

test('resolveCapability rejects unknown paths, foreign hosts, and non-GET methods', () => {
  throwsWithCode(
    () => resolveCapability({ host: 'backend', method: 'GET', path: '/workflows/nope' }),
    'UNKNOWN_CAPABILITY',
  );
  throwsWithCode(
    () => resolveCapability({ host: 'backend', method: 'GET', path: '/workflow/LOC1/list/extra' }),
    'UNKNOWN_CAPABILITY',
  );
  // A backend path must not resolve when claimed on the services host, and vice versa.
  throwsWithCode(
    () => resolveCapability({ host: 'services', method: 'GET', path: '/workflows/logs/v2' }),
    'UNKNOWN_CAPABILITY',
  );
  throwsWithCode(
    () => resolveCapability({ host: 'backend', method: 'GET', path: '/voice-ai/agents/simple' }),
    'UNKNOWN_CAPABILITY',
  );
  throwsWithCode(
    () => resolveCapability({ host: 'backend', method: 'POST', path: '/workflows/logs/v2' }),
    'UNAPPROVED_METHOD',
  );
  throwsWithCode(
    () => resolveCapability({ host: 'backend', method: 'DELETE', path: '/workflow/LOC1/wf-1' }),
    'UNAPPROVED_METHOD',
  );
});

// M9: an absolute URL must be refused BY RULE. Without the explicit check it was only
// refused by accident — `segmentsOf` shreds `https://evil.example/workflows/logs/v2` into
// segments, and a same-length descriptor would have matched with the origin silently gone.
test('resolveCapability refuses absolute, scheme-bearing, and unrooted paths by rule', () => {
  for (const path of [
    'https://backend.leadconnectorhq.com/workflows/logs/v2',
    'https://evil.example/workflows/logs/v2',
    'http://backend.leadconnectorhq.com/workflows/logs/v2',
    '//evil.example/workflows/logs/v2',
    'javascript:alert(1)',
    'workflows/logs/v2',
    '',
  ]) {
    throwsWithCode(
      () => resolveCapability({ host: 'backend', method: 'GET', path }),
      'ABSOLUTE_PATH_REJECTED',
    );
  }
  // The legitimate rooted form still resolves.
  assert.equal(
    resolveCapability({ host: 'backend', method: 'GET', path: '/workflows/logs/v2' }).capabilityId,
    'workflow_execution_logs',
  );
});

// M4: AMBIGUOUS_CAPABILITY is unreachable against the real 16-descriptor set (the test
// below proves exactly that), so without an injectable descriptor list the rule has no
// positive test and could be deleted with everything still green.
test('resolveCapability rejects a genuine specificity tie as AMBIGUOUS_CAPABILITY', () => {
  const tied = [
    { capabilityId: 'synthetic_a', host: 'backend', method: 'GET', normalizedPath: '/a/{first}/c' },
    { capabilityId: 'synthetic_b', host: 'backend', method: 'GET', normalizedPath: '/a/{second}/c' },
  ];
  throwsWithCode(
    () => resolveCapability({ host: 'backend', method: 'GET', path: '/a/b/c' }, tied),
    'AMBIGUOUS_CAPABILITY',
  );
  // The same injected list still resolves an unambiguous path normally, so the tie is
  // what is being detected and not merely the presence of a custom list.
  assert.equal(
    resolveCapability({ host: 'backend', method: 'GET', path: '/a/b/c' }, [tied[0]]).capabilityId,
    'synthetic_a',
  );
  // A more specific sibling still wins outright rather than tying.
  const withStatic = [...tied.slice(0, 1), { capabilityId: 'synthetic_c', host: 'backend', method: 'GET', normalizedPath: '/a/b/c' }];
  assert.equal(
    resolveCapability({ host: 'backend', method: 'GET', path: '/a/b/c' }, withStatic).capabilityId,
    'synthetic_c',
  );
});

test('no two descriptors can tie, so AMBIGUOUS_CAPABILITY is structurally unreachable today', () => {
  // A tie needs: same host, same segment count, an overlapping concrete path, and an
  // equal static-segment count. Prove no pair satisfies all four.
  for (let i = 0; i < AUDIT_CAPABILITIES.length; i += 1) {
    for (let j = i + 1; j < AUDIT_CAPABILITIES.length; j += 1) {
      const a = AUDIT_CAPABILITIES[i];
      const b = AUDIT_CAPABILITIES[j];
      if (a.host !== b.host) continue;
      const sa = segments(a.normalizedPath);
      const sb = segments(b.normalizedPath);
      if (sa.length !== sb.length) continue;
      const overlaps = sa.every((segment, index) => (
        isVariable(segment) || isVariable(sb[index]) || segment === sb[index]
      ));
      if (!overlaps) continue;
      assert.notEqual(
        staticCount(a.normalizedPath),
        staticCount(b.normalizedPath),
        `${a.capabilityId} and ${b.capabilityId} can both match the same path with equal static specificity`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Task 5: the build-and-diff gate
// ---------------------------------------------------------------------------
//
// The descriptors above are the ONLY source of audit policy. The generated manifest is an
// artefact of them. Without an equality gate the two drift silently in the one direction
// that matters: a descriptor tightened here while the checked-in manifest keeps describing
// the wider surface that Task 7's receipts are minted against.
//
// `repeatableQueryKeys` and `sealedBy` are included in the compared field set because the
// plan's prose field list predates both, and an artefact missing them would describe a
// wider surface than the gateway enforces (see the module header of audit-capabilities.mjs).

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_FILE = resolve(HERE, '../audit-capability-manifest.json');

let genManifest = null;
async function manifestApi() {
  genManifest ??= await import('../scripts/gen-manifest.mjs');
  assert.equal(
    typeof genManifest.buildAuditManifest, 'function',
    'scripts/gen-manifest.mjs must export buildAuditManifest() — the manifest is compiled from these descriptors',
  );
  return genManifest;
}

const readCommittedManifest = () => {
  try {
    return JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));
  } catch (error) {
    assert.fail(`audit-capability-manifest.json is missing or unreadable (${error.code ?? error.message}); run \`npm run manifest\``);
  }
};

test('the generated manifest describes exactly the descriptors in this module', async () => {
  const { buildAuditManifest } = await manifestApi();
  const manifest = buildAuditManifest();
  const rows = manifest.capabilities;

  assert.deepEqual(
    [...new Set(rows.map((row) => row.capabilityId))].sort(),
    [...CAPABILITY_ORDER].sort(),
    'the manifest must cover every descriptor and invent none',
  );

  for (const capability of AUDIT_CAPABILITIES) {
    const matching = rows.filter((row) => row.capabilityId === capability.capabilityId);
    assert.ok(matching.length > 0, `${capability.capabilityId}: no manifest row`);
    const expected = canonical(Object.fromEntries(
      DESCRIPTOR_FIELDS.map((field) => [field, capability[field]]),
    ));
    for (const row of matching) {
      const projected = canonical(Object.fromEntries(
        DESCRIPTOR_FIELDS.map((field) => [field, row[field]]),
      ));
      assert.deepEqual(
        projected, expected,
        `${capability.capabilityId}: manifest row (tool ${row.tool}) diverges from the gateway descriptor`,
      );
    }
  }
});

test('the COMMITTED audit manifest equals a fresh generation, field for field', async () => {
  const { buildAuditManifest } = await manifestApi();
  assert.deepEqual(
    readCommittedManifest(), buildAuditManifest(),
    'audit-capability-manifest.json is stale — run `npm run manifest` and commit it',
  );
});

test('the manifest is an ARTEFACT: mutating it cannot widen what the gateway enforces', async () => {
  const { buildAuditManifest } = await manifestApi();
  const before = buildAuditManifest();
  // A manifest row is data. Widening one must not change the descriptors, and regenerating
  // must reproduce the original — proving policy is never read back out of the artefact.
  before.capabilities[0].requiredQueryKeys = ['anything'];
  before.capabilities[0].method = 'DELETE';
  const roster = capabilityById('workflow_roster_list');
  assert.equal(roster.method, 'GET');
  assert.equal(roster.requiredQueryKeys.includes('anything'), false);
  assert.deepEqual(buildAuditManifest(), readCommittedManifest());
});
