import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from './catalog.mjs';
import { evaluateMergeTags, checkMergeTags, suggestTags, NAMESPACE_POLICY } from './merge-tags.mjs';
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

// ENGINE_STATIC_TAGS is retired: the extractor expands childUserMenu() and the catalog carries all
// 18 itself. What must not regress is the OUTCOME the overlay existed to guarantee — the assigned-
// user tags are real picker tags in a CLOSED namespace, so a miss here would be a hard error.
test('the assigned-user tags are in the catalog itself, no engine-side overlay needed', () => {
  const known = new Set(M.tags.map((t) => String(t.tag).replace(/\s+/g, '')));
  const expected = ['appointment', 'task'].flatMap((ns) => ['id', 'name', 'first_name', 'last_name',
    'email', 'phone', 'phone_raw', 'email_signature', 'twilio_phone_number'].map((k) => `{{${ns}.user.${k}}}`));
  assert.deepEqual(expected.filter((t) => !known.has(t)), [], 'the catalog lost the childUserMenu expansion');
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

// A first-party step's OWN outputs are referenced as {{<customVarPrefix>.<stepIndex>.<field>}}.
// Proven live 2026-09-19: {{workflow_ai_analyze_image.1.response}} rendered the model's actual
// answer — while the build that wrote it warned "a namespace the picker does not list … it will
// render literally". The namespace comes from the document's OWN steps, so a typo still warns.
test('a marketplace action step in the document owns its output namespace; an absent one still warns', () => {
  const marketplace = { get: (key, kind) => (kind === 'action' && key === 'workflow_ai_analyze_image'
    ? { key, customVarPrefix: 'workflow_ai_analyze_image' } : undefined) };
  const doc = [
    { id: 'a', type: 'workflow_ai_analyze_image', name: 'AI', attributes: {} },
    { id: 's', type: 'sms', name: 'S', attributes: { body: '{{workflow_ai_analyze_image.1.response}}' } },
  ];
  const warned = [];
  checkMergeTags(doc, catalog, { marketplace, warn: (m) => warned.push(m) });
  assert.deepEqual(warned, []);
  // CONTROL 1: the same tag with NO such step in the document is still an unknown namespace.
  const orphan = [];
  checkMergeTags(tpl('{{workflow_ai_analyze_image.1.response}}'), catalog, { marketplace, warn: (m) => orphan.push(m) });
  assert.equal(orphan.filter((m) => /unknown|does not list/.test(m)).length, 1);
  // CONTROL 2: a typo'd namespace warns even while the real step is present.
  const typo = [];
  checkMergeTags([doc[0], { id: 's', type: 'sms', name: 'S', attributes: { body: '{{workflow_ai_analyse_image.1.response}}' } }],
    catalog, { marketplace, warn: (m) => typo.push(m) });
  assert.equal(typo.filter((m) => /does not list/.test(m)).length, 1);
});

// On the EDIT path compileSubgraph compiles the edited step ALONE, so the producers live only in
// ctx.graphTemplates — the same channel externalRefs uses. Without this an in-place correction to a
// step that prints an AI step's output warned about a tag the runtime resolves.
test('the whole live graph counts as the document on the edit path (ctx.graphTemplates)', () => {
  const marketplace = { get: (key, kind) => (kind === 'action' && key === 'workflow_ai_email_parser'
    ? { key, customVarPrefix: 'workflow_ai_email_parser' } : undefined) };
  const editedAlone = tpl('{{workflow_ai_email_parser.1.full_name}}');
  const graphTemplates = [{ id: 'p', type: 'workflow_ai_email_parser', name: 'P', attributes: {} }, ...editedAlone];
  const warned = [];
  checkMergeTags(editedAlone, catalog, { marketplace, graphTemplates, warn: (m) => warned.push(m) });
  assert.deepEqual(warned, []);
  const control = [];   // same edit, no such producer anywhere
  checkMergeTags(editedAlone, catalog, { marketplace, graphTemplates: [], warn: (m) => control.push(m) });
  assert.equal(control.filter((m) => /does not list/.test(m)).length, 1);
});
