// The single source of truth for what the audit rail is allowed to ask for.
// Everything downstream — the gateway matcher, the capability receipts, and the
// generated manifest — is COMPILED FROM this module. Nothing is ever read back
// the other way: a manifest is an artifact, and an artifact that could redefine
// policy would let a checked-in file widen the audit surface without a test.
//
// A new route or query key therefore requires a descriptor change here, a test
// change, and a manifest regeneration — in that order.
import { CODES, scrubSecrets } from './errors.mjs';

// Descriptors are policy, so they are frozen all the way down: a shallow freeze
// would still let `capability.requiredQueryKeys.push(...)` widen the audit surface
// at runtime, with no test and no manifest change to show for it.
const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

// The only two origins the audit profile may reach. Pinned as data rather than
// derived from a request so a descriptor cannot smuggle in a third host.
export const AUDIT_HOSTS = Object.freeze({
  backend: 'https://backend.leadconnectorhq.com',
  services: 'https://services.leadconnectorhq.com',
});

// Every descriptor carries the same shape so the matcher, the validator, and the
// manifest generator can all iterate it without special cases. Defaults are spelled
// out per descriptor below by spreading this base, which keeps a missing field a
// structural impossibility instead of an `undefined` that silently skips a check.
//
// MANIFEST NOTE (Task 5): `repeatableQueryKeys` and `sealedBy` are POLICY-BEARING and
// must appear in every generated manifest row. The plan's prose field list predates
// both: a row missing `sealedBy` cannot tell which discovery route is allowed to
// authorize a given detail route, and dropping either from the manifest would let the
// checked-in artifact describe a wider surface than the gateway enforces.
//
// `repeatableQueryKeys` is currently EMPTY on every descriptor, and it must still be
// carried. Empty is the policy statement: no audit key may be repeated today (see
// workflow_enroll_stats_cache for why the one former entry was withdrawn). Because the
// field appears in every manifest row, a future non-empty value cannot be introduced
// without a visible manifest diff — which is exactly the review gate that widening the
// audit surface should have to pass. Deleting the field because "it is all empty" would
// remove that gate, and the gateway's duplicate-key check would then be enforcing a rule
// no artifact records.
const descriptor = (over) => deepFreeze({
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
  // Which discovery capability's sealed result may authorize this detail route. A flat
  // product-agnostic seal would let a Voice id probe the Conversation-AI and
  // Agent-Studio detail routes, which is a cross-product probe with a valid-looking id.
  sealedBy: null,
  ...over,
});

