import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile, casingLint } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('a'), catalog: loadCatalog() });

const linearIR = {
  name: 'Linear', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
  graph: [
    { ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag A', attributes: { tags: ['a'] } },
    { ref: 'w', kind: 'wait', name: 'Wait', config: { unit: 'days', value: 1, when: 'after' } },
    { ref: 'b', kind: 'action', type: 'add_contact_tag', name: 'Tag B', attributes: { tags: ['b'] } },
  ],
};

test('linear chain wires next/parentKey/order and lean envelope', () => {
  const { autoSaveBody } = compile(linearIR, ctx());
  const t = autoSaveBody.workflowData.templates;
  assert.equal(t.length, 3);
  assert.equal(t[0].parentKey, null);
  assert.equal(t[0].next, t[1].id);
  assert.equal(t[1].parentKey, t[0].id);
  assert.equal(t[1].next, t[2].id);
  assert.equal(t[2].next, null);
  assert.deepEqual([t[0].order, t[1].order, t[2].order], [0, 1, 2]);
  assert.equal(t[1].attributes.type, 'time');
  assert.deepEqual(t[1].attributes.startAfter, { type: 'days', value: 1, when: 'after' });
  assert.equal(t[1].attributes.hybridActionType, 'wait');   // waits carry hybrid flags (real shape)
  assert.deepEqual(t[1].attributes.transitions, []);         // linear wait: empty transitions
  assert.deepEqual(Object.keys(t[0]).sort(), ['attributes', 'id', 'name', 'next', 'order', 'parentKey', 'type']);
  assert.deepEqual(autoSaveBody.createdSteps, t.map((s) => s.id));
  assert.deepEqual(autoSaveBody.modifiedSteps, []);
});

const ifElseIR = {
  name: 'Branchy', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
  graph: [
    { ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['x'] } },
    { ref: 'b', kind: 'if_else', name: 'Check', branches: [
      { ref: 'y', name: 'Yes', conditions: [{ conditionType: 'contact_detail', conditionSubType: 'tag', conditionOperator: 'contains', conditionValue: 'hv' }], then: [
        { ref: 'yt', kind: 'action', type: 'add_contact_tag', name: 'Premium', attributes: { tags: ['premium'] } } ] },
      { ref: 'n', name: 'No', else: true, then: [
        { ref: 'nt', kind: 'action', type: 'add_contact_tag', name: 'Standard', attributes: { tags: ['standard'] } } ] },
    ] },
  ],
};

test('binary if_else: container + branch-yes/branch-no wiring', () => {
  const { autoSaveBody } = compile(ifElseIR, ctx());
  const t = autoSaveBody.workflowData.templates;
  const byRef = (name) => t.find((s) => s.name === name);
  const container = byRef('Check');
  assert.equal(container.type, 'if_else');
  assert.equal(container.nodeType, 'condition-node');
  assert.equal(container.parentKey, byRef('Tag').id);
  assert.deepEqual(container.next.length, 2);
  const yes = t.find((s) => s.name === 'Yes'), no = t.find((s) => s.name === 'No');
  assert.equal(yes.nodeType, 'branch-yes');
  assert.equal(no.nodeType, 'branch-no');
  assert.equal(yes.parent, container.id);
  assert.deepEqual(yes.sibling, [no.id]);
  assert.deepEqual(no.sibling, [yes.id]);
  assert.equal(container.next[0], yes.id);
  assert.equal(container.next[1], no.id);
  assert.equal(container.attributes.branches[0].id, yes.id);
  assert.equal(container.attributes.branches[1].id, no.id);
  assert.equal(container.attributes.branches[1].segments.length, 0);
  // container renders its label from attributes.conditionName (the "undefined" fix)
  assert.equal(container.attributes.conditionName, 'Check');
  assert.equal(container.attributes.if, true);
  assert.equal(container.attributes.operator, 'and');
  assert.equal(container.attributes.noneBranchName, 'No');
  assert.equal(container.cat, '');
  assert.deepEqual(container.comments, []);
  assert.equal(container.attributes.branches[0].showErrors, false);
  assert.equal(yes.next, byRef('Premium').id);
  assert.equal(byRef('Premium').parent, yes.id);
  assert.equal(byRef('Premium').next, null);
  assert.ok(['parent', 'sibling', 'cat', 'comments', 'nodeType', 'parentKey'].every((k) => k in yes));
});

test('create body + auto-save envelope are well-formed', () => {
  const { createBody, autoSaveBody } = compile(linearIR, ctx());
  assert.equal(createBody.name, 'Linear');
  assert.equal(createBody.status, 'draft');
  assert.equal(createBody.company_id, 'CID');
  assert.deepEqual(createBody.workflowData, { templates: [] });
  assert.equal(autoSaveBody._id, autoSaveBody.id);
  assert.equal(autoSaveBody.locationId, 'LOC');
  assert.equal(autoSaveBody.dataVersion, 7);
  assert.equal(autoSaveBody.isAutoSave, true);
  assert.equal(autoSaveBody.autoSaveSession.workflowId, autoSaveBody.id);
  assert.equal(autoSaveBody.autoSaveSession.userId, 'UID');
});

test('trigger body casing: workflowId camel at root, location_id snake', () => {
  const { triggerBodies, _wid } = compile(linearIR, ctx());
  assert.equal(triggerBodies.length, 1);
  const tb = triggerBodies[0];
  assert.equal(tb.workflowId, _wid);
  assert.equal(tb.location_id, 'LOC');
  assert.equal(tb.company_id, 'CID');
  assert.equal(tb.type, 'contact_tag');
  assert.equal(tb.masterType, 'highlevel');
  assert.deepEqual(tb.actions, [{ workflow_id: _wid, type: 'add_to_workflow' }]);
});

