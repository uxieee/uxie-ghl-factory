import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { loadCatalog } from './catalog.mjs';
import { buildMarketplaceIndex } from './marketplace.mjs';
import ASSETS from './fixtures/marketplace-assets.json' with { type: 'json' };
import MODULES from './fixtures/marketplace-modules.json' with { type: 'json' };

let n = 0;
const idGen = () => `id-${++n}`;
const marketplace = buildMarketplaceIndex({ assets: ASSETS, modules: MODULES });

const ctx = (over = {}) => ({
  loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0,
  idGen, catalog: loadCatalog(), marketplace, ...over,
});

const irWith = (node) => ({ name: 'wf', triggers: [], graph: [node] });

test('a marketplace action emits isMarketplaceAction and mirrors attributes.type', () => {
  n = 0;
  const built = compile(irWith({
    ref: 'a', kind: 'action', marketplace: true, type: 'imessage_a',
    name: 'Send iMessage', attributes: { message: 'hi' },
  }), ctx());
  const step = built.autoSaveBody.workflowData.templates[0];
  assert.equal(step.isMarketplaceAction, true);
  assert.equal(step.type, 'imessage_a');
  assert.equal(step.attributes.type, 'imessage_a');
  assert.equal(step.attributes.message, 'hi');
});

test('envelope keys survive the attribute-key check', () => {
  n = 0;
  const built = compile(irWith({
    ref: 'a', kind: 'action', marketplace: true, type: 'imessage_a',
    name: 'Send iMessage',
    attributes: { message: 'hi', __customInputs__: {}, __dynamicAttachments__: {} },
  }), ctx());
  const attrs = built.autoSaveBody.workflowData.templates[0].attributes;
  assert.deepEqual(attrs.__customInputs__, {});
  assert.deepEqual(attrs.__dynamicAttachments__, {});
});

test('an attribute key the app does not declare WARNS but still builds', () => {
  n = 0;
  const warnings = [];
  const built = compile(irWith({
    ref: 'a', kind: 'action', marketplace: true, type: 'imessage_a',
    name: 'Send iMessage', attributes: { message: 'hi', connected_phone: '' },
  }), ctx({ warn: (w) => warnings.push(w) }));
  assert.equal(built.autoSaveBody.workflowData.templates[0].attributes.connected_phone, '');
  assert.ok(warnings.some((w) => /connected_phone/.test(w)));
});

// NOTE ON ASSERTION STYLE: this repo asserts error CODES with a predicate, because
// `assert.throws(fn, /X/)` matches the error MESSAGE, and these codes never appear in
// their own message text. Follow compiler.test.mjs:391.
test('an uninstalled app fails closed', () => {
  n = 0;
  const bare = buildMarketplaceIndex({ assets: ASSETS, modules: { actions: [], triggers: [] } });
  assert.throws(() => compile(irWith({
    ref: 'a', kind: 'action', marketplace: true, type: 'imessage_a',
    name: 'Send iMessage', attributes: { message: 'hi' },
  }), ctx({ marketplace: bare })),
    (e) => e.code === 'MARKETPLACE_APP_NOT_INSTALLED' && /not installed/i.test(e.message));
});

test('an unknown marketplace key fails closed', () => {
  n = 0;
  assert.throws(() => compile(irWith({
    ref: 'a', kind: 'action', marketplace: true, type: 'not_a_real_key',
    name: 'X', attributes: {},
  }), ctx()), (e) => e.code === 'MARKETPLACE_KEY_UNKNOWN');
});

test('a node WITHOUT the flag still takes the native path unchanged', () => {
  n = 0;
  const built = compile(irWith({
    ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['x'] },
  }), ctx());
  const step = built.autoSaveBody.workflowData.templates[0];
  assert.equal(step.isMarketplaceAction, undefined);
});
