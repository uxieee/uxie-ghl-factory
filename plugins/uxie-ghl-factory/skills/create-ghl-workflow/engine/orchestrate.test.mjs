import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchEntities, orchestrate } from './orchestrate.mjs';

// Mock gateway: records calls, returns canned responses keyed by method+path prefix.
function mockGateway({ tags = [], pipelines = [], calendars = [], users = [], forms = [] } = {}) {
  const calls = [];
  const call = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET' && path.includes('/opportunities/pipelines')) return { ok: true, json: { pipelines } };
    if (method === 'GET' && path.includes('/calendars/')) return { ok: true, json: { calendars } };
    if (method === 'GET' && path.includes('/users/')) return { ok: true, json: { users } };
    if (method === 'GET' && path.includes('/forms/')) return { ok: true, json: { forms } };
    if (method === 'GET' && path.includes('/customFields')) return { ok: true, json: { customFields: [] } };
    if (method === 'GET' && path.includes('/voice-ai/') || path.includes('/ai-employees/')) return { ok: false, json: {} };
    if (method === 'GET' && path.match(/\/tags$/)) return { ok: true, json: { tags: tags.map((n) => ({ name: n })) } };
    if (method === 'POST' && path.match(/\/tags$/)) return { ok: true, json: { id: 'TAG_' + body.name } };
    if (method === 'POST' && path.match(/\/workflow\/[^/]+$/)) return { ok: true, json: { id: 'WID_1' } };
    if (method === 'PUT' && path.includes('/auto-save')) return { ok: true, json: {} };
    if (method === 'POST' && path.includes('/trigger')) return { ok: true, json: { id: 'TRIG_1' } };
    if (method === 'GET' && path.includes('/workflow/')) return { ok: true, json: { workflowData: { templates: [
      { id: 'WID_1', type: 'add_contact_tag', attributes: { tags: ['new-tag'] } },
    ] } } };
    return { ok: true, json: {} };
  };
  return { gw: { call, loc: 'LOC', uid: 'UID' }, calls };
}

const tagIR = () => ({ name: 'W', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [{ field: 'tagsAdded', value: 'new-tag' }] }],
  graph: [{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['new-tag'] } }] });

const inlineTemplateIR = () => ({
  name: 'Template workflow',
  triggers: [],
  graph: [{
    ref: 'email', kind: 'action', type: 'email', name: 'Email',
    attributes: {
      subject: 'Hello',
      _template: { title: 'Shared email', html: '<p>Hello</p>', previewText: 'Hello' },
    },
  }],
});

test('orchestrate pre-creates missing tags BEFORE building (the friend bug)', async () => {
  const { gw, calls } = mockGateway({ tags: [] }); // account has no tags yet
  const report = await orchestrate(tagIR(), gw);
  assert.deepEqual(report.createdTags, ['new-tag']);
  // the tag POST must happen before the workflow create
  const tagPost = calls.findIndex((c) => c.method === 'POST' && /\/tags$/.test(c.path));
  const wfCreate = calls.findIndex((c) => c.method === 'POST' && /\/workflow\/[^/]+$/.test(c.path));
  assert.ok(tagPost !== -1 && tagPost < wfCreate, 'tags created before workflow');
  assert.equal(report.wid, 'WID_1');
  assert.equal(report.aborted, null);
});

test('orchestrate does NOT recreate an existing tag', async () => {
  const { gw } = mockGateway({ tags: ['new-tag'] }); // already exists
  const report = await orchestrate(tagIR(), gw);
  assert.deepEqual(report.createdTags, []);
});

test('orchestrate fails closed on every known non-2xx dependency HTTP phase before workflow creation', async () => {
  const credentialLookingBodyValue = 'eyJhbGciOiJIUzI1NiJ9.dependency-error-credential-fixture.signature';
  const scenarios = [
    {
      phase: 'email_template_create', status: 422, spec: inlineTemplateIR(),
      match: (method, path) => method === 'POST' && path === '/emails/builder',
    },
    {
      phase: 'email_template_data_create', status: 503, spec: inlineTemplateIR(),
      match: (method, path) => method === 'POST' && path === '/emails/builder/data',
    },
    {
      phase: 'tag_list', status: 403, spec: tagIR(),
      match: (method, path) => method === 'GET' && path === '/locations/LOC/tags',
    },
    {
      phase: 'tag_create', status: 500, spec: tagIR(),
      match: (method, path) => method === 'POST' && path === '/locations/LOC/tags',
    },
  ];

  for (const scenario of scenarios) {
    const { gw, calls } = mockGateway({ tags: [] });
    const inner = gw.call;
    gw.call = async (method, path, body) => {
      if (scenario.phase === 'email_template_data_create'
        && method === 'POST' && path === '/emails/builder') {
        calls.push({ method, path, body });
        return { status: 201, ok: true, json: { id: 'TEMPLATE_1' } };
      }
      if (scenario.match(method, path)) {
        calls.push({ method, path, body });
        return {
          status: scenario.status,
          ok: false,
          json: { message: `${scenario.phase} rejected`, authorization: credentialLookingBodyValue },
        };
      }
      return inner(method, path, body);
    };

    const report = await orchestrate(structuredClone(scenario.spec), gw);
    assert.equal(report.failurePhase, scenario.phase, scenario.phase);
    assert.match(report.aborted, /non-2xx|upstream/i, scenario.phase);
    assert.equal(report.failureHttp.status, scenario.status, scenario.phase);
    assert.equal(report.failureHttp.body.authorization, '<redacted>', scenario.phase);
    assert.equal(JSON.stringify(report).includes(credentialLookingBodyValue), false, scenario.phase);
    assert.equal(calls.some(({ method, path }) => (
      method === 'POST' && path === '/workflow/LOC'
    )), false, `${scenario.phase} must abort before workflow creation`);
    if (scenario.phase === 'email_template_data_create') {
      assert.deepEqual(report.createdTemplates, [{ title: 'Shared email', id: 'TEMPLATE_1' }]);
    }
  }
});

