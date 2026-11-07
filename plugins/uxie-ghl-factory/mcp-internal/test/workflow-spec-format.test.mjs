// W6 item 2, Task 3: one format in and out. export_workflow {format:'spec'} returns the lifted spec (the build format
// plus `stored`); repair_workflow {spec | specPath} compiles it with the stored ids pinned and goes through the same
// whole-document repair path as {templates}. An unchanged spec repairs to the stored document; an edited attribute
// changes exactly that step. Trigger differences are reported, never written (triggers are a separate document).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TOOLS } from '../core/tools.mjs';
import { compile } from '../../skills/create-ghl-workflow/engine/compiler.mjs';
import { makeSeededIdGen } from '../../skills/create-ghl-workflow/engine/idgen.mjs';
// A synthetic Stripe-shaped key, built at runtime so no source line carries a full key shape (GitHub push protection).
const FAKE_STRIPE = ['sk', 'live', 'abcdefghijklmnopqrstuvwx'].join('_');
import { loadCatalog } from '../../skills/create-ghl-workflow/engine/catalog.mjs';

const tool = (name) => TOOLS.find((t) => t.name === name);
const IR = {
  name: 'Spec door', triggers: [],
  graph: [
    { ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['lead'] } },
    { ref: 'b', kind: 'action', type: 'sms', name: 'Text', attributes: { body: 'hello' } },
  ],
};
function storedDoc() {
  const built = compile(structuredClone(IR), { loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: makeSeededIdGen('d'), catalog: loadCatalog(), warn: () => {} });
  const templates = structuredClone(built.autoSaveBody.workflowData.templates);
  templates.forEach((t, i) => { t.advanceCanvasMeta = { position: { x: i, y: i } }; });
  templates[0].attributes.apiKey = FAKE_STRIPE;       // a stored key the build rail refuses
  return { _id: 'WID', id: 'WID', name: 'Spec door', status: 'draft', version: 3, locationId: 'LOC', workflowData: { templates } };
}
const TRIGGER = { id: 'TR1', type: 'contact_tag', name: 'Tagged', conditions: [{ field: 'tagsAdded', operator: 'index-of-true', value: 'go', title: 'Tag Added', type: 'select', id: 'tag-added' }] };

function gateway(doc = storedDoc()) {
  const calls = [];
  let stored = structuredClone(doc);
  const gw = {
    loc: 'LOC', uid: 'USER', rail: 'jwt',
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (method === 'GET' && path.startsWith('/workflows/sticky-notes-all')) return { ok: true, status: 200, json: { data: [], count: 0 } };
      if (method === 'GET' && path.includes('/trigger')) return { ok: true, status: 200, json: { triggers: [structuredClone(TRIGGER)] } };
      if (method === 'POST' && path === '/workflow/LOC/validate-assets') return { ok: true, status: 200, json: { errors: [], warnings: [] } };
      if (method === 'GET' && path.includes('/workflows-marketplace/')) return { ok: true, status: 200, json: { actions: [], triggers: [] } };
      if (method === 'GET' && path.includes('/customFields/search')) return { ok: true, status: 200, json: { customFields: [] } };
      if (method === 'GET' && path === '/locations/LOC/customValues') return { ok: true, status: 200, json: { customValues: [] } };
      if (method === 'GET' && path.startsWith('/phone-system/numbers')) return { ok: true, status: 200, json: { phoneNumbers: [] } };
      if (method === 'GET' && path.startsWith('/workflow/LOC/WID')) return { ok: true, status: 200, json: structuredClone(stored) };
      if (method === 'PUT' && path.startsWith('/workflow/LOC/WID')) { stored = { ...stored, ...structuredClone(body), version: stored.version + 1 }; return { ok: true, status: 200, json: structuredClone(stored) }; }
      return { ok: false, status: 404, json: {} };
    },
  };
  return { gw, calls, stored: () => stored };
}
const deps = (gw) => ({ state: {}, makeGw: () => gw });
const exportSpec = async (gw, extra = {}) => tool('export_workflow').handler({ locationId: 'LOC', workflowId: 'WID', format: 'spec', ...extra }, deps(gw));
const repair = (gw, extra) => tool('repair_workflow').handler({ locationId: 'LOC', workflowId: 'WID', ...extra }, deps(gw));

test('export_workflow {format:"spec"} returns the build format, every step named by its stored id', async () => {
  const { gw } = gateway();
  const r = await exportSpec(gw);
  assert.equal(r.ok, true, r.detail);
  const ids = storedDoc().workflowData.templates.map((t) => t.id);
  assert.deepEqual(r.data.spec.graph.map((n) => n.ref), ids);
  assert.ok(r.data.spec.stored?.pins, 'carries the stored layer');
  assert.deepEqual(r.data.spec.triggers.map((t) => t.ref), ['TR1']);
  assert.deepEqual(r.data.spec.triggers[0].filters, TRIGGER.conditions, 'stored conditions come back as filters, verbatim');
  assert.ok(Array.isArray(r.data.lift.frozen));
});

