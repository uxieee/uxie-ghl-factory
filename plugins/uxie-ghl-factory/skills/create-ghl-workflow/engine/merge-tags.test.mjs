import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from './catalog.mjs';
import { evaluateMergeTags, checkMergeTags, suggestTags, ENGINE_STATIC_TAGS, NAMESPACE_POLICY } from './merge-tags.mjs';
const catalog = loadCatalog();
const M = catalog.mergeTags;
const tpl = (body) => [{ id: 's', type: 'sms', name: 'S', attributes: { body } }];
const fields = [
  { id: 'F1', name: 'Preferred Name', fieldKey: 'contact.preferred_name', dataType: 'TEXT', model: 'contact' },
  { id: 'F2', name: 'Budget', fieldKey: 'opportunity.budget', dataType: 'NUMERICAL', model: 'opportunity' },
];
const values = [{ id: 'V1', name: 'Booking link', fieldKey: '{{ custom_values.booking_link }}' }];
const errs = (f) => f.filter((x) => x.severity === 'error').map((x) => x.tag);
const warns = (f) => f.filter((x) => x.severity === 'warning').map((x) => x.tag);

test('policy is source-derived: appointment/user/calendar/right_now/message/phoneCall/document/location are CLOSED', () => {
  for (const ns of ['appointment', 'user', 'calendar', 'right_now', 'message', 'phoneCall', 'document', 'location'])
    assert.equal(NAMESPACE_POLICY.closed.has(ns), true, ns);
  assert.deepEqual(NAMESPACE_POLICY.perLocation, { contact: 'customFields', opportunity: 'customFields', custom_values: 'customValues' });
});

test('an invented appointment tag is an ERROR with the real tag suggested (F5-27)', () => {
  const f = evaluateMergeTags(tpl('See you on {{appointment.date}} at {{appointment.time}} — {{appointment.only_start_time}} is fine'), M);
  assert.deepEqual(errs(f), ['{{appointment.date}}', '{{appointment.time}}']);
  assert.ok(f[0].suggestions.includes('{{appointment.only_start_date}}'), JSON.stringify(f[0].suggestions));
  assert.ok(f[1].suggestions.includes('{{appointment.only_start_time}}'), JSON.stringify(f[1].suggestions));
});

test('a per-location namespace checks the fetched list: known custom field passes, unknown is an ERROR, no list = WARNING', () => {
  const body = '{{contact.first_name}} {{contact.preferred_name}} {{contact.prefered_name}} {{opportunity.budget}} {{custom_values.booking_link}}';
  const withLists = evaluateMergeTags(tpl(body), M, { customFields: fields, customValues: values });
  assert.deepEqual(errs(withLists), ['{{contact.prefered_name}}']);
  assert.ok(withLists[0].suggestions.includes('{{contact.preferred_name}}'));
  const noLists = evaluateMergeTags(tpl(body), M);
  assert.deepEqual(errs(noLists), []);
  assert.deepEqual(warns(noLists).sort(), ['{{contact.prefered_name}}', '{{contact.preferred_name}}', '{{custom_values.booking_link}}', '{{opportunity.budget}}'].sort());
  assert.match(noLists[0].msg, /unverifiable/);
});

test('gated namespaces warn; unknown namespaces warn; step-output namespaces and handlebars are never judged', () => {
  const f = evaluateMergeTags(tpl('{{invoice.nope}} {{appt.time}} {{custom_webhook.1.response.url}} {{chatgpt.2.response}} {{#if x}}{{else}}{{/if}}'), M);
  assert.deepEqual(errs(f), []);
  assert.deepEqual(warns(f).sort(), ['{{appt.time}}', '{{invoice.nope}}']);
});

test('ENGINE_STATIC_TAGS carries the 18 assigned-user tags the harvest dropped — and dies when the catalog gains them', () => {
  assert.equal(ENGINE_STATIC_TAGS.length, 18);
  const known = new Set(M.tags.map((t) => String(t.tag).replace(/\s+/g, '')));
  assert.ok(ENGINE_STATIC_TAGS.some((t) => !known.has(t)), 'the catalog now carries these tags — DELETE ENGINE_STATIC_TAGS from merge-tags.mjs');
  assert.deepEqual(errs(evaluateMergeTags(tpl('{{appointment.user.first_name}} {{task.user.email}}'), M)), []);
});

test('unbalanced braces warn; checkMergeTags throws MERGE_TAG_UNKNOWN on errors, warns otherwise, and honours both hatches', () => {
  assert.match(evaluateMergeTags(tpl('Hello {{contact.first_name}'), M)[0].msg, /unbalanced/);
  const warnsOut = [];
  assert.throws(() => checkMergeTags(tpl('{{user.nmae}}'), catalog, { warn: (m) => warnsOut.push(m) }),
    (e) => e.code === 'MERGE_TAG_UNKNOWN' && /user\.nmae/.test(e.message) && /user\.name/.test(e.message));
  const demoted = [];
  checkMergeTags(tpl('{{user.nmae}}'), catalog, { warn: (m) => demoted.push(m), strictMergeTags: false });
  assert.match(demoted[0], /^MERGE_TAG: /);
  assert.deepEqual(checkMergeTags(tpl('{{user.nmae}}'), catalog, { skipMergeTagCheck: true }), []);
  const soft = [];
  checkMergeTags(tpl('{{invoice.nope}}'), catalog, { warn: (m) => soft.push(m) });
  assert.match(soft[0], /^MERGE_TAG_SOFT: /);
});

test('suggestTags: edit distance and shared words, namespace-scoped, at most 4', () => {
  const cands = M.tags.map((t) => String(t.tag).replace(/\s+/g, ''));
  assert.ok(suggestTags('{{appointment.day}}', cands).includes('{{appointment.day_of_week}}'));
  assert.ok(suggestTags('{{contact.frist_name}}', cands).includes('{{contact.first_name}}'));
  assert.ok(suggestTags('{{appointment.day}}', cands).length <= 4);
  assert.deepEqual(suggestTags('{{appointment.day}}', cands).filter((t) => !t.startsWith('{{appointment.')), []);
});