test('orchestrate ABORTS on a missing account dependency (unknown pipeline)', async () => {
  const { gw, calls } = mockGateway({ pipelines: [] }); // no pipelines exist
  const ir = { name: 'W', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
    graph: [{ ref: 'o', kind: 'action', type: 'create_opportunity', name: 'Op', attributes: { pipeline: 'Ghost', status: 'open' } }] };
  const report = await orchestrate(ir, gw);
  assert.ok(report.aborted && report.aborted.includes('Ghost'), 'aborts naming the missing dep');
  assert.equal(report.wid, null);
  // must NOT have created a workflow
  assert.equal(calls.some((c) => c.method === 'POST' && /\/workflow\/[^/]+$/.test(c.path)), false);
});

test('orchestrate resolves a real pipeline name and proceeds', async () => {
  const { gw } = mockGateway({ pipelines: [{ id: 'PIPE_1', name: 'Sales', stages: [{ id: 'ST_1', name: 'New' }] }] });
  const ir = { name: 'W', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
    graph: [{ ref: 'o', kind: 'action', type: 'create_opportunity', name: 'Op', attributes: { name: 'D', pipeline: 'Sales', stage: 'New', status: 'open' } }] };
  const report = await orchestrate(ir, gw);
  assert.equal(report.aborted, null);
  assert.equal(report.wid, 'WID_1');
  assert.deepEqual(report.unresolved, []);
});

test('orchestrate ABORTS gracefully on compile rejection (OPP_UNASSOCIATED) instead of throwing', async () => {
  const { gw, calls } = mockGateway({});
  const ir = { name: 'W', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
    graph: [{ ref: 'u', kind: 'action', type: 'update_opportunity', name: 'Upd',
      attributes: { updates: [{ field: 'status', value: 'won' }] } }] };
  const report = await orchestrate(ir, gw);   // must NOT throw
  assert.ok(report.aborted && report.aborted.includes('OPP_UNASSOCIATED'), 'aborted names the code');
  assert.equal(report.wid, null);
  assert.equal(calls.some((c) => c.method === 'POST' && /\/workflow\/[^/]+$/.test(c.path)), false, 'no workflow created');
});

test('orchestrate retries the trigger POST through the settle race and records the outcome', async () => {
  const { gw } = mockGateway({ tags: ['new-tag'] });
  // first two trigger POSTs hit the race ("Workflow not found"), third succeeds
  let attempts = 0;
  const inner = gw.call;
  gw.call = async (m, p, b) => {
    if (m === 'POST' && p.includes('/trigger')) {
      attempts++;
      if (attempts < 3) return { ok: false, status: 400, json: { message: 'Workflow not found' } };
    }
    return inner(m, p, b);
  };
  const report = await orchestrate(tagIR(), gw, { triggerBackoffMs: [0, 0, 0] });
  assert.equal(attempts, 3);
  assert.equal(report.triggers.posted, 1);
  assert.deepEqual(report.triggers.failed, []);
});

test('orchestrate records a trigger that never persists instead of dropping it silently', async () => {
  const { gw } = mockGateway({ tags: ['new-tag'] });
  const inner = gw.call;
  gw.call = async (m, p, b) => (m === 'POST' && p.includes('/trigger'))
    ? { ok: false, status: 400, json: { message: 'Workflow not found' } } : inner(m, p, b);
  const report = await orchestrate(tagIR(), gw, { triggerBackoffMs: [0, 0] });
  assert.equal(report.triggers.posted, 0);
  assert.equal(report.triggers.failed.length, 1);
  assert.equal(report.triggers.failed[0].type, 'contact_tag');
  assert.equal(report.triggers.failed[0].status, 400);
});