test('casingLint rejects snake workflow_id at trigger root', () => {
  assert.throws(() => casingLint({ triggerBodies: [{ workflow_id: 'x' }], autoSaveBody: {} }),
    (e) => e.code === 'CASING');
});

test('inline email fills required fields and omits template_id', () => {
  const ir = { name: 'E', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }], graph: [
    { ref: 'e', kind: 'action', type: 'email', name: 'Hi', attributes: { subject: 'S', html: '<p>x</p>' } },
  ] };
  const { autoSaveBody } = compile(ir, ctx());
  const e = autoSaveBody.workflowData.templates[0].attributes;
  assert.equal('template_id' in e, false);        // inline: no template_id (a literal "none" errors)
  assert.equal(e.subject, 'S');
  assert.equal(e.html, '<p>x</p>');
  assert.deepEqual(e.conditions, []);
  assert.equal(e.syncEnabled, false);
  assert.equal(e.templateCreationMode, 'existing');
  assert.ok(e.trackingOptions && e.fieldDefaults);
});

test('template email references template_id and drops html', () => {
  const ir = { name: 'E', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }], graph: [
    { ref: 'e', kind: 'action', type: 'email', name: 'Hi', attributes: { subject: 'S', template_id: 'abc123' } },
  ] };
  const { autoSaveBody } = compile(ir, ctx());
  const e = autoSaveBody.workflowData.templates[0].attributes;
  assert.equal(e.template_id, 'abc123');
  assert.equal(e.templatesource, 'email-builder');
  assert.equal('html' in e, false);               // template mode: html lives in the template
});

test('multipath reply-wait: container + 2 transition steps + both paths', () => {
  const ir = { name: 'W', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }], graph: [
    { ref: 'sms', kind: 'action', type: 'sms', name: 'Ask', attributes: { body: 'Reply YES' } },
    { ref: 'w', kind: 'wait', waitType: 'reply', name: 'Wait for reply',
      reply: { steps: ['sms'], labels: ['Ask'] }, timeout: { unit: 'hours', value: 1, when: 'after' },
      onEvent: [{ ref: 'yes', kind: 'action', type: 'add_contact_tag', name: 'Replied', attributes: { tags: ['replied'] } }],
      onTimeout: [{ ref: 'no', kind: 'action', type: 'add_contact_tag', name: 'No reply', attributes: { tags: ['no-reply'] } }] },
  ] };
  const { autoSaveBody } = compile(ir, ctx());
  const t = autoSaveBody.workflowData.templates;
  const container = t.find((s) => s.type === 'wait' && s.attributes.convertToMultipath === true);
  assert.ok(container, 'multipath wait container exists');
  assert.equal(container.next.length, 2);
  assert.equal(container.attributes.transitions.length, 2);
  assert.equal(container.attributes.transitions[0].condition, 'primary');
  assert.equal(container.attributes.transitions[1].condition, 'timeout');
  // reply references the sms step's id
  assert.equal(container.attributes.reply[0], t.find((s) => s.name === 'Ask').id);
  // two transition entry steps
  const trans = t.filter((s) => s.type === 'transition');
  assert.equal(trans.length, 2);
  assert.equal(trans[0].parent, container.id);
  // children hang off the transitions
  assert.equal(t.find((s) => s.name === 'Replied').parent, container.next[0]);
  assert.equal(t.find((s) => s.name === 'No reply').parent, container.next[1]);
});

const gotoIR = {
  name: 'Loop', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
  graph: [
    { ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Start', attributes: { tags: ['s'] } },
    { ref: 'g', kind: 'goto', target: 'a' },
  ],
};

test('goto emits targetNodeId, next null, lean envelope', () => {
  const { autoSaveBody } = compile(gotoIR, ctx());
  const t = autoSaveBody.workflowData.templates;
  const start = t.find((s) => s.name === 'Start');
  const g = t.find((s) => s.type === 'goto');
  assert.equal(g.attributes.targetNodeId, start.id);
  assert.equal(g.attributes.type, 'goto');
  assert.equal(g.next, null);
  assert.equal(g.parentKey, start.id);
  // lean: no situational keys on a root-scope goto
  assert.deepEqual(Object.keys(g).sort(), ['attributes', 'id', 'name', 'next', 'order', 'parentKey', 'type']);
});

test('Appendix A acceptance: tagged-vip-nurture compiles to 8 steps, correct shape', () => {
  const ir = JSON.parse(readFileSync(join(__dir, 'fixtures/tagged-vip-nurture.ir.json'), 'utf8'));
  const { autoSaveBody, triggerBodies } = compile(ir, ctx());
  const t = autoSaveBody.workflowData.templates;
  assert.equal(t.length, 8);
  const byName = (n) => t.find((s) => s.name === n);
  assert.equal(byName('Has high-value tag?').nodeType, 'condition-node');
  assert.equal(byName('Yes').nodeType, 'branch-yes');
  assert.equal(byName('No').nodeType, 'branch-no');
  assert.equal(byName('Tag premium').next, null);
  assert.equal(byName('Tag premium').parent, byName('Yes').id);
  assert.equal(triggerBodies[0].type, 'contact_tag');
  assert.deepEqual(triggerBodies[0].conditions, [{ field: 'tagsAdded', operator: 'index-of-true', value: ['VIP'] }]);
  assert.equal(autoSaveBody.createdSteps.length, 8);
});
