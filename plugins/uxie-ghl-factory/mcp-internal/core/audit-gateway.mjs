// The audit rail's chokepoint. Every audit read goes through `callCapability`,
// which validates the whole request against its descriptor BEFORE any fetch, then
// spends one slot of the process-wide limiter behind the process-wide circuit.
//
// Two invariants drive the shape of this file:
//   1. A rejected call makes ZERO network calls. Validation is therefore pure and
//      complete before the limiter is ever touched — a partially-validated request
//      that reaches the wire is a policy breach even if the response is discarded.
//   2. Nothing fails open. A 403, a 429, a location-throttled 200, or an open
//      circuit must never surface as a successful or empty read, because the
//      auditor's completeness claims are built on exactly that distinction.
import { CODES, scrubSecrets } from './errors.mjs';
import { AUDIT_CAPABILITIES, auditError, capabilityById, hostBaseFor, resolveCapability } from './audit-capabilities.mjs';

const DEFAULT_MINIMUM_DELAY_MS = 300;   // established constant (core/gateway.mjs, scripts/edit.mjs)
const DEFAULT_JITTER_MS = 150;
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One limiter for the whole audit process, constructed by the caller and handed to
// every audit gateway. Per-gateway throttling would let N surfaces each pace
// themselves politely while the ACCOUNT sees N times the rate — which is what
// actually trips a location-level throttle.
//
// Work is serialized rather than merely spaced: the audit rail has no ordering
// requirement that a burst would satisfy, and serializing makes the observed
// spacing an actual guarantee instead of a best case.
export function makeAuditLimiter({
  minimumDelayMs = DEFAULT_MINIMUM_DELAY_MS,
  jitterMs = DEFAULT_JITTER_MS,
  sleepImpl = defaultSleep,
  randomImpl = Math.random,
  nowImpl = Date.now,
} = {}) {
  let chain = Promise.resolve();
  let nextAllowedAt = -Infinity;

  const schedule = (task) => {
    const run = chain.then(async () => {
      const waitMs = nextAllowedAt - nowImpl();
      if (waitMs > 0) await sleepImpl(waitMs);
      // Booked at grant time, not completion time, so a slow response cannot
      // stretch the spacing into a stall — and so a thrown task still pays.
      nextAllowedAt = nowImpl() + minimumDelayMs + Math.floor(randomImpl() * jitterMs);
      return task();
    });
    // The chain must survive a rejected task; otherwise one failed read wedges
    // every later read behind a permanently rejected promise.
    chain = run.then(() => undefined, () => undefined);
    return run;
  };

  return { schedule };
}

// One circuit for the whole audit process, SCOPED rather than global.
//
// It latches: there is no half-open probe and no timer that reopens it. A throttle or a
// dead credential means the run must stop and be resumed deliberately from a checkpoint,
// so the first reason per scope is the one worth reporting and a later symptom must not
// overwrite it.
//
// Scopes exist because the audit rail carries TWO independent credentials. A single
// global latch made every rail-level fact fatal to the other rail — a refusal on the AI
// rail would kill the untouched backend rail, and per-component completeness (Task 4)
// becomes unimplementable when one component's refusal ends the run. So:
//   'process'          — an account-level fact (throttling). Blocks every scope.
//   'backend' / 'ai'   — a credential-level fact. Blocks only that rail.
export const CIRCUIT_SCOPES = Object.freeze(['process', 'backend', 'ai']);

export function makeAuditCircuit() {
  const latched = new Map();   // scope -> { reason, meta }
  // The consecutive-unusable-body run, keyed by scope. It lives HERE, on the circuit,
  // rather than on each gateway, because the latch it feeds lives here: when the counter
  // was per-gateway, N gateways sharing one circuit each kept their own run, so the real
  // threshold was 3 x N and each gateway reset the others' evidence away. Two gateways on
  // one backend rail measured 5 unusable bodies before latching, and a run split evenly
  // across three gateways would never have latched at all. The counter and the thing it
  // decides must have the same lifetime.
  const unusableBodyRuns = new Map();   // scope -> consecutive count

  const requireScope = (scope) => {
    if (!CIRCUIT_SCOPES.includes(scope)) {
      throw auditError(
        CODES.INVALID_CIRCUIT_SCOPE,
        `the audit circuit has no scope by that name (expected one of ${CIRCUIT_SCOPES.join(', ')})`,
        "Open and query the circuit with 'process' or a credential rail name.",
      );
    }
    return scope;
  };

  // The blocking entry for a scope: a 'process' latch wins over a rail latch, because it
  // is the broader and earlier fact and is what a resumer must clear first.
  const blockerFor = (scope) => {
    if (latched.has('process')) return { scope: 'process', ...latched.get('process') };
    if (scope !== 'process' && latched.has(scope)) return { scope, ...latched.get(scope) };
    return null;
  };

  return {
    // Defaults to 'process' so an unscoped question means "is the whole run stopped".
    isOpen: (scope = 'process') => blockerFor(requireScope(scope)) !== null,
    state: (scope = 'process') => {
      const blocker = blockerFor(requireScope(scope));
      return blocker === null
        ? { open: false, scope: null, reason: null, meta: null }
        : { open: true, scope: blocker.scope, reason: blocker.reason, meta: blocker.meta };
    },
    // `state()` answers "what is BLOCKING this scope", which is what a caller about to
    // read needs — and a 'process' latch deliberately outranks a rail latch there. That
    // made every rail fact unreadable the moment the process latched: an AI credential
    // that died at 09:00 became invisible behind a 09:05 throttle, so a checkpoint written
    // after both could not record that the AI rail ALSO needs clearing, and a resumer
    // would clear the throttle and walk straight back into the dead credential.
    //
    // `latchOf` answers the other question — "what did THIS scope record" — independently
    // of any broader latch. Both are needed; neither can be expressed as the other.
    latchOf: (scope) => {
      requireScope(scope);
      const entry = latched.get(scope);
      return entry === undefined
        ? { open: false, scope, reason: null, meta: null }
        : { open: true, scope, reason: entry.reason, meta: entry.meta };
    },
    // Every latch that exists, in CIRCUIT_SCOPES order, so Task 3/5 checkpoint metadata can
    // record the whole set rather than only whichever one happens to outrank the others.
    latches: () => CIRCUIT_SCOPES
      .filter((scope) => latched.has(scope))
      .map((scope) => ({ scope, reason: latched.get(scope).reason, meta: latched.get(scope).meta })),
    open(scope, nextReason, nextMeta = null) {
      requireScope(scope);
      if (latched.has(scope)) return;   // first reason per scope wins
      latched.set(scope, { reason: String(nextReason), meta: nextMeta });
    },
    // Returns the new run length so the caller can compare it against its own threshold
    // without the circuit needing to know what that threshold is.
    noteUnusableBody(scope) {
      requireScope(scope);
      const next = (unusableBodyRuns.get(scope) ?? 0) + 1;
      unusableBodyRuns.set(scope, next);
      return next;
    },
    // Only a GENUINELY successful read clears the run — see the caller for why a parseable
    // error body must not.
    noteUsableRead(scope) {
      requireScope(scope);
      unusableBodyRuns.set(scope, 0);
    },
    unusableBodyRun: (scope) => {
      requireScope(scope);
      return unusableBodyRuns.get(scope) ?? 0;
    },
  };
}

