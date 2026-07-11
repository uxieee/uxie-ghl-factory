import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileConvaiAgent, compileConvaiAction, compileConvaiUpdate, AUTH_HEADER } from './convai-compiler.mjs';
import { IRError } from './convai-ir.mjs';

// Mirrors captures/convai-create.json's request_body 1:1 (values changed only where the
// IR supplies them; everything else must match the capture's literal defaults).
const fullIR = {
  name: 'TEST-CAP-CONVAI',
  mode: 'suggestive',
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
  assert.equal(authHeader, 'token-id');
  assert.equal(AUTH_HEADER, 'token-id');
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

test('compileConvaiAction: non-humanHandOver action types keep pure passthrough (no defaults injected)', () => {
  const { body } = compileConvaiAction(
    { type: 'stopBot', name: 'Stop Bot', details: { someField: 'x' } },
    { agentId: 'AGENT1', locationId: 'LOC' },
  );
  assert.deepEqual(body.details, { someField: 'x' });
  assert.equal('enabled' in body.details, false);
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
  assert.equal(authHeader, 'token-id');
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
