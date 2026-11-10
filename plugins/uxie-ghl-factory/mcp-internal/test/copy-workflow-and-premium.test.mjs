import { setPublishMinAgeForTests } from '../core/publish-confirmation.mjs';
// w7: these cases preview and publish in one process. The minimum age (20 s, a same-turn refusal) is lowered for them.
setPublishMinAgeForTests(0);
// copy_workflow_to_location and get_premium_usage (operator-approved 2026-09-23).
// The copy writes into a SECOND account, so the tests pin the target fence, the measured body, and
// that success is the new workflow APPEARING in the target (GHL only queues the copy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = (n) => TOOLS.find((t) => t.name === n);
const WF = { _id: 'W1', name: 'Lead nurture', status: 'published', workflowData: { templates: [{ id: 's1' }, { id: 's2' }] } };

function copyGateway({ appearAfter = 1, copyAppears = true, logResult = null } = {}) {
  const calls = [];
  let listReads = 0, posted = false, logReads = 0;
  const call = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET' && path.startsWith('/workflow/SRC/W1')) return { ok: true, status: 200, json: WF };
    if (method === 'GET' && path.startsWith('/locations/TGT')) return { ok: true, status: 200, json: { location: { name: 'Target Co' } } };
    if (method === 'GET' && path.startsWith('/workflow/TGT/list')) {
      listReads++;
      const rows = [{ _id: 'OLD', name: 'Lead nurture' }, { _id: 'X', name: 'Other' }];
      if (posted && copyAppears && listReads > appearAfter) rows.push({ _id: 'NEW', name: 'Lead nurture' });
      return { ok: true, status: 200, json: { rows, count: rows.length } };
    }
    if (method === 'GET' && path.startsWith('/workflow/TGT/NEW')) return { ok: true, status: 200, json: { ...WF, _id: 'NEW', status: 'draft' } };
    if (method === 'POST' && path === '/workflow/SRC/W1/copy-workflow') { posted = true; return { ok: true, status: 200, json: { error: false, msg: 'Queued to copy Workflow' } }; }
    // GHL's copy log: an older request is always there; this request's row appears once posted.
    if (method === 'GET' && path.startsWith('/workflows/copyWorkflow/statusList')) {
      const logs = [{ requestGroupId: 'OLD-G', workflowId: 'W1', subLocationId: 'TGT', result: 'success', currentStep: 'workflow_clean_and_creation' }];
      // The row trails the copy: 'processing' on its first read after the send, the given result after.
      if (posted && logResult) { logReads++; logs.unshift({ requestGroupId: 'NEW-G', workflowId: 'W1', subLocationId: 'TGT',
        result: logResult === 'success' && logReads < 3 ? 'processing' : logResult, currentStep: logResult === 'success' && logReads >= 3 ? 'workflow_clean_and_creation' : 'create_assets', updatedAt: 'T' }); }
      return { ok: true, status: 200, json: { logs, total: logs.length } };
    }
    if (method === 'GET' && path.startsWith('/workflows/copyWorkflow/internalLogList') && path.includes('requestGroupId=NEW-G')) {
      return { ok: true, status: 200, json: { logs: [{ currentStep: 'create_assets', result: 'failed', message: 'custom field limit reached' }], total: 1 } };
    }
    return { ok: false, status: 404, json: {} };
  };
  return { calls, gw: { uid: 'U1', loc: 'SRC', call } };
}
const deps = (gw, allowed) => ({ makeGw: () => gw, state: { allowedLocations: allowed } });
const args = (extra = {}) => ({ locationId: 'SRC', workflowId: 'W1', targetLocationId: 'TGT', ...extra });

test('copy preview: names source and target, counts same-name workflows already there, sends nothing', async () => {
  const { gw, calls } = copyGateway();
  const r = await tool('copy_workflow_to_location').handler(args(), deps(gw, new Set(['SRC', 'TGT'])));
  assert.equal(r.code, 'CONFIRM_REQUIRED');
  assert.deepEqual(r.data.preview.source, { locationId: 'SRC', workflowId: 'W1', name: 'Lead nurture', status: 'published', steps: 2, triggers: null });
  assert.equal(r.data.preview.target.name, 'Target Co');
  assert.equal(r.data.preview.target.existingWithThisName, 1);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
});

test('copy refuses a target the registration is not bound to, before anything is sent', async () => {
  const { gw, calls } = copyGateway();
  const r = await copyConfirmed({}, deps(gw, new Set(['SRC'])));
  assert.equal(r.code, 'LOCATION_FORBIDDEN');
  assert.equal(calls.length, 0);
});

test('the same refusal holds on the PREVIEW: a foreign or unbound target is neither read nor previewed', async () => {
  const { gw, calls } = copyGateway();
  const foreign = await tool('copy_workflow_to_location').handler(args(), deps(gw, new Set(['SRC'])));
  assert.equal(foreign.code, 'LOCATION_FORBIDDEN');
  const unbound = await tool('copy_workflow_to_location').handler(args(), deps(gw, null));
  assert.equal(unbound.code, 'LOCATION_FORBIDDEN');
  assert.equal(calls.length, 0, 'not even a read reached the gateway');
});

test('a confirmed copy sends the builder\'s body and is proven by the NEW id appearing in the target', async () => {
  const { gw, calls } = copyGateway();
  const r = await copyConfirmed({}, deps(gw, new Set(['SRC', 'TGT'])));
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  const post = calls.find((c) => c.method === 'POST');
  assert.deepEqual(post.body, { userId: 'U1', subLocationId: 'TGT', subLocationName: 'Target Co' });
  assert.equal(r.data.copied.workflowId, 'NEW', 'the pre-existing same-name workflow is never mistaken for the copy');
  assert.equal(r.data.copied.status, 'draft');
  assert.equal(r.data.stepsMatch, true);
});