// A path variable is exactly one DECODED segment. Decoding runs to a fixed point
// because a single decode still leaves `%252F` as `%2F`, which an upstream router
// may decode again into a separator this validator never saw.
//
// Exported for direct unit testing: the decode-budget exhaustion branch is otherwise
// shadowed by the stricter percent rejection in `validate`, and an untested fail-closed
// branch is one that can be flipped to fail-open without any test noticing.
const UNSAFE_IN_SEGMENT = /[/\\?#]/;
// A scheme prefix, not the literal `://`. `://` always contains a `/`, so the old check
// could never fire ahead of UNSAFE_IN_SEGMENT — it was dead code. A bare `javascript:x`
// or `mailto:x` carries no separator at all and is what actually needs catching.
const SCHEME_PREFIX = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const MAX_DECODE_PASSES = 5;
export const isSafePathSegment = (value) => {
  let current = value;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    if (current === '' || current === '.' || current === '..') return false;
    if (UNSAFE_IN_SEGMENT.test(current)) return false;
    if (SCHEME_PREFIX.test(current)) return false;
    if (!current.includes('%')) return true;
    let decoded;
    try { decoded = decodeURIComponent(current); } catch { return false; }   // malformed encoding is never safe
    if (decoded === current) return true;
    current = decoded;
  }
  return false;
};

// Numeric-bounded keys are compared as NUMBERS but travel as STRINGS, and the raw string
// is what reaches the wire and the receipt. `Number(' 50 ')`, `Number('0x10')`,
// `Number('1e2')`, `Number('+5')` and `Number('')` are all finite, so a bounds check alone
// passes values the upstream may parse differently — or not at all. Only an unsigned
// integral literal is accepted.
const UNSIGNED_INTEGER = /^\d+$/;

// GHL's backend expects the LITERAL bracketed key `workflowIds[]`; percent-encoded
// brackets are not accepted (same reason tools.mjs hand-builds this query string
// instead of letting URLSearchParams serialize it).
const encodeQueryKey = (key) => encodeURIComponent(key).replace(/%5B/g, '[').replace(/%5D/g, ']');

// Normalize every caller shape into one multimap so validation reads values through
// getAll() semantics. A repeated key must be VISIBLE to the validator: reading only
// the first value is how a smuggled second locationId would slip past.
const toParams = (query) => {
  const params = new URLSearchParams();
  if (query instanceof URLSearchParams) {
    for (const [key, value] of query.entries()) params.append(key, value);
    return params;
  }
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else {
      params.append(key, String(value));
    }
  }
  return params;
};

// A 200 can still be a refusal: GHL reports a location-level throttle INSIDE an
// otherwise-successful envelope, so trusting res.ok would turn a throttled read
// into a confident "this window is empty".
const isLocationRateLimited = (json) => {
  if (!json || typeof json !== 'object') return false;
  // No live payload has proven the array form; this is a cheap shallow defence so that
  // if the flag ever rides a record instead of an envelope it still fails closed.
  if (Array.isArray(json)) {
    return json.some((row) => row && typeof row === 'object' && row.isLocationRateLimited === true);
  }
  if (json.isLocationRateLimited === true) return true;
  const nested = json.data;
  return Boolean(nested && typeof nested === 'object' && nested.isLocationRateLimited === true);
};

// Response-side identity validation lives HERE, not in each composite, because the
// gateway is the one place that already holds both the typed bindings and the bound
// location. Two composites reimplementing it is where completeness quietly diverges.
//
// Field -> which typed binding it must equal. `stepId` and `currentStepId` both name the
// step the roster call was typed with.
const IDENTITY_FIELDS = Object.freeze({
  locationId: 'locationId',
  workflowId: 'workflowId',
  stepId: 'stepId',
  currentStepId: 'stepId',
  companyId: 'companyId',
  agentId: 'agentId',
});

// WHICH fields a given capability may be judged on. Checking every typed binding that
// happens to be in the bag produced FALSE quarantines that silently destroyed real
// evidence: `/workflows/logs/v2` legitimately returns rows naming the STEP that emitted
// them and the BOT that authored them, so a leftover `stepId`/`agentId` in typedBindings
// turned a perfectly good log page into IDENTITY_CONFLICT. A response may only be
// contradicted about an entity the request actually ADDRESSED, and the descriptor is the
// record of what was addressed.
const checkableFieldsCache = new WeakMap();
const checkableFieldsFor = (capability) => {
  const cached = checkableFieldsCache.get(capability);
  if (cached) return cached;
  const targets = new Set([
    ...Object.values(capability.pathBindings),
    ...Object.values(capability.queryBindings),
  ]);
  // Every audit capability is location-scoped (locationBinding is path, query, or
  // request_scope), and the gateway is bound to exactly one location, so the location is
  // always addressed even when it travels outside pathBindings/queryBindings.
  if (capability.locationBinding) targets.add('locationId');
  const fields = Object.freeze(Object.entries(IDENTITY_FIELDS)
    .filter(([, target]) => targets.has(target))
    .map(([field, target]) => [field, target]));
  checkableFieldsCache.set(capability, fields);
  return fields;
};

