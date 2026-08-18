// retypeStep + the marketplace edit rail.
//
// The migration these exist for: converting a native `sms` step into a third-party
// marketplace action (goghl.ai WhatsApp) INSIDE a workflow that already exists and already
// has contacts walking it. The whole safety argument is that the step's graph fields never
// move — so that is what most of these assert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  retypeStep, editCommitBody, assignMarketplaceStepIndexes, marketplaceStepIndexCounter,
  RETYPE_PRESERVED_FIELDS,
} from './edit.mjs';
import { applyOps, opsUseMarketplace } from './edit-driver.mjs';
import { loadCatalog } from './catalog.mjs';
import { buildMarketplaceIndex } from './marketplace.mjs';
import ASSETS from './fixtures/marketplace-assets.json' with { type: 'json' };
import MODULES from './fixtures/marketplace-modules.json' with { type: 'json' };

let n = 0;
const idGen = () => `id-${++n}`;
const marketplace = buildMarketplaceIndex({ assets: ASSETS, modules: MODULES });
const ctx = (over = {}) => ({
  loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0,
  idGen, catalog: loadCatalog(), marketplace, warn: () => {}, ...over,
});

// Two native sms steps in a chain, the shape a harvested client workflow arrives in.
const smsWorkflow = () => [
  { id: 's1', type: 'sms', name: 'Instant SMS', next: 's2', parent: null, parentKey: null, order: 0,
    attributes: { body: 'Hi {{contact.first_name}}' } },
  { id: 's2', type: 'wait', name: 'Wait', next: 's3', parent: null, parentKey: 's1', order: 1,
    attributes: { duration: '1', unit: 'hours' } },
  { id: 's3', type: 'sms', name: 'Follow-up SMS', next: null, parent: null, parentKey: 's2', order: 2,
    attributes: { body: 'Still there?', attachments: [] } },
];

const waOp = (stepId, message, name) => ({
  op: 'retypeStep', stepId,
  step: { kind: 'action', marketplace: true, type: 'imessage_a', name,
    attributes: { message, attachment: '', connected_phone: '', __dynamicAttachments__: {}, __customInputs__: {} } },
});

test('a retype preserves every graph field byte-for-byte', () => {
  n = 0;
  const before = smsWorkflow();
  const { templates } = applyOps(before, [waOp('s1', 'Hi there', 'Instant WhatsApp')], { ctx: ctx(), idGen });
  const after = templates.find((t) => t.id === 's1');
  for (const field of RETYPE_PRESERVED_FIELDS)
    assert.equal(JSON.stringify(after[field]), JSON.stringify(before[0][field]), `graph field '${field}' moved`);
  assert.equal(templates.length, before.length, 'step count changed');
  // Everything else in the graph is untouched too — no delete-and-reinsert anywhere.
  assert.deepEqual(templates.filter((t) => t.id !== 's1'), before.slice(1));
});

test('a retype REPLACES attributes — no stale key from the old type survives', () => {
  n = 0;
  // s3 carries BOTH of the native sms keys (`body` and `attachments`), which is the shape a
  // merge would leave stranded beside the new `message`.
  const { templates } = applyOps(smsWorkflow(), [waOp('s3', 'Hi there', 'Follow-up WhatsApp')], { ctx: ctx(), idGen });
  const attrs = templates.find((t) => t.id === 's3').attributes;
  assert.equal('body' in attrs, false, 'the sms body survived the retype — attributes were merged, not replaced');
  assert.equal('attachments' in attrs, false, 'the sms attachments key survived the retype');
  // Every authored key is present. (The fixture app also declares schema DEFAULTS for
  // to_phone/conversation_provider, which the compiler fills and warns about — the real
  // goghl.ai WhatsApp action declares none, so live it stores exactly these six.)
  for (const k of ['__customInputs__', '__dynamicAttachments__', 'attachment', 'connected_phone', 'message', 'type'])
    assert.ok(k in attrs, `authored key '${k}' is missing`);
  assert.equal(attrs.message, 'Hi there');
  assert.equal(attrs.type, 'imessage_a');
});