test('a copy GHL queued but that never appears is reported as NOT done, with a do-not-resend warning (bl-1038: the poll is injected, so it takes no real time)', async () => {
  const { gw } = copyGateway({ copyAppears: false });
  // The production poll is 20 attempts at 1500 ms (30 s). The seam takes the same 20 attempts with a no-op sleep.
  const fast = { sleep: async () => {}, copyPoll: { attempts: 20, intervalMs: 1500 } };
  const t0 = Date.now();
  const r = await copyConfirmed({}, { ...deps(gw, new Set(['SRC', 'TGT'])), ...fast });
  assert.ok(Date.now() - t0 < 1000, `the copy poll must not wait real time under test (took ${Date.now() - t0} ms)`);
  assert.equal(r.ok, false);
  assert.match(r.detail, /queued the copy, but no new workflow/);
  assert.match(r.remediation, /Do not re-send/);
});

test('get_premium_usage reads the three plan tiers verbatim, and one failed tier never hides the others', async () => {
  const usage = { plan: 'x', usage: 3, limit: 10, remaining: 7, percentage: 30, credits: null, resetTime: null };
  const gw = { call: async (m, p) => (p.includes('/growth_tier')
    ? { ok: false, status: 503, json: { message: 'reset' } }
    : { ok: true, status: 200, json: { usage } }) };
  const r = await tool('get_premium_usage').handler({ locationId: 'L' }, { makeGw: () => gw, state: {} });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.starter_tier, { read: true, usage });
  assert.deepEqual(r.data.scale_tier, { read: true, usage });
  assert.equal(r.data.growth_tier.read, false);
  assert.match(r.data.headline, /2 of 3 tier\(s\) read; FAILED: growth_tier/);
});

test('get_premium_usage: the two legacy tier keys still read but carry a note that GHL echoes any string', async () => {
  const usage = { plan: 'x', usage: 0, limit: null, remaining: null, percentage: 0, credits: 0, resetTime: null };
  const gw = { call: async () => ({ ok: true, status: 200, json: { usage } }) };
  const r = await tool('get_premium_usage').handler({ locationId: 'L', tiers: ['workflow_ai', 'starter_tier'] }, { makeGw: () => gw, state: {} });
  assert.equal(r.data.workflow_ai.read, true);
  assert.match(r.data.workflow_ai.note, /proves nothing/);
  assert.equal(r.data.starter_tier.note, undefined);
});

test('a confirmed copy carries GHL\'s own copy-log row for THIS request, not an older one', async () => {
  const { gw } = copyGateway({ logResult: 'success' });
  const r = await copyConfirmed({}, deps(gw, new Set(['SRC', 'TGT'])));
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  assert.equal(r.data.copyLog.requestGroupId, 'NEW-G');
  assert.equal(r.data.copyLog.result, 'success', 'the row is re-read until it leaves processing');
  assert.equal(r.data.copyLog.currentStep, 'workflow_clean_and_creation');
});

test('a copy GHL\'s log marks FAILED is reported at once, with the step and GHL\'s own message', async () => {
  const { gw, calls } = copyGateway({ copyAppears: false, logResult: 'failed' });
  const t0 = Date.now();
  const r = await copyConfirmed({}, deps(gw, new Set(['SRC', 'TGT'])));
  assert.equal(r.ok, false);
  assert.match(r.detail, /marks this copy FAILED at step 'create_assets'/);
  assert.deepEqual(r.data.copyLog.steps, [{ step: 'create_assets', result: 'failed', message: 'custom field limit reached' }]);
  assert.ok(Date.now() - t0 < 10000, 'it did not wait out the 30 s poll');
  assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
});

// bl-946: a confirmed copy is two calls now. The preview call returns the token; the second presents it.
const copyConfirmed = async (extra, dependencies) => {
  const preview = await tool('copy_workflow_to_location').handler(args({ confirm: true, ...extra }), dependencies);
  if (!preview.data?.confirmationToken) return preview;
  return tool('copy_workflow_to_location').handler(args({ confirm: true, ...extra, confirmationToken: preview.data.confirmationToken }), dependencies);
};

// bl-946 (DECISIONS 2026-11-09, part of w6): the copy writes into a second account, so it takes the two-step token gate too.
// confirm:true with no token sends nothing and returns the preview and a token; the token, presented once, copies once.
test('bl-946: copy with confirm:true and NO token sends nothing; the token from the preview copies exactly once', async () => {
  const { gw, calls } = copyGateway();
  const first = await tool('copy_workflow_to_location').handler(args({ confirm: true }), deps(gw, new Set(['SRC', 'TGT'])));
  assert.equal(first.code, 'CONFIRM_REQUIRED', JSON.stringify(first));
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0, 'the first call must not copy');
  assert.equal(typeof first.data.confirmationToken, 'string');
  const second = await tool('copy_workflow_to_location').handler(
    args({ confirm: true, confirmationToken: first.data.confirmationToken }), deps(gw, new Set(['SRC', 'TGT'])));
  assert.equal(calls.filter((c) => c.method === 'POST').length, 1, 'the token copies once');
  assert.ok(second.ok || second.code, 'the second call reaches the copy');
  const replay = await tool('copy_workflow_to_location').handler(
    args({ confirm: true, confirmationToken: first.data.confirmationToken }), deps(gw, new Set(['SRC', 'TGT'])));
  assert.equal(replay.ok, false, 'a spent token must not copy again');
  assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
});