// Query values travel the wire as strings, so fixed and allowed values are declared
// as strings and compared after String() coercion. Declaring `20` here and receiving
// `'20'` would otherwise fail a strict comparison for a request that is in fact legal.
export const AUDIT_CAPABILITIES = Object.freeze([
  descriptor({
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
  descriptor({
    capabilityId: 'workflow_detail',
    normalizedPath: '/workflow/{locationId}/{workflowId}',
    pathBindings: { locationId: 'locationId', workflowId: 'workflowId' },
    requiredQueryKeys: ['includeScheduledPauseInfo'],
    fixedQueryValues: { includeScheduledPauseInfo: 'true' },
    locationBinding: 'path',
  }),
  descriptor({
    capabilityId: 'workflow_triggers',
    normalizedPath: '/workflow/{locationId}/trigger',
    pathBindings: { locationId: 'locationId' },
    queryBindings: { workflowId: 'workflowId' },
    requiredQueryKeys: ['workflowId'],
    locationBinding: 'path',
  }),
  descriptor({
    capabilityId: 'workflow_sticky_notes',
    normalizedPath: '/workflows/sticky-notes-all',
    queryBindings: { workflowId: 'workflowId' },
    requiredQueryKeys: ['workflowId', 'locationId'],
    locationBinding: 'query',
  }),
  descriptor({
    capabilityId: 'workflow_execution_logs',
    normalizedPath: '/workflows/logs/v2',
    queryBindings: { workflowId: 'workflowId' },
    requiredQueryKeys: ['workflowId', 'locationId', 'limit', 'dateType', 'fromDate', 'toDate', 'action'],
    optionalQueryKeys: ['contactId', 'eventType', 'referenceId', 'referenceCreatedAt'],
    // ⚠️ `dateType` IS THE MODE SWITCH, AND IT IS REQUIRED. This is the single most
    // expensive thing ever learned about this endpoint, so it is pinned in policy rather
    // than left to a caller.
    //
    // `fromDate`/`toDate` were sent here for months and DID NOTHING, because without
    // `dateType=custom` the backend ignores them and applies a ~30-DAY DEFAULT WINDOW,
    // snapped to a day boundary rather than measured from the instant of the request.
    //
    // Measured across four workflows on 2026-07-27, a bare read returned 37 of 433 rows,
    // 428 of 1000+, 201 of 643 and 176 of 242. Nothing about any of those reads looks wrong:
    // HTTP 200, plausible rows, a page well short of the limit. They are simply a fraction
    // of the history, silently.
    //
    // The day-snapping matters and was nearly missed. On the first (sparse) workflow the
    // default was ID-SET-IDENTICAL to an explicit `now-30d` window — 37 either way — which
    // read as "the default is now-30d, to the millisecond". On a denser workflow the two
    // separate: 428 day-snapped versus 419 ms-precise. A coincidence on one account is not a
    // rule; ("30 days back from the newest ROW" was a third hypothesis, refuted at 299 rows.)
    //
    // `dateType` is PINNED to 'custom' rather than merely allow-listed, because the preset
    // values are a minefield: `today`/`yesterday`/`this_week`/`last_week`/`this_month`/
    // `last_month`/`last_60_days`/`last_90_days` are recognised, while `all`, `all_time`,
    // `alltime`, `last_7_days`, `last7days`, `last_15_days`, '' and ANY typo SILENTLY fall
    // through to the 30-day default. `dateType=all` does not mean all history — it means
    // thirty days. A rail that can express that value is a rail that can publish it as a
    // complete audit, so this one cannot express it.
    //
    // Both bounds are INCLUSIVE (`fromDate <= createdAt <= toDate`, proven to the exact
    // millisecond) and the server filters on `createdAt`. To read a true full history, pass
    // `fromDate=0`.
    fixedQueryValues: { dateType: 'custom' },
    // The cursor is REAL and needs `action`. `action=first` opens the walk; `action=next`
    // continues it, and `referenceCreatedAt` is LOAD-BEARING alongside `referenceId` —
    // supply the id alone and page 2 comes back byte-identical to page 1, with no error and
    // no progress. `referenceSequence` was measured inert in this shape and is deliberately
    // NOT declared: an undeclared key cannot be sent, and a key that does nothing has no
    // business in a receipt (see the fromDate lesson above).
    //
    // Every page RE-RETURNS the previous page's last row, so the walk dedupes by id and
    // terminates on a page contributing ZERO NEW IDS — never on `rows.length === 0`, which
    // does not occur.
    allowedQueryValues: {
      action: ['first', 'next'],
      // The closed `IWorkflowLogStatus` enum from the recovered `models/WorkflowLog.ts`.
      // Allow-listed because it is DOCUMENTED and closed; two values are live-verified
      // (`finished`, `skipped`) and every returned row is echo-checked against the request.
      eventType: [
        'added_to_workflow', 'enroll', 'step', 'success', 'waiting',
        'wait_finished', 'skipped', 'failed', 'retry', 'finished',
      ],
    },
    // NO `actionType`, AND THAT IS A DELIBERATE REFUSAL, NOT AN OVERSIGHT. The UI's "All
    // actions" dropdown really does send `actionType=<step type>` and it really does filter
    // (`actionType=email` → 135 rows all `type:email`). It is not declared because its
    // enum cannot be established from any source available here: the 383-entry builder
    // catalog is a DIFFERENT vocabulary (it has `wait`; the logs want `wait_time`), the
    // recovered `ActionLabels` map holds only 77 slugs and lacks live-observed values like
    // `added_to_workflow`, and the UI's 379 option VALUES are not extractable from a
    // production build. An unrecognised `actionType` returns `200 []` — the opposite
    // failure direction from `dateType`, and just as silent.
    //
    // The deeper reason it stays undeclared is that SERVER-SIDE `actionType` CANNOT BE MADE
    // SAFE HERE, even with an allow-list. Its only real benefit is fetching fewer pages —
    // but the sole way to tell "this step type never ran" from "you spelled the slug wrong"
    // is to compare against the unfiltered window, i.e. to fetch the very pages the filter
    // existed to avoid. A validated `actionType` costs strictly more than no `actionType`.
    //
    // Nothing is lost: every retained row is published VERBATIM under `runtimeEvents[].event`,
    // carrying its own `type`, so a consumer filters the returned array itself — over data
    // whose completeness this rail has already established. This collector does NOT filter
    // by type, and does not expose an input for it.
    numericQueryBounds: { limit: { min: 1, max: 5000 } },
    locationBinding: 'query',
  }),
  descriptor({
    capabilityId: 'workflow_count_per_step',
    normalizedPath: '/workflows/status/search/count-per-step',
    queryBindings: { workflowId: 'workflowId' },
    requiredQueryKeys: ['workflowId', 'locationId'],
    locationBinding: 'query',
  }),
  descriptor({
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
  descriptor({
    capabilityId: 'workflow_step_details',
    normalizedPath: '/workflows/status/search/details-by-step',
    queryBindings: { workflowId: 'workflowId', currentStepId: 'stepId' },
    requiredQueryKeys: ['workflowId', 'locationId', 'currentStepId', 'skip', 'limit', 'showTotalCount'],
    // Without showTotalCount the roster cannot be reconciled against a total, so a
    // truncated roster would read as a complete one.
    fixedQueryValues: { showTotalCount: 'true' },
    numericQueryBounds: { limit: { min: 1, max: 50 }, skip: { min: 0 } },
    locationBinding: 'query',
  }),
  descriptor({
    capabilityId: 'workflow_enroll_stats_cache',
    normalizedPath: '/workflows/status/search/enroll-stats-cache',
    queryBindings: { 'workflowIds[]': 'workflowId' },
    requiredQueryKeys: ['workflowIds[]', 'locationId'],
    // `workflowIds[]` is an ARRAY parameter upstream, and it was declared repeatable on
    // that basis. It is not repeatable HERE, and the two facts do not conflict: the plan
    // (line 313) binds this key to "contain exactly that workflow", so the bound-key
    // cardinality rule in audit-gateway.mjs requires exactly one value. Declaring it
    // repeatable was therefore dead policy — every batch attempt threw BINDING_MISMATCH,
    // so the field could never be exercised positively.
    //
    // Batching N workflows into one call is NOT authorized: it would ask the upstream for
    // a differently-shaped result than the one-workflow read the receipt claims, and it
    // widens the audit surface (a batch response carries rows for workflows this call was
    // never typed with, which the identity guard would then have to either quarantine or
    // ignore). Cardinality 1 is the spec.
    //
    // COST, recorded deliberately so a later reader does not "optimize" it: one call per
    // workflow is the spec-mandated price of this capability. An account with 400
    // workflows costs 400 calls here. That is the intended trade — a proven narrow read
    // per workflow beats an unproven wide one — and changing it requires a plan revision,
    // a descriptor change, new tests, and a manifest diff, in that order.
    //
    // The LITERAL bracket emission is independent of this field: encodeQueryKey in
    // audit-gateway.mjs is what keeps `workflowIds[]` off the wire as `workflowIds%5B%5D`,
    // and it still applies to a single-valued key.
    repeatableQueryKeys: [],
    locationBinding: 'query',
  }),
  descriptor({
    capabilityId: 'workflow_enroll_stats',
    normalizedPath: '/workflows/status/enroll-stats',
    queryBindings: { workflowId: 'workflowId' },
    requiredQueryKeys: ['workflowId', 'locationId'],
    locationBinding: 'query',
  }),
  descriptor({
    capabilityId: 'voice_ai_agent_discovery',
    host: 'services',
    authRail: 'ai',
    normalizedPath: '/voice-ai/agents/simple',
    requiredQueryKeys: ['locationId'],
    locationBinding: 'query',
  }),
  descriptor({
    capabilityId: 'voice_ai_agent_detail',
    host: 'services',
    authRail: 'ai',
    normalizedPath: '/voice-ai/agents/{agentId}',
    pathBindings: { agentId: 'agentId' },
    requiredQueryKeys: ['locationId'],
    locationBinding: 'query',
    sealedBy: 'voice_ai_agent_discovery',
  }),
  descriptor({
    capabilityId: 'conversation_ai_agent_discovery',
    host: 'services',
    authRail: 'ai',
    // CORRECTED 2026-07-27 FROM LIVE TRAFFIC. This was `/ai-employees/agents`, which GHL does
    // not serve: a read-only probe on GROM AU answered
    // `404 {"message":"Cannot GET /ai-employees/agents?locationId=…","error":"Not Found"}` —
    // an express-style "route not registered", not an empty surface and not a permissions
    // problem. The whole Conversation AI component therefore failed EVERY run with
    // AI_DISCOVERY_READ_FAILED, took the bundle to complete:false, and would have done so on
    // the canary for a reason that had nothing to do with what the canary was testing.
    //
    // The live route is the discovery sibling of the detail route below — same
    // `/ai-employees/employees/*` family — and it answers
    // `{employees: [...], totalCount: N, count: N, traceId}` with `id` on each row, matching
    // the id the detail body returns. `totalCount` is why AI_TOTAL_KEYS reads it; `count` is
    // deliberately not read (see core/audit-configuration.mjs — it carried the same value as
    // `totalCount` on a single-page response, so nothing observed separates a page count from
    // a surface total).
    //
    // NOTE FOR CONSUMERS: this moves `capabilityDescriptorHash` for this capability and
    // therefore `capabilityManifestHash`. That is a pinned handshake value; a client holding
    // the old one must re-pin. The alternative was leaving a capability that cannot read its
    // surface at all, which is not a contract worth preserving.
    normalizedPath: '/ai-employees/employees/search',
    requiredQueryKeys: ['locationId'],
    locationBinding: 'query',
  }),
  descriptor({
    capabilityId: 'conversation_ai_agent_detail',
    host: 'services',
    authRail: 'ai',
    normalizedPath: '/ai-employees/employees/{agentId}',
    pathBindings: { agentId: 'agentId' },
    requiredQueryKeys: ['locationId'],
    locationBinding: 'query',
    sealedBy: 'conversation_ai_agent_discovery',
  }),
  descriptor({
    capabilityId: 'agent_studio_agent_discovery',
    host: 'services',
    authRail: 'ai',
    normalizedPath: '/agent-studio/agents/agents-with-folders',
    // agencyId is the agency the location belongs to, not a free parameter: it is
    // bound to the typed companyId the composite was given.
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
  descriptor({
    capabilityId: 'agent_studio_agent_detail',
    host: 'services',
    authRail: 'ai',
    normalizedPath: '/agent-studio/super-agent/agents/{agentId}',
    pathBindings: { agentId: 'agentId' },
    requiredQueryKeys: ['locationId'],
    locationBinding: 'query',
    sealedBy: 'agent_studio_agent_discovery',
  }),
  // ONE endpoint called twice with different `type` values, not two endpoints. Modelling
  // this as two descriptors (`marketplace_module_triggers` / `marketplace_module_actions`,
  // both declaring `normalizedPath: '/marketplace/core/search/module'`) collided in
  // buildAuditManifest's path-collision guard — correctly, since a bare path can only ever
  // bind to one descriptor. `type` is the query VALUE that varies per call, which is exactly
  // what `allowedQueryValues` exists to express, the same way `workflow_roster_list` allows
  // `status` to be either `published` or `draft` from one descriptor.
  descriptor({
    capabilityId: 'marketplace_module_search',
    host: 'services',
    authRail: 'ai',
    normalizedPath: '/marketplace/core/search/module',
    requiredQueryKeys: ['locationId', 'type', 'isInstalled', 'skip', 'limit'],
    fixedQueryValues: { isInstalled: 'true' },
    allowedQueryValues: { type: ['triggers', 'actions'] },
    numericQueryBounds: { skip: { min: 0 }, limit: { min: 1, max: 200 } },
    locationBinding: 'query',
  }),
]);

const BY_ID = new Map(AUDIT_CAPABILITIES.map((capability) => [capability.capabilityId, capability]));

// `descriptors` is injectable for the same single reason `resolveCapability`'s is: some
// descriptor-shaped policy is unreachable against the real 16-descriptor set, and a rule
// with no positive test is a rule that can be deleted with everything still green.
// `repeatableQueryKeys` is now exactly that — empty everywhere, so only a synthetic
// descriptor can exercise the allow-a-repeat branch. Runtime callers always take the
// default, and the default keeps the O(1) map lookup.
export function capabilityById(capabilityId, descriptors = AUDIT_CAPABILITIES) {
  if (typeof capabilityId !== 'string' || capabilityId === '') return undefined;
  if (descriptors === AUDIT_CAPABILITIES) return BY_ID.get(capabilityId);
  return descriptors.find((capability) => capability.capabilityId === capabilityId);
}

// Errors carry a machine-branchable `.code` plus a human `detail`/`remediation`,
// matching the rest of the server. The message is scrubbed on the way in because
// a rejected value can be anything the caller passed — including something that
// looks like a credential, which must never reach the MCP transcript.
export function auditError(code, detail, remediation) {
  const safeDetail = scrubSecrets(String(detail));
  const error = new Error(`${code}: ${safeDetail}`);
  error.code = code;
  error.detail = safeDetail;
  error.remediation = scrubSecrets(String(remediation));
  return error;
}

// Resolve a descriptor's host token to its origin. Indexing AUDIT_HOSTS directly would
// yield `undefined` for an unknown token, and core/gateway.mjs treats a missing base as
// "use the backend default" — so a descriptor typo would quietly send an AI-rail read to
// the backend host instead of failing. Own-property only: `AUDIT_HOSTS.constructor` is
// not a host.
export function hostBaseFor(host) {
  if (typeof host !== 'string' || !Object.hasOwn(AUDIT_HOSTS, host)) {
    throw auditError(
      CODES.UNKNOWN_CAPABILITY_HOST,
      'the requested capability names a host outside the two approved audit origins',
      'Audit reads may only target the backend or services origin; correct the descriptor host.',
    );
  }
  return AUDIT_HOSTS[host];
}

const segmentsOf = (normalizedPath) => normalizedPath.split('/').filter(Boolean);
const isVariable = (segment) => segment.startsWith('{') && segment.endsWith('}');
const staticSegmentCount = (normalizedPath) => segmentsOf(normalizedPath).filter((s) => !isVariable(s)).length;

// Resolve a CONCRETE path back to the descriptor it came from. This is the only
// thing a capability receipt may be minted from: a receipt derived from the
// caller's claimed id would prove nothing about the request actually sent.
//
// Specificity, not declaration order, decides ties — `/voice-ai/agents/simple`
// must trace the discovery capability even though `{agentId}` also matches it.
//
// `descriptors` is injectable for one reason only: AMBIGUOUS_CAPABILITY is unreachable
// against the real 16-descriptor set, and a rule with no positive test is a rule that
// can be deleted. Runtime callers always take the default.
export function resolveCapability({ host, method, path }, descriptors = AUDIT_CAPABILITIES) {
  if (method !== 'GET') {
    throw auditError(
      CODES.UNAPPROVED_METHOD,
      'the audit rail is GET-only and cannot resolve a capability for another method',
      'Use a read capability, or add a separate non-audit tool for the write.',
    );
  }
  const raw = String(path ?? '');
  // Rejected BY RULE, not by accident: `segmentsOf` would happily shred
  // `https://evil.example/workflows/logs/v2` into segments that match a descriptor, and
  // the leading origin would then be silently dropped rather than refused.
  if (!raw.startsWith('/') || raw.startsWith('//') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)) {
    throw auditError(
      CODES.ABSOLUTE_PATH_REJECTED,
      'a capability path must be a rooted relative path, not an absolute or scheme-bearing URL',
      'Pass the path only; the host comes from the descriptor, never from the caller.',
    );
  }
  const wanted = segmentsOf(raw);
  const candidates = descriptors.filter((capability) => {
    if (capability.host !== host) return false;
    const declared = segmentsOf(capability.normalizedPath);
    if (declared.length !== wanted.length) return false;
    return declared.every((segment, index) => isVariable(segment) || segment === wanted[index]);
  });
  if (candidates.length === 0) {
    throw auditError(
      CODES.UNKNOWN_CAPABILITY,
      'no audit capability descriptor matches the requested host and path',
      'Add a descriptor plus its tests and regenerate the manifest before calling this route.',
    );
  }
  const best = Math.max(...candidates.map((capability) => staticSegmentCount(capability.normalizedPath)));
  const winners = candidates.filter((capability) => staticSegmentCount(capability.normalizedPath) === best);
  if (winners.length > 1) {
    throw auditError(
      CODES.AMBIGUOUS_CAPABILITY,
      `the requested path matches ${winners.length} descriptors with equal path specificity`,
      'Disambiguate the descriptors so exactly one can own a concrete path, then re-run.',
    );
  }
  return winners[0];
}