test('orchestrate builds a trigger-less workflow with zero trigger POSTs', async () => {
  const { gw, calls } = mockGateway({ tags: ['new-tag'] });
  const ir = { name: 'W', triggers: [],
    graph: [{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['new-tag'] } }] };
  const report = await orchestrate(ir, gw);
  assert.equal(report.wid, 'WID_1');
  assert.equal(report.aborted, null);
  assert.equal(calls.some((c) => c.method === 'POST' && c.path.includes('/trigger')), false);
  assert.equal(report.triggers.posted, 0);
});

// §5 reachability: the sender default must be usable from the normal build path, not only
// programmatically. An email step is extracted from the auto-save PUT body the mock records.
const emailIR = (extra = {}) => ({ name: 'W', ...extra,
  triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
  graph: [{ ref: 'e', kind: 'action', type: 'email', name: 'Mail', attributes: { subject: 'Hi', html: '<p>x</p>' } }] });
const savedEmail = (calls) => calls.find((c) => c.method === 'PUT' && c.path.includes('/auto-save'))
  .body.workflowData.templates.find((t) => t.type === 'email');

test('orchestrate fetches custom fields across ALL models (opportunity fields must be visible)', async () => {
  // Live-caught 2026-07-18: the plain /customFields endpoint returns CONTACT fields only,
  // so update_opportunity referencing an OPPORTUNITY custom field false-threw OPP_FIELD_UNKNOWN.
  const { gw, calls } = mockGateway();
  await orchestrate(tagIR(), gw);
  const cfGet = calls.find((c) => c.method === 'GET' && c.path.includes('/customFields'));
  assert.ok(cfGet, 'fetches custom fields');
  assert.match(cfGet.path, /model=all/, 'must request model=all — the contact-only endpoint false-throws on opportunity custom fields');
});

test('fetchEntities degrades malformed and failed endpoint payloads to empty arrays', async () => {
  const call = async (_method, path) => {
    if (path.includes('/opportunities/pipelines')) return { ok: true, json: { pipelines: {} } };
    if (path.includes('/calendars/')) return { ok: false, json: { calendars: [{ id: 'must-not-leak' }] } };
    if (path.includes('/users/')) return { ok: true, json: { users: [null, 'wrong type'] } };
    if (path.includes('/forms/')) return { ok: true, json: { forms: [null] } };
    if (path.includes('/customFields/')) return { ok: true, json: { message: 'no custom fields array' } };
    if (path.includes('/voice-ai/')) throw new Error('best-effort endpoint down');
    return { ok: true, json: { agents: null } };
  };

  assert.deepEqual(await fetchEntities({ call, loc: 'LOC' }), {
    pipelines: [], calendars: [], users: [], forms: [], customFields: [], agents: [],
    workflows: [], customValues: [], triggerLinks: [], offers: [], membershipProducts: [],
    smsTemplates: [], emailTemplates: [], products: [], coupons: [], phoneNumbers: [], funnels: [],
    fbPages: [], documentTemplates: [], objects: [],
  });
});

test('fetchEntities URL-encodes hostile location ids in every request', async () => {
  const calls = [];
  const locationId = 'L /?&=#';
  await fetchEntities({
    loc: locationId,
    call: async (method, path) => {
      calls.push({ method, path });
      return { ok: false, json: {} };
    },
  });

  const queryValue = new URLSearchParams({ locationId }).toString();
  const pathValue = encodeURIComponent(locationId);
  assert.equal(calls.length, 21);
  // legs that carry the location in the PATH (must be encodeURIComponent'd there)
  const pathLegs = [
    new RegExp(`^/locations/${pathValue}/customFields/search\\?`),
    new RegExp(`^/workflow/${pathValue}/list\\?`),
    new RegExp(`^/locations/${pathValue}/customValues$`),
    new RegExp(`^/membership/locations/${pathValue}/offers$`),
    new RegExp(`^/membership/locations/${pathValue}/products\\?`),
    new RegExp(`^/locations/${pathValue}/templates\\?`),
    new RegExp(`^/integrations/facebook/${pathValue}/pages\\?`),
  ];
  // the coupons leg carries the location as altId= (that endpoint's own contract)
  const altValue = new URLSearchParams({ altId: locationId }).toString();
  for (const { method, path } of calls) {
    assert.equal(method, 'GET');
    const pathLeg = pathLegs.find((re) => re.test(path));
    if (pathLeg) continue;
    assert.ok(!path.includes(locationId), `raw location id leaked into: ${path}`);
    if (path.startsWith('/payments/coupon/list')) { assert.ok(path.includes(altValue), `altId was not encoded: ${path}`); continue; }
    assert.ok(path.includes(queryValue), `location query was not encoded: ${path}`);
  }
  for (const re of pathLegs) assert.ok(calls.some(({ path }) => re.test(path)), `missing path-encoded leg ${re}`);
});

test('orchestrate applies a top-level ir.senderDefault to email steps (§5 reachable via IR)', async () => {
  const { gw, calls } = mockGateway();
  await orchestrate(emailIR({ senderDefault: { from_name: '{{ custom_values.sender_name }}', from_email: '{{ custom_values.sender_email }}' } }), gw);
  const email = savedEmail(calls);
  assert.equal(email.attributes.from_name, '{{ custom_values.sender_name }}');
  assert.equal(email.attributes.from_email, '{{ custom_values.sender_email }}');
});

