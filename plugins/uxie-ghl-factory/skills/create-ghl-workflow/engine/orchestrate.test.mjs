import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orchestrate } from './orchestrate.mjs';

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
