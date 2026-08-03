// update_contact_field actionType advisory — see contact-field-shapes.mjs for the defect.
// These are ADVISORY warnings, so every test here asserts two things: the warning fired,
// AND the build was not blocked. A regression that turned one of these into a throw would
// break callers who empty-write on purpose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkContactFieldShape, lintContactFieldTemplates, isEmptyFieldValue,
  fieldSuppliesNoValue, CONTACT_FIELD_ACTION_TYPES } from './contact-field-shapes.mjs';
import { compile } from './compiler.mjs';
import { applyOps } from './edit-driver.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const sink = () => { const w = []; const fn = (m) => w.push(m); fn.messages = w; return fn; };
const codes = (warn) => warn.messages.map((m) => m.split(':')[0]);
const field = (over = {}) => ({ field: 'em3R3rToFy8N0oYcJDwE', value: '', title: 'HB Timezone', type: 'string', date: '', ...over });

// ─── the two builder dropdown values ────────────────────────────────────────────────
test('the closed actionType list is exactly what the builder offers', () => {
  assert.deepEqual(CONTACT_FIELD_ACTION_TYPES, ['update_field_data', 'clear_field_data']);
});

// ─── the primary defect: an empty update_field_data that was meant to be a clear ─────
test('update_field_data with every field empty warns CONTACT_FIELD_CLEAR_MISMATCH', () => {
  const warn = sink();
  checkContactFieldShape({ actionType: 'update_field_data', fields: [field()] }, { ref: 'blank', warn });
  assert.deepEqual(codes(warn), ['CONTACT_FIELD_CLEAR_MISMATCH']);
  assert.match(warn.messages[0], /clear_field_data/);
  assert.match(warn.messages[0], /'blank'/, 'names the offending step');
});

test('the real live-found shape reproduces the warning verbatim', () => {
  // The live step found in a client account 2026-08-03: a "blank this field" step that was
  // actually update_field_data with value "". Field names anonymised (public repo).
  const warn = sink();
  checkContactFieldShape(
    { type: 'update_contact_field', actionType: 'update_field_data',
      fields: [{ field: 'call_outcome', value: '', title: 'Call Outcome', type: 'string', date: '' }] },
    { ref: 'Blank call outcome', warn },
  );
  assert.equal(warn.messages.length, 1);
  assert.match(warn.messages[0], /^CONTACT_FIELD_CLEAR_MISMATCH/);
});

test('a partially-empty update_field_data warns CONTACT_FIELD_EMPTY_VALUE, not the clear mismatch', () => {
  const warn = sink();
  checkContactFieldShape({ actionType: 'update_field_data',
    fields: [field({ value: 'real' }), field({ field: 'other', value: '' })] }, { ref: 'x', warn });
  assert.deepEqual(codes(warn), ['CONTACT_FIELD_EMPTY_VALUE']);
  assert.match(warn.messages[0], /1 of 2/);
});

test('a populated update_field_data is silent', () => {
  const warn = sink();
  checkContactFieldShape({ actionType: 'update_field_data', fields: [field({ value: '{{message.body}}' })] }, { ref: 'x', warn });
  assert.deepEqual(warn.messages, []);
});

// GHL's validator exempts ONLY the currentDate sentinel — not an arbitrary date string.
test("date:'currentDate' supplies the value, so an empty value is not flagged", () => {
  const warn = sink();
  checkContactFieldShape({ actionType: 'update_field_data', fields: [field({ value: '', date: 'currentDate' })] }, { ref: 'x', warn });
  assert.deepEqual(warn.messages, []);
});

test('an ISO date does NOT exempt an empty value — the validator only knows currentDate', () => {
  const warn = sink();
  checkContactFieldShape({ actionType: 'update_field_data', fields: [field({ value: '', date: '2026-08-03' })] }, { ref: 'x', warn });
  assert.deepEqual(codes(warn), ['CONTACT_FIELD_CLEAR_MISMATCH']);
});

// ─── the mirror case ────────────────────────────────────────────────────────────────
test('clear_field_data carrying a value warns CONTACT_FIELD_CLEAR_HAS_VALUE', () => {
  const warn = sink();
  checkContactFieldShape({ actionType: 'clear_field_data', fields: [field({ value: 'kept?' })] }, { ref: 'x', warn });
  assert.deepEqual(codes(warn), ['CONTACT_FIELD_CLEAR_HAS_VALUE']);
  assert.match(warn.messages[0], /"kept\?"/, 'quotes the value that will be discarded');
});

test('the harvested clear example is silent — the catalog must not warn on its own example', () => {
  const warn = sink();
  checkContactFieldShape({ actionType: 'clear_field_data', fields: [field()] }, { ref: 'x', warn });
  assert.deepEqual(warn.messages, []);
});

// ─── discriminator edge cases ───────────────────────────────────────────────────────
test('an absent actionType is analysed as the documented default and says so', () => {
  const warn = sink();
  checkContactFieldShape({ fields: [field()] }, { ref: 'x', warn });
  assert.deepEqual(codes(warn), ['CONTACT_FIELD_CLEAR_MISMATCH']);
  assert.match(warn.messages[0], /actionType is absent/);
});