test('orchestrate: opts.senderDefault wins over ir.senderDefault', async () => {
  const { gw, calls } = mockGateway();
  await orchestrate(emailIR({ senderDefault: { from_name: 'FROM_IR', from_email: 'ir@x' } }), gw,
    { senderDefault: { from_name: 'FROM_OPTS', from_email: 'opts@x' } });
  assert.equal(savedEmail(calls).attributes.from_name, 'FROM_OPTS');
});

test('orchestrate: no senderDefault anywhere falls back to {{location.*}}', async () => {
  const { gw, calls } = mockGateway();
  await orchestrate(emailIR(), gw);
  assert.equal(savedEmail(calls).attributes.from_name, '{{location.name}}');
});

// ── Asset pre-flight (validate-assets) ──────────────────────────────────────────────────
// GHL's own reference validator, called before the create. Live-proven on GROM AU
// 2026-08-21; see docs/superpowers/notes/2026-08-21-workflow-shape-findings.md F3.

// Wrap mockGateway so /validate-assets returns a chosen verdict instead of falling through.
function withAssetVerdict(base, verdict) {
  const inner = base.gw.call;
  base.gw.call = async (method, path, body) => {
    if (method === 'POST' && path.includes('/validate-assets')) {
      base.calls.push({ method, path, body });
      return { ok: true, status: 200, json: verdict };
    }
    return inner(method, path, body);
  };
  return base;
}

const ASSET_ERR = {
  ruleId: 'ASSET_USER_NOT_FOUND', assetType: 'user', assetId: 'GONE',
  message: 'Referenced User does not exist or does not belong to this location.',
  severity: 'error', stepId: 'S1', stepName: 'Assign', stepType: 'assign_user',
};

test('asset pre-flight ABORTS before the workflow is created', async () => {
  const mock = withAssetVerdict(mockGateway({ tags: ['new-tag'] }), { errors: [ASSET_ERR], warnings: [] });
  const report = await orchestrate(tagIR(), mock.gw);

  assert.equal(report.failurePhase, 'validate_assets');
  assert.match(report.aborted, /Referenced User does not exist/);
  assert.equal(report.wid, null, 'no workflow id — nothing was created');

  // the decisive assertion: no workflow POST ever went out
  const wfCreate = mock.calls.findIndex((c) => c.method === 'POST' && /\/workflow\/[^/]+$/.test(c.path));
  assert.equal(wfCreate, -1, 'workflow must NOT be created when an asset reference is bad');

  // and the check ran before any create attempt
  const preflight = mock.calls.findIndex((c) => c.path.includes('/validate-assets'));
  assert.ok(preflight !== -1, 'pre-flight actually ran');
});

test('asset pre-flight warnings are reported but do NOT block the build', async () => {
  const warn = { ...ASSET_ERR, severity: 'warning', message: 'Soft problem.' };
  const mock = withAssetVerdict(mockGateway({ tags: ['new-tag'] }), { errors: [], warnings: [warn] });
  const report = await orchestrate(tagIR(), mock.gw);

  assert.equal(report.aborted, null);
  assert.equal(report.wid, 'WID_1');
  assert.ok(report.warnings.some((w) => /Soft problem/.test(w)), 'warning surfaced in the report');
});

test('ignoreAssetErrors builds anyway, and still records what GHL objected to', async () => {
  const mock = withAssetVerdict(mockGateway({ tags: ['new-tag'] }), { errors: [ASSET_ERR], warnings: [] });
  const report = await orchestrate(tagIR(), mock.gw, { ignoreAssetErrors: true });

  assert.equal(report.aborted, null);
  assert.equal(report.wid, 'WID_1');
  assert.equal(report.assetPreflight.errors.length, 1, 'the objection is still on the record');
});

test('FAIL-OPEN: an unreachable pre-flight endpoint does not block a good build', async () => {
  // mockGateway's fallthrough returns {} — an unrecognised shape, which must degrade to
  // "skipped" rather than becoming a new way for a previously-working build to die.
  const { gw } = mockGateway({ tags: ['new-tag'] });
  const report = await orchestrate(tagIR(), gw);

  assert.equal(report.aborted, null);
  assert.equal(report.wid, 'WID_1');
  assert.equal(report.assetPreflight.checked, false);
  assert.ok(report.assetPreflight.skipped, 'records why it was skipped');
});

