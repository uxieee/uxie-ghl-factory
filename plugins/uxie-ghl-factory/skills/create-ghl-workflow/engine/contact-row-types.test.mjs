// w6d-3 (plan Task 3): the row TYPE a contact-field row stores is the builder's own mapping, not the author's word. A row written as
// type 'text' (bl-386 update_contact_field, bl-418 find_contact) shows no value box in the drawer; the builder stores 'string'. The
// standard Time Zone row stores 'select'. The mapping is the builder's getValueTypeFromCustomFieldType (recovered source, conditions.ts)
// plus ValueDataType's string values (types/conditions.ts). The author's 'text' is accepted and rewritten, with an advisory.
// RED first. The merge-tag value shape (bl-366) is NOT here: it needs the UI control's stored shape, which is a live capture (W6D).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';
import { VALUE_TYPE_BY_DATATYPE, normalizeContactRows, TIMEZONE_ROW_TYPE } from './contact-row-types.mjs';

const sink = () => { const w = []; const fn = (m) => w.push(m); fn.messages = w; return fn; };
const codes = (warn) => warn.messages.map((m) => m.split(':')[0]);
const TEXT_ID = 'cfTextAaaaaaaaaaaaa';
const NUM_ID = 'cfNumBbbbbbbbbbbbb';
const customFields = [
  { id: TEXT_ID, name: 'Follow Up On', dataType: 'TEXT', model: 'contact', fieldKey: 'contact.follow_up_on' },
  { id: NUM_ID, name: 'Score', dataType: 'NUMERICAL', model: 'contact', fieldKey: 'contact.score' },
];

// ─── the builder's mapping, by custom-field dataType ───────────────────────────────────────
test('the mapping is the builder\'s: text-like → string, numbers → numerical, options → select, multi → multiselect, dates → date', () => {
  for (const t of ['TEXT', 'LARGE_TEXT', 'PHONE', 'URL', 'RICH_TEXT']) assert.equal(VALUE_TYPE_BY_DATATYPE[t], 'string', t);
  for (const t of ['NUMERICAL', 'MONETORY']) assert.equal(VALUE_TYPE_BY_DATATYPE[t], 'numerical', t);
  for (const t of ['SINGLE_OPTIONS', 'RADIO', 'USER']) assert.equal(VALUE_TYPE_BY_DATATYPE[t], 'select', t);
  for (const t of ['MULTIPLE_OPTIONS', 'CHECKBOX']) assert.equal(VALUE_TYPE_BY_DATATYPE[t], 'multiselect', t);
  for (const t of ['DATE', 'DATE_TIME']) assert.equal(VALUE_TYPE_BY_DATATYPE[t], 'date', t);
  assert.equal(TIMEZONE_ROW_TYPE, 'select');
  assert.equal(Object.values(VALUE_TYPE_BY_DATATYPE).includes('text'), false, "'text' is never a stored row type");
});

// ─── the rewrite rules ──────────────────────────────────────────────────────────────────────
test("a row authored as 'text' on a TEXT custom field is stored as 'string' and warned (bl-386)", () => {
  const warn = sink();
  const out = normalizeContactRows([{ field: TEXT_ID, value: 'x', title: 'Follow Up On', type: 'text', date: '' }],
    { customFields, warn, ref: 'u' });
  assert.equal(out[0].type, 'string');
  assert.deepEqual(codes(warn), ['CONTACT_ROW_TYPE_REWRITTEN']);
});

test("the standard Time Zone row ('timezone') is stored as 'select', whatever was authored (bl-386)", () => {
  const warn = sink();
  const out = normalizeContactRows([{ field: 'timezone', value: 'America/New_York', title: 'Timezone', type: 'string', date: '' }],
    { customFields, warn, ref: 'u' });
  assert.equal(out[0].type, 'select');
  assert.deepEqual(codes(warn), ['CONTACT_ROW_TYPE_REWRITTEN']);
});