test('an unrecognised actionType warns once and does not also run the value checks', () => {
  const warn = sink();
  checkContactFieldShape({ actionType: 'clear_field', fields: [field()] }, { ref: 'x', warn });
  assert.deepEqual(codes(warn), ['CONTACT_FIELD_ACTION_TYPE_UNKNOWN']);
});

test('an empty fields[] is left to GHL at_least_one_field_required, not warned here', () => {
  const warn = sink();
  checkContactFieldShape({ actionType: 'update_field_data', fields: [] }, { ref: 'x', warn });
  assert.deepEqual(warn.messages, []);
});

test('no warn sink means no work and no throw', () => {
  assert.doesNotThrow(() => checkContactFieldShape({ actionType: 'update_field_data', fields: [field()] }, {}));
});

// ─── emptiness predicate ────────────────────────────────────────────────────────────
test('emptiness follows the validator: null/undefined/"" and [] are empty; " " and 0 are not', () => {
  for (const v of [null, undefined, '', []]) assert.equal(isEmptyFieldValue(v), true, JSON.stringify(v));
  for (const v of [' ', 0, false, 'x', ['a']]) assert.equal(isEmptyFieldValue(v), false, JSON.stringify(v));
});

test('fieldSuppliesNoValue folds in the currentDate exemption', () => {
  assert.equal(fieldSuppliesNoValue({ value: '', date: '' }), true);
  assert.equal(fieldSuppliesNoValue({ value: '', date: 'currentDate' }), false);
  assert.equal(fieldSuppliesNoValue({ value: 'x', date: '' }), false);
});

// ─── build path: the compiler surfaces it through ctx.warn, and does not block ───────
const ctx = (warn) => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27,
  idGen: makeSeededIdGen('a'), catalog: loadCatalog(), warn });
const tagTrigger = { ref: 't', type: 'contact_tag', name: 'T', filters: [] };
const buildOne = (attributes, warn) => compile(
  { name: 'WF', triggers: [tagTrigger], graph: [{ ref: 'u', kind: 'action', type: 'update_contact_field', name: 'Blank it', attributes }] },
  ctx(warn),
);

test('build path warns on the empty write AND still compiles the step', () => {
  const warn = sink();
  const built = buildOne({ actionType: 'update_field_data', fields: [field()] }, warn);
  assert.deepEqual(codes(warn), ['CONTACT_FIELD_CLEAR_MISMATCH']);
  const step = built.autoSaveBody.workflowData.templates.find((t) => t.type === 'update_contact_field');
  assert.ok(step, 'the step was still compiled — this is advisory, not a gate');
  assert.equal(step.attributes.actionType, 'update_field_data', 'the authored intent is emitted untouched');
});

test('build path is silent on a correct clear', () => {
  const warn = sink();
  buildOne({ actionType: 'clear_field_data', fields: [field()] }, warn);
  assert.deepEqual(warn.messages, []);
});

// ─── edit path ──────────────────────────────────────────────────────────────────────
const editCtx = (warn) => ({ ...ctx(warn), companyAge: 0 });

test('edit appendStep warns through the compiler', () => {
  const warn = sink();
  const idGen = makeSeededIdGen('b');
  applyOps([], [{ op: 'appendStep', step: { kind: 'action', type: 'update_contact_field', name: 'Blank it',
    attributes: { actionType: 'update_field_data', fields: [field()] } } }], { ctx: editCtx(warn), idGen });
  assert.deepEqual(codes(warn), ['CONTACT_FIELD_CLEAR_MISMATCH']);
});

// modifyStep never reaches the compiler — this is the path lintContactFieldTemplates covers.
test('modifyStep flipping a clear into an empty write is caught by the templates lint', () => {
  const warn = sink();
  const before = [{ id: 'S1', type: 'update_contact_field', name: 'Blank call outcome', order: 0,
    parentKey: null, next: null,
    attributes: { type: 'update_contact_field', actionType: 'clear_field_data', fields: [field()] } }];
  const { templates, diff } = applyOps(before,
    [{ op: 'modifyStep', stepId: 'S1', attrPatch: { actionType: 'update_field_data' } }],
    { ctx: editCtx(warn), idGen: makeSeededIdGen('c') });
  assert.deepEqual(warn.messages, [], 'modifyStep alone is silent — it bypasses the compiler');
  lintContactFieldTemplates(templates, diff.modifiedSteps, warn);
  assert.deepEqual(codes(warn), ['CONTACT_FIELD_CLEAR_MISMATCH']);
});

test('the templates lint is scoped to the ids it is given', () => {
  const bad = { id: 'S9', type: 'update_contact_field', name: 'untouched',
    attributes: { actionType: 'update_field_data', fields: [field()] } };
  const scoped = sink();
  lintContactFieldTemplates([bad], ['S1'], scoped);
  assert.deepEqual(scoped.messages, [], 'a step this edit did not touch is not warned about');
  const all = sink();
  lintContactFieldTemplates([bad], null, all);
  assert.deepEqual(codes(all), ['CONTACT_FIELD_CLEAR_MISMATCH'], 'null scope means lint everything');
});

test('the templates lint ignores other step types', () => {
  const warn = sink();
  lintContactFieldTemplates([{ id: 'S1', type: 'add_contact_tag', attributes: { tags: [] } }], null, warn);
  assert.deepEqual(warn.messages, []);
});
