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

// A scheduled pause un-publishes a workflow and marks the document (live 2026-09-23). Without the
// marker in the digest, a paused workflow is a bare `draft` and reads as unfinished.
test('a workflow held by a scheduled pause says so, with the config that holds it', () => {
  const d = digestWorkflow({ doc: { ...doc(), paused: 'workflow-scheduled-pause', pauseUpdatedById: 'CFG1' }, triggers: triggers() });
  assert.equal(d.status, 'draft');
  assert.equal(d.pausedBy.by, 'workflow-scheduled-pause');
  assert.equal(d.pausedBy.pauseConfigId, 'CFG1');
  assert.match(d.pausedBy.note, /SCHEDULED PAUSE/);
});

test('CONTROL: an ordinary draft, and one whose pause has ended (fields reset to null), carry no pause marker', () => {
  assert.equal('pausedBy' in digestWorkflow({ doc: doc(), triggers: triggers() }), false);
  assert.equal('pausedBy' in digestWorkflow({ doc: { ...doc(), paused: null, pauseUpdatedById: null }, triggers: triggers() }), false);
});

test('pause windows that have not ended are shown; past ones are dropped', () => {
  const now = Date.parse('2026-09-23T06:00:00Z');
  const d = digestWorkflow({ now, triggers: triggers(), doc: { ...doc(), scheduledPauseDates: [
    { pauseStartTime: '2026-10-25T00:00:00.000Z', pauseEndTime: '2026-10-26T02:00:00.000Z' },   // ahead
    { pauseStartTime: '2026-09-23T05:00:00.000Z', pauseEndTime: '2026-09-24T06:00:00.000Z' },   // running now
    { pauseStartTime: '2026-09-02T00:00:00.000Z', pauseEndTime: '2026-09-03T01:00:00.000Z' },   // over
  ] } });
  assert.deepEqual(d.scheduledPauses, [
    { start: '2026-10-25T00:00:00.000Z', end: '2026-10-26T02:00:00.000Z' },
    { start: '2026-09-23T05:00:00.000Z', end: '2026-09-24T06:00:00.000Z' },
  ]);
});

test('CONTROL: only past windows, or none at all, adds no key', () => {
  const now = Date.parse('2026-09-23T06:00:00Z');
  const past = [{ pauseStartTime: '2026-09-02T00:00:00.000Z', pauseEndTime: '2026-09-03T01:00:00.000Z' }];
  assert.equal('scheduledPauses' in digestWorkflow({ now, triggers: triggers(), doc: { ...doc(), scheduledPauseDates: past } }), false);
  assert.equal('scheduledPauses' in digestWorkflow({ now, triggers: triggers(), doc: doc() }), false);
});
