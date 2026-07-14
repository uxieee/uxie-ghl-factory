// Conversation-AI flow-builder node shapes. Mirrors the live captures at
// flow-builder-captures/conv-ai-node-templates.json + recon-flow-workflow-full.json
// (2026-07-14). A FLOW_BUILDER_BOT's logic IS a workflow: conv_ai_trigger + these
// conversationai_* INTERNAL nodes (+ custom_webhook to the worker).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('a'), catalog: loadCatalog() });
const tmpl = (ir) => compile(ir, ctx()).autoSaveBody.workflowData.templates;
const flowTrigger = { ref: 't', type: 'conv_ai_trigger', name: 'Chat Initiated', filters: [] };

test('linear conv-ai nodes (ai_message / custom_message) emit the captured INTERNAL shape', () => {
  const t = tmpl({
    name: 'Msgs', triggers: [flowTrigger],
    graph: [
      { ref: 'm', kind: 'action', type: 'conversationai_ai_message', name: 'AI message', attributes: { message: 'Share the slots', waitForReply: true } },
      { ref: 'c', kind: 'action', type: 'conversationai_custom_message', name: 'Custom message', attributes: { message: 'Verbatim text', waitForReply: true } },
    ],
  });
  const ai = t.find((s) => s.type === 'conversationai_ai_message');
  assert.equal(ai.workflowsActionType, 'INTERNAL');
  assert.deepEqual(ai.attributes, { message: 'Share the slots', waitForReply: true, type: 'conversationai_ai_message', __customInputs__: {} });
  const cm = t.find((s) => s.type === 'conversationai_custom_message');
  assert.deepEqual(cm.attributes, { message: 'Verbatim text', waitForReply: true, type: 'conversationai_custom_message', __customInputs__: {} });
});

test('conversationai_objective emits full attribute shape + stepIndex (premium)', () => {
  const t = tmpl({
    name: 'Obj', triggers: [flowTrigger],
    graph: [{ ref: 'o', kind: 'action', type: 'conversationai_objective', name: 'AI capture information',
      attributes: { objective: 'capture day-type', contactField: 'day_type_preference', instructions: '', responseExample: '', skipIfFilled: false, maxAttempts: '5', proceedIfNotMet: false } }],
  });
  const o = t.find((s) => s.type === 'conversationai_objective');
  assert.equal(o.workflowsActionType, 'INTERNAL');
  assert.equal(o.attributes.type, 'conversationai_objective');
  assert.deepEqual(o.attributes.__customInputs__, {});
  assert.equal(o.attributes.objective, 'capture day-type');
  assert.equal(o.attributes.contactField, 'day_type_preference');
  assert.equal(typeof o.stepIndex, 'number'); // premium node carries a stepIndex
});

test('conversationai_book_appointment: multipath container with 2 pre-defined branches', () => {
  const t = tmpl({
    name: 'Book', triggers: [flowTrigger],
    graph: [{ kind: 'action', type: 'conversationai_book_appointment', name: 'Book appointment',
      attributes: { promptInstructions: 'Get the customer to book an appointment', calendarId: 'CAL123' },
      onBooked: [{ kind: 'action', type: 'add_contact_tag', name: 'Booked Tag', attributes: { tags: ['booked'] } }],
      onNotBooked: [{ kind: 'action', type: 'add_contact_tag', name: 'NotBooked Tag', attributes: { tags: ['nb'] } }] }],
  });
  const c = t.find((s) => s.type === 'conversationai_book_appointment');
  assert.equal(c.cat, 'multi-path');
  assert.equal(c.workflowsActionType, 'INTERNAL');
  assert.equal(c.attributes.convertToMultipath, true);
  assert.equal(c.attributes.calendarId, 'CAL123');
  assert.equal(c.attributes.__name__, 'Book appointment');
  assert.equal(c.attributes.transitions.length, 2);
  assert.deepEqual(c.attributes.transitions[0].fields, { appointmentBooked: true, appointmentNotBooked: false });
  assert.deepEqual(c.attributes.transitions[1].fields, { appointmentNotBooked: true });
  assert.equal(c.attributes.transitions[0].conditionType, 'pre-defined');
  // next points at the two transition nodes, distinct
  assert.equal(c.next.length, 2);
  assert.equal(new Set(c.next).size, 2);
  const [t1, t2] = c.next.map((id) => t.find((s) => s.id === id && s.type === 'transition'));
  assert.equal(t1.name, 'Appointment Booked');
  assert.equal(t2.name, 'Appointment Not booked');
  assert.equal(t1.parent, c.id);
  // tails wired under each branch
  assert.equal(t.find((s) => s.name === 'Booked Tag').parent, t1.id);
  assert.equal(t.find((s) => s.name === 'NotBooked Tag').parent, t2.id);
});