// How deep the walker looks for record objects, counted in OBJECT levels (arrays are
// transparent, so an array-of-arrays costs nothing).
//
// RAISED 3 -> 32 on 2026-07-27, after the first live canary run failed on it. The old value
// reasoned about ENVELOPE shapes — "a bare row, `{data:[row]}`, and the nested
// `{data:{data:[row]}}`, with one level spare" — which is correct about envelopes and wrong
// about payloads, because `visit()` descends into row CONTENT too. A GHL workflow body nests
// `workflowData → templates → [i] → attributes → …` far past three levels, so `depthCapped`
// fired on essentially every real workflow read, raised IDENTITY_INSPECTION_INCOMPLETE, and
// made `componentClean('workflow_definition')` false. The consequence was not cosmetic: the
// runtime window could NEVER report `complete` against a real account.
//
// MEASURED, not guessed (GROM AU, 20 workflow bodies, read-only):
//   - deepest object nesting observed: 15, in a 43-step workflow with nested containers
//   - identity fields actually occur at depth 0 (40 of them) and depth 11 (4) — so the old
//     bound was not merely noisy, it never looked at the depth-11 identities at all
//   - FOREIGN locationId values found by walking to full depth: ZERO
//
// That last line is the one that mattered. The old comment justified the bound by warning
// that "walking arbitrarily deep starts matching ids belonging to unrelated nested objects
// and manufactures conflicts that are not conflicts" — and a manufactured conflict
// QUARANTINES a run, which is worse than incompleteness, so the concern deserved testing
// rather than dismissing. It is not borne out on real payloads: every identity found at
// depth belonged to the bound location.
//
// 32 is ~2x the deepest body observed, which leaves room for workflows more nested than any
// on this account while still bounding the recursion. The bound is KEPT rather than removed
// because `visit()` is recursive and a pathological payload should meet a limit, and because
// MAX_IDENTITY_RECORDS below is a records cap, not a depth cap — it cannot stop a single
// deeply-nested chain. Hitting this still fails closed, which is now meaningful: at 32 it
// means the payload really is pathological, where at 3 it only meant the workflow was real.
const MAX_IDENTITY_DEPTH = 32;
// How many RECORDS may be inspected per response, where a record is an object that either
// carries at least one checkable identity field or is a member of an array. That unit is
// the whole point: the counter used to increment for EVERY visited object, including every
// identity-free nested sub-object, so the real headroom was 4 nested objects per row and
// the guard switched itself off inside a legal page. A 100-row response (the descriptors'
// own maximum) with 5 nested objects per row hit the cap at row 83 and the remaining rows
// were never checked at all.
//
// Counted in records, 500 is 5x the largest legal page (limit is capped at 100 by the
// descriptors), so no honest response is ever truncated — while a pathological payload
// still cannot turn identity validation into the run's cost centre. Two descriptors
// (`voice_ai_agent_discovery`, `conversation_ai_agent_discovery`) declare no page-size key
// at all, so on those routes this cap is the ONLY bound and reaching it is plausible,
// which is precisely why hitting it fails closed rather than passing quietly.
const MAX_IDENTITY_RECORDS = 500;

// The real Mongo/BSON wrappers an id can arrive inside. An identity field carrying one of
// these is READABLE — `{locationId:{$oid:'OTHER'}}` is a wrong location, not an absent one
// — and skipping it as "non-primitive" silently downgraded the record to request_scope and
// let the response pass. Nothing else is guessed at: an unrecognized object shape is
// UNREADABLE and fails closed, because an identity we cannot read cannot prove binding.
const ID_WRAPPER_KEYS = ['$oid', '_id', 'id'];
const WRAPPED = Symbol('unreadable');
const readIdentityValue = (raw) => {
  if (raw === null || raw === undefined) return null;              // absence, not unreadability
  if (typeof raw !== 'object') return { value: raw };
  if (Array.isArray(raw)) return WRAPPED;                          // an id is never a list
  for (const key of ID_WRAPPER_KEYS) {
    if (!Object.hasOwn(raw, key)) continue;
    const inner = raw[key];
    // One level only. `{$oid:{$oid:'x'}}` is not a shape this API emits, and unwrapping
    // recursively would start inventing readings for arbitrary nesting.
    if (inner !== null && inner !== undefined && typeof inner !== 'object') return { value: inner };
    return WRAPPED;
  }
  return WRAPPED;
};

