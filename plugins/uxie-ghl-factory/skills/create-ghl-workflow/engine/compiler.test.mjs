import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile, casingLint } from './compiler.mjs';

// Frozen UI-hint arrays harvested verbatim from live UI-built if_else conditions
// (ghl-internal-api-research corpus, 2026-07-15). The compiler must emit these on
// every condition; the test pins the exact values independently of the compiler.
const IFELSE_NESTED_DROPDOWN_TYPES = ['inboundWebhookRequest', 'sheet', 'datetime_formatter',
  'custom_webhook', 'array_functions', 'ivr_gather', 'ivr_connect_call', 'custom_code'];
const IFELSE_ALLOW_IS_OPERATOR_TYPES = ['contact_reply', 'inboundWebhookRequest', 'custom_webhook',
  'custom_code', 'contact_detail', 'array_functions', 'appointment', 'service_booking'];
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

test('binary if_else: container + branch-yes/None-node wiring (runtime-correct structure)', () => {
  const { autoSaveBody } = compile(ifElseIR, ctx());
  const t = autoSaveBody.workflowData.templates;
  const byRef = (name) => t.find((s) => s.name === name);
  const container = byRef('Check');
  assert.equal(container.type, 'if_else');
  assert.equal(container.nodeType, 'condition-node');
  assert.equal(container.parentKey, byRef('Tag').id);
  const yes = t.find((s) => s.name === 'Yes'), no = t.find((s) => s.name === 'No');
  assert.equal(yes.nodeType, 'branch-yes');
  assert.equal(no.nodeType, 'branch-no');
  // The None node is a SEPARATE node in next[] — next.length === conditioned + 1.
  // (This is the runtime fix: with the None fused onto the conditioned branch the
  // graph compile made the pre-container step terminal → end_of_workflow.)
  assert.equal(container.next.length, 2, 'next = [conditionedYes, None]');
  assert.equal(container.next[0], yes.id);
  assert.equal(container.next[1], no.id);
  // attributes.branches holds CONDITIONED branches ONLY — the None/else is NOT here.
  assert.equal(container.attributes.branches.length, 1);
  assert.equal(container.attributes.branches[0].id, yes.id);
  assert.ok(container.attributes.branches.every((b) => b.id !== no.id),
    'the None/else id must not appear as an attributes.branches entry');
  assert.equal(container.next.length, container.attributes.branches.length + 1);
  // conditioned branch carries a real segment (with a generated __segmentId)
  const seg = container.attributes.branches[0].segments[0];
  assert.equal(container.attributes.branches[0].segments.length, 1);
  assert.equal(typeof seg.__segmentId, 'string');
  assert.ok(seg.__segmentId.length > 0);
  // container attributes: label + version + none-branch name
  assert.equal(container.attributes.conditionName, 'Check');
  assert.equal(container.attributes.if, true);
  assert.equal(container.attributes.operator, 'and');
  assert.equal(container.attributes.currentRecipeType, 'CUSTOM');
  assert.equal(container.attributes.version, 2);
  assert.equal(container.attributes.noneBranchName, 'No');
  assert.equal(container.cat, 'conditions');
  assert.deepEqual(container.comments, []);
  assert.equal(container.attributes.branches[0].showErrors, false);
  // branch-yes node attributes are the real non-empty shape (NOT {})
  assert.deepEqual(yes.attributes, { if: false, conditionName: 'Condition', operator: 'and', branches: [] });
  // None node attributes are {else:true}; its next wires the fallback ladder
  assert.deepEqual(no.attributes, { else: true });
  assert.equal(yes.parent, container.id);
  assert.deepEqual(yes.sibling, [no.id]);
  assert.deepEqual(no.sibling, [yes.id]);
  assert.equal(yes.next, byRef('Premium').id);
  assert.equal(byRef('Premium').parent, yes.id);
  assert.equal(byRef('Premium').next, null);
  assert.equal(no.next, byRef('Standard').id, 'None node wires the else fallback ladder');
  assert.ok(['parent', 'sibling', 'cat', 'comments', 'nodeType', 'parentKey'].every((k) => k in yes));
});