test('conversationai_ai_splitter: author branches + No-condition-met fallback, distinct ids', () => {
  const t = tmpl({
    name: 'Split', triggers: [flowTrigger],
    graph: [{ kind: 'action', type: 'conversationai_ai_splitter', name: 'AI splitter',
      attributes: { description: 'weekday vs weekend' },
      branches: [
        { name: 'Weekday', then: [{ kind: 'action', type: 'add_contact_tag', name: 'WD', attributes: { tags: ['wd'] } }] },
        { name: 'Weekend', then: [{ kind: 'action', type: 'add_contact_tag', name: 'WE', attributes: { tags: ['we'] } }] },
      ],
      default: [{ kind: 'action', type: 'add_contact_tag', name: 'Fallback', attributes: { tags: ['fb'] } }] }],
  });
  const c = t.find((s) => s.type === 'conversationai_ai_splitter');
  assert.equal(c.cat, 'multi-path');
  assert.equal(c.workflowsActionType, 'INTERNAL');
  assert.equal(c.attributes.description, 'weekday vs weekend');
  // 1 fallback (FIRST) + 2 author branches = 3 transitions, all distinct
  // (mirrors catalog/step-examples/conversationai_ai_splitter.json)
  assert.equal(c.attributes.transitions.length, 3);
  assert.equal(c.next.length, 3);
  assert.equal(new Set(c.next).size, 3, 'branch ids in next must be distinct');
  // fallback comes first: pre-defined + __branchKey__
  assert.equal(c.attributes.transitions[0].name, 'No condition met');
  assert.equal(c.attributes.transitions[0].conditionType, 'pre-defined');
  assert.ok(c.attributes.transitions[0].meta.__branchKey__);
  assert.equal(c.next[0], c.attributes.transitions[0].id);
  // author branches: user-defined with empty meta
  assert.equal(c.attributes.transitions[1].name, 'Weekday');
  assert.equal(c.attributes.transitions[1].conditionType, 'user-defined');
  assert.deepEqual(c.attributes.transitions[2].meta, {});
  // tails wired: fallback first, named after
  assert.equal(t.find((s) => s.name === 'Fallback').parent, c.next[0]);
  assert.equal(t.find((s) => s.name === 'WD').parent, c.next[1]);
});

test('fields-only conv-ai nodes (end/continue/transfer_bot/services_booking) get the INTERNAL envelope', () => {
  const cases = [
    { type: 'conversationai_end', attributes: { customMessage: 'bye', reactivate: true, duration: 1 } },
    { type: 'conversationai_continue', attributes: { prompt: 'keep going' } },
    { type: 'conversationai_transfer_bot', attributes: { assignedEmployeeId: 'AGENT2', prompt: 'hand over' } },
    { type: 'conversationai_services_booking', attributes: { services: ['svc1'], description: 'book a facial' } },
  ];
  for (const c of cases) {
    const t = tmpl({ name: 'X', triggers: [flowTrigger],
      graph: [{ ref: 'n', kind: 'action', type: c.type, name: c.type, attributes: c.attributes }] });
    const node = t.find((s) => s.type === c.type);
    assert.equal(node.workflowsActionType, 'INTERNAL', `${c.type} INTERNAL`);
    assert.equal(node.attributes.type, c.type, `${c.type} attributes.type`);
    assert.deepEqual(node.attributes.__customInputs__, {}, `${c.type} __customInputs__`);
  }
});

test('FLOW_BUILDER_BOT binding: conv_ai_trigger carries convTriggerBotId + workflow persists workflowType:agent', () => {
  const out = compile({
    name: 'Flow', workflowType: 'agent',
    triggers: [{ ref: 't', type: 'conv_ai_trigger', name: 'Chat Initiated', filters: [], convTriggerBotId: 'AGENT9' }],
    graph: [{ ref: 'm', kind: 'action', type: 'conversationai_ai_message', name: 'AI message', attributes: { message: 'hi', waitForReply: true } }],
  }, ctx());
  // the flow binds to its agent (was silently dropped before the 2026-07-15 fix)
  assert.equal(out.triggerBodies[0].convTriggerBotId, 'AGENT9');
  assert.equal(out.triggerBodies[0].type, 'conv_ai_trigger');
  // and persists as an agent-type workflow so the flow builder opens it as the bot canvas
  assert.equal(out.autoSaveBody.workflowType, 'agent');
  assert.equal(out.autoSaveBody.type, 'workflow'); // type stays "workflow"
});

test('non-flow workflows omit workflowType and convTriggerBotId', () => {
  const out = compile({
    name: 'Plain', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }],
    graph: [{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['x'] } }],
  }, ctx());
  assert.equal('workflowType' in out.autoSaveBody, false);
  assert.equal('convTriggerBotId' in out.triggerBodies[0], false);
});

test('ai_splitter branch missing name is rejected', () => {
  assert.throws(() => tmpl({
    name: 'Bad', triggers: [flowTrigger],
    graph: [{ kind: 'action', type: 'conversationai_ai_splitter', name: 'AI splitter', attributes: { description: 'x' },
      branches: [{ then: [] }] }],
  }), (e) => e.code === 'AI_SPLITTER_BRANCH');
});