const inspectIdentity = (json, expected, fields) => {
  const checked = new Set();
  const conflicts = [];
  const unreadable = [];
  let nativeRecords = 0;
  let scopedRecords = 0;
  let inspected = 0;
  let inspectionCapped = false;
  let depthCapped = false;

  // Cheap pre-test used to decide whether an object SPENDS budget, so the budget check can
  // run before any comparison work.
  const carriesIdentity = (record) => fields.some(([field]) => Object.hasOwn(record, field));

  // Returns whether the record carried ANY checkable identity (so the walker can run the
  // native/request_scope census) plus the child objects the identity reader already
  // CONSUMED. A consumed child is an id wrapper, not a record: descending into
  // `{locationId:{$oid:LOC}}`'s wrapper would census it as an identity-free leaf and drag
  // a fully-native row down to 'mixed'.
  const scan = (record, insideRecord = false) => {
    let sawIdentity = false;
    let consumed = null;
    for (const [field, target] of fields) {
      if (!Object.hasOwn(record, field)) continue;
      /*
       * 🔴 BELOW A ROW, ONLY THE TENANT BINDING IS JUDGED.
       *
       * `locationId` is tenant identity: a foreign one at ANY depth is a real leak and the
       * depth-32 walk exists to catch it (measured: zero foreign locationIds on real payloads).
       * `workflowId`, `stepId`, `currentStepId` and `agentId` are entity references WITHIN a
       * tenant, and a row may legitimately name a different one in its own payload.
       *
       * MEASURED 2026-07-29 on a live client account, on a workflow whose job is to react to a reply
       * to ANOTHER workflow and remove the contact from it. Its execution
       * log rows carry the correct `workflowId` at row level and ALSO carry
       * `meta.extraMeta.message.workflowId` naming the workflow the customer replied TO, because
       * that is what the trigger is about. 49 such references in 100 rows quarantined the whole
       * read, so the one workflow whose job is cross-referencing another reported ZERO runtime and
       * looked like a workflow nobody used.
       *
       * This is the same defect the per-capability field filter above was written for, one level
       * down: that fix stopped judging a capability on entities the REQUEST never addressed, and
       * this one stops judging a row on entities its own PAYLOAD merely mentions. Restricting the
       * depth instead would have blinded the tenant check, which is the one that must not blink.
       */
      if (insideRecord && target !== 'locationId') continue;
      const raw = record[field];
      const want = expected[target];
      if (want === null || want === undefined) continue;   // nothing typed to check against
      const read = readIdentityValue(raw);
      if (read === null) continue;                          // null/undefined is absence
      if (raw !== null && typeof raw === 'object') {
        consumed ??= new Set();
        consumed.add(raw);
      }
      if (read === WRAPPED) {
        // Recorded and failed closed, NOT counted as identity: an unreadable field proves
        // neither binding nor conflict, and treating it as either would be a guess.
        unreadable.push({ field, expected: String(want) });
        continue;
      }
      sawIdentity = true;
      if (String(read.value) === String(want)) checked.add(field);
      else conflicts.push({ field, expected: String(want), actual: String(read.value) });
    }
    return { sawIdentity, consumed };
  };

  // Generic walk, not a hand-maintained envelope allowlist. The allowlist
  // (`data`/`rows`/`statuses`/`logs`) omitted `counts`, `agents`, and `triggers` — all
  // three read by this codebase from these exact routes — so the location guard was a
  // no-op on those responses and a roster of ANOTHER location's agents could be sealed as
  // this location's discovery result.
  //
  // Returns how many records the subtree contributed, which is what distinguishes a
  // CONTAINER (an identity-free wrapper whose children are the records) from a LEAF
  // record with no identity. Only the latter is request-scope evidence; counting the
  // wrapper too would drag a fully-native row set down to "mixed".
  const visit = (value, depth, isArrayMember, insideRecord = false) => {
    if (Array.isArray(value)) {
      let fromArray = 0;
      // Arrays are transparent for DEPTH but their members are records by position: a row
      // in a page is a record whether or not it happens to carry an id.
      for (const item of value) fromArray += visit(item, depth, true, insideRecord);
      return fromArray;
    }
    if (!value || typeof value !== 'object') return 0;
    // Envelopes and id wrappers are structure, not records, so they do not spend budget.
    const spendsBudget = isArrayMember || carriesIdentity(value);
    if (spendsBudget) {
      if (inspected >= MAX_IDENTITY_RECORDS) { inspectionCapped = true; return 0; }
      inspected += 1;
    }
    const { sawIdentity, consumed } = scan(value, insideRecord);
    let fromChildren = 0;
    // Own enumerable properties only: a prototype-borne `data` is not payload.
    const children = Object.values(value).filter((child) => (
      child && typeof child === 'object' && !(consumed?.has(child))
    ));
    /*
     * Everything under a row that carried its own identity is that row's PAYLOAD, so the subtree
     * is judged on the tenant binding alone. See the note in `scan`. An envelope that carried no
     * identity is still structure, so its children stay fully checkable and a foreign row inside a
     * bare `{data:[...]}` wrapper is caught exactly as before.
     */
    const childrenAreInsideRecord = insideRecord || sawIdentity;
    if (depth < MAX_IDENTITY_DEPTH) {
      for (const child of children) fromChildren += visit(child, depth + 1, false, childrenAreInsideRecord);
    } else if (children.length > 0) {
      // The bound stopped the walk with payload still underneath it. That is an
      // INCOMPLETE check, and it used to be completely silent: `{a:{b:{c:{d:{locationId:
      // 'OTHER'}}}}}` returned ok:true with inspectionCapped:false, indistinguishable from
      // a genuinely clean response. Recorded on its own flag because the operator response
      // differs from the record cap's — a too-deep envelope means the descriptor's shape
      // assumption is wrong, not that the page was too big.
      depthCapped = true;
    }
    if (sawIdentity) { nativeRecords += 1; return 1 + fromChildren; }
    if (fromChildren === 0) { scopedRecords += 1; return 1; }
    return fromChildren;
  };
  visit(json, 0, false);

  // Absence records request-scope binding. It never downgrades a native conflict:
  // `quarantined` is decided by the conflict list alone.
  const bindingMethod = nativeRecords === 0 ? 'request_scope'
    : scopedRecords === 0 ? 'native'
      : 'mixed';
  return {
    identity: {
      bindingMethod,
      checked: [...checked].sort(),
      conflicts,
      unreadable,
      inspectionCapped,
      depthCapped,
    },
    quarantined: conflicts.length > 0,
  };
};

// Every way a COMPLETED inspection can still end up unable to prove binding. A conflict is
// deliberately not here: a conflict is a proven contradiction and outranks all of these.
// (A throwing body is the fourth way and cannot be expressed as a flag — it never produces
// an identity object at all, so callCapability raises it as a coded error instead.)
const identityIncomplete = (identity) => identity.unreadable.length > 0
  || identity.inspectionCapped
  || identity.depthCapped;

// One gateway structurally cannot serve both audit hosts: the 10 backend capabilities
// need the location JWT rail and the 6 services capabilities need the AI rail (Bearer
// PLUS the agency token-id, and core/gateway.mjs refuses to attach that to any other
// origin). `authRail` was therefore declared on every descriptor and enforced nowhere.
//
// The rail map is asserted at CONSTRUCTION so a swapped wiring cannot survive to the
// first live read, where it would present as an opaque 401 or an untyped throw.
const EXPECTED_RAIL = Object.freeze({ backend: 'jwt', ai: 'ai' });