test('if_else conditions get the full UI/runtime condition shape (not the bare 4 fields)', () => {
  const { autoSaveBody } = compile(ifElseIR, ctx());
  const t = autoSaveBody.workflowData.templates;
  const container = t.find((s) => s.name === 'Check');
  const cond = container.attributes.branches[0].segments[0].conditions[0];
  assert.equal(cond.conditionType, 'contact_detail');
  assert.equal(cond.conditionSubType, 'tag');
  assert.equal(cond.conditionValue, 'hv');
  // envelope fields the builder/runtime expect
  assert.equal(typeof cond.__conditionId, 'string');
  assert.ok(cond.__conditionId.length > 0);
  assert.equal(cond.ifElseNodeId, '');
  assert.equal(cond.isWait, false);
  assert.equal(cond.__customFieldType__, 'standard'); // contact_detail carries this
  assert.deepEqual(cond.nestedDropdownTypes, IFELSE_NESTED_DROPDOWN_TYPES);
  assert.deepEqual(cond.allowIsOperatorTypes, IFELSE_ALLOW_IS_OPERATOR_TYPES);
});

// Regression (root-caused 2026-07-15): when if_else branches omit `ref`, every
// ref-less branch used to collapse onto one refMap `undefined` key — duplicating
// branch ids in next[] (live symptom next:[b1,b2,b2]) and dropping later branches'
// segments. Mirrors the live "08 Deposit Paid Handler" defect: two conditioned
// branches + an else fallback, all authored WITHOUT refs.
const refLessMultiBranchIR = {
  name: 'PaidProduct', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
  graph: [
    { kind: 'if_else', name: 'Which paid product?', branches: [
      { name: 'Treatment', conditions: [{ conditionType: 'contact_detail', conditionSubType: 'tag', conditionOperator: 'contains', conditionValue: 'treatment' }], then: [
        { kind: 'action', type: 'add_contact_tag', name: 'Tag Treatment', attributes: { tags: ['treatment'] } } ] },
      { name: 'Course', conditions: [{ conditionType: 'contact_detail', conditionSubType: 'tag', conditionOperator: 'contains', conditionValue: 'course' }], then: [
        { kind: 'action', type: 'add_contact_tag', name: 'Tag Course', attributes: { tags: ['course'] } } ] },
      { name: 'None', else: true, then: [
        { kind: 'action', type: 'add_contact_tag', name: 'Tag Fallback', attributes: { tags: ['fallback'] } } ] },
    ] },
  ],
};

test('if_else with ref-less branches: N conditioned + separate None node, per-branch segments', () => {
  const { autoSaveBody } = compile(refLessMultiBranchIR, ctx());
  const t = autoSaveBody.workflowData.templates;
  const container = t.find((s) => s.name === 'Which paid product?');
  // next = [treatment, course, None] — 2 conditioned + 1 separate None node
  assert.equal(container.next.length, 3);
  assert.equal(new Set(container.next).size, 3, 'branch ids in next must be distinct');
  // attributes.branches holds the 2 CONDITIONED branches only (None excluded)
  const branchIds = container.attributes.branches.map((b) => b.id);
  assert.equal(branchIds.length, 2);
  assert.equal(new Set(branchIds).size, 2);
  assert.deepEqual(branchIds, container.next.slice(0, 2), 'conditioned ids lead next[]');
  assert.equal(container.next.length, branchIds.length + 1);
  // EVERY conditioned branch keeps its own segments (not just the first)
  const [treatment, course] = container.attributes.branches;
  assert.equal(treatment.segments.length, 1);
  assert.equal(treatment.segments[0].conditions[0].conditionValue, 'treatment');
  assert.equal(course.segments.length, 1, 'second conditioned branch must keep its condition');
  assert.equal(course.segments[0].conditions[0].conditionValue, 'course');
  // the None node is the 3rd next entry: nodeType branch-no, attributes {else:true}
  const noneNode = t.find((s) => s.id === container.next[2] && s.type === 'if_else');
  assert.equal(noneNode.nodeType, 'branch-no');
  assert.deepEqual(noneNode.attributes, { else: true });
  assert.equal(noneNode.next, t.find((s) => s.name === 'Tag Fallback').id, 'else fallback wired to None node');
  // the two conditioned nodes are branch-yes
  const yes0 = t.find((s) => s.id === container.next[0] && s.type === 'if_else');
  assert.equal(yes0.nodeType, 'branch-yes');
});