test('a retype emits the marketplace step shape', () => {
  n = 0;
  const { templates, diff } = applyOps(smsWorkflow(), [waOp('s1', 'Hi there', 'Instant WhatsApp')], { ctx: ctx(), idGen });
  const step = templates.find((t) => t.id === 's1');
  assert.equal(step.type, 'imessage_a');
  assert.equal(step.name, 'Instant WhatsApp');
  assert.equal(step.isMarketplaceAction, true);
  assert.equal(step.stepIndex, 1);
  assert.deepEqual(diff, { createdSteps: [], modifiedSteps: ['s1'], deletedSteps: [] });
});

test('retypeStep refuses a step with no attributes replacement', () => {
  n = 0;
  assert.throws(
    () => applyOps(smsWorkflow(), [{ op: 'retypeStep', stepId: 's1', step: { type: 'sms', name: 'x' } }], { ctx: ctx(), idGen }),
    /needs a full 'attributes' object/);
});

test('retypeStep accepts an explicit empty attributes object', () => {
  n = 0;
  const { templates } = applyOps(smsWorkflow(),
    [{ op: 'retypeStep', stepId: 's1', step: { kind: 'action', type: 'remove_from_workflow', name: 'Stop', attributes: {} } }],
    { ctx: ctx(), idGen });
  assert.equal(templates.find((t) => t.id === 's1').type, 'remove_from_workflow');
});

test('retypeStep refuses a container step (its next[] is branch wiring)', () => {
  n = 0;
  const templates = [{ id: 'c1', type: 'if_else', name: 'Split', next: ['b1', 'b2'], parentKey: null, order: 0, attributes: {} }];
  assert.throws(() => retypeStep(templates, 'c1', { id: 'x', type: 'sms', attributes: {} }), /is a container/);
});

test('retypeStep drops a top-level structural field the OLD type carried', () => {
  n = 0;
  const before = [{ id: 's1', type: 'internal_notification', name: 'Notify', next: null, parentKey: null, order: 0,
    workflowsActionType: 'INTERNAL', attributes: { subject: 'x' } }];
  const { templates } = applyOps(before, [waOp('s1', 'Hi', 'WA')], { ctx: ctx(), idGen });
  assert.equal('workflowsActionType' in templates[0], false,
    'a structural field from the old type was inherited by the new one');
});

test('retypeStep carries the native pause flag across — a disabled step stays disabled', () => {
  n = 0;
  const before = [{ id: 's1', type: 'sms', name: 'Instant SMS', next: null, parentKey: null, order: 0,
    advanceCanvasMeta: { isDisabled: true }, attributes: { body: 'hi' } }];
  const { templates } = applyOps(before, [waOp('s1', 'Hi', 'WA')], { ctx: ctx(), idGen });
  assert.deepEqual(templates[0].advanceCanvasMeta, { isDisabled: true });
});

test('retypeStep still enforces the app\'s required inputs', () => {
  n = 0;
  // to_phone/message are required on the fixture app; a blank message must fail closed
  // exactly as it does on the build path.
  assert.throws(
    () => applyOps(smsWorkflow(), [waOp('s1', '', 'WA')], { ctx: ctx(), idGen }),
    (e) => e.code === 'MARKETPLACE_REQUIRED_FIELD');
});

test('a marketplace key that resolves to nothing fails closed on the edit path too', () => {
  n = 0;
  const empty = buildMarketplaceIndex({ assets: null, modules: { actions: [], triggers: [] } });
  assert.throws(
    () => applyOps(smsWorkflow(), [waOp('s1', 'hi', 'WA')], { ctx: ctx({ marketplace: empty }), idGen }),
    (e) => e.code === 'MARKETPLACE_KEY_UNKNOWN');
});

// --- stepIndex: the per-action-key occurrence counter -----------------------------------

