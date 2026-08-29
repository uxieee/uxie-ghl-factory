// export_workflow returns the raw wire document — tens of kilobytes of __customInputFields__ rows
// and frozen UI-hint arrays. An agent that must read all of it to answer "what does this workflow
// do and where would my change land?" either burns its context or skips the read, and skipping the
// read is how edits get authored against a graph nobody looked at.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digestWorkflow, fingerprintWorkflow } from './digest.mjs';

const doc = () => ({
  id: 'WID', name: 'Nurture', status: 'draft', version: 7, allowMultiple: false, timezone: 'account',
  workflowData: { templates: [
    { id: 's1', type: 'add_contact_tag', name: 'Tag', next: 'g', parentKey: null, order: 0, attributes: { tags: ['lead', 'new'] } },
    { id: 'g', type: 'if_else', name: 'VIP?', next: ['b1', 'b2'], parentKey: 's1', order: 1,
      attributes: { branches: [{ name: 'Yes', segments: [] }, { name: 'No', segments: [] }] } },
    { id: 'b1', type: 'transition', name: 'Yes', next: 's2', parent: 'g', order: 0, attributes: {} },
    { id: 'b2', type: 'transition', name: 'No', next: null, parent: 'g', order: 1, attributes: {} },
    { id: 's2', type: 'sms', name: 'Text', next: null, parentKey: 'b1', order: 0,
      attributes: { body: 'Hi {{contact.first_name}}, see you {{appointment.only_start_time}}' } },
  ] },
});
const triggers = () => [{ id: 'tr1', type: 'contact_tag', name: 'Tagged', active: true,
  conditions: [{ field: 'tagsAdded', operator: 'index-of-true', value: ['lead'] }] }];

test('the digest carries identity, version, triggers, one line per step, and the chains', () => {
  const d = digestWorkflow({ doc: doc(), triggers: triggers() });
  assert.equal(d.workflowId, 'WID');
  assert.equal(d.version, 7);
  assert.equal(d.stepCount, 5);
  assert.deepEqual(d.triggers[0].conditions, [{ field: 'tagsAdded', operator: 'index-of-true', value: ['lead'] }]);
  const sms = d.steps.find((s) => s.id === 's2');
  assert.deepEqual(sms.mergeTags, ['{{contact.first_name}}', '{{appointment.only_start_time}}']);
  assert.match(sms.text, /^Hi \{\{contact\.first_name\}\}/);
  assert.ok(sms.flags.includes('terminal'));
  assert.ok(d.chains.some((c) => c.from === 'ROOT' && c.path[0] === 's1'));
});

test('a step inside a branch says WHICH branch, so the reader need not rebuild the tree', () => {
  const d = digestWorkflow({ doc: doc(), triggers: [] });
  assert.equal(d.steps.find((s) => s.id === 's2').branch, 'VIP?/Yes');
  assert.equal(d.steps.find((s) => s.id === 's1').branch, undefined, 'a root-chain step belongs to no branch');
});

test('the fingerprint changes when structure changes and holds when it does not', () => {
  const a = fingerprintWorkflow(doc().workflowData.templates, triggers());
  const b = fingerprintWorkflow(doc().workflowData.templates, triggers());
  assert.equal(a, b, 'the same document fingerprints the same');
  const moved = doc().workflowData.templates;
  moved[0].attributes.tags = ['lead', 'changed'];
  assert.notEqual(fingerprintWorkflow(moved, triggers()), a);
  const trg = triggers(); trg[0].conditions[0].value = ['other'];
  assert.notEqual(fingerprintWorkflow(doc().workflowData.templates, trg), a);
});

test('the digest is COMPACT — well under the raw document, and under 250 bytes per step', () => {
  const d = digestWorkflow({ doc: doc(), triggers: triggers() });
  const size = JSON.stringify(d).length;
  assert.ok(size / d.stepCount < 250, `${Math.round(size / d.stepCount)} B/step`);
});

test('nothing throws on an empty or hostile document', () => {
  for (const bad of [{}, { doc: null }, { doc: { workflowData: { templates: [null, {}] } } }]) {
    const d = digestWorkflow(bad);
    assert.ok(Array.isArray(d.steps));
  }
});
