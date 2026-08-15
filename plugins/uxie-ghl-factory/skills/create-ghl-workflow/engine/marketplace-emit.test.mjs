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

test('the schema-default fill writes the exact declared values, and warns for each', () => {
  n = 0;
  const warnings = [];
  const built = compile(irWith({
    ref: 'a', kind: 'action', marketplace: true, type: 'imessage_a',
    name: 'Send iMessage', attributes: { message: 'hi' },
  }), ctx({ warn: (w) => warnings.push(w) }));
  const attrs = built.autoSaveBody.workflowData.templates[0].attributes;
  // Exact values, not just "the required check didn't throw" — a transposition bug
  // writing the right values to the wrong fields would otherwise pass silently.
  assert.equal(attrs.to_phone, '{{contact.phone_raw}}');
  assert.equal(attrs.conversation_provider, '65f0a76d7aabd6ba4decd979');
  assert.ok(warnings.some((w) => /MARKETPLACE_DEFAULT_FILLED/.test(w) && /to_phone/.test(w)));
  assert.ok(warnings.some((w) => /MARKETPLACE_DEFAULT_FILLED/.test(w) && /conversation_provider/.test(w)));
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

// A required input with NO schema default (message: no `value` key on this action, unlike
// to_phone / conversation_provider) cannot be masked by the auto-fill, so omitting it must
// still fail closed with MARKETPLACE_REQUIRED_FIELD.
test('a required input with no schema default throws MARKETPLACE_REQUIRED_FIELD', () => {
  n = 0;
  assert.throws(() => compile(irWith({
    ref: 'a', kind: 'action', marketplace: true, type: 'imessage_a',
    name: 'Send iMessage', attributes: {},
  }), ctx()), (e) => e.code === 'MARKETPLACE_REQUIRED_FIELD' && /message/.test(e.message));
});

// The shared fixture has no checkbox/numerical default, so this builds its own tiny
// inline schema rather than editing fixtures/marketplace-assets.json. Field defaults
// arrive as strings regardless of declared type (GHL's own convention, see
// action-schema.mjs's coerceDefault) — the fill must coerce by fieldType, not store
// the literal string, or a checkbox/numerical default round-trips as the wrong JS type.
const INLINE_ASSETS = {
  actions: [{
    appName: 'Coerce Co',
    actions: [{
      key: 'coerce_test_action', version: '1.0', templateId: 'TPL-COERCE',
      inputs: [
        { field: 'enabled', title: 'Enabled', required: true, fieldType: 'checkbox', value: 'true' },
        { field: 'count', title: 'Count', required: true, fieldType: 'numerical', value: '5' },
        { field: 'label', title: 'Label', required: true, fieldType: 'string' },
      ],
    }],
  }],
  triggers: [],
};
const INLINE_MODULES = {
  actions: [{
    appId: 'app-coerce', name: 'Coerce Co', companyName: 'Coerce Co', isInstalled: true,
    actions: [{ key: 'coerce_test_action' }],
  }],
  triggers: [],
};

test('a checkbox/numerical schema default is type-coerced, not stored as a raw string', () => {
  n = 0;
  const idx = buildMarketplaceIndex({ assets: INLINE_ASSETS, modules: INLINE_MODULES });
  const built = compile(irWith({
    ref: 'a', kind: 'action', marketplace: true, type: 'coerce_test_action',
    name: 'Coerce Test', attributes: { label: 'x' },
  }), ctx({ marketplace: idx }));
  const attrs = built.autoSaveBody.workflowData.templates[0].attributes;
  assert.equal(attrs.enabled, true);
  assert.equal(typeof attrs.enabled, 'boolean');
  assert.equal(attrs.count, 5);
  assert.equal(typeof attrs.count, 'number');
});

const irTrigger = (trigger) => ({ name: 'wf', triggers: [trigger], graph: [] });

test('a marketplace trigger emits masterType, version and templateId', () => {
  n = 0;
  const built = compile(irTrigger({
    marketplace: true, type: 'imessage_t', name: 'iMessage In',
    filters: [{ field: 'payload.message.text', title: 'Message', type: 'string',
                operator: 'string-contains-any-of', value: ['Book now please'] }],
  }), ctx());
  const t = built.triggerBodies[0];
  assert.equal(t.masterType, 'marketplace');
  assert.equal(t.version, '1.4');
  assert.equal(t.templateId, '01JTG30GR5C99TGPCJA8Z5899R');
});

test('a marketplace condition carries id identical to field', () => {
  n = 0;
  const built = compile(irTrigger({
    marketplace: true, type: 'imessage_t', name: 'iMessage In',
    filters: [{ field: 'payload.message.text', title: 'Message', type: 'string',
                operator: 'string-contains-any-of', value: ['Book now please'] }],
  }), ctx());
  const cond = built.triggerBodies[0].conditions[0];
  assert.equal(cond.id, 'payload.message.text');
  assert.equal(cond.field, 'payload.message.text');
  assert.deepEqual(cond.value, ['Book now please']);
});

test('an operator GHL does not offer is fatal', () => {
  n = 0;
  assert.throws(() => compile(irTrigger({
    marketplace: true, type: 'imessage_t', name: 'iMessage In',
    filters: [{ field: 'payload.message.text', title: 'Message', type: 'string',
                operator: 'eq', value: ['Book now'] }],
  }), ctx()), (e) => e.code === 'MARKETPLACE_FILTER_OPERATOR' && /eq/.test(e.message));
});

test('a marketplace filter with no operator is fatal, not silently unmatched', () => {
  n = 0;
  assert.throws(() => compile(irTrigger({
    marketplace: true, type: 'imessage_t', name: 'iMessage In',
    filters: [{ field: 'payload.message.text', title: 'Message', type: 'string',
                value: ['Book now'] }],
  }), ctx()), (e) => e.code === 'MARKETPLACE_FILTER_OPERATOR' && /operator/i.test(e.message));
});

test('substring-colliding filter values warn but still build', () => {
  n = 0;
  const warnings = [];
  const built = compile({
    name: 'wf', graph: [],
    triggers: [
      { marketplace: true, type: 'imessage_t', name: 'A',
        filters: [{ field: 'payload.message.text', title: 'Message', type: 'string',
                    operator: 'string-contains-any-of', value: ['Book now'] }] },
      { marketplace: true, type: 'imessage_t', name: 'B',
        filters: [{ field: 'payload.message.text', title: 'Message', type: 'string',
                    operator: 'string-contains-any-of', value: ['Book now please'] }] },
    ],
  }, ctx({ warn: (w) => warnings.push(w) }));
  assert.equal(built.triggerBodies.length, 2);
  assert.ok(warnings.some((w) => /Book now/.test(w) && /substring|overlap/i.test(w)));
});

test('a NON-marketplace trigger is untouched', () => {
  n = 0;
  const built = compile(irTrigger({ type: 'contact_tag', name: 'Tagged' }), ctx());
  const t = built.triggerBodies[0];
  assert.equal(t.masterType, 'highlevel');
  assert.equal(t.version, undefined);
  assert.equal(t.templateId, undefined);
});