test('two retypes of the same key number 1 and 2, not 1 and 1', () => {
  n = 0;
  const { templates } = applyOps(smsWorkflow(),
    [waOp('s1', 'Hi', 'Instant WhatsApp'), waOp('s3', 'Still there?', 'Follow-up WhatsApp')],
    { ctx: ctx(), idGen });
  assert.equal(templates.find((t) => t.id === 's1').stepIndex, 1);
  assert.equal(templates.find((t) => t.id === 's3').stepIndex, 2);
});

test('a new marketplace step is numbered against the ones ALREADY stored', () => {
  n = 0;
  const before = [
    { id: 'm1', type: 'imessage_a', name: 'WA one', isMarketplaceAction: true, stepIndex: 1,
      next: 's2', parentKey: null, order: 0, attributes: { type: 'imessage_a', message: 'a' } },
    { id: 's2', type: 'sms', name: 'SMS', next: null, parentKey: 'm1', order: 1, attributes: { body: 'b' } },
  ];
  const { templates } = applyOps(before, [waOp('s2', 'b', 'WA two')], { ctx: ctx(), idGen });
  assert.equal(templates.find((t) => t.id === 'm1').stepIndex, 1);
  assert.equal(templates.find((t) => t.id === 's2').stepIndex, 2,
    'the retyped step kept the standalone compile\'s stepIndex:1 and collided with the stored step');
});

test('assignMarketplaceStepIndexes counts per KEY, not globally', () => {
  const { templates, counter } = assignMarketplaceStepIndexes([
    { id: 'a', type: 'key_x', isMarketplaceAction: true },
    { id: 'b', type: 'wait' },
    { id: 'c', type: 'key_y', isMarketplaceAction: true },
    { id: 'd', type: 'key_x', isMarketplaceAction: true },
  ]);
  assert.deepEqual(templates.map((t) => t.stepIndex), [1, undefined, 1, 2]);
  assert.deepEqual(Object.fromEntries(counter), { key_x: 2, key_y: 1 });
});

test('a step whose stepIndex moved is reported as modified', () => {
  n = 0;
  // A stored WA step mis-numbered 7. Retyping the sms beside it renumbers both, and the
  // repaired one must be listed for the server to persist it.
  const before = [
    { id: 'm1', type: 'imessage_a', name: 'WA', isMarketplaceAction: true, stepIndex: 7,
      next: 's2', parentKey: null, order: 0, attributes: { type: 'imessage_a', message: 'a' } },
    { id: 's2', type: 'sms', name: 'SMS', next: null, parentKey: 'm1', order: 1, attributes: { body: 'b' } },
  ];
  const { templates, diff } = applyOps(before, [waOp('s2', 'b', 'WA two')], { ctx: ctx(), idGen });
  assert.equal(templates.find((t) => t.id === 'm1').stepIndex, 1);
  assert.deepEqual(diff.modifiedSteps.sort(), ['m1', 's2']);
});

test('a purely native edit never renumbers marketplace steps it did not touch', () => {
  n = 0;
  const before = [
    { id: 'm1', type: 'imessage_a', name: 'WA', isMarketplaceAction: true, stepIndex: 7,
      next: 's2', parentKey: null, order: 0, attributes: { type: 'imessage_a', message: 'a' } },
    { id: 's2', type: 'sms', name: 'SMS', next: null, parentKey: 'm1', order: 1, attributes: { body: 'b' } },
  ];
  const { templates, diff } = applyOps(before, [{ op: 'renameStep', stepId: 's2', name: 'Renamed' }], { ctx: ctx(), idGen });
  assert.equal(templates.find((t) => t.id === 'm1').stepIndex, 7);
  assert.deepEqual(diff.modifiedSteps, ['s2']);
});

// --- meta.stepIndexCounter -------------------------------------------------------------

const freshWf = (templates, over = {}) => ({
  _id: 'WID', id: 'WID', name: 'wf', status: 'draft', version: 3,
  workflowData: { templates }, ...over,
});

