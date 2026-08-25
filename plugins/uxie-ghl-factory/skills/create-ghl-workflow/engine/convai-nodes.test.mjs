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
  // These are the COMMITTED shapes captured on AU 2026-07-25, not the previously
  // documented ones. `end` was {customMessage, reactivate, duration} — all three names
  // wrong; authoring `reactivate` persisted an unknown key while the actually-required
  // `sleepEnabled` stayed unset, so the node kept its error badge. `continue` is literally
  // {} and `transfer_bot` is {assignedEmployeeId} only — the `prompt` key on both was a
  // recon read of the panel and never persisted.
  const cases = [
    { type: 'conversationai_end', attributes: { message: 'bye', sleepEnabled: true, sleepDuration: 1, sleepUnit: 'hours' } },
    { type: 'conversationai_continue', attributes: {} },
    { type: 'conversationai_transfer_bot', attributes: { assignedEmployeeId: 'AGENT2' } },
    { type: 'conversationai_services_booking', attributes: { conversationai_services: ['svc1'], conversationai_booking_description: 'book a facial' } },
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

test('FLOW_BUILDER_BOT binding: conv_ai_trigger binds via a botId CONDITION + workflow persists workflowType:agent', () => {
  const out = compile({
    name: 'Flow', workflowType: 'agent',
    triggers: [{ ref: 't', type: 'conv_ai_trigger', name: 'Chat Initiated', filters: [], convTriggerBotId: 'AGENT9' }],
    graph: [{ ref: 'm', kind: 'action', type: 'conversationai_ai_message', name: 'AI message', attributes: { message: 'hi', waitForReply: true } }],
  }, ctx());
  // The flow binds to its agent through a CONDITION ROW -- the shape GHL's own client stores
  // (capture 2026-04-20). This assertion previously pinned `convTriggerBotId` at the top level
  // and passed for over a month while every flow the engine built was UNBOUND: live read-back
  // on 2026-08-26 showed GHL discards that key and leaves conditions empty.
  assert.deepEqual(out.triggerBodies[0].conditions,
    [{ operator: '==', field: 'botId', value: 'AGENT9', title: '', type: 'input' }]);
  assert.equal(out.triggerBodies[0].type, 'conv_ai_trigger');
  // and the key GHL throws away is not sent at all
  assert.equal('convTriggerBotId' in out.triggerBodies[0], false);
  // and persists as an agent-type workflow so the flow builder opens it as the bot canvas
  assert.equal(out.autoSaveBody.workflowType, 'agent');
  assert.equal(out.autoSaveBody.type, 'workflow'); // type stays "workflow"
});

test('an unbound conv_ai_trigger warns rather than silently building a flow no bot can enter', () => {
  const warnings = [];
  const c = { ...ctx(), warn: (m) => warnings.push(m) };
  compile({
    name: 'Flow', workflowType: 'agent',
    triggers: [{ ref: 't', type: 'conv_ai_trigger', name: 'Chat Initiated', filters: [] }],
    graph: [{ ref: 'm', kind: 'action', type: 'conversationai_ai_message', name: 'AI message', attributes: { message: 'hi', waitForReply: true } }],
  }, c);
  assert.ok(warnings.some((w) => w.startsWith('FLOW_BINDING:')),
    `expected a FLOW_BINDING warning, got ${JSON.stringify(warnings)}`);
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

// ── Flow-entry guard (live-proven 2026-08-26: GHL's API refuses NONE of this) ────────────────
test('edit ops refuse to modify or delete a conv_ai_trigger, and the hatch opens it', async () => {
  const { planTriggerOps } = await import('./edit-driver.mjs');
  const existing = [{
    id: 'TRIG1', type: 'conv_ai_trigger', name: 'Chat Initiated',
    conditions: [{ operator: '==', field: 'botId', value: 'AGENT9', title: '', type: 'input' }],
  }];
  const c = ctx();
  for (const op of [{ op: 'modifyTrigger', triggerId: 'TRIG1', trigger: { type: 'contact_tag' } },
    { op: 'deleteTrigger', triggerId: 'TRIG1' }]) {
    assert.throws(() => planTriggerOps([op], { ctx: c, wid: 'W', uid: 'U', existing }),
      /FLOW_BUILDER_BOT flow bound to agent AGENT9/, `${op.op} must refuse`);
  }
  // an ordinary trigger is untouched by the guard
  assert.ok(planTriggerOps([{ op: 'deleteTrigger', triggerId: 'T2' }],
    { ctx: c, wid: 'W', uid: 'U', existing: [{ id: 'T2', type: 'contact_tag', name: 'Tag' }] }).length === 1);
  // and the hatch lets a caller who means it through
  assert.ok(planTriggerOps([{ op: 'deleteTrigger', triggerId: 'TRIG1' }],
    { ctx: { ...c, allowFlowTriggerEdit: true }, wid: 'W', uid: 'U', existing }).length === 1);
});

// ── services_booking is a CONTAINER (asset: 2 pre-defined branches) ──────────────────────────
test('conversationai_services_booking compiles as multipath with both branches and their tails', () => {
  const t = tmpl({
    name: 'SB', triggers: [flowTrigger],
    graph: [{ ref: 'sb', kind: 'action', type: 'conversationai_services_booking', name: 'Services booking',
      attributes: { conversationai_services: ['svc1'], conversationai_booking_description: 'book a facial' },
      onBooked: [{ kind: 'action', type: 'add_contact_tag', name: 'Booked', attributes: { tags: ['b'] } }],
      onNotBooked: [{ kind: 'action', type: 'add_contact_tag', name: 'NotBooked', attributes: { tags: ['nb'] } }] }],
  });
  const c = t.find((s) => s.type === 'conversationai_services_booking');
  // It shipped as a PLAIN node until 2026-08-26 — no cat, no transitions, next:null — because the
  // catalogue carried isMultipathContainer:false from a panel read and the compiler had no case.
  assert.equal(c.cat, 'multi-path');
  assert.equal(c.attributes.convertToMultipath, true);
  assert.equal(c.attributes.transitions.length, 2);
  assert.deepEqual(c.attributes.transitions.map((x) => x.name), ['Appointment Booked', 'Appointment Not Booked']);
  assert.equal(c.next.length, 2);
  // both tails are wired to their own transition node
  assert.equal(t.find((s) => s.name === 'Booked').parent, c.next[0]);
  assert.equal(t.find((s) => s.name === 'NotBooked').parent, c.next[1]);
});

// ── goto trigger ("Custom trigger") ─────────────────────────────────────────────────────────
test('conv_ai_autonomous_trigger resolves target -> targetActionId and expands its four filters', async () => {
  const { compile: c2 } = await import('./compiler.mjs');
  const out = c2({
    name: 'Flow', workflowType: 'agent',
    triggers: [
      { ref: 't1', type: 'conv_ai_trigger', name: 'Chat Initiated', filters: [], convTriggerBotId: 'AGENT9' },
      { ref: 't2', type: 'conv_ai_autonomous_trigger', name: 'Custom Trigger', target: 'book',
        filters: [
          { field: 'customTriggerType', value: 'book_appointment' },
          { field: 'customTriggerDescription', value: 'The customer wants to book' },
          { field: 'customTriggerPriority', value: '8' },
          { field: 'customTriggerSensitivity', value: 'medium' },
        ] },
    ],
    graph: [
      { ref: 'msg', kind: 'action', type: 'conversationai_ai_message', name: 'Greet', attributes: { message: 'hi', waitForReply: true } },
      { ref: 'book', kind: 'action', type: 'conversationai_book_appointment', name: 'Book', attributes: { calendarId: 'CAL1' } },
    ],
  }, ctx());
  const bookId = out.autoSaveBody.workflowData.templates.find((s) => s.type === 'conversationai_book_appointment').id;
  const goto = out.triggerBodies[1];
  // the jump target is a REAL step id, resolved from the ref — a goto trigger with no
  // targetActionId saves and has nowhere to send the contact
  assert.equal(goto.targetActionId, bookId);
  // and the rows carry the envelope GHL's own builder writes: operator `eq` (NOT `==`), type
  // `input`, title '' — captured live 2026-08-26
  assert.deepEqual(goto.conditions, [
    { field: 'customTriggerType', operator: 'eq', value: 'book_appointment', title: '', type: 'input' },
    { field: 'customTriggerDescription', operator: 'eq', value: 'The customer wants to book', title: '', type: 'input' },
    { field: 'customTriggerPriority', operator: 'eq', value: '8', title: '', type: 'input' },
    { field: 'customTriggerSensitivity', operator: 'eq', value: 'medium', title: '', type: 'input' },
  ]);
  // the entry trigger is NOT a goto and carries no target
  assert.equal('targetActionId' in out.triggerBodies[0], false);
});

test('a goto trigger pointing at a ref that does not exist is rejected, not silently emitted', async () => {
  const { compile: c2 } = await import('./compiler.mjs');
  assert.throws(() => c2({
    name: 'Flow', workflowType: 'agent',
    triggers: [
      { ref: 't1', type: 'conv_ai_trigger', name: 'Chat', filters: [], convTriggerBotId: 'A9' },
      { ref: 't2', type: 'conv_ai_autonomous_trigger', name: 'Custom', target: 'nope', filters: [] },
    ],
    graph: [{ ref: 'msg', kind: 'action', type: 'conversationai_ai_message', name: 'Greet', attributes: { message: 'hi', waitForReply: false } }],
  }, ctx()), /REF_DANGLING/);
});
