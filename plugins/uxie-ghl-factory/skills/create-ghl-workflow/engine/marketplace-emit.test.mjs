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

// --- Task 5 fixes: stepIndex, __customInputs__, meta.stepIndexCounter -----------------
//
// Live-confirmed 2026-08-16 (Jing Spa, docs/superpowers/notes/2026-08-16-marketplace-
// live-evidence.md): a stored marketplace step carries a per-action-key stepIndex, and
// the workflow body carries a matching meta.stepIndexCounter map.

// Two marketplace apps with no required inputs, so these tests isolate the
// stepIndex/counter/customInputs behaviour without also exercising the
// required-field/default-fill machinery covered elsewhere in this file.
const COUNTER_ASSETS = {
  actions: [{
    appName: 'WhatsApp Sync',
    actions: [
      { key: 'send_outbound_whatsapp_message', version: '1.0', templateId: 'TPL-WA', inputs: [] },
      { key: 'wait_step', version: '1.0', templateId: 'TPL-WAIT', inputs: [] },
    ],
  }],
  triggers: [],
};
const COUNTER_MODULES = {
  actions: [{
    appId: 'app-counter', name: 'WhatsApp Sync', companyName: 'WhatsApp Sync', isInstalled: true,
    actions: [{ key: 'send_outbound_whatsapp_message' }, { key: 'wait_step' }],
  }],
  triggers: [],
};
const counterMarketplace = buildMarketplaceIndex({ assets: COUNTER_ASSETS, modules: COUNTER_MODULES });

test('a single marketplace step emits stepIndex:1 and meta.stepIndexCounter {key:1}', () => {
  n = 0;
  const built = compile(irWith({
    ref: 'a', kind: 'action', marketplace: true, type: 'send_outbound_whatsapp_message',
    name: 'Send WhatsApp', attributes: {},
  }), ctx({ marketplace: counterMarketplace }));
  const step = built.autoSaveBody.workflowData.templates[0];
  assert.equal(step.stepIndex, 1);
  assert.deepEqual(built.autoSaveBody.meta.stepIndexCounter, { send_outbound_whatsapp_message: 1 });
});

test('per-key stepIndex: two send_outbound_whatsapp_message steps around one wait_step count independently', () => {
  n = 0;
  const built = compile({
    name: 'wf', triggers: [],
    graph: [
      { ref: 'a', kind: 'action', marketplace: true, type: 'send_outbound_whatsapp_message', name: 'A', attributes: {} },
      { ref: 'b', kind: 'action', marketplace: true, type: 'wait_step', name: 'B', attributes: {} },
      { ref: 'c', kind: 'action', marketplace: true, type: 'send_outbound_whatsapp_message', name: 'C', attributes: {} },
    ],
  }, ctx({ marketplace: counterMarketplace }));
  const [stepA, stepB, stepC] = built.autoSaveBody.workflowData.templates;
  // Per-key, not global: B (a different key) does NOT consume a slot from A/C's counter.
  assert.equal(stepA.stepIndex, 1);
  assert.equal(stepB.stepIndex, 1);
  assert.equal(stepC.stepIndex, 2);
  assert.deepEqual(built.autoSaveBody.meta.stepIndexCounter, {
    send_outbound_whatsapp_message: 2,
    wait_step: 1,
  });
});

test('__customInputs__ defaults to {} when the author omits it', () => {
  n = 0;
  const built = compile(irWith({
    ref: 'a', kind: 'action', marketplace: true, type: 'imessage_a',
    name: 'Send iMessage', attributes: { message: 'hi' },
  }), ctx());
  const attrs = built.autoSaveBody.workflowData.templates[0].attributes;
  assert.deepEqual(attrs.__customInputs__, {});
});

test('__customInputs__ is PRESERVED when the author supplies a non-empty value', () => {
  n = 0;
  const built = compile(irWith({
    ref: 'a', kind: 'action', marketplace: true, type: 'imessage_a',
    name: 'Send iMessage',
    attributes: { message: 'hi', __customInputs__: { foo: 'bar' } },
  }), ctx());
  const attrs = built.autoSaveBody.workflowData.templates[0].attributes;
  assert.deepEqual(attrs.__customInputs__, { foo: 'bar' });
});

test('a native-only workflow emits NO meta key on autoSaveBody', () => {
  n = 0;
  const built = compile(irWith({
    ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['x'] },
  }), ctx());
  assert.equal('meta' in built.autoSaveBody, false);
});