test('inbound_webhook: the report names the receiving URL from the SERVER-assigned trigger id, and a sample payload lints {{inboundWebhookRequest.*}} refs', async () => {
  const { gw } = mockGateway();
  const ir = { name: 'Hook W', triggers: [{ ref: 'h', type: 'inbound_webhook', name: 'Inbound Webhook', filters: [] }],
    sampleWebhookPayload: { lead: { email: 'sample@example.com' }, dealRefId: 'X' },
    graph: [{ ref: 'n', kind: 'action', type: 'add_notes', name: 'Note', attributes: { html: '<p>{{inboundWebhookRequest.dealRefId}} {{inboundWebhookRequest.lead.emial}}</p>', type: 'add_notes' } }] };
  const report = await orchestrate(ir, gw);
  assert.equal(report.aborted, null, JSON.stringify(report.aborted));
  assert.deepEqual(report.triggers.ids, [{ type: 'inbound_webhook', name: 'Inbound Webhook', id: 'TRIG_1' }]);
  assert.deepEqual(report.webhookUrls, [{ name: 'Inbound Webhook', triggerId: 'TRIG_1', url: 'https://services.leadconnectorhq.com/hooks/LOC/webhook-trigger/TRIG_1' }]);
  assert.ok(report.warnings.some((w) => /lead\.emial/.test(w) && /did you mean lead\.email/.test(w)), JSON.stringify(report.warnings));
  assert.ok(!report.warnings.some((w) => /dealRefId/.test(w)), 'the valid path does not warn');
});

test('a non-webhook build reports no webhook URLs and no trigger-id surprises', async () => {
  const { gw } = mockGateway({ tags: ['new-tag'] });
  const report = await orchestrate(tagIR(), gw);
  assert.deepEqual(report.webhookUrls, []);
  assert.deepEqual(report.triggers.ids, [{ type: 'contact_tag', name: 'T', id: 'TRIG_1' }]);
});

// ── custom-code sandbox pre-flight + webhook pin (2026-08-22 wiring) ──────────────────────
function gwWith(routes, base = mockGateway()) {
  const calls = base.calls;
  const call = async (method, path, body) => {
    for (const [pred, res] of routes) if (pred(method, path, body)) { calls.push({ method, path, body }); return typeof res === 'function' ? res(method, path, body) : res; }
    return base.gw.call(method, path, body);
  };
  return { gw: { ...base.gw, call }, calls };
}
const codeIR = (extra = {}) => ({ name: 'Code W', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
  graph: [{ ref: 'calc', kind: 'action', type: 'custom_code', name: 'Calc', attributes: { code: 'output = { ok: true, sum: inputData.a + inputData.b }', language: 'javascript', inputData: { a: 2, b: 3 }, output: { ok: true } } }], ...extra });

test('custom_code pre-flight: a passing sandbox run REPLACES the authored output with the real object and warns on key drift', async () => {
  const { gw, calls } = gwWith([[ (m, p) => m === 'POST' && p === '/workflow/custom-code/run-test', { ok: true, status: 200, json: { output: { ok: true, sum: 5 }, hasError: false, consoleLogs: [], consoleErrors: [] } } ]], mockGateway({ tags: ['x'] }));
  const report = await orchestrate(codeIR(), gw);
  assert.equal(report.aborted, null, JSON.stringify(report.aborted));
  const [t] = report.customCodeTests;
  assert.equal(t.passed, true); assert.equal(t.replacedOutput, true); assert.deepEqual(t.outputKeys, ['ok', 'sum']); assert.deepEqual(t.authoredKeys, ['ok']);
  assert.ok(report.warnings.some((w) => /keys differ/.test(w) && /extra: sum/.test(w)), JSON.stringify(report.warnings));
  const run = calls.find((c) => c.path === '/workflow/custom-code/run-test');
  assert.deepEqual(run.body, { location_id: 'LOC', attributes: { language: 'javascript', code: 'output = { ok: true, sum: inputData.a + inputData.b }', inputData: { a: 2, b: 3 } } });
  const save = calls.find((c) => c.method === 'PUT' && c.path.includes('/auto-save'));
  const step = save.body.workflowData.templates.find((x) => x.type === 'custom_code');
  assert.deepEqual(step.attributes.output, { ok: true, sum: 5 }, 'the auto-save carried the sandbox output');
  assert.ok(calls.findIndex((c) => c.path === '/workflow/custom-code/run-test') < calls.findIndex((c) => c.method === 'POST' && /\/workflow\/[^/]+$/.test(c.path)), 'pre-flight runs BEFORE the workflow is created');
});