export function makeAuditGateway({ gateways, locationId, limiter, circuit, descriptors = AUDIT_CAPABILITIES }) {
  // A missing location degrades to the literal string 'undefined', which then MATCHES a
  // typedBindings.locationId of undefined — the binding guard would pass while the read
  // addressed nothing. There is no safe default for the one value everything is scoped to.
  if (typeof locationId !== 'string' || locationId.trim() === '') {
    throw auditError(
      CODES.INVALID_AUDIT_LOCATION,
      'an audit gateway must be constructed with a non-empty string locationId',
      'Pass the typed location the run is scoped to; the audit rail has no default location.',
    );
  }
  const boundLocationId = locationId;

  const rails = { ...(gateways ?? {}) };
  for (const [slot, expected] of Object.entries(EXPECTED_RAIL)) {
    const candidate = rails[slot];
    if (candidate === undefined || candidate === null) continue;   // an absent rail fails closed at call time
    if (candidate.rail !== expected) {
      throw auditError(
        CODES.AUDIT_RAIL_MISMATCH,
        `the ${slot} audit slot was given a gateway on the ${String(candidate.rail)} credential rail`,
        `Construct the ${slot} slot with a rail:'${expected}' gateway; the slots are not interchangeable.`,
      );
    }
  }

  const gatewayFor = (capability) => {
    const chosen = rails[capability.authRail];
    if (!chosen) {
      throw auditError(
        CODES.MISSING_AUTH_RAIL,
        `capability ${capability.capabilityId} needs the ${capability.authRail} credential rail, which was not supplied`,
        'Construct the audit gateway with both rails, or do not call capabilities on a rail you cannot authenticate.',
      );
    }
    return chosen;
  };

  // Rejection messages name the KEY or VARIABLE at fault and never its value: the
  // rejected value is attacker- or caller-controlled and may itself look like a
  // credential. auditError scrubs on top of that as a second line of defence.
  const validate = ({ capabilityId, method, typedBindings, query }) => {
    const capability = capabilityById(capabilityId, descriptors);
    if (!capability) {
      throw auditError(
        CODES.UNKNOWN_CAPABILITY,
        'the requested capability id is not in the audit descriptor set',
        'Call one of the registered audit capabilities, or add a descriptor plus tests first.',
      );
    }
    if (method !== 'GET') {
      throw auditError(
        CODES.UNAPPROVED_METHOD,
        `capability ${capability.capabilityId} may only be called with GET on the audit rail`,
        'The audit profile is structurally read-only; use the full server for any write.',
      );
    }

    // The typed location the composite is working with must be the location this
    // gateway was bound to, whatever the descriptor does with it downstream.
    if (typedBindings.locationId !== undefined && String(typedBindings.locationId) !== boundLocationId) {
      throw auditError(
        CODES.LOCATION_BINDING_MISMATCH,
        `capability ${capability.capabilityId} was given a typed location other than the bound one`,
        'Audit reads are scoped to one location per gateway; construct a second gateway for a second location.',
      );
    }

    // --- path bindings -----------------------------------------------------
    const appliedPath = capability.normalizedPath.split('/').map((segment) => {
      if (!(segment.startsWith('{') && segment.endsWith('}'))) return segment;
      const variable = segment.slice(1, -1);
      const target = capability.pathBindings[variable];
      const raw = typedBindings[target];
      if (raw === undefined || raw === null) {
        throw auditError(
          CODES.MISSING_PATH_BINDING,
          `capability ${capability.capabilityId} needs a typed ${target} for path variable ${variable}`,
          'Pass the typed id through typedBindings before calling this capability.',
        );
      }
      const value = String(raw);
      if (!isSafePathSegment(value)) {
        throw auditError(
          CODES.INVALID_PATH_BINDING,
          `path variable ${variable} of capability ${capability.capabilityId} is not a single safe decoded segment`,
          'Path variables accept one decoded segment: no separators, traversal, scheme, or empty value.',
        );
      }
      // GHL ids are ObjectId-shaped, so a percent in a path binding is never data — it is
      // an encoding attempt. Rejecting it outright subsumes the whole encoded-separator
      // class AND fixes the double-encoding bug where `wf%201` went to the wire as
      // `wf%25201`, addressing a different resource than the one that was validated.
      if (value.includes('%')) {
        throw auditError(
          CODES.INVALID_PATH_BINDING,
          `path variable ${variable} of capability ${capability.capabilityId} contains a percent-encoding sequence`,
          'Pass the decoded id; audit path variables are plain ids and never percent-encoded.',
        );
      }
      // Defence in depth behind the typed-location guard above, which already refuses a
      // typedBindings.locationId other than the bound one — and this value is READ from
      // that same typed binding. Deleting either line alone is therefore invisible to a
      // single-mutation test; deleting BOTH is what the location tests catch. Kept
      // because the typed guard is a general pre-check and this one is the last thing
      // between a wrong id and the URL.
      if (target === 'locationId' && value !== boundLocationId) {
        throw auditError(
          CODES.LOCATION_BINDING_MISMATCH,
          `capability ${capability.capabilityId} would address a location other than the bound one`,
          'Audit reads are scoped to one location per gateway; construct a second gateway for a second location.',
        );
      }
      if (target === 'agentId') {
        // A detail route may only be called for an id ITS OWN discovery route returned.
        // The seal is keyed per discovery capability, not flat: the three AI products
        // share an id shape, so one flat list would let a Voice id probe the
        // Conversation-AI and Agent-Studio detail routes with a plausible id.
        const sealed = typedBindings.discoveredAgentIds;
        const sealKey = capability.sealedBy;
        if (!sealed || typeof sealed !== 'object' || Array.isArray(sealed)) {
          throw auditError(
            CODES.BINDING_MISMATCH,
            `capability ${capability.capabilityId} needs the sealed discovery result keyed by discovery capability id`,
            'Pass discoveredAgentIds as { <discovery capabilityId>: [...ids] }, then retry the detail read.',
          );
        }
        // OWN property only. A plain `sealed[sealKey]` walks the prototype chain, so
        // `{ __proto__: { voice_ai_agent_discovery: ['a1'] } }` — an object with no own
        // keys at all — forged a seal and authorized a detail read for an id no discovery
        // route ever returned.
        const permitted = Object.hasOwn(sealed, sealKey) ? sealed[sealKey] : undefined;
        if (!Array.isArray(permitted)) {
          throw auditError(
            CODES.BINDING_MISMATCH,
            `capability ${capability.capabilityId} has no sealed result under its own discovery capability ${sealKey}`,
            `Run ${sealKey} first and seal its ids under that key; another product's discovery result cannot authorize this route.`,
          );
        }
        if (!permitted.map(String).includes(value)) {
          throw auditError(
            CODES.BINDING_MISMATCH,
            `capability ${capability.capabilityId} was asked for an agent outside its sealed discovery result`,
            'Only read details for ids returned by the paired discovery capability.',
          );
        }
      }
      return encodeURIComponent(value);
    }).join('/');

    // --- query keys --------------------------------------------------------
    const params = toParams(query);
    const declared = new Set([...capability.requiredQueryKeys, ...capability.optionalQueryKeys]);
    const repeatable = new Set(capability.repeatableQueryKeys);
    const presentKeys = [...new Set(params.keys())];

    for (const key of presentKeys) {
      if (!declared.has(key)) {
        throw auditError(
          CODES.UNKNOWN_QUERY_KEY,
          `capability ${capability.capabilityId} does not declare one of the supplied query keys`,
          'Only descriptor-declared keys may be sent; add the key to the descriptor plus tests first.',
        );
      }
    }
    for (const key of capability.requiredQueryKeys) {
      if (!params.has(key)) {
        throw auditError(
          CODES.MISSING_QUERY_KEY,
          `capability ${capability.capabilityId} requires query key ${key}`,
          'Supply every required query key; a partial query cannot support a completeness claim.',
        );
      }
    }
    for (const key of presentKeys) {
      if (params.getAll(key).length > 1 && !repeatable.has(key)) {
        throw auditError(
          CODES.DUPLICATE_QUERY_KEY,
          `query key ${key} is repeated but capability ${capability.capabilityId} does not allow repeats`,
          'Send one value per key; only descriptor-declared repeatable keys may appear more than once.',
        );
      }
    }

    // --- query values ------------------------------------------------------
    for (const [key, expected] of Object.entries(capability.fixedQueryValues)) {
      for (const value of params.getAll(key)) {
        if (value !== String(expected)) {
          throw auditError(
            CODES.FIXED_QUERY_VALUE_MISMATCH,
            `query key ${key} is pinned by capability ${capability.capabilityId} and cannot be changed`,
            'Changing a pinned value invalidates the proven contract; revise the descriptor and re-prove it instead.',
          );
        }
      }
    }
    for (const [key, allowed] of Object.entries(capability.allowedQueryValues)) {
      const permitted = allowed.map(String);
      for (const value of params.getAll(key)) {
        if (!permitted.includes(value)) {
          throw auditError(
            CODES.DISALLOWED_QUERY_VALUE,
            `query key ${key} carries a value outside the set capability ${capability.capabilityId} allows`,
            'Use one of the descriptor-declared values for this key.',
          );
        }
      }
    }
    for (const [key, bounds] of Object.entries(capability.numericQueryBounds)) {
      for (const value of params.getAll(key)) {
        const numeric = Number(value);
        const outOfRange = !UNSIGNED_INTEGER.test(value)
          || !Number.isFinite(numeric)
          || (bounds.min !== undefined && numeric < bounds.min)
          || (bounds.max !== undefined && numeric > bounds.max);
        if (outOfRange) {
          throw auditError(
            CODES.QUERY_BOUND_VIOLATION,
            `query key ${key} is outside the numeric bounds capability ${capability.capabilityId} declares`,
            'Keep paging parameters inside the declared bounds; a wider page has not been proven.',
          );
        }
      }
    }

    // A required key must carry a VALUE, not merely exist. `params.has('fromDate')` is
    // true for `fromDate=`, so an unbounded window went to the wire as
    // `&fromDate=&toDate=` while the receipt claimed a bounded one — the completeness
    // claim and the request would have disagreed.
    //
    // Deliberately runs AFTER the value checks: a required key that is also numerically
    // bounded or pinned earns the more specific QUERY_BOUND_VIOLATION /
    // FIXED_QUERY_VALUE_MISMATCH, which names the actual defect. Whitespace-only counts as
    // empty — a space is not a date, an id, or a cursor.
    for (const key of capability.requiredQueryKeys) {
      if (params.getAll(key).some((value) => value.trim() === '')) {
        throw auditError(
          CODES.MISSING_QUERY_KEY,
          `capability ${capability.capabilityId} requires a non-empty value for query key ${key}`,
          'Supply a real value for every required key; an empty value is not a narrower request, it is an unbounded one.',
        );
      }
    }

    // --- typed bindings ----------------------------------------------------
    for (const [key, target] of Object.entries(capability.queryBindings)) {
      const values = params.getAll(key);
      if (values.length === 0) continue;   // absence is a required/optional-key question, handled above
      const typed = typedBindings[target];
      if (typed === undefined || typed === null) {
        throw auditError(
          CODES.BINDING_MISMATCH,
          `query key ${key} must be bound to a typed ${target}, which was not supplied`,
          'Pass the typed id through typedBindings so the emitted query can be checked against it.',
        );
      }
      // "Contain exactly that workflow" is a CARDINALITY rule, not just an equality one.
      // Checking equality alone lets `workflowIds[]=wf-1&workflowIds[]=wf-1` through, and
      // an N-repeat asks the upstream for a differently-shaped result than the one-workflow
      // read the receipt would claim.
      if (values.length !== 1) {
        throw auditError(
          CODES.BINDING_MISMATCH,
          `query key ${key} must carry exactly one value bound to the typed ${target} for capability ${capability.capabilityId}`,
          'Bound keys address exactly one entity; send a single value equal to the typed id.',
        );
      }
      for (const value of values) {
        if (value !== String(typed)) {
          throw auditError(
            CODES.BINDING_MISMATCH,
            `query key ${key} does not match the typed ${target} for capability ${capability.capabilityId}`,
            'A capability may only ask about the entity it was typed with; correct the query or the typed binding.',
          );
        }
      }
    }

    // An OPTIONAL seal for step rosters. The plan does not require one — step ids come
    // from the workflow definition, not a separate discovery call — but when a composite
    // DOES hold an enumerated step set, honouring it costs nothing and stops a typo'd
    // step id from being read as a legitimately empty roster.
    if (Object.values(capability.queryBindings).includes('stepId')
      && typedBindings.stepId !== undefined && typedBindings.stepId !== null
      && typedBindings.discoveredStepIds !== undefined) {
      const sealedSteps = typedBindings.discoveredStepIds;
      if (!Array.isArray(sealedSteps) || !sealedSteps.map(String).includes(String(typedBindings.stepId))) {
        throw auditError(
          CODES.BINDING_MISMATCH,
          `capability ${capability.capabilityId} was typed with a step outside the sealed step set it was given`,
          'Either omit discoveredStepIds or pass an array that contains the step being read.',
        );
      }
    }

    if (capability.locationBinding === 'query') {
      for (const value of params.getAll('locationId')) {
        if (value !== boundLocationId) {
          throw auditError(
            CODES.LOCATION_BINDING_MISMATCH,
            `capability ${capability.capabilityId} would query a location other than the bound one`,
            'Audit reads are scoped to one location per gateway; construct a second gateway for a second location.',
          );
        }
      }
    }

    // Receipts are minted from the RESOLVED trace id, never the claimed one, so the
    // concrete path is resolved back through the matcher and must agree. A binding
    // that turns `/workflow/{loc}/{workflowId}` into `/workflow/{loc}/list` is a
    // different capability and must not be recorded as proof of this one.
    const traced = resolveCapability({ host: capability.host, method: 'GET', path: appliedPath }, descriptors);
    if (traced.capabilityId !== capability.capabilityId) {
      throw auditError(
        CODES.CAPABILITY_TRACE_MISMATCH,
        `the concrete path for capability ${capability.capabilityId} resolves to ${traced.capabilityId}`,
        'A typed id collided with a static route segment; correct the binding before retrying.',
      );
    }

    const appliedQuery = {};
    for (const key of presentKeys) {
      const values = params.getAll(key);
      appliedQuery[key] = repeatable.has(key) ? values : values[0];
    }
    const search = [...params.entries()]
      .map(([key, value]) => `${encodeQueryKey(key)}=${encodeURIComponent(value)}`)
      .join('&');

    return {
      // The RESOLVED trace, not the claimed id. A receipt minted from the caller's claim
      // would prove nothing about the request that was actually sent. The mismatch throw
      // immediately above means the two are provably the same descriptor here, so this
      // line cannot be killed by a single mutation on its own — it is the trace CHECK
      // that carries the behaviour, and that check is what the collision tests kill.
      // Sourcing the receipt from `traced` keeps that true even if the check ever moves.
      capability: traced,
      // Scrubbed on the SUCCESS path too, not only on rejection: an optional free-text
      // key such as `search` is caller-controlled, and these fields are echoed straight
      // into the receipt and the MCP transcript.
      appliedPath: scrubSecrets(appliedPath),
      appliedQuery: scrubSecrets(appliedQuery),
      target: search ? `${appliedPath}?${search}` : appliedPath,
      gateway: gatewayFor(traced),
      base: hostBaseFor(traced.host),
    };
  };

  // A rail latches after this many CONSECUTIVE unusable bodies. Threshold and reset are a
  // HEURISTIC, not a proof: one Cloudflare interstitial or truncated body can be a blip,
  // but a host that returns three in a row on the same rail is not going to return a
  // record set on the fourth — and without a latch that pattern silently burns the whole
  // page budget on challenge pages while every read is recorded as its own isolated
  // failure. Three is the smallest run that is cheap to spend and hard to hit by accident.
  // Counted per rail because the two rails are different hosts with different front doors,
  // and the count itself lives on the CIRCUIT (see makeAuditCircuit) rather than here: a
  // per-gateway counter feeding a shared latch made the effective threshold 3 x (number of
  // gateways), and let each gateway reset the others' evidence.
  const INVALID_BODY_LATCH_THRESHOLD = 3;

  // CIRCUIT_OPEN is a checkpoint/resume instruction, so it carries the machine-readable
  // state a resumer needs rather than only a human sentence — including WHICH scope
  // blocked it, since clearing a rail latch and clearing a process latch are different
  // operator actions.
  const circuitOpenError = (scope) => {
    const state = circuit.state(scope);
    const error = auditError(
      CODES.CIRCUIT_OPEN,
      `the shared audit circuit is open on the ${state.scope ?? scope} scope (${state.reason ?? 'unknown reason'})`,
      'Stop the run and resume from the last checkpoint after the throttle clears; the audit rail never auto-retries.',
    );
    error.meta = state;
    error.retryAfterMs = state.meta?.retryAfterMs ?? null;
    return error;
  };

  const callCapability = async ({ capabilityId, method = 'GET', typedBindings = {}, query = {} }) => {
    const { capability, appliedPath, appliedQuery, target, gateway, base } = validate({ capabilityId, method, typedBindings, query });
    const scope = capability.authRail;

    // Checked twice on purpose: once before queueing so an already-open circuit
    // costs nothing, and once after the limiter grant because a concurrent read
    // may have opened it while this one waited.
    if (circuit.isOpen(scope)) throw circuitOpenError(scope);
    let meta;
    try {
      meta = await limiter.schedule(() => {
        if (circuit.isOpen(scope)) throw circuitOpenError(scope);
        return gateway.callWithMeta('GET', target, undefined, { base });
      });
    } catch (error) {
      if (error?.code === CODES.CIRCUIT_OPEN) throw error;
      // A thrown transport (DNS, socket, abort, credential refusal at header time) is
      // still a failed read, and a failed read the auditor cannot classify is worse than
      // one it can. Latch the RAIL: a rail is 1:1 with a host, so an unreachable host is a
      // rail-level fact — and says nothing about the other rail's host.
      circuit.open(scope, CODES.TRANSPORT_FAILED, {
        capabilityId: capability.capabilityId,
        status: null,
        retryAfterMs: null,
      });
      const failure = auditError(
        CODES.TRANSPORT_FAILED,
        `capability ${capability.capabilityId} could not complete its transport`,
        'Treat the read as failed, not empty. Resume from the last checkpoint once the transport is healthy.',
      );
      // Non-enumerable so the original (which may carry headers or a URL) is available
      // for debugging but never serialized into a tool result or the MCP transcript.
      Object.defineProperty(failure, 'cause', { value: error, enumerable: false, configurable: true, writable: true });
      throw failure;
    }

    const authRejected = meta.status === 401 || meta.status === 403;
    const locationThrottled = isLocationRateLimited(meta.json);
    // A 200 whose body is neither an object nor an array is a Cloudflare challenge page,
    // a proxy error page, or a truncated response — never a record set. Reading it as a
    // success turns "I was blocked" into "this window is empty".
    const bodyUsable = meta.json !== null && typeof meta.json === 'object';
    // A response body is caller-hostile data: a getter, a Proxy, or a revoked Proxy in the
    // graph throws mid-walk, and that throw used to escape callCapability as an UNCODED
    // Error — indistinguishable to a caller branching on `.code` from a bug in its own
    // handler, and never recorded as a failed read. It is a failure of the check, so it is
    // coded and it fails closed; a payload that cannot be inspected cannot be evidence.
    let identity;
    let quarantined;
    try {
      ({ identity, quarantined } = inspectIdentity(
        meta.json,
        {
          locationId: boundLocationId,
          workflowId: typedBindings.workflowId,
          stepId: typedBindings.stepId,
          companyId: typedBindings.companyId,
          agentId: typedBindings.agentId,
        },
        checkableFieldsFor(capability),
      ));
    } catch (error) {
      const failure = auditError(
        CODES.IDENTITY_INSPECTION_FAILED,
        `capability ${capability.capabilityId} returned a body that threw while its identity was being inspected`,
        'Treat the read as failed, not empty. A response whose identity cannot be inspected cannot prove it belongs to this location.',
      );
      // Non-enumerable for the same reason as TRANSPORT_FAILED's: the original may carry a
      // URL or headers and must never be serialized into the MCP transcript.
      Object.defineProperty(failure, 'cause', { value: error, enumerable: false, configurable: true, writable: true });
      throw failure;
    }
    const incomplete = identityIncomplete(identity);

    const latchMeta = {
      capabilityId: capability.capabilityId,
      status: meta.status,
      retryAfterMs: meta.retryAfterMs,
    };
    if (meta.status === 429) {
      // PROCESS scope: an HTTP throttle is an account-level fact about how fast this run
      // is reading, not a statement about either credential. Continuing on the other rail
      // would keep pushing the same account that just said stop.
      //
      // The reason is CODES.RATE_LIMITED, matching this read's failureClass and every
      // other latch, so a resumer branching on `state().reason` sees one vocabulary.
      circuit.open('process', CODES.RATE_LIMITED, latchMeta);
    } else if (meta.status === 401) {
      // RAIL scope. A 401 means this rail's credential is dead, so every further read on
      // it is a guaranteed refusal — but the other rail carries a DIFFERENT credential
      // and is unaffected. A process-wide latch here let an expired AI token-id end a
      // backend workflow audit that had nothing to do with it.
      circuit.open(scope, CODES.AUTH_REJECTED, latchMeta);
    } else if (locationThrottled) {
      // PROCESS scope, same reasoning as the 429: the location is throttling the account.
      circuit.open('process', CODES.LOCATION_RATE_LIMITED, latchMeta);
    } else if (!bodyUsable) {
      const consecutive = circuit.noteUnusableBody(scope);
      if (consecutive >= INVALID_BODY_LATCH_THRESHOLD) {
        circuit.open(scope, CODES.INVALID_RESPONSE_BODY, { ...latchMeta, consecutive });
      }
    }
    // Only a GENUINELY SUCCESSFUL read breaks the run. Resetting on any parseable body was
    // enough to defeat the latch entirely: a front door alternating between a challenge
    // page and a JSON-bodied 403/404/500 kept clearing the counter, so `bad, bad, 403,
    // bad, bad, 403, …` never latched and the run walked its whole page budget against a
    // wall. A parseable error body is not evidence the front door opened — it is the front
    // door telling you no in a different format.
    if (meta.ok === true && bodyUsable) circuit.noteUsableRead(scope);

    // 403 latches NOTHING, deliberately. Unlike a 401 it is an entitlement or permission
    // refusal about ONE resource — an unprovisioned product, a soft-deleted agent whose
    // detail route is forbidden — not a dead credential, and the very next capability on
    // the same rail may well be readable. It still fails closed at the RESULT level
    // (ok:false, failureClass AUTH_REJECTED) so the read is never mistaken for an empty
    // one, which is exactly what Task 4 needs in order to record per-component
    // incompleteness instead of ending the whole run.
    //
    // Task 4's tombstone rule only excludes rows with BOTH isDeleted === true AND
    // agentStatus === "INACTIVE", so half-signalled rows (`{isDeleted:true,
    // agentStatus:"ACTIVE"}`) are still given a detail call and can still 403 — under a
    // process-wide latch, one such row would have ended the run.

    // Most specific first. The three incompleteness classes rank BELOW a conflict (a
    // proven contradiction beats an unproven one) and below every transport/HTTP class,
    // but they are still classes: a capped, too-deep, or unreadable inspection is a
    // provably incomplete check, and the previous pass's choice to let it pass as `ok:true`
    // was wrong — the record cap is reachable inside the descriptors' OWN maximum page
    // size (100 rows), so "the guard quietly switched off" was a real, routine outcome
    // rather than a pathological one. Reaching a bound is now an honest "I could not
    // verify this", which is what the auditor's completeness claims are built on.
    const failureClass = authRejected ? CODES.AUTH_REJECTED
      : meta.status === 429 ? CODES.RATE_LIMITED
        : locationThrottled ? CODES.LOCATION_RATE_LIMITED
          : meta.ok !== true ? `HTTP_${meta.status}`
            : !bodyUsable ? CODES.INVALID_RESPONSE_BODY
              : quarantined ? CODES.IDENTITY_CONFLICT
                : identity.unreadable.length > 0 ? CODES.IDENTITY_UNREADABLE
                  : identity.inspectionCapped ? CODES.IDENTITY_INSPECTION_CAPPED
                    : identity.depthCapped ? CODES.IDENTITY_DEPTH_CAPPED
                      : null;

    return {
      capabilityId: capability.capabilityId,
      host: capability.host,
      appliedPath,
      appliedQuery,
      status: meta.status,
      // A throttled 200, an unparseable body, a record whose identity contradicts the
      // request, and an identity check that could not be COMPLETED are all NOT successes.
      // The status and body are preserved so the caller can record the evidence, but none
      // of them may count as a read.
      ok: meta.ok === true && !locationThrottled && bodyUsable && !quarantined && !incomplete,
      json: meta.json,
      identity,
      quarantined,
      failureClass,
      retryAfterMs: meta.retryAfterMs,
      capturedAt: meta.capturedAt,
    };
  };

  return { callCapability, locationId: boundLocationId };
}
