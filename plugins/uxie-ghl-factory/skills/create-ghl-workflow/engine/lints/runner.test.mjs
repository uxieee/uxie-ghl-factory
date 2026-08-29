// RC-F: check_workflow ran ONE lint layer (the marketplace action schema) while the build path ran
// about ten, so recon on a live account found nothing that only the build path checks. A client
// shipped a literal {{appointment.date}} for three weeks under a clean check_workflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLints } from './runner.mjs';
import { loadDoctrinePack } from './doctrine.mjs';
import { loadCatalog } from '../catalog.mjs';

const catalog = loadCatalog();
const doc = () => ({
  templates: [
    { id: 'g', type: 'goto', name: 'Dead jump', next: null, parentKey: null, order: 0, attributes: { type: 'goto', targetNodeId: 'ghost' } },
    { id: 's', type: 'sms', name: 'Text', next: null, parentKey: null, order: 1, attributes: { body: 'See you {{appointment.date}}' } },
    { id: 'n', type: 'internal_notification', name: 'Ping', next: 'r1', parentKey: null, order: 2, attributes: { type: 'notification', notification: { body: 'b', title: 't', userType: 'all' } } },
    { id: 'r1', type: 'remove_from_workflow', name: 'R1', next: 'r2', parentKey: 'n', order: 3, attributes: {} },
    { id: 'r2', type: 'remove_from_workflow', name: 'R2', next: null, parentKey: 'r1', order: 4, attributes: {} },
  ],
  triggers: [],
});
const rules = (list) => list.map((f) => f.rule).sort();

test('platform carries the dead goto and the invented merge tag as ERRORS; hygiene carries the rest as warnings', () => {
  const r = runLints(doc(), { catalog });
  assert.ok(r.platform.some((f) => f.rule === 'dangling-ref' && f.severity === 'error'));
  assert.ok(r.platform.some((f) => f.rule === 'merge-tag' && f.severity === 'error' && /appointment\.date/.test(f.msg)));
  assert.deepEqual(rules(r.hygiene), ['notification-no-redirect', 'remove-chain']);
  assert.ok(r.hygiene.every((f) => f.severity === 'warning'));
});

test('packs are selectable: platform alone runs no hygiene', () => {
  const r = runLints(doc(), { catalog, packs: ['platform'] });
  assert.deepEqual(r.hygiene, []);
  assert.ok(r.platform.length > 0);
});

test('a doctrine pack states CLIENT policy the engine never defines', () => {
  const { rules: pack, errors } = loadDoctrinePack({ requireRedirectPage: true, sendWindow: { start: '08:00', end: '18:00' } });
  assert.deepEqual(errors, []);
  const r = runLints(doc(), { catalog, packs: ['doctrine'], doctrinePack: pack });
  assert.ok(r.doctrine.some((f) => f.rule === 'requireRedirectPage' && f.severity === 'error'),
    'the same shape hygiene only warns about is an ERROR when the account requires it');

  const late = { templates: [{ id: 'w', type: 'wait', name: 'W', attributes: { type: 'time', window: { condition: 'when', start: '06:00', end: '22:00' } } }] };
  const w = runLints(late, { catalog, packs: ['doctrine'], doctrinePack: pack });
  assert.ok(w.doctrine.some((f) => f.rule === 'sendWindow' && /06:00-22:00/.test(f.msg)));
});

test('a malformed doctrine pack reports WHY rather than silently doing nothing', () => {
  assert.deepEqual(loadDoctrinePack('{not json').rules, null);
  assert.match(loadDoctrinePack('{not json').errors[0], /not valid JSON/);
  assert.match(loadDoctrinePack({ sendWindow: { start: '8am', end: '6pm' } }).errors[0], /HH:MM/);
  const r = runLints(doc(), { catalog, packs: ['doctrine'] });
  assert.deepEqual(r.doctrine, []);
  assert.ok(r.notEvaluable.some((x) => /no pack supplied/.test(x)));
});

test('"could not look" is never reported as "nothing found"', () => {
  const r = runLints(doc(), { catalog: null });
  assert.ok(r.notEvaluable.some((x) => /workflowRules \(no catalog/.test(x)));
  assert.ok(r.notEvaluable.some((x) => /mergeTags \(no catalog/.test(x)));
  assert.deepEqual(r.platform.filter((f) => f.rule === 'merge-tag'), [], 'no catalog means no merge-tag verdict at all');
});

test('nothing throws on an empty or hostile document', () => {
  for (const d of [{ templates: [] }, { templates: null }, {}, { templates: [null, {}, { id: 'x' }] }, null]) {
    const r = runLints(d, { catalog });
    assert.ok(Array.isArray(r.platform) && Array.isArray(r.hygiene));
  }
});