test('custom_code pre-flight: a thrown run is a recorded warning (authored output kept); strictCustomCode aborts before any create; skipCustomCodeTest skips the call', async () => {
  const thrown = [[ (m, p) => m === 'POST' && p === '/workflow/custom-code/run-test', { ok: true, status: 200, json: { output: {}, hasError: true, errorMessage: 'Error: boom', consoleErrors: [] } } ]];
  let g = gwWith(thrown, mockGateway({ tags: ['x'] }));
  let report = await orchestrate(codeIR(), g.gw);
  assert.equal(report.aborted, null); assert.equal(report.customCodeTests[0].passed, false); assert.equal(report.customCodeTests[0].errorMessage, 'Error: boom');
  assert.ok(report.warnings.some((w) => /did not pass/.test(w)));
  const save = g.calls.find((c) => c.method === 'PUT' && c.path.includes('/auto-save'));
  assert.deepEqual(save.body.workflowData.templates.find((x) => x.type === 'custom_code').attributes.output, { ok: true }, 'authored sample kept');
  g = gwWith(thrown, mockGateway({ tags: ['x'] }));
  report = await orchestrate(codeIR(), g.gw, { strictCustomCode: true });
  assert.equal(report.failurePhase, 'custom_code_test'); assert.match(report.aborted, /failed the sandbox test/);
  assert.equal(g.calls.some((c) => c.method === 'POST' && /\/workflow\/[^/]+$/.test(c.path)), false, 'no create after a strict abort');
  g = gwWith(thrown, mockGateway({ tags: ['x'] }));
  report = await orchestrate(codeIR(), g.gw, { skipCustomCodeTest: true });
  assert.equal(g.calls.some((c) => c.path === '/workflow/custom-code/run-test'), false); assert.deepEqual(report.customCodeTests, []);
});

test('webhook pin (opt-in): POSTs the sample to the receiving path, finds it by canonical payload, pins it, and reports merge tags; a missing request is a recorded failure', async () => {
  const sample = { lead: { email: 'sample@example.com' }, dealRefId: 'X' };
  const routes = [
    [(m, p) => m === 'POST' && p === '/hooks/LOC/webhook-trigger/TRIG_1', { ok: true, status: 200, json: { status: 'Success: test request received' } }],
    [(m, p) => m === 'GET' && p.startsWith('/hooks/inbound-webhook-request/trigger/TRIG_1'), { ok: true, status: 200, json: [{ _id: 'reqOld', payload: { dealRefId: 'OLD', headers: { h: 1 } } }, { _id: 'reqNew', payload: { dealRefId: 'X', lead: { email: 'sample@example.com' }, headers: { h: 1 } } }] }],
    [(m, p) => m === 'PUT' && p.startsWith('/hooks/inbound-webhook-request/set-as-reference/reqNew'), { ok: true, status: 200, json: 'ref1' }],
    [(m, p) => m === 'GET' && p.startsWith('/hooks/inbound-webhook-request/reference/TRIG_1'), { ok: true, status: 200, json: { _id: 'ref1', requestId: 'reqNew', payload: { ...sample, headers: { h: 1 } } } }],
  ];
  const { gw, calls } = gwWith(routes);
  const ir = { name: 'Hook W', triggers: [{ ref: 'h', type: 'inbound_webhook', name: 'Inbound Webhook', filters: [] }], sampleWebhookPayload: sample, pinWebhookSample: true,
    graph: [{ ref: 'n', kind: 'action', type: 'add_notes', name: 'Note', attributes: { html: '<p>{{inboundWebhookRequest.dealRefId}}</p>', type: 'add_notes' } }] };
  const report = await orchestrate(ir, gw, { sleep: async () => {}, pinPollMs: 1, pinMaxPolls: 3 });
  assert.equal(report.aborted, null, JSON.stringify(report.aborted));
  const [pin] = report.webhookPins;
  assert.equal(pin.requestId, 'reqNew'); assert.equal(pin.referenceId, 'ref1'); assert.equal(pin.tagCount, 2); assert.equal(pin.error, null);
  assert.deepEqual(Object.keys(pin.mergeTags).sort(), ['dealRefId', 'lead.email']);
  assert.ok(calls.some((c) => c.method === 'POST' && c.path === '/hooks/LOC/webhook-trigger/TRIG_1' && c.body.dealRefId === 'X'));
  // opt-out: no flag → no hooks traffic at all
  const g2 = gwWith(routes);
  const r2 = await orchestrate({ ...ir, pinWebhookSample: undefined }, g2.gw, { sleep: async () => {} });
  assert.deepEqual(r2.webhookPins, []); assert.equal(g2.calls.some((c) => c.path.startsWith('/hooks/')), false);
  // missing request → recorded, not thrown
  const g3 = gwWith([routes[0], [(m, p) => m === 'GET' && p.startsWith('/hooks/inbound-webhook-request/trigger/'), { ok: true, status: 200, json: [] }]]);
  const r3 = await orchestrate(ir, g3.gw, { sleep: async () => {}, pinPollMs: 1, pinMaxPolls: 2 });
  assert.equal(r3.aborted, null); assert.match(r3.webhookPins[0].error, /not recorded/); assert.ok(r3.warnings.some((w) => /webhook pin/.test(w)));
});