// --- contact_engagement_score: the real, observed action/trigger key collision ---------
//
// Measured against the live GHL catalog (319 action keys, 162 trigger keys), 2026-08-16:
// `contact_engagement_score` is the ONE key (of 481 total) that exists as BOTH an action
// (required inputs: operator, points) AND a trigger (0 inputs). Before the kind-aware
// index, `.get(key)` on this key silently resolved to whichever kind was parsed last
// (the trigger), so a marketplace STEP of this key skipped required-field enforcement
// entirely, and a marketplace TRIGGER of a colliding key where the action won emitted the
// wrong templateId. These two tests prove both directions now resolve correctly.
const COLLISION_ASSETS = {
  actions: [{
    appName: 'Engagement Scoring',
    actions: [{
      key: 'contact_engagement_score', version: '2.0', templateId: 'TPL-SCORE-ACTION',
      inputs: [
        { field: 'operator', title: 'Operator', required: true, fieldType: 'string' },
        { field: 'points', title: 'Points', required: true, fieldType: 'numerical' },
      ],
    }],
  }],
  triggers: [{
    appName: 'Engagement Scoring',
    triggers: [{
      key: 'contact_engagement_score', version: '1.0', templateId: 'TPL-SCORE-TRIGGER',
      inputs: [],
    }],
  }],
};
const COLLISION_MODULES = {
  actions: [{
    appId: 'app-score', name: 'Engagement Scoring', companyName: 'Engagement Scoring',
    isInstalled: true, actions: [{ key: 'contact_engagement_score' }],
  }],
  triggers: [{
    appId: 'app-score', name: 'Engagement Scoring', companyName: 'Engagement Scoring',
    isInstalled: true, triggers: [{ key: 'contact_engagement_score' }],
  }],
};
const collisionMarketplace = buildMarketplaceIndex({ assets: COLLISION_ASSETS, modules: COLLISION_MODULES });

test('a marketplace STEP of the colliding key enforces the ACTION\'s required fields', () => {
  n = 0;
  assert.throws(() => compile(irWith({
    ref: 'a', kind: 'action', marketplace: true, type: 'contact_engagement_score',
    name: 'Score', attributes: {},
  }), ctx({ marketplace: collisionMarketplace })),
    (e) => e.code === 'MARKETPLACE_REQUIRED_FIELD'
      && /operator/.test(e.message) && /points/.test(e.message));
});

test('a marketplace STEP of the colliding key builds when the ACTION\'s required fields are supplied', () => {
  n = 0;
  const built = compile(irWith({
    ref: 'a', kind: 'action', marketplace: true, type: 'contact_engagement_score',
    name: 'Score', attributes: { operator: 'add', points: 5 },
  }), ctx({ marketplace: collisionMarketplace }));
  const attrs = built.autoSaveBody.workflowData.templates[0].attributes;
  assert.equal(attrs.operator, 'add');
  assert.equal(attrs.points, 5);
});

test('a marketplace TRIGGER of the colliding key emits the TRIGGER\'s templateId, not the action\'s', () => {
  n = 0;
  const built = compile(irTrigger({
    marketplace: true, type: 'contact_engagement_score', name: 'Score Trigger', filters: [],
  }), ctx({ marketplace: collisionMarketplace }));
  const t = built.triggerBodies[0];
  assert.equal(t.templateId, 'TPL-SCORE-TRIGGER');
  assert.equal(t.version, '1.0');
});

// An author who flags marketplace:true on a STEP using a key that only exists as a
// TRIGGER (imessage_t, from the shared fixture) gets a message explaining the real
// problem — not the generic "no app publishes that key" — because the kind-aware lookup
// can tell the key exists, just under the other kind.
test('a marketplace STEP using a trigger-only key names the real problem, not a generic miss', () => {
  n = 0;
  assert.throws(() => compile(irWith({
    ref: 'a', kind: 'action', marketplace: true, type: 'imessage_t',
    name: 'Wrong Slot', attributes: {},
  }), ctx()), (e) => e.code === 'MARKETPLACE_KEY_UNKNOWN'
    && /published in this location as a\s*marketplace trigger/.test(e.message));
});

// Same in the other direction: a marketplace TRIGGER using an action-only key.
test('a marketplace TRIGGER using an action-only key names the real problem, not a generic miss', () => {
  n = 0;
  assert.throws(() => compile(irTrigger({
    marketplace: true, type: 'imessage_a', name: 'Wrong Slot', filters: [],
  }), ctx()), (e) => e.code === 'MARKETPLACE_KEY_UNKNOWN'
    && /published in this location as a\s*marketplace action/.test(e.message));
});
