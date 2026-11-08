// wf-5 (bl-839): get_workflow_linked_assets, the Workflow Maps "what uses what" read. RED first.
// The request is the one the Workflow Maps page sent on 2026-11-08 (captured: knowledge sniffs/workflows-wf5-2026-11-08/wf5-map-capture.json):
// POST /workflows/es/linked-assets with the 37 asset types below, pageLimit 500 (this test asks for the default 100, the corpus-proven size),
// and includeWorkflowsWithoutAssets true (the page's setting; the tool defaults to false, so an impact question lists only workflows that use
// an asset). Paging: send the previous searchAfter back, until the rows reach count. A page that adds nothing, or an empty searchAfter, stops.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { makeLinkedAssetsTools } from '../core/workflow-linked-assets.mjs';

const describe = (_t, fallback) => fallback;
const schema = (shape) => z.object(shape).passthrough();
const guard = (fn) => fn();
const tool = (name) => makeLinkedAssetsTools({ describe, schema, guard }).find((t) => t.name === name);
const LOC = 'TEST_LOCATION_ID';

// The page's asset-type list, copied from the 2026-11-08 capture (wf5-map-capture.json, linkedAssetsCaptures[0].body.assetTypes).
const CAPTURED_ASSET_TYPES = ['tags', 'forms', 'calendars', 'surveys', 'facebookForms', 'tikTokForms', 'triggerLinks', 'users', 'pipelines',
  'pipelineStages', 'funnels', 'funnelPages', 'funnelProducts', 'globalProducts', 'globalProductPrices', 'membershipOffers', 'membershipProducts',
  'membershipCategories', 'videos', 'templates', 'quizzes', 'certificateTemplates', 'customValues', 'contactCustomFields', 'opportunityCustomFields',
  'invoiceTemplates', 'customObjects', 'adAccounts', 'membershipLessons', 'workflowLinks', 'estimateTemplates', 'aiStudioProjects', 'services',
  'listings', 'listingCategories', 'chatWidgets', 'facebookPages'];

// A simulated route holding `total` workflows, each using one tag. It honours pageLimit and searchAfter; the cursor is [epoch, index].
function serverOf(total, { ignoreSearchAfter = false, withForm = false } = {}) {
  const calls = [];
  const rows = Array.from({ length: total }, (_, i) => ({
    id: `wf${i}`, name: `Workflow ${i}`, deleted: false, status: 'published', version: 1, parentId: 'folder1', updatedAt: 1794000000000 + i,
    workflowNote: null,
    linkedAssets: {
      trigger: [],
      action: [
        { stepId: `s${i}`, name: 'Add tag', docKey: 'add_contact_tag', type: 'tags', values: [{ id: `t${i % 3}`, name: i % 3 === 0 ? 'vip' : 'lead' }], attributes: {} },
        ...(withForm && i % 2 === 0 ? [{ stepId: `f${i}`, name: 'Form submitted', docKey: 'form_submitted', type: 'forms', values: [{ id: 'form-A', name: 'Intake form' }], attributes: {} }] : []),
      ],
    },
  }));
  const gw = {
    async call(method, path, body) {
      calls.push({ method, path, body });
      const start = body.searchAfter ? (ignoreSearchAfter ? 0 : Number(body.searchAfter[1])) : 0;
      const page = rows.slice(start, start + body.pageLimit);
      const next = start + page.length;
      return { ok: true, status: 201, json: { count: total, workflows: page,
        searchAfter: page.length && next < total ? [page[page.length - 1].updatedAt, next] : null } };
    },
  };
  return { calls, deps: { makeGw: () => gw, state: {} } };
}

test('the tool is registered and reads by POST to the linked-assets route', () => {
  assert.ok(tool('get_workflow_linked_assets'), 'get_workflow_linked_assets must be registered');
});

test('the first request is the page\'s own body: locationId, the 37 captured asset types, pageLimit 100, no searchAfter', async () => {
  const { calls, deps } = serverOf(3);
  await tool('get_workflow_linked_assets').handler({ locationId: LOC }, deps);
  const b = calls[0].body;
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].path, '/workflows/es/linked-assets');
  assert.equal(b.locationId, LOC);
  assert.deepEqual(b.assetTypes, CAPTURED_ASSET_TYPES, 'the asset-type list is the page\'s (the capture)');
  assert.equal(b.pageLimit, 100);
  assert.equal(b.searchAfter, undefined);
  assert.equal(b.includeWorkflowsWithoutAssets, false, 'an impact question lists only workflows that use an asset by default');
});