test('orchestrate --publish strips a stored null `next` before the publish PUT — the same fix as publish_workflow in mcp-internal/core/tools.mjs (see terminals.mjs)', async () => {
  // The document GET returns a stale step whose `next` a prior save wrote as an explicit
  // null (terminals.mjs). The publish path re-GETs and echoes this document back as a PUT
  // (unlike the round-trip verify GET, which is read-only) — without stripping, that PUT
  // 400s on a step nobody touched.
  let getWorkflowCalls = 0;
  const staleTemplates = [
    { id: 's1', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['new-tag'] }, next: null },
  ];
  const routes = [
    [(m, p) => m === 'GET' && p === '/workflow/LOC/WID_1?includeScheduledPauseInfo=true', () => {
      getWorkflowCalls++;
      // 1st call: step-5 round-trip verify. 2nd: publish preflight fetch. 3rd: post-publish
      // verify — reports the status the PUT presumably committed.
      const status = getWorkflowCalls >= 3 ? 'published' : 'draft';
      return { ok: true, status: 200, json: { status, version: 3, workflowData: { templates: staleTemplates } } };
    }],
    [(m, p) => m === 'GET' && p === '/workflow/LOC/trigger?workflowId=WID_1', { ok: true, status: 200, json: { triggers: [] } }],
    [(m, p) => m === 'PUT' && p === '/workflow/LOC/WID_1', { ok: true, status: 200, json: {} }],
  ];
  const { gw, calls } = gwWith(routes, mockGateway({ tags: ['new-tag'] }));
  const report = await orchestrate(tagIR(), gw, { publish: true });
  assert.equal(report.aborted, null, JSON.stringify(report.aborted));
  assert.equal(report.published, true);
  const publishPut = calls.find((c) => c.method === 'PUT' && c.path === '/workflow/LOC/WID_1');
  assert.ok(publishPut, 'the publish PUT must have been sent');
  assert.equal('next' in publishPut.body.workflowData.templates[0], false,
    'the stored null `next` must not ride onto the publish PUT unrepaired');
});

test('orchestrate --publish fills input_trigger_params on a legacy add_to_workflow step it never touched — same wire-assembly boundary as the null-`next` fix above (see terminals.mjs)', async () => {
  // Sibling rule to the null-`next` test above. The document GET returns a stale add_to_workflow
  // step stored as {workflow_id, type} — no input_trigger_params key at all, the shape a pre-fix
  // engine build actually produced (required-fields.mjs's CONDITIONAL_DEFAULTS only ever ran on
  // the compile path). GHL's save validator refuses its absence with "Input Trigger Params is
  // required", and that refusal blocks EVERY save on the workflow, not just this step. The
  // publish path re-GETs and echoes this document back as a PUT, so it must repair this the
  // same way editCommitBody already does on the edit path.
  let getWorkflowCalls = 0;
  const staleTemplates = [
    { id: 's2', type: 'add_to_workflow', name: 'Enrol', attributes: { workflow_id: 'W1', type: 'add_to_workflow' } },
  ];
  const routes = [
    [(m, p) => m === 'GET' && p === '/workflow/LOC/WID_1?includeScheduledPauseInfo=true', () => {
      getWorkflowCalls++;
      const status = getWorkflowCalls >= 3 ? 'published' : 'draft';
      return { ok: true, status: 200, json: { status, version: 3, workflowData: { templates: staleTemplates } } };
    }],
    [(m, p) => m === 'GET' && p === '/workflow/LOC/trigger?workflowId=WID_1', { ok: true, status: 200, json: { triggers: [] } }],
    [(m, p) => m === 'PUT' && p === '/workflow/LOC/WID_1', { ok: true, status: 200, json: {} }],
  ];
  const { gw, calls } = gwWith(routes, mockGateway({ tags: ['new-tag'] }));
  const report = await orchestrate(tagIR(), gw, { publish: true });
  assert.equal(report.aborted, null, JSON.stringify(report.aborted));
  assert.equal(report.published, true);
  const publishPut = calls.find((c) => c.method === 'PUT' && c.path === '/workflow/LOC/WID_1');
  assert.ok(publishPut, 'the publish PUT must have been sent');
  const legacyStep = publishPut.body.workflowData.templates.find((t) => t.id === 's2');
  assert.equal(legacyStep.attributes.input_trigger_params, false,
    'a stored {workflow_id, type}-only add_to_workflow step must not ride the publish PUT unrepaired');
  assert.equal(typeof legacyStep.attributes.input_trigger_params, 'boolean',
    'it must be a real JSON boolean, not a stringified or missing value');
});