test('a row with no type on a known custom field gets the builder\'s type, with no warning (the drawer needs it)', () => {
  const warn = sink();
  const out = normalizeContactRows([{ field: NUM_ID, value: 3, title: 'Score', date: '' }], { customFields, warn, ref: 'u' });
  assert.equal(out[0].type, 'numerical');
  assert.deepEqual(codes(warn), []);
});

test("a 'text' row on a field the account does not list is stored as 'string' (the default), warned", () => {
  const warn = sink();
  const out = normalizeContactRows([{ field: 'zzUnknownField000', value: 'x', type: 'text' }], { customFields, warn, ref: 'u' });
  assert.equal(out[0].type, 'string');
  assert.deepEqual(codes(warn), ['CONTACT_ROW_TYPE_REWRITTEN']);
});

test('an authored type that is already the builder\'s is kept, with no warning', () => {
  const warn = sink();
  const out = normalizeContactRows([{ field: NUM_ID, value: 3, title: 'Score', type: 'numerical', date: '' }], { customFields, warn, ref: 'u' });
  assert.equal(out[0].type, 'numerical');
  assert.deepEqual(codes(warn), []);
});

test('the input rows are not mutated (the caller keeps what it wrote)', () => {
  const rows = [{ field: TEXT_ID, value: 'x', type: 'text' }];
  normalizeContactRows(rows, { customFields, warn: sink(), ref: 'u' });
  assert.equal(rows[0].type, 'text');
});

// ─── the build path: the compiled step carries the builder's type, and the build is not blocked ─────────
const ctx = (warn) => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('r'),
  catalog: loadCatalog(), customFields, warn });
const tagTrigger = { ref: 't', type: 'contact_tag', name: 'T', filters: [] };

test("update_contact_field: a TEXT custom field authored as 'text' compiles to 'string' (bl-386), and the build is not blocked", () => {
  const warn = sink();
  const built = compile({ name: 'WF', triggers: [tagTrigger], graph: [{ ref: 'u', kind: 'action', type: 'update_contact_field',
    name: 'Set follow-up', attributes: { actionType: 'update_field_data', fields: [{ field: TEXT_ID, value: 'call', title: 'Follow Up On', type: 'text', date: '' }] } }] }, ctx(warn));
  const step = built.autoSaveBody.workflowData.templates.find((t) => t.type === 'update_contact_field');
  assert.equal(step.attributes.fields[0].type, 'string');
  assert.ok(warn.messages.some((m) => m.startsWith('CONTACT_ROW_TYPE_REWRITTEN')));
});

test("update_contact_field: the standard Time Zone row compiles to 'select' (bl-386)", () => {
  const built = compile({ name: 'WF', triggers: [tagTrigger], graph: [{ ref: 'u', kind: 'action', type: 'update_contact_field',
    name: 'Set zone', attributes: { actionType: 'update_field_data', fields: [{ field: 'timezone', value: 'America/New_York', title: 'Timezone', type: 'string', date: '' }] } }] }, ctx(sink()));
  const step = built.autoSaveBody.workflowData.templates.find((t) => t.type === 'update_contact_field');
  assert.equal(step.attributes.fields[0].type, 'select');
});

test("find_contact: a TEXT filter row authored as 'text' compiles to 'string' (bl-418)", () => {
  const warn = sink();
  const built = compile({ name: 'WF', triggers: [tagTrigger], graph: [{ ref: 'f', type: 'find_contact', name: 'Find by follow-up',
    find: { fields: [{ field: TEXT_ID, value: 'call', title: 'Follow Up On', type: 'text', date: '' }] } }] }, ctx(warn));
  const find = built.autoSaveBody.workflowData.templates.find((t) => t.type === 'find_contact');
  assert.equal(find.attributes.fields[0].type, 'string');
  assert.ok(warn.messages.some((m) => m.startsWith('CONTACT_ROW_TYPE_REWRITTEN')));
});