test('includeWorkflowsWithoutAssets true is sent as true (the page\'s setting; the answer then adds asset-less workflows), and false is sent as false', async () => {
  const on = serverOf(3);
  await tool('get_workflow_linked_assets').handler({ locationId: LOC, includeWorkflowsWithoutAssets: true }, on.deps);
  assert.equal(on.calls[0].body.includeWorkflowsWithoutAssets, true);
  const off = serverOf(3);
  await tool('get_workflow_linked_assets').handler({ locationId: LOC, includeWorkflowsWithoutAssets: false }, off.deps);
  assert.equal(off.calls[0].body.includeWorkflowsWithoutAssets, false);
});

test('paging sends the previous searchAfter back and stops when the rows reach count (250 = three pages, no fourth)', async () => {
  const { calls, deps } = serverOf(250);
  const out = await tool('get_workflow_linked_assets').handler({ locationId: LOC }, deps);
  assert.equal(out.ok, true);
  assert.equal(out.data.workflows.length, 250);
  assert.equal(out.data.count, 250);
  assert.equal(out.data.complete, true);
  assert.equal(calls.length, 3, 'exactly three pages');
  assert.deepEqual(calls[1].body.searchAfter, [1794000000000 + 99, 100], 'page two carries the cursor from page one');
});

test('an empty searchAfter ends the walk; with rows short of count the answer is not complete', async () => {
  const { calls, deps } = serverOf(250);
  const gw = deps.makeGw();
  const original = gw.call;
  gw.call = async (m, p, b) => { const r = await original(m, p, b); r.json.searchAfter = null; return r; };   // the route ends the walk after page one
  const out = await tool('get_workflow_linked_assets').handler({ locationId: LOC }, { makeGw: () => gw, state: {} });
  assert.equal(out.data.complete, false);
  assert.equal(out.data.workflows.length, 100, 'the rows read so far are kept (page one); the answer says it is incomplete');
});

test('a service that ignores searchAfter cannot loop: a page that adds nothing new stops the walk, and the answer is not complete', async () => {
  const { calls, deps } = serverOf(250, { ignoreSearchAfter: true });
  const out = await tool('get_workflow_linked_assets').handler({ locationId: LOC }, deps);
  assert.ok(calls.length <= 3, `the walk must stop, got ${calls.length} requests`);
  assert.equal(out.data.complete, false);
  assert.equal(out.data.workflows.length, 100, 'rows are de-duplicated by id');
});

test('workflowIds narrows the read and is sent as given; the named workflow comes back even when it uses no asset', async () => {
  const { calls, deps } = serverOf(5);
  await tool('get_workflow_linked_assets').handler({ locationId: LOC, workflowIds: ['wf2'] }, deps);
  assert.deepEqual(calls[0].body.workflowIds, ['wf2']);
});

test('per workflow, the result lists the assets it uses by step: stepId, docKey, type and values', async () => {
  const { deps } = serverOf(2, { withForm: true });
  const out = await tool('get_workflow_linked_assets').handler({ locationId: LOC }, deps);
  const wf0 = out.data.workflows.find((w) => w.id === 'wf0');
  assert.equal(wf0.name, 'Workflow 0');
  assert.deepEqual(wf0.uses.map((u) => u.type).sort(), ['forms', 'tags']);
  const tag = wf0.uses.find((u) => u.type === 'tags');
  assert.deepEqual(tag, { stepId: 's0', stepName: 'Add tag', docKey: 'add_contact_tag', type: 'tags', values: [{ id: 't0', name: 'vip' }] });
});

test('forAsset keeps only the workflows that use the asset (by type and by value id or name, case-insensitive)', async () => {
  const { deps } = serverOf(6);
  const byName = await tool('get_workflow_linked_assets').handler({ locationId: LOC, forAsset: { type: 'tags', value: 'VIP' } }, deps);
  assert.deepEqual(byName.data.workflows.map((w) => w.id).sort(), ['wf0', 'wf3']);
  const { deps: d2 } = serverOf(6);
  const byId = await tool('get_workflow_linked_assets').handler({ locationId: LOC, forAsset: { type: 'tags', value: 't1' } }, d2);
  assert.deepEqual(byId.data.workflows.map((w) => w.id).sort(), ['wf1', 'wf4']);
});

test('pageLimit is capped at 500 (the page sent 500; the corpus recorded a cap of 100 on 2026-09-29, both answered 201)', async () => {
  const { calls, deps } = serverOf(3);
  await tool('get_workflow_linked_assets').handler({ locationId: LOC, pageLimit: 9999 }, deps);
  assert.equal(calls[0].body.pageLimit, 500);
});

test('a non-2xx page is reported as the route error, and is not retried', async () => {
  const gw = { calls: 0, async call() { this.calls += 1; return { ok: false, status: 500, json: 'Internal Server Error' }; } };
  const out = await tool('get_workflow_linked_assets').handler({ locationId: LOC }, { makeGw: () => gw, state: {} });
  assert.equal(out.ok, false);
  assert.equal(gw.calls, 1, 'no retry');
});