test('the spec export redacts a credential carried in the residual, not only under a key name', async () => {
  const r = await exportSpec(gateway().gw);
  assert.equal(r.ok, true);
  assert.ok(!JSON.stringify(r).includes(FAKE_STRIPE), 'the stored apiKey value must not leave in the residual');
  const entries = Object.values(r.data.spec.stored.residual).flat();
  assert.ok(entries.some((e) => e.p.at(-1) === 'apiKey' && e.t === '<redacted>'), 'the residual carries the key, its value redacted');
});

test('format:"spec" with stepIds is refused: a spec is the whole workflow', async () => {
  const r = await exportSpec(gateway().gw, { stepIds: ['x'] });
  assert.equal(r.ok, false);
  assert.match(r.detail, /whole workflow/);
});

const cleanSpec = async () => {
  // The spec as exported, with the redacted residual value restored the way an operator would before writing back.
  const doc = storedDoc();
  const r = await exportSpec(gateway(doc).gw);
  const spec = structuredClone(r.data.spec);
  for (const entries of Object.values(spec.stored.residual)) for (const e of entries) if (e.t === '<redacted>') e.t = FAKE_STRIPE;
  return { spec, doc };
};

test('repair_workflow {spec} unchanged: the preview changes no step', async () => {
  const { spec, doc } = await cleanSpec();
  const path = join(mkdtempSync(join(tmpdir(), 'spec-')), 'spec.json');
  writeFileSync(path, JSON.stringify({ spec }));
  const r = await repair(gateway(doc).gw, { specPath: path });
  assert.equal(r.code, 'CONFIRM_REQUIRED', r.detail);
  assert.deepEqual(r.data.preview.diff, { createdSteps: [], modifiedSteps: [], deletedSteps: [] });
});

test('repair_workflow {spec} with one edited attribute changes exactly that step, keeps the rest as stored', async () => {
  const { spec, doc } = await cleanSpec();
  const textId = doc.workflowData.templates[1].id;
  spec.graph.find((n) => n.ref === textId).attributes.body = 'hello again';
  const path = join(mkdtempSync(join(tmpdir(), 'spec-')), 'spec.json');
  writeFileSync(path, JSON.stringify(spec));
  const g = gateway(doc);
  const r = await repair(g.gw, { specPath: path, confirm: true });
  assert.equal(r.ok, true, r.detail);
  const after = g.stored().workflowData.templates;
  assert.equal(after.find((t) => t.id === textId).attributes.body, 'hello again');
  assert.deepEqual(after.find((t) => t.id === textId).advanceCanvasMeta, doc.workflowData.templates[1].advanceCanvasMeta);
  assert.deepEqual(after[0], doc.workflowData.templates[0], 'the untouched step is written back exactly as stored');
});

test('a trigger change in the spec is reported, not written', async () => {
  const { spec, doc } = await cleanSpec();
  spec.triggers[0].filters[0].value = 'changed';
  const path = join(mkdtempSync(join(tmpdir(), 'spec-')), 'spec.json');
  writeFileSync(path, JSON.stringify(spec));
  const g = gateway(doc);
  const r = await repair(g.gw, { specPath: path });
  assert.equal(r.code, 'CONFIRM_REQUIRED', r.detail);
  assert.equal(r.data.preview.triggerDifferences.length, 1);
  assert.match(r.data.preview.triggerDifferences[0].note, /edit_workflow/);
  assert.equal(g.calls.some((c) => c.method !== 'GET' && c.path.includes('/trigger')), false);
});

test('repair_workflow refuses spec together with templates, and a spec with no stored layer', async () => {
  const { spec, doc } = await cleanSpec();
  const plain = doc.workflowData.templates.map((t) => { const c = structuredClone(t); delete c.attributes.apiKey; return c; });   // inline: no credential
  const both = await repair(gateway(doc).gw, { spec: { name: 'x', triggers: [], graph: [] }, templates: plain });
  assert.equal(both.ok, false);
  assert.match(both.detail, /either/);
  const bare = await repair(gateway(doc).gw, { spec: { name: 'x', triggers: [], graph: spec.graph.map(({ stepIndex, ...n }) => n) } });
  assert.equal(bare.ok, false);
  assert.match(bare.detail, /format:'spec'/);
});

// Final review W6b (I1): repair and edit refuse the redaction placeholder; the build door did not, though it now takes an
// exported spec "as it is". A Bearer header exported as <redacted> would be stored as that literal string.
test('build_workflow refuses a spec still carrying the redaction placeholder, before any request', async () => {
  const calls = [];
  const gw = { loc: 'LOC', uid: 'U', rail: 'jwt', call: async (m, p) => { calls.push([m, p]); return { ok: true, status: 200, json: {} }; } };
  const spec = { name: 'Copy', triggers: [], graph: [{ ref: 'w', kind: 'action', type: 'custom_webhook', name: 'Hook',
    attributes: { method: 'POST', url: 'https://example.invalid/h', headers: [{ key: 'X-Hook-Secret', value: '<redacted>' }] } }] };
  const r = await tool('build_workflow').handler({ locationId: 'LOC', spec }, deps(gw));
  assert.equal(r.ok, false);
  assert.match(r.detail, /redaction placeholder/);
  assert.deepEqual(calls, []);
});
