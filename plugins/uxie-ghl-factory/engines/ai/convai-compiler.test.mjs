import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileConvaiAgent, compileConvaiAction, compileConvaiUpdate, compileLinkFlowWorkflow, compileFlowBuilderBot, AUTH_HEADER, uiSaveViolations, compileConvaiUpdateFromRecord, applyBotTypeCleanup } from './convai-compiler.mjs';
import { IRError } from './convai-ir.mjs';

// Mirrors captures/convai-create.json's request_body 1:1 (values changed only where the
// IR supplies them; everything else must match the capture's literal defaults).
const fullIR = {
  name: 'TEST-CAP-CONVAI',
  mode: 'suggestive',
  // The capture predates the UI's tone requirement; a currently-valid agent carries tones, and
  // without them a FLOW_BUILDER_BOT is created over the API and then cannot be saved from the UI.
  // The field-for-field assertions below do not pin `tones`, so this changes nothing they check.
  tones: ['professional'],
  channels: ['SMS', 'IG', 'FB', 'WebChat', 'Live_Chat', 'WhatsApp'],
  wait: { value: 2, unit: 'seconds' },
  sleep: { enabled: false, onManualMessage: false, onWorkflowMessage: false, time: 2, timeUnit: 'hours' },
  autoPilotMaxMessages: 75,
  personality: 'You are a bot for {{ai.business_name}}, tasked to assist customers. Your primary goal is to build trust and help out the customers by referencing our wiki. \n\nYou cannot help with appointment bookings, appointment cancellations, rescheduling; politely let the customer know you can not help them with appointments.',
  goal: 'Your goal is to assist the customers with their queries.',
  instructions: 'Conversation Guidelines:\n* Maintain a casual, purposeful, and concise tone.',
  knowledgeBaseIds: [],
};

test('compileConvaiAgent: create body matches convai-create.json field-for-field', () => {
  const { create, authHeader } = compileConvaiAgent(fullIR, { locationId: 'wdzEoUZnXO9tB3PPzcot' });
  assert.equal(create.method, 'POST');
  assert.equal(create.path, '/ai-employees/employees');
  const b = create.body;
  assert.equal(b.locationId, 'wdzEoUZnXO9tB3PPzcot');
  assert.equal(b.employeeName, 'TEST-CAP-CONVAI');
  assert.equal(b.businessName, '');
  assert.equal(b.mode, 'suggestive');
  assert.deepEqual(b.channels, ['SMS', 'IG', 'FB', 'WebChat', 'Live_Chat', 'WhatsApp']);
  assert.equal(b.isPrimary, false);
  assert.equal(b.waitTime, 2);
  assert.equal(b.waitTimeUnit, 'seconds');
  assert.equal(b.sleepEnabled, false);
  assert.equal(b.sleepOnManualMessage, false);
  assert.equal(b.sleepOnWorkflowMessage, false);
  assert.equal(b.sleepTime, 2);
  assert.equal(b.sleepTimeUnit, 'hours');
  assert.equal(b.autoPilotMaxMessages, 75);
  assert.deepEqual(b.actions, []);
  assert.equal(b.personality, fullIR.personality);
  assert.equal(b.goal, fullIR.goal);
  assert.equal(b.instructions, fullIR.instructions);
  assert.equal(b.botType, 'PROMPT_BASED_BOT');
  assert.deepEqual(b.knowledgeBaseIds, []);
  assert.deepEqual(b.knowledgeBaseTriggers, []);
  assert.deepEqual(b.summary, {
    enabled: false,
    inactivity: { value: 15, unit: 'minutes' },
    minimumMessages: 3,
    workflowIds: [],
    emailNotifications: { admins: false, allUsers: false, contactAssignedUser: false, specificUsers: [], customEmail: '' },
  });
  assert.equal(b.respondToImages, false);
  assert.equal(b.respondToAudio, false);
  assert.equal(b.objectiveBuilderWorkflowId, '');
  assert.equal(b.isObjectiveBuilderEnabled, false);
  assert.equal(b.aiResponseLengthEnabled, false);
  assert.equal(b.responseLength, 'balanced');
  assert.equal(authHeader, 'ai');
  assert.equal(AUTH_HEADER, 'ai');
});