// An if_else with NO authored else branch still gets a synthesized None node
// (the builder always adds one; next.length === conditioned + 1). Its next is null.
const noElseIR = {
  name: 'NoElse', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
  graph: [
    { kind: 'if_else', name: 'Gate', branches: [
      { name: 'A', conditions: [{ conditionType: 'contact_detail', conditionSubType: 'field', conditionOperator: 'contain', conditionValue: 'a' }], then: [
        { kind: 'action', type: 'add_contact_tag', name: 'Tag A', attributes: { tags: ['a'] } } ] },
      { name: 'B', conditions: [{ conditionType: 'contact_detail', conditionSubType: 'field', conditionOperator: 'contain', conditionValue: 'b' }], then: [
        { kind: 'action', type: 'add_contact_tag', name: 'Tag B', attributes: { tags: ['b'] } } ] },
    ] },
  ],
};

test('if_else with no else branch synthesizes a None node with next:null', () => {
  const { autoSaveBody } = compile(noElseIR, ctx());
  const t = autoSaveBody.workflowData.templates;
  const container = t.find((s) => s.name === 'Gate');
  assert.equal(container.next.length, 3, '2 conditioned + synthesized None');
  assert.equal(container.attributes.branches.length, 2);
  assert.equal(container.attributes.noneBranchName, 'None');
  const noneNode = t.find((s) => s.id === container.next[2] && s.type === 'if_else');
  assert.equal(noneNode.nodeType, 'branch-no');
  assert.deepEqual(noneNode.attributes, { else: true });
  assert.equal(noneNode.next, null, 'no fallback ladder → None.next is null');
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

test('voice_ai_outbound_call: attributes + workflowsActionType INTERNAL (live-verified shape)', () => {
  const ir = { name: 'V', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }], graph: [
    { ref: 'v', kind: 'action', type: 'voice_ai_outbound_call', name: 'Voice AI outbound call',
      attributes: { agentId: '6a2632febba50b0bbd1031d2', fromPhoneNumber: '+61481610656' } },
  ] };
  const { autoSaveBody } = compile(ir, ctx());
  const t = autoSaveBody.workflowData.templates[0];
  assert.equal(t.type, 'voice_ai_outbound_call');
  assert.equal(t.workflowsActionType, 'INTERNAL');
  assert.equal(t.attributes.agentId, '6a2632febba50b0bbd1031d2');
  assert.equal(t.attributes.fromPhoneNumber, '+61481610656');
  assert.equal(t.attributes.type, 'voice_ai_outbound_call');
  assert.equal(t.attributes.outboundGuidelines, '');
  assert.deepEqual(t.attributes.__customInputs__, {});
});

test('voice_ai_outbound_call: missing agentId or fromPhoneNumber rejected', () => {
  const missingAgent = { name: 'V', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }], graph: [
    { ref: 'v', kind: 'action', type: 'voice_ai_outbound_call', name: 'Voice AI outbound call', attributes: { fromPhoneNumber: '+61481610656' } },
  ] };
  assert.throws(() => compile(missingAgent, ctx()), (e) => e.code === 'MISSING_FIELD');
  const missingPhone = { name: 'V', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }], graph: [
    { ref: 'v', kind: 'action', type: 'voice_ai_outbound_call', name: 'Voice AI outbound call', attributes: { agentId: '6a2632febba50b0bbd1031d2' } },
  ] };
  assert.throws(() => compile(missingPhone, ctx()), (e) => e.code === 'MISSING_FIELD');
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
  // filter expansion enriches the lean {field,operator,value} into the full UI condition shape
  assert.deepEqual(triggerBodies[0].conditions, [{ field: 'tagsAdded', operator: 'index-of-true', value: ['VIP'], title: 'tag_added', type: 'select', id: 'tag-added' }]);
  assert.equal(autoSaveBody.createdSteps.length, 8);
});