// Task 9 (workflow save-correctness, 2026-08-27) found the full-document PUT's
// oldTriggers/newTriggers INERT for trigger content generally and routed activation
// through a per-trigger PUT /workflow/{loc}/trigger/{triggerId} instead. Measured
// 2026-08-28 (throwaway probes on the designated test sub-account, three experiments)
// DISPROVED that rail for `active` specifically: a publish with ZERO trigger writes still
// activates every trigger sub-second after the publish PUT returns, and a per-trigger PUT
// with active:false against a published workflow returns 200 with the trigger staying
// active:true. `active` is a SERVER-MANAGED PROJECTION of the workflow's publish state —
// this test now pins the opposite of what it used to assert: no per-trigger write is sent,
// and activation happens purely as a side effect of the publish PUT succeeding.
test('orchestrate --publish sends no per-trigger activation PUT — activation happens as a side effect of the publish PUT alone', async () => {
  let triggersState = [{ id: 'tr1', _id: 'tr1', type: 'contact_tag', name: 'T', active: false, conditions: [] }];
  let getWorkflowCalls = 0;
  const staleTemplates = [{ id: 's1', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['new-tag'] } }];
  const routes = [
    [(m, p) => m === 'GET' && p === '/workflow/LOC/WID_1?includeScheduledPauseInfo=true', () => {
      getWorkflowCalls++;
      // Mirrors the null-`next` test above: 1st call is the step-5 round-trip verify, 2nd is
      // the publish preflight fetch, 3rd is the post-publish verify.
      const status = getWorkflowCalls >= 3 ? 'published' : 'draft';
      return { ok: true, status: 200, json: { status, version: 3, workflowData: { templates: staleTemplates } } };
    }],
    [(m, p) => m === 'GET' && p === '/workflow/LOC/trigger?workflowId=WID_1',
      () => ({ ok: true, status: 200, json: { triggers: triggersState.map((t) => ({ ...t })) } })],
    // Modeled inert, matching the live-measured behavior: accepts `active`, ignores it —
    // kept only so a stray reintroduction of the write is caught doing nothing, same as
    // the real API, rather than the mock accidentally "fixing" a bug the API does not fix.
    [(m, p) => m === 'PUT' && p === '/workflow/LOC/trigger/tr1', (m, p, body) => {
      const { active: _ignoredActive, ...contentOnly } = body ?? {};
      triggersState = triggersState.map((t) => ((t.id ?? t._id) === 'tr1' ? { ...t, ...contentOnly } : t));
      return { ok: true, status: 200, json: { id: 'tr1' } };
    }],
    // The measured mechanism: publishing itself flips `active`, not any field in this body.
    [(m, p) => m === 'PUT' && p === '/workflow/LOC/WID_1', (m, p, body) => {
      if (body.status === 'published') triggersState = triggersState.map((t) => ({ ...t, active: true }));
      return { ok: true, status: 200, json: {} };
    }],
  ];
  const { gw, calls } = gwWith(routes, mockGateway({ tags: ['new-tag'] }));
  const report = await orchestrate(tagIR(), gw, { publish: true });
  assert.equal(report.aborted, null, JSON.stringify(report.aborted));
  assert.equal(report.published, true);

  assert.equal(calls.some((c) => c.method === 'PUT' && c.path === '/workflow/LOC/trigger/tr1'), false,
    'orchestrate --publish must never send a per-trigger activation PUT — the write is proven inert');

  // the document PUT's oldTriggers/newTriggers is an ECHO of the roster as it was READ —
  // still active:false — because that field is not the activation mechanism.
  const publishPut = calls.find((c) => c.method === 'PUT' && c.path === '/workflow/LOC/WID_1');
  assert.deepEqual(publishPut.body.oldTriggers, publishPut.body.newTriggers);
  assert.deepEqual(publishPut.body.newTriggers.map((t) => t.active), [false]);

  // and the trigger reads active afterward, via the publish transition itself
  assert.equal(triggersState[0].active, true);
});

test('orchestrate --publish reports published:false, naming the trigger, when it reads inactive after a successful publish PUT — the open, unsolved case', async () => {
  // Models the honest open question: `active` is a server-managed projection with no known
  // write to force it, so a trigger that simply never flips cannot currently be fixed
  // through any known API path — including by retrying the retired per-trigger write. The
  // engine's job is to report that state clearly and name the trigger, never to pretend a
  // fix exists.
  const triggersState = [{ id: 'tr1', _id: 'tr1', type: 'contact_tag', name: 'T', active: false, conditions: [] }];
  const routes = [
    [(m, p) => m === 'GET' && p === '/workflow/LOC/WID_1?includeScheduledPauseInfo=true',
      { ok: true, status: 200, json: { status: 'published', version: 3, workflowData: { templates: [] } } }],
    [(m, p) => m === 'GET' && p === '/workflow/LOC/trigger?workflowId=WID_1',
      () => ({ ok: true, status: 200, json: { triggers: triggersState.map((t) => ({ ...t })) } })],
    [(m, p) => m === 'PUT' && p === '/workflow/LOC/WID_1', { ok: true, status: 200, json: {} }],
  ];
  const { gw, calls } = gwWith(routes, mockGateway({ tags: ['new-tag'] }));
  const report = await orchestrate(tagIR(), gw, { publish: true });
  assert.equal(report.published, false);
  assert.equal(calls.some((c) => c.method === 'PUT' && c.path === '/workflow/LOC/trigger/tr1'), false,
    'a trigger reading inactive after publish must not provoke a retry via the retired per-trigger write');
  assert.ok(report.verify.issues.some((i) => Array.isArray(i.inactiveTriggers) && i.inactiveTriggers.includes('T')),
    'the failure must name the still-inactive trigger, not just say "publish failed"');
});