test('compileConvaiAgent: defaults apply when wait/sleep/autoPilotMaxMessages omitted', () => {
  const minimalIR = { name: 'Minimal', mode: 'off', channels: ['SMS'] };
  const { create } = compileConvaiAgent(minimalIR, { locationId: 'LOC' });
  assert.equal(create.body.waitTime, 2);
  assert.equal(create.body.waitTimeUnit, 'seconds');
  assert.equal(create.body.sleepEnabled, false);
  assert.equal(create.body.sleepTime, 2);
  assert.equal(create.body.sleepTimeUnit, 'hours');
  assert.equal(create.body.autoPilotMaxMessages, 75);
  assert.equal(create.body.personality, '');
  assert.equal(create.body.goal, '');
  assert.equal(create.body.instructions, '');
});

test('compileConvaiAgent: rejects invalid IR (missing name)', () => {
  assert.throws(() => compileConvaiAgent({ mode: 'off', channels: ['SMS'] }, { locationId: 'LOC' }),
    (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('compileConvaiAgent: action list compiled into separate actions[] descriptors', () => {
  const ir = {
    ...fullIR,
    actions: [{
      type: 'humanHandOver',
      name: 'Human Requested',
      details: { handoverType: 'contactRequest', triggerCondition: 'Direct request to speak with human' },
    }],
  };
  const { create, actions } = compileConvaiAgent(ir, { locationId: 'LOC' });
  // create body itself always carries an empty actions[] (actions are a separate resource)
  assert.deepEqual(create.body.actions, []);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].method, 'POST');
  assert.equal(actions[0].path, '/ai-employees/actions');
  assert.equal(actions[0].body.type, 'humanHandOver');
  assert.equal(actions[0].body.name, 'Human Requested');
  assert.equal(actions[0].body.locationId, 'LOC');
  assert.deepEqual(actions[0].body.details, {
    handoverType: 'contactRequest',
    triggerCondition: 'Direct request to speak with human',
    enabled: true,
    reactivateEnabled: false,
    sleepTime: 8,
    sleepTimeUnit: 'hours',
  });
});

// Matches captures/convai-action.json's request_body field-for-field.
test('compileConvaiAction: humanHandOver matches convai-action.json shape', () => {
  const action = {
    type: 'humanHandOver',
    name: 'Human Requested',
    details: {
      triggerCondition: 'Direct request to speak with human',
      finalMessage: "Sure! I'm transferring your request to a human agent. Someone from the team will get back to you within 24 hours.",
      reactivateEnabled: true,
      sleepTimeUnit: 'hours',
      sleepTime: 8,
      enabled: true,
      tags: ['human handover'],
      examples: ['I want to talk to the manager', 'I want to talk to a human'],
      skipAssignToUser: true,
      createTask: true,
      assignToUserId: 'CpTT7UCqUcPNfWgg3ArU',
      handoverType: 'contactRequest',
    },
  };
  const { method, path, body } = compileConvaiAction(action, { agentId: '69udtYyGwTVOL9doSdfb', locationId: 'wdzEoUZnXO9tB3PPzcot' });
  assert.equal(method, 'POST');
  assert.equal(path, '/ai-employees/actions');
  assert.equal(body.employeeId, '69udtYyGwTVOL9doSdfb');
  assert.equal(body.locationId, 'wdzEoUZnXO9tB3PPzcot');
  assert.equal(body.type, 'humanHandOver');
  assert.equal(body.name, 'Human Requested');
  assert.deepEqual(body.details, action.details);
  assert.equal(body.details.handoverType, 'contactRequest');
});

test('compileConvaiAction: rejects missing type/name', () => {
  assert.throws(() => compileConvaiAction({ name: 'X' }, { locationId: 'LOC' }), (e) => e.code === 'SCHEMA');
  assert.throws(() => compileConvaiAction({ type: 'humanHandOver' }, { locationId: 'LOC' }), (e) => e.code === 'SCHEMA');
});

// Live-verified 422 gap: the API rejects a humanHandOver action lacking these fields
// even though only `details.handoverType` was previously emitted.
test('compileConvaiAction: humanHandOver merges API-required detail defaults over provided details', () => {
  const { body } = compileConvaiAction(
    { type: 'humanHandOver', name: 'Human Requested', details: { triggerCondition: 'Direct request to speak with human', handoverType: 'contactRequest' } },
    { agentId: 'AGENT1', locationId: 'LOC' },
  );
  assert.equal(body.details.enabled, true);
  assert.equal(body.details.reactivateEnabled, false);
  assert.equal(body.details.sleepTime, 8);
  assert.equal(body.details.sleepTimeUnit, 'hours');
  assert.equal(body.details.triggerCondition, 'Direct request to speak with human');
  assert.equal(body.details.handoverType, 'contactRequest');
});

test('compileConvaiAction: humanHandOver provided enabled/reactivateEnabled override the defaults', () => {
  const { body } = compileConvaiAction(
    { type: 'humanHandOver', name: 'Human Requested', details: { triggerCondition: 'Direct request to speak with human', enabled: false, reactivateEnabled: true } },
    { agentId: 'AGENT1', locationId: 'LOC' },
  );
  assert.equal(body.details.enabled, false);
  assert.equal(body.details.reactivateEnabled, true);
});

test('compileConvaiAction: humanHandOver rejects missing triggerCondition', () => {
  assert.throws(
    () => compileConvaiAction({ type: 'humanHandOver', name: 'Human Requested', details: { handoverType: 'contactRequest' } }, { locationId: 'LOC' }),
    (e) => e instanceof IRError && e.code === 'SCHEMA',
  );
});

test('compileConvaiAction: humanHandOver rejects too-short triggerCondition', () => {
  assert.throws(
    () => compileConvaiAction({ type: 'humanHandOver', name: 'Human Requested', details: { triggerCondition: 'short' } }, { locationId: 'LOC' }),
    (e) => e instanceof IRError && e.code === 'SCHEMA',
  );
});

test('compileConvaiAction: unverified action types keep pure passthrough (no defaults injected)', () => {
  const { body } = compileConvaiAction(
    { type: 'mcpConnect', name: 'MCP Connect', details: { someField: 'x' } },
    { agentId: 'AGENT1', locationId: 'LOC' },
  );
  assert.deepEqual(body.details, { someField: 'x' });
  assert.equal('enabled' in body.details, false);
});

// --- Newly verified action types: convai-actions-all.json ------------------------

// appointmentBooking
test('compileConvaiAction: appointmentBooking matches convai-actions-all.json shape', () => {
  const { body } = compileConvaiAction(
    { type: 'appointmentBooking', name: 'Book Appointment', details: { calendarId: '3KIkHmnkrlhfpN9nORu4' } },
    { agentId: 'AGENT1', locationId: 'LOC' },
  );
  assert.deepEqual(body.details, {
    calendarActionType: 'single',
    onlySendLink: false,
    triggerWorkflow: false,
    workflowIds: null,
    sleepAfterBooking: false,
    sleepTimeUnit: null,
    sleepTime: null,
    transferBot: false,
    transferEmployee: null,
    cancelEnabled: false,
    rescheduleEnabled: false,
    calendarId: '3KIkHmnkrlhfpN9nORu4',
  });
});

test('compileConvaiAction: appointmentBooking rejects missing calendarId', () => {
  assert.throws(
    () => compileConvaiAction({ type: 'appointmentBooking', name: 'Book Appointment', details: {} }, { locationId: 'LOC' }),
    (e) => e instanceof IRError && e.code === 'SCHEMA',
  );
});

// triggerWorkflow
test('compileConvaiAction: triggerWorkflow matches convai-actions-all.json shape', () => {
  const { body } = compileConvaiAction(
    {
      type: 'triggerWorkflow',
      name: 'Trigger Workflow 1',
      details: { triggerCondition: 'Test condition: customer confirms interest in a demo', workflowIds: ['76b6ce98-dd6e-4e4d-aaff-bd58369fe18b'] },
    },
    { agentId: 'AGENT1', locationId: 'LOC' },
  );
  assert.deepEqual(body.details, {
    triggerCondition: 'Test condition: customer confirms interest in a demo',
    workflowIds: ['76b6ce98-dd6e-4e4d-aaff-bd58369fe18b'],
  });
});

test('compileConvaiAction: triggerWorkflow rejects missing workflowIds', () => {
  assert.throws(
    () => compileConvaiAction({ type: 'triggerWorkflow', name: 'Trigger', details: { triggerCondition: 'when x happens' } }, { locationId: 'LOC' }),
    (e) => e instanceof IRError && e.code === 'SCHEMA',
  );
});

test('compileConvaiAction: triggerWorkflow rejects missing triggerCondition', () => {
  assert.throws(
    () => compileConvaiAction({ type: 'triggerWorkflow', name: 'Trigger', details: { workflowIds: ['wf1'] } }, { locationId: 'LOC' }),
    (e) => e instanceof IRError && e.code === 'SCHEMA',
  );
});

// updateContactField
test('compileConvaiAction: updateContactField matches convai-actions-all.json shape', () => {
  const { body } = compileConvaiAction(
    {
      type: 'updateContactField',
      name: 'Field update 1',
      details: {
        contactFieldId: 'cF7gC1kD5AjJdT951wnr',
        contactFieldName: 'Date Of Birth',
        description: 'Ask the customer for their date of birth',
        contactFieldDataType: 'STANDARD_FIELD',
        contactFieldKey: 'contact.date_of_birth',
      },
    },
    { agentId: 'AGENT1', locationId: 'LOC' },
  );
  assert.deepEqual(body.details, {
    contactFieldId: 'cF7gC1kD5AjJdT951wnr',
    contactFieldName: 'Date Of Birth',
    description: 'Ask the customer for their date of birth',
    contactFieldDataType: 'STANDARD_FIELD',
    contactFieldKey: 'contact.date_of_birth',
    contactUpdateExamples: [],
  });
});

test('compileConvaiAction: updateContactField rejects missing contactFieldId', () => {
  assert.throws(
    () => compileConvaiAction({ type: 'updateContactField', name: 'Field update', details: { description: 'x' } }, { locationId: 'LOC' }),
    (e) => e instanceof IRError && e.code === 'SCHEMA',
  );
});

test('compileConvaiAction: updateContactField rejects missing description', () => {
  assert.throws(
    () => compileConvaiAction({ type: 'updateContactField', name: 'Field update', details: { contactFieldId: 'f1' } }, { locationId: 'LOC' }),
    (e) => e instanceof IRError && e.code === 'SCHEMA',
  );
});

// stopBot
test('compileConvaiAction: stopBot merges the pre-built Goodbye Detection defaults', () => {
  const { body } = compileConvaiAction(
    { type: 'stopBot', name: 'Goodbye Detection', details: {} },
    { agentId: 'AGENT1', locationId: 'LOC' },
  );
  assert.deepEqual(body.details, {
    stopBotDetectionType: 'Goodbye',
    stopBotTriggerCondition: 'When the contact says goodbye or similar phrases ',
    finalMessage: 'Thank you for your time, Have a nice day.',
    reactivateEnabled: true,
    sleepTimeUnit: 'hours',
    sleepTime: 24,
    stopBotExamples: ['Bye', 'Goodbye', 'Thank you! have a nice day'],
    enabled: true,
    tags: ['stop bot'],
  });
});

test('compileConvaiAction: stopBot lets caller override defaults', () => {
  const { body } = compileConvaiAction(
    { type: 'stopBot', name: 'Custom Stop', details: { enabled: false, finalMessage: 'Bye!' } },
    { agentId: 'AGENT1', locationId: 'LOC' },
  );
  assert.equal(body.details.enabled, false);
  assert.equal(body.details.finalMessage, 'Bye!');
  assert.equal(body.details.stopBotDetectionType, 'Goodbye');
});

// transferBot
test('compileConvaiAction: transferBot matches convai-actions-all.json shape', () => {
  const { body } = compileConvaiAction(
    { type: 'transferBot', name: 'Default Transfer Bot', details: { transferToBot: 'MZtNjcbSrGj0NIdw5JdU' } },
    { agentId: 'AGENT1', locationId: 'LOC' },
  );
  assert.deepEqual(body.details, {
    transferBotExamples: [],
    transferBotType: 'Default',
    enabled: true,
    transferBotTriggerCondition: "If bot doesn't know the answer",
    transferToBot: 'MZtNjcbSrGj0NIdw5JdU',
  });
});

test('compileConvaiAction: transferBot rejects missing transferToBot', () => {
  assert.throws(
    () => compileConvaiAction({ type: 'transferBot', name: 'Transfer Bot', details: {} }, { locationId: 'LOC' }),
    (e) => e instanceof IRError && e.code === 'SCHEMA',
  );
});

// advancedFollowup
test('compileConvaiAction: advancedFollowup merges the pre-built Contact Stopped Replying defaults', () => {
  const { body } = compileConvaiAction(
    { type: 'advancedFollowup', name: 'Contact Stopped Replying', details: {} },
    { agentId: 'AGENT1', locationId: 'LOC' },
  );
  assert.deepEqual(body.details, {
    enabled: true,
    scenarioId: 'contactStoppedReplying',
    followupSequence: [
      { id: 1, followupTime: 15, followupTimeUnit: 'minutes', aiEnabledMessage: true, customMessage: null, workflowId: null, triggerWorkflow: false },
    ],
  });
});

test('compileConvaiAction: advancedFollowup lets caller override the followup sequence', () => {
  const customSequence = [{ id: 1, followupTime: 30, followupTimeUnit: 'minutes', aiEnabledMessage: false, customMessage: 'Still there?', workflowId: null, triggerWorkflow: false }];
  const { body } = compileConvaiAction(
    { type: 'advancedFollowup', name: 'Contact Stopped Replying', details: { followupSequence: customSequence } },
    { agentId: 'AGENT1', locationId: 'LOC' },
  );
  assert.deepEqual(body.details.followupSequence, customSequence);
});

// Matches captures/convai-kb.json's KB-trigger PUT: only locationId + the touched
// field(s) are sent — the backend merges rather than replaces.
test('compileConvaiUpdate: partial merge — only touched fields present in body', () => {
  const { method, path, body, authHeader } = compileConvaiUpdate(
    { knowledgeBaseIds: ['tJdoJJkFGwqhsWKmHLEd'] },
    { agentId: '69udtYyGwTVOL9doSdfb', locationId: 'wdzEoUZnXO9tB3PPzcot' },
  );
  assert.equal(method, 'PUT');
  assert.equal(path, '/ai-employees/employees/69udtYyGwTVOL9doSdfb');
  assert.deepEqual(body, { locationId: 'wdzEoUZnXO9tB3PPzcot', knowledgeBaseIds: ['tJdoJJkFGwqhsWKmHLEd'] });
  assert.equal(authHeader, 'ai');
});

test('compileConvaiUpdate: name maps to wire field employeeName', () => {
  const { body } = compileConvaiUpdate({ name: 'Renamed Bot' }, { agentId: 'id1', locationId: 'LOC' });
  assert.equal(body.employeeName, 'Renamed Bot');
  assert.equal('name' in body, false);
});

test('compileConvaiUpdate: nested wait/sleep fields flattened to wire keys only when present', () => {
  const { body } = compileConvaiUpdate({ wait: { value: 5 }, sleep: { enabled: true } }, { agentId: 'id1', locationId: 'LOC' });
  assert.equal(body.waitTime, 5);
  assert.equal('waitTimeUnit' in body, false); // unit not supplied -> not emitted
  assert.equal(body.sleepEnabled, true);
  assert.equal('sleepTime' in body, false);
});

test('compileConvaiUpdate: requires agentId', () => {
  assert.throws(() => compileConvaiUpdate({ name: 'X' }, { locationId: 'LOC' }), (e) => e.code === 'MISSING_FIELD');
});

test('compileConvaiUpdate: rejects invalid mode even in a partial body', () => {
  assert.throws(() => compileConvaiUpdate({ mode: 'nope' }, { agentId: 'id1', locationId: 'LOC' }), (e) => e.code === 'BAD_MODE');
});

// --- humanHandOver.handoverType (live-verified 422 gap, 2026-07-15) ---------------
test('humanHandOver: handoverType defaults to custom when omitted', () => {
  const { actions } = compileConvaiAgent(
    { ...fullIR, actions: [{ type: 'humanHandOver', name: 'Handover', details: { triggerCondition: 'When the customer explicitly asks for a human agent' } }] },
    { locationId: 'LOC' });
  assert.equal(actions[0].body.details.handoverType, 'custom');
});

test('humanHandOver: valid handoverType passes through, invalid is rejected', () => {
  const { actions } = compileConvaiAgent(
    { ...fullIR, actions: [{ type: 'humanHandOver', name: 'H', details: { handoverType: 'lackOfInformation', triggerCondition: 'When the bot lacks the information needed' } }] },
    { locationId: 'LOC' });
  assert.equal(actions[0].body.details.handoverType, 'lackOfInformation');
  assert.throws(() => compileConvaiAgent(
    { ...fullIR, actions: [{ type: 'humanHandOver', name: 'H', details: { handoverType: 'nope', triggerCondition: 'A valid length trigger condition text' } }] },
    { locationId: 'LOC' }), (e) => e.code === 'SCHEMA');
});

// --- FLOW_BUILDER_BOT support -----------------------------------------------------
test('compileConvaiAgent: botType FLOW_BUILDER_BOT + flow linkage fields', () => {
  const { create } = compileConvaiAgent(
    { ...fullIR, botType: 'FLOW_BUILDER_BOT', isObjectiveBuilderEnabled: true, objectiveBuilderWorkflowId: 'WID123' },
    { locationId: 'LOC' });
  assert.equal(create.body.botType, 'FLOW_BUILDER_BOT');
  assert.equal(create.body.isObjectiveBuilderEnabled, true);
  assert.equal(create.body.objectiveBuilderWorkflowId, 'WID123');
});

test('compileConvaiAgent: rejects unknown botType', () => {
  assert.throws(() => compileConvaiAgent({ ...fullIR, botType: 'BOGUS' }, { locationId: 'LOC' }), (e) => e.code === 'BAD_BOT_TYPE');
});

test('compileLinkFlowWorkflow: PUT sets isObjectiveBuilderEnabled + objectiveBuilderWorkflowId', () => {
  const d = compileLinkFlowWorkflow('AGENT1', 'WID123', { locationId: 'LOC' });
  assert.equal(d.method, 'PUT');
  assert.equal(d.path, '/ai-employees/employees/AGENT1');
  assert.equal(d.body.isObjectiveBuilderEnabled, true);
  assert.equal(d.body.objectiveBuilderWorkflowId, 'WID123');
  assert.equal(d.body.locationId, 'LOC');
  assert.equal(d.authHeader, AUTH_HEADER);
  assert.throws(() => compileLinkFlowWorkflow(null, 'WID', { locationId: 'LOC' }), (e) => e.code === 'MISSING_FIELD');
  assert.throws(() => compileLinkFlowWorkflow('A', null, { locationId: 'LOC' }), (e) => e.code === 'MISSING_FIELD');
});

test('compileFlowBuilderBot: end-to-end plan (agent + flow workflow bound + link)', () => {
  const flow = {
    name: 'Booking flow', triggers: [],
    graph: [
      { ref: 'obj', kind: 'action', type: 'conversationai_objective', name: 'AI capture information', attributes: { objective: 'capture day-type' } },
      { ref: 'slots', kind: 'action', type: 'custom_webhook', name: 'Get slots', attributes: { method: 'GET', url: 'https://worker/slots', event: 'workflow' } },
    ],
  };
  const plan = compileFlowBuilderBot({ ...fullIR, flow }, { locationId: 'LOC' });
  // 1. agent is created as a flow bot
  assert.equal(plan.createAgent.create.body.botType, 'FLOW_BUILDER_BOT');
  // 2. the flow workflow is bound to the agent id via a conv_ai_trigger
  const wfIr = plan.flowWorkflow('AGENT9');
  const trig = wfIr.triggers.find((t) => t.type === 'conv_ai_trigger');
  assert.ok(trig, 'conv_ai_trigger injected');
  assert.equal(trig.convTriggerBotId, 'AGENT9');
  assert.equal(wfIr.workflowType, 'agent');
  assert.equal(wfIr.graph.length, 2);
  // 3. link step wires the agent to the created workflow
  const link = plan.linkWorkflow('AGENT9', 'WID55');
  assert.equal(link.body.objectiveBuilderWorkflowId, 'WID55');
  assert.equal(link.body.isObjectiveBuilderEnabled, true);
});

test('compileFlowBuilderBot: flowWorkflow honors an injected create-ghl-workflow compile fn', () => {
  const plan = compileFlowBuilderBot(
    { ...fullIR, flow: { name: 'F', triggers: [], graph: [] } },
    { locationId: 'LOC', compileWorkflow: (ir, ctx) => ({ compiled: true, triggerBot: ir.triggers[0].convTriggerBotId, ctx }), workflowCtx: { loc: 'LOC' } });
  const out = plan.flowWorkflow('AG1');
  assert.equal(out.compiled, true);
  assert.equal(out.triggerBot, 'AG1');
  assert.deepEqual(out.ctx, { loc: 'LOC' });
});

// F5-31: tones are required by the UI's save validator, and an agent built over the API without
// them saves fine and then cannot be saved from the builder at all.
test('tones: emitted on create, validated against the 7-value enum, max 3; empty tones on a FLOW bot is refused', () => {
  const base = { name: 'Bot', mode: 'suggestive', channels: ['SMS'], personality: 'p', goal: 'g', instructions: 'i' };
  const ok = compileConvaiAgent({ ...base, tones: ['friendly', 'empathetic'] }, { locationId: 'LOC' });
  assert.deepEqual(ok.create.body.tones, ['friendly', 'empathetic']);
  assert.throws(() => compileConvaiAgent({ ...base, tones: ['zen'] }, { locationId: 'LOC' }), (e) => e.code === 'BAD_TONES');
  assert.throws(() => compileConvaiAgent({ ...base, tones: ['friendly', 'empathetic', 'confident', 'engaging'] }, { locationId: 'LOC' }), (e) => e.code === 'BAD_TONES');
  assert.throws(() => compileConvaiAgent({ ...base, botType: 'FLOW_BUILDER_BOT' }, { locationId: 'LOC' }),
    (e) => e.code === 'UI_SAVE_BLOCKED' && /Tone/.test(e.message));
  assert.doesNotThrow(() => compileConvaiAgent({ ...base, botType: 'FLOW_BUILDER_BOT', tones: ['friendly'] }, { locationId: 'LOC' }));
});

test('a PROMPT bot with blank personality/goal/instructions warns; allowUiUnsaveable silences the flow-bot throw', () => {
  const warns = [];
  compileConvaiAgent({ name: 'Bot', mode: 'suggestive', channels: ['SMS'] }, { locationId: 'LOC', warn: (m) => warns.push(m) });
  assert.ok(warns.some((w) => /UI_SAVE/.test(w) && /personality/i.test(w)), JSON.stringify(warns));
  assert.doesNotThrow(() => compileConvaiAgent({ name: 'B', mode: 'suggestive', channels: ['SMS'], botType: 'FLOW_BUILDER_BOT' },
    { locationId: 'LOC', allowUiUnsaveable: true }));
});

test('summary knobs land on the create body; defaults are unchanged when absent', () => {
  const full = { name: 'Bot', mode: 'suggestive', channels: ['SMS'], personality: 'p', goal: 'g', instructions: 'i', tones: ['friendly'] };
  const out = compileConvaiAgent({ ...full, summary: { enabled: true, workflowIds: ['WF1'], customFieldId: 'CF1', minimumMessages: 5 } }, { locationId: 'LOC' });
  assert.equal(out.create.body.summary.enabled, true);
  assert.deepEqual(out.create.body.summary.workflowIds, ['WF1']);
  assert.equal(out.create.body.summary.customFieldId, 'CF1');
  assert.equal(out.create.body.summary.minimumMessages, 5);
  const dflt = compileConvaiAgent(full, { locationId: 'LOC' });
  assert.equal(dflt.create.body.summary.enabled, false);
  assert.equal('customFieldId' in dflt.create.body.summary, false,
    'the captured create body has no customFieldId — the engine must not invent one');
});

test('the wait-time bounds come from the shipped validator strings, verbatim', () => {
  const v = uiSaveViolations({ channels: ['SMS'], personality: 'p', goal: 'g', instructions: 'i', tones: ['friendly'], waitTime: { unit: 'hours', value: 9 } });
  assert.deepEqual(v.map((x) => x.msg), ['Wait time must be between 1 and 6 hours']);
});

// F5-04: the "PUT merges" claim came from a capture whose at-risk booleans were already false, so
// a reset could not have been visible in it. A live partial PUT reset cancelEnabled and
// rescheduleEnabled. The UI never sends a partial — it PUTs the whole record.
test('compileConvaiUpdateFromRecord: full record, overlay, bot-type cleanup, actions:null, collateralKeys', () => {
  const current = { id: 'A1', locationId: 'LOC', name: 'Bot', employeeName: 'Bot', mode: 'suggestive', channels: ['SMS'],
    personality: 'p', goal: 'g', instructions: 'i', botType: 'FLOW_BUILDER_BOT', cancelEnabled: true, rescheduleEnabled: true,
    tones: ['friendly'], knowledgeBaseIds: ['KB1'], knowledgeBaseTriggers: [], sleepEnabled: false, waitTime: 2,
    summary: { enabled: false }, dateAdded: 'x', dateUpdated: 'y', actions: [{ id: 'ACT1' }] };
  const out = compileConvaiUpdateFromRecord(current, { knowledgeBaseIds: ['KB1', 'KB2'] }, { agentId: 'A1', locationId: 'LOC' });
  assert.equal(out.method, 'PUT');
  assert.deepEqual(out.body.knowledgeBaseIds, ['KB1', 'KB2']);
  assert.equal(out.body.cancelEnabled, true, 'a FLOW bot keeps its toggles — the partial-PUT reset is the exact defect this closes');
  assert.equal(out.body.rescheduleEnabled, true);
  assert.deepEqual(out.body.tones, ['friendly']);
  assert.equal(out.body.actions, null, 'the UI sends actions:null on the record PUT');
  assert.equal(out.body.dateAdded, undefined);
  assert.ok(out.collateralKeys.includes('cancelEnabled'));
  assert.ok(!out.collateralKeys.includes('knowledgeBaseIds'), 'a key this update SETS is not collateral');
  assert.throws(() => compileConvaiUpdateFromRecord(null, {}, { agentId: 'A1' }), (e) => e.code === 'SCHEMA' && /GET it first/.test(e.message));
});

// Ported verbatim from useAIEmployee's `eo`, including the FORM_BASED_BOT branch and the llm
// pruning the review's plan did not mention.
test('applyBotTypeCleanup matches the UI: flow-only keys, the FORM branch, and llm pruning', () => {
  assert.equal('tones' in applyBotTypeCleanup({ botType: 'PROMPT_BASED_BOT', tones: ['friendly'], cancelEnabled: true }), false);
  assert.equal('cancelEnabled' in applyBotTypeCleanup({ botType: 'PROMPT_BASED_BOT', cancelEnabled: true }), false);
  assert.deepEqual(applyBotTypeCleanup({ botType: 'FLOW_BUILDER_BOT', tones: ['friendly'] }).tones, ['friendly']);

  const form = applyBotTypeCleanup({ botType: 'FORM_BASED_BOT', personality: 'p', goal: 'g', steps: [1], brandId: 'B' });
  assert.equal('personality' in form, false);
  assert.equal('goal' in form, false);
  assert.deepEqual(form.steps, [1], 'the FORM branch keeps the form-only keys');

  const prompt = applyBotTypeCleanup({ botType: 'PROMPT_BASED_BOT', steps: [1], brandId: 'B', botInitialMessage: 'hi', personality: 'p' });
  assert.equal('steps' in prompt, false);
  assert.equal('brandId' in prompt, false);
  assert.equal(prompt.personality, 'p');

  assert.equal('llm' in applyBotTypeCleanup({ botType: 'PROMPT_BASED_BOT', llm: { primary: '', secondary: '' } }), false);
  assert.deepEqual(applyBotTypeCleanup({ botType: 'PROMPT_BASED_BOT', llm: { primary: 'gpt', secondary: '' } }).llm, { primary: 'gpt' });
});

// R-21 (2026-09-02). A read-merge-write replayed keys that GET returns and PUT refuses, so
// update_convai_agent could not update a FLOW_BUILDER_BOT at all: the PUT 422'd and nothing was
// written. The record shape below is the live one read off the sandbox agent on 2026-09-02 --
// `employeeType` and `errors` come back on every GET, and the DTO rejects both.
test('compileConvaiUpdateFromRecord: strips the read-only keys GHL returns and the PUT refuses', () => {
  const current = {
    id: 'A1',
    name: 'Front Desk',
    botType: 'FLOW_BUILDER_BOT',
    locationId: 'LOC',
    mode: 'auto-pilot',
    // returned by GET, refused by PUT
    employeeType: 'custom',
    errors: [],
    isDeleted: false,
    rootParentAgentId: 'A0',   // minted by the UI's Duplicate (R-59)
    // ordinary server metadata, already stripped before this fix
    dateAdded: '2026-01-01',
    traceId: 'abc',
    // a real setting that must survive
    cancelEnabled: true,
  };
  const out = compileConvaiUpdateFromRecord(current, { knowledgeBaseIds: ['KB1'] }, { agentId: 'A1', locationId: 'LOC' });
  const body = out.body ?? out;
  for (const k of ['employeeType', 'errors', 'isDeleted', 'rootParentAgentId', 'id', 'dateAdded', 'traceId']) {
    assert.ok(!(k in body), `${k} must not reach the PUT body`);
  }
  // and the fix must not become a blunt filter: real settings still ride along
  assert.equal(body.cancelEnabled, true);
  assert.deepEqual(body.knowledgeBaseIds, ['KB1']);
});