test('empty triggers compile to zero triggerBodies', () => {
  const { triggerBodies, autoSaveBody } = compile({ name: 'W', triggers: [],
    graph: [{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'A', attributes: { tags: ['x'] } }] }, ctx());
  assert.deepEqual(triggerBodies, []);
  assert.equal(autoSaveBody.workflowData.templates.length, 1);
});

test('invented attribute key fails at compile (ATTR_KEY), not as a blank step', () => {
  const ir = { name: 'W', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
    graph: [{ ref: 's', kind: 'action', type: 'sms', name: 'S', attributes: { message: 'hi' } }] };
  assert.throws(() => compile(ir, ctx()), (e) => e.code === 'ATTR_KEY' && /message/.test(e.message) && /body/.test(e.message));
});

test('known + engine + resolver-intent attribute keys pass validation', () => {
  const ir = { name: 'W', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
    graph: [
      { ref: 's', kind: 'action', type: 'sms', name: 'S', attributes: { body: 'hi', attachments: [], template_id: 'X' } },
      { ref: 'u', kind: 'action', type: 'assign_user', name: 'U', attributes: { user: 'Jane Doe', user_list: ['UID1'] } },
    ] };
  const { autoSaveBody } = compile(ir, ctx());
  assert.equal(autoSaveBody.workflowData.templates.length, 2);
});

test('internal_notification derives attributes.type from the channel envelope', () => {
  const ir = { name: 'W', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
    graph: [{ ref: 'n', kind: 'action', type: 'internal_notification', name: 'N',
      attributes: { sms: { body: 'ping', userType: 'assign', attachments: [] } } }] };
  const { autoSaveBody } = compile(ir, ctx());
  assert.equal(autoSaveBody.workflowData.templates[0].attributes.type, 'sms');
});

// The builder's editor form binds to the full per-channel shape; a drifted/partial shape
// fires at runtime but won't OPEN when clicked. The compiler emits the corpus-canonical
// field set per channel (harvested from 180 live steps, 2026-07-15), correctly typed.
const inA = (ir) => compile(ir, ctx()).autoSaveBody.workflowData.templates[0].attributes;

test('internal_notification sms/user: selectedUser coerced to array + full fields', () => {
  const a = inA({ name: 'W', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
    graph: [{ kind: 'action', type: 'internal_notification', name: 'N',
      attributes: { sms: { body: 'ping', userType: 'user', selectedUser: 'USER123' } } }] });
  assert.equal(a.type, 'sms');
  assert.deepEqual(a.sms.selectedUser, ['USER123'], 'sms selectedUser must be an ARRAY');
  assert.equal(a.sms.body, 'ping');
  assert.equal(a.sms.userType, 'user');
  assert.deepEqual(a.sms.attachments, []);
});

test('internal_notification email: full editable shape (from/userType/subject/html/attachments)', () => {
  const a = inA({ name: 'W', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
    graph: [{ kind: 'action', type: 'internal_notification', name: 'N',
      attributes: { email: { subject: 'Hi', html: '<p>x</p>' } } }] });
  assert.equal(a.type, 'email');
  assert.deepEqual(Object.keys(a.email).sort(),
    ['attachments', 'from_email', 'from_name', 'html', 'subject', 'userType']);
  assert.equal(a.email.userType, 'all'); // default when no recipient specified
  assert.equal(a.email.subject, 'Hi');
});

test('internal_notification notification: nested type + string selectedUser', () => {
  const a = inA({ name: 'W', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
    graph: [{ kind: 'action', type: 'internal_notification', name: 'N',
      attributes: { notification: { body: 'hey', title: 'T', userType: 'user', selectedUser: ['U1'] } } }] });
  assert.equal(a.type, 'notification');
  assert.equal(a.notification.type, 'send_notification'); // nested subtype the editor needs
  assert.equal(a.notification.title, 'T');
  assert.equal(a.notification.redirectPage, 'contact');
  assert.equal(a.notification.selectedUser, 'U1', 'notification selectedUser is a STRING (not array)');
});