test('the commit body carries meta.stepIndexCounter as a HIGH-WATER MARK', () => {
  n = 0;
  const { templates, diff } = applyOps(smsWorkflow(),
    [waOp('s1', 'Hi', 'WA one'), waOp('s3', 'Bye', 'WA two')], { ctx: ctx(), idGen });
  const body = editCommitBody(freshWf(smsWorkflow()), templates, diff, 'UID');
  assert.deepEqual(body.meta.stepIndexCounter, { imessage_a: 2 });
});

test('the counter is never ACCUMULATED onto the stored value across re-runs', () => {
  n = 0;
  // The live failure mode this guards: a stored counter of 12 plus 12 more steps read back as 24.
  const { templates, diff } = applyOps(smsWorkflow(),
    [waOp('s1', 'Hi', 'WA one'), waOp('s3', 'Bye', 'WA two')], { ctx: ctx(), idGen });
  const body = editCommitBody(
    freshWf(smsWorkflow(), { meta: { stepIndexCounter: { imessage_a: 12 } } }), templates, diff, 'UID');
  assert.equal(body.meta.stepIndexCounter.imessage_a, 2);
});

test('an unrelated stored meta key survives the merge', () => {
  n = 0;
  const { templates, diff } = applyOps(smsWorkflow(), [waOp('s1', 'Hi', 'WA')], { ctx: ctx(), idGen });
  const body = editCommitBody(
    freshWf(smsWorkflow(), { meta: { somethingElse: 'keep', stepIndexCounter: { other_key: 4 } } }),
    templates, diff, 'UID');
  assert.equal(body.meta.somethingElse, 'keep');
  assert.equal(body.meta.stepIndexCounter.other_key, 4);
  assert.equal(body.meta.stepIndexCounter.imessage_a, 1);
});

test('a native-only edit adds no meta key at all', () => {
  n = 0;
  const { templates, diff } = applyOps(smsWorkflow(), [{ op: 'renameStep', stepId: 's1', name: 'Renamed' }], { ctx: ctx(), idGen });
  const body = editCommitBody(freshWf(smsWorkflow()), templates, diff, 'UID');
  assert.equal('meta' in body, false);
});

test('marketplaceStepIndexCounter reads the high-water mark off templates', () => {
  assert.deepEqual(Object.fromEntries(marketplaceStepIndexCounter([
    { id: 'a', type: 'k', isMarketplaceAction: true, stepIndex: 1 },
    { id: 'b', type: 'k', isMarketplaceAction: true, stepIndex: 5 },
    { id: 'c', type: 'sms' },
  ])), { k: 5 });
});

// --- the marketplace fetch gate --------------------------------------------------------

test('opsUseMarketplace is false for a purely native edit', () => {
  assert.equal(opsUseMarketplace([
    { op: 'renameStep', stepId: 's1', name: 'x' },
    { op: 'appendStep', step: { type: 'sms', name: 'SMS', attributes: { body: 'hi' } } },
  ]), false);
});

test('opsUseMarketplace finds a flag nested inside an added container\'s branch', () => {
  assert.equal(opsUseMarketplace([{
    op: 'appendStep',
    step: { type: 'if_else', name: 'Split', branches: [
      { name: 'yes', then: [{ marketplace: true, type: 'imessage_a', attributes: {} }] },
    ] },
  }]), true);
});

test('opsUseMarketplace does NOT fire on the literal text inside an attribute string', () => {
  // A pasted JSON body in a custom_webhook step is a string, not a node — this is why the
  // gate walks the subgraph instead of scanning the serialized ops.
  assert.equal(opsUseMarketplace([{
    op: 'appendStep',
    step: { type: 'custom_webhook', name: 'Hook',
      attributes: { body: '{"marketplace":true,"note":"just a payload"}' } },
  }]), false);
});

test('opsUseMarketplace sees a marketplace TRIGGER op', () => {
  assert.equal(opsUseMarketplace([
    { op: 'addTrigger', trigger: { marketplace: true, type: 'imessage_t', name: 'Inbound' } },
  ]), true);
});
