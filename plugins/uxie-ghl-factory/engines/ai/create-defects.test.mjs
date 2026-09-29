// t22 (2026-09-29): the three create tools refuse what they cannot apply, and create the way today's builders do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileConvaiAgent, compileConvaiAction, compileConvaiUpdateFromRecord, uiSaveViolations } from './convai-compiler.mjs';
import { compileVoiceAiAgent, compileVoiceAiUpdate, compileVoiceAiS2sFollowUp } from './voiceai-compiler.mjs';
import { compileVoiceAiPartialUpdate, executeVoiceAiUpdate } from './voiceai-update.mjs';
import { refuseUnappliedStudioKeys } from './studio-ir.mjs';
import { executeAgentPlan, awaitingInput } from './driver.mjs';

const LOC = 'loc-1';
const code = (c) => (e) => e?.code === c;
const cai = (extra = {}) => ({ name: 'TEST agent', mode: 'off', channels: ['SMS'], goal: 'Help.', ...extra });
const voice = (extra = {}) => ({ agentName: 'TEST voice', agentPrompt: 'You answer calls.', ...extra });

// --- (a) unknown / unapplied keys ------------------------------------------------------------------------------------

test('CAI create: an unknown spec key is refused before anything is compiled, with where it lives', () => {
  assert.throws(() => compileConvaiAgent(cai({ workingHours: {} }), { locationId: LOC }),
    (e) => e.code === 'SPEC_KEY_UNAPPLIED' && /workingHours: working hours are their own resource/.test(e.message));
  assert.throws(() => compileConvaiAgent(cai({ folderId: 'f1', bogus: 1 }), { locationId: LOC }),
    (e) => e.code === 'SPEC_KEY_UNAPPLIED' && /\[folderId, bogus\]/.test(e.message));
  // control: every key it lists as applicable compiles
  assert.doesNotThrow(() => compileConvaiAgent(cai({ wait: { value: 3, unit: 'seconds' }, respondToImages: true }), { locationId: LOC }));
});

test('Voice create: unknown top-level and section keys are refused; number keys and flat names get their pointer', () => {
  assert.throws(() => compileVoiceAiAgent(voice({ voiceId: 'v1' }), { locationId: LOC }),
    (e) => e.code === 'SPEC_KEY_UNAPPLIED' && /voiceId: in create_voiceai_agent it is voice\.voiceId/.test(e.message));
  assert.throws(() => compileVoiceAiAgent(voice({ voice: { speed: 1 } }), { locationId: LOC }),
    (e) => e.code === 'SPEC_KEY_UNAPPLIED' && /voice\.speed/.test(e.message));
  assert.throws(() => compileVoiceAiAgent(voice({ outbound: { inboundNumbers: ['+1'] } }), { locationId: LOC }),
    (e) => e.code === 'SPEC_KEY_UNAPPLIED' && /deploy screen/.test(e.message));
  assert.throws(() => compileVoiceAiAgent(voice({ provider: 'lc' }), { locationId: LOC }), code('SPEC_KEY_UNAPPLIED'));
  assert.doesNotThrow(() => compileVoiceAiAgent(voice({ voice: { voiceId: 'v1' } }), { locationId: LOC }));
});

test('Studio create: an unknown spec key is refused, with where it lives (t25a: folderId / templateId / customApiEnabled now apply)', () => {
  assert.throws(() => refuseUnappliedStudioKeys({ name: 'x', buildPrompt: 'y', publish: true }),
    (e) => e.code === 'SPEC_KEY_UNAPPLIED' && /publish: this tool never publishes/.test(e.message));
  assert.doesNotThrow(() => refuseUnappliedStudioKeys({ name: 'x', buildPrompt: 'y', tools: [], triggers: [], folderId: 'f', customApiEnabled: true }));
});

// --- (b) Conversation AI ---------------------------------------------------------------------------------------------

test('CAI create: fullPrompt-only is the builder contract — three fields "", llm.primary gpt-4.1, no MISSING_FIELD', () => {
  const { create } = compileConvaiAgent({ name: 'A', mode: 'off', channels: ['SMS'], fullPrompt: '## Goal\n\nBook calls.' }, { locationId: LOC });
  assert.equal(create.body.fullPrompt, '## Goal\n\nBook calls.');
  assert.deepEqual([create.body.personality, create.body.goal, create.body.instructions], ['', '', '']);
  assert.deepEqual(create.body.llm, { primary: 'gpt-4.1' });
  // an authored llm wins
  const own = compileConvaiAgent({ name: 'A', mode: 'off', channels: ['SMS'], fullPrompt: 'x', llm: { primary: 'gpt-4.1-mini' } }, { locationId: LOC });
  assert.deepEqual(own.create.body.llm, { primary: 'gpt-4.1-mini' });
  // CONTROL: no prompt at all is still refused
  assert.throws(() => compileConvaiAgent({ name: 'A', mode: 'off', channels: ['SMS'] }, { locationId: LOC }), code('MISSING_FIELD'));
  // CONTROL: the legacy three-field create keeps no llm and no fullPrompt
  const legacy = compileConvaiAgent(cai(), { locationId: LOC });
  assert.equal('fullPrompt' in legacy.create.body, false);
  assert.equal('llm' in legacy.create.body, false);
});

test('CAI create: fullPrompt beside a prompt field is ambiguous and refused; fullPrompt on a flow bot is refused', () => {
  assert.throws(() => compileConvaiAgent(cai({ fullPrompt: 'x' }), { locationId: LOC }), code('FULLPROMPT_OWNS_PROMPT'));
  assert.throws(() => compileConvaiAgent({ name: 'A', mode: 'off', channels: ['SMS'], botType: 'FLOW_BUILDER_BOT', fullPrompt: 'x' }, { locationId: LOC }),
    code('SPEC_KEY_UNAPPLIED'));
  assert.throws(() => compileConvaiAgent({ name: 'A', mode: 'off', channels: ['SMS'], fullPrompt: '  ' }, { locationId: LOC }), code('SCHEMA'));
});

test('CAI create: a fullPrompt agent raises no three-field UI_SAVE warning (the builder validates fullPrompt)', () => {
  const body = { channels: ['SMS'], personality: '', goal: '', instructions: '', fullPrompt: 'x', tones: ['friendly'] };
  assert.equal(uiSaveViolations(body, 'PROMPT_BASED_BOT').filter((v) => v.rule === 'notEmpty').length, 0);
  assert.equal(uiSaveViolations({ ...body, fullPrompt: '' }, 'PROMPT_BASED_BOT').filter((v) => v.rule === 'notEmpty').length, 3);
});

test('CAI create: knowledgeBaseTriggers are sent, renumbered 1..n, ids minted or kept; server caps enforced', () => {
  const { create } = compileConvaiAgent(cai({ knowledgeBaseIds: ['kb1'], knowledgeBaseTriggers: [
    { mode: 'custom', knowledgeBaseIds: ['kb1'], triggerCondition: 'pricing questions', priority: 9 },
    { id: 'kbt_mine', mode: 'all' },
  ] }), { locationId: LOC });
  const [t1, t2] = create.body.knowledgeBaseTriggers;
  assert.match(t1.id, /^kbt_\d+_[a-z0-9]{7}$/);
  assert.deepEqual({ ...t1, id: 'x' }, { id: 'x', mode: 'custom', knowledgeBaseIds: ['kb1'], triggerCondition: 'pricing questions', priority: 1 });
  assert.deepEqual(t2, { id: 'kbt_mine', mode: 'all', knowledgeBaseIds: [], triggerCondition: '', priority: 2 });
  const five = Array.from({ length: 5 }, () => ({ mode: 'all' }));
  assert.throws(() => compileConvaiAgent(cai({ knowledgeBaseTriggers: five }), { locationId: LOC }), code('SCHEMA'));
  assert.throws(() => compileConvaiAgent(cai({ knowledgeBaseTriggers: [{ mode: 'custom' }] }), { locationId: LOC }), code('SCHEMA'));
  // CONTROL: none authored stays []
  assert.deepEqual(compileConvaiAgent(cai(), { locationId: LOC }).create.body.knowledgeBaseTriggers, []);
});

test('CAI create: isPrimary:true is refused by name (location-wide); false is accepted and sent false', () => {
  assert.throws(() => compileConvaiAgent(cai({ isPrimary: true }), { locationId: LOC }),
    (e) => e.code === 'SPEC_KEY_UNAPPLIED' && /location-wide/.test(e.message) && /Conversation AI UI/.test(e.message));
  assert.equal(compileConvaiAgent(cai({ isPrimary: false }), { locationId: LOC }).create.body.isPrimary, false);
});

test('CAI create + update: agent-level cancel/reschedule apply to a FLOW bot only', () => {
  const flow = compileConvaiAgent({ name: 'F', mode: 'off', channels: ['SMS'], botType: 'FLOW_BUILDER_BOT', tones: ['friendly'],
    cancelEnabled: true, rescheduleEnabled: false }, { locationId: LOC });
  assert.equal(flow.create.body.cancelEnabled, true);
  assert.equal(flow.create.body.rescheduleEnabled, false);
  assert.throws(() => compileConvaiAgent(cai({ cancelEnabled: true }), { locationId: LOC }),
    (e) => e.code === 'SPEC_KEY_UNAPPLIED' && /appointmentBooking action/.test(e.message));
  const flowRecord = { botType: 'FLOW_BUILDER_BOT', name: 'F', mode: 'off', channels: ['SMS'], tones: ['friendly'], cancelEnabled: false, rescheduleEnabled: false };
  const up = compileConvaiUpdateFromRecord(flowRecord, { cancelEnabled: true }, { agentId: 'a', locationId: LOC });
  assert.equal(up.body.cancelEnabled, true);
  assert.equal(up.collateralKeys.includes('cancelEnabled'), false);
  assert.equal(up.collateralKeys.includes('rescheduleEnabled'), true);
  // CONTROL: the same key on a prompt bot's update is still refused with the action pointer
  assert.throws(() => compileConvaiUpdateFromRecord({ botType: 'PROMPT_BASED_BOT', name: 'P', goal: 'g' }, { cancelEnabled: true }, { agentId: 'a', locationId: LOC }),
    code('SPEC_KEY_UNAPPLIED'));
});

test('CAI booking action: multiple mode builds the modal body; service is refused by name; single keeps calendarId', () => {
  const multi = compileConvaiAction({ type: 'appointmentBooking', name: 'Book', details: {
    calendarActionType: 'multiple', calendarIds: ['c1', { id: 'c2', triggerCondition: 'follow-ups' }], aiDescription: 'Pick by service.',
    fallbackCalendar: true, fallbackCalendarId: 'c1' } }, { locationId: LOC });
  assert.deepEqual(multi.body.details.calendarIds, [{ id: 'c1', triggerCondition: '' }, { id: 'c2', triggerCondition: 'follow-ups' }]);
  assert.equal(multi.body.details.fallbackCalendarId, 'c1');
  assert.equal('calendarId' in multi.body.details, false);
  const noFallback = compileConvaiAction({ type: 'appointmentBooking', name: 'Book', details: { calendarActionType: 'multiple', calendarIds: ['c1'], aiDescription: 'x' } });
  assert.equal(noFallback.body.details.fallbackCalendar, false);
  assert.equal(noFallback.body.details.fallbackCalendarId, null);
  assert.throws(() => compileConvaiAction({ type: 'appointmentBooking', name: 'B', details: { calendarActionType: 'service', calendarIds: ['s1'], aiDescription: 'x' } }),
    (e) => e.code === 'SPEC_KEY_UNAPPLIED' && /raw_request/.test(e.message));
  assert.throws(() => compileConvaiAction({ type: 'appointmentBooking', name: 'B', details: { calendarActionType: 'multiple', calendarIds: ['c1'] } }), code('SCHEMA'));
  assert.throws(() => compileConvaiAction({ type: 'appointmentBooking', name: 'B', details: { calendarActionType: 'multiple', calendarIds: ['c1'], aiDescription: 'x', fallbackCalendar: true } }), code('SCHEMA'));
  assert.throws(() => compileConvaiAction({ type: 'appointmentBooking', name: 'B', details: { calendarId: 'c1', calendarIds: ['c2'] } }), code('SCHEMA'));
  // CONTROL: the proven single-calendar body is unchanged
  const single = compileConvaiAction({ type: 'appointmentBooking', name: 'B', details: { calendarId: 'c1' } });
  assert.equal(single.body.details.calendarId, 'c1');
  assert.equal(single.body.details.calendarActionType, 'single');
});

// --- (c) Voice AI ----------------------------------------------------------------------------------------------------

test('Voice create: the builder create body carries folderId; provider is never sent', () => {
  assert.deepEqual(compileVoiceAiAgent(voice({ folderId: 'fold-1' }), { locationId: LOC }).create.body, { locationId: LOC, folderId: 'fold-1' });
  assert.deepEqual(compileVoiceAiAgent(voice(), { locationId: LOC }).create.body, { locationId: LOC });
  const up = compileVoiceAiUpdate(voice(), { agentId: 'a', locationId: LOC });
  assert.equal('provider' in up.body, false);
  assert.equal('folderId' in up.body, false);
});

test('Voice create: user_first, all three denoising modes, and the builder-saved keys are written', () => {
  const body = compileVoiceAiUpdate(voice({
    welcomeMessageMode: 'user_first',
    voice: { denoisingMode: 'noise-and-background-speech-cancellation' },
    callSettings: { languages: ['en-US', 'es'] },
    sessionVariables: [{ name: 'session.caller_tier', dataType: 'string' }],
    endCallConfig: { instruction: '  End when done.  ', spamDetectionEnabled: true },
    spamConfig: { postCallAnalysis: { enabled: true, blockThreshold: 7 } },
    disabledPrompts: ['personality'],
    prompts: { dateAndTimeAwareness: 'Use the caller timezone.' },
  }), { agentId: 'a', locationId: LOC }).body;
  assert.deepEqual(body.userFirstFallback, { enabled: true });
  assert.equal(body.beginAfterUserSilenceMs, 200);
  assert.equal(body.denoisingMode, 'noise-and-background-speech-cancellation');
  assert.deepEqual(body.languages, ['en-US', 'es']);
  assert.equal(body.language, 'en-US');
  assert.deepEqual(body.sessionVariables, [{ label: 'caller_tier', dataType: 'string', defaultValue: '', name: 'session.caller_tier' }]);
  assert.deepEqual(body.endCallConfig, { instruction: 'End when done.', spamDetectionEnabled: true, spamDetectionInstruction: null });
  assert.deepEqual(body.spamConfig, { postCallAnalysis: { enabled: true, blockThreshold: 7, notifyModes: ['admin'], notifyEmails: [] } });
  assert.deepEqual(body.disabledPrompts, ['personality']);
  // CONTROL: none of them authored → none sent, and ai_custom sends no user-first keys
  const plain = compileVoiceAiUpdate(voice(), { agentId: 'a', locationId: LOC }).body;
  for (const k of ['userFirstFallback', 'beginAfterUserSilenceMs', 'languages', 'sessionVariables', 'endCallConfig', 'spamConfig', 'disabledPrompts']) {
    assert.equal(k in plain, false, k);
  }
  assert.throws(() => compileVoiceAiUpdate(voice({ beginAfterUserSilenceMs: 300 }), { agentId: 'a', locationId: LOC }), code('SCHEMA'));
  assert.throws(() => compileVoiceAiUpdate(voice({ prompts: { endCall: 'x' } }), { agentId: 'a', locationId: LOC }), code('SPEC_KEY_UNAPPLIED'));
  assert.throws(() => compileVoiceAiUpdate(voice({ spamConfig: { postCallAnalysis: { notifyEmails: ['a@b.c'] } } }), { agentId: 'a', locationId: LOC }), code('SCHEMA'));
});

test('Voice create: a speech-to-speech model gets no noResponseConfig, the 60 s silence default, and s2sBehaviour in a second PUT', () => {
  const ir = voice({ llmModel: 'gpt-realtime-2.1', s2sBehaviour: { responseDepth: 'low', languages: ['en-US'] } });
  const body = compileVoiceAiUpdate(ir, { agentId: 'a', locationId: LOC }).body;
  assert.equal(body.llmModel, 'gpt-realtime-2.1');
  assert.equal('noResponseConfig' in body, false);
  assert.equal(body.endCallAfterSilenceMs, 60000);
  assert.equal('s2sBehaviour' in body, false);
  const second = compileVoiceAiS2sFollowUp(ir, { agentId: 'a', locationId: LOC });
  assert.deepEqual(second, { method: 'PUT', path: '/voice-ai/agents/a', body: { locationId: LOC, s2sBehaviour: { responseDepth: 'low', languages: ['en'] } }, authHeader: 'ai' });
  // CONTROL: a text model keeps the Retell defaults and has no second PUT
  const text = compileVoiceAiUpdate(voice(), { agentId: 'a', locationId: LOC }).body;
  assert.equal(text.endCallAfterSilenceMs, 15000);
  assert.ok(text.noResponseConfig);
  assert.equal(compileVoiceAiS2sFollowUp(voice(), { agentId: 'a', locationId: LOC }), null);
  assert.throws(() => compileVoiceAiUpdate(voice({ s2sBehaviour: { responseDepth: 'low' } }), { agentId: 'a', locationId: LOC }), code('SPEC_KEY_UNAPPLIED'));
  assert.throws(() => compileVoiceAiUpdate(voice({ llmModel: 'gpt-live-1', noResponseConfig: { enabled: true } }), { agentId: 'a', locationId: LOC }), code('SPEC_KEY_UNAPPLIED'));
});

test('patienceLevel is refused by create and update: GHL answers 200 and stores nothing (measured 2026-09-29)', () => {
  assert.throws(() => compileVoiceAiAgent(voice({ callSettings: { patienceLevel: 'high' } }), { locationId: LOC }),
    (e) => e.code === 'SPEC_KEY_UNAPPLIED' && /stores nothing/.test(e.message));
  assert.throws(() => compileVoiceAiPartialUpdate({ locationId: LOC }, { patienceLevel: 'low' }, { agentId: 'a', locationId: LOC }),
    (e) => e.code === 'SPEC_KEY_UNAPPLIED' && /stores nothing/.test(e.message));
});

test('Voice update: languages, spamConfig (merged over the stored one, the four builder keys) and beginAfterUserSilenceMs (user_first only)', () => {
  // the read carries notifyMode / notifyEnabled beside the four keys (live 2026-09-29); they are not echoed
  const current = { locationId: LOC, welcomeMessageMode: 'ai_custom',
    spamConfig: { postCallAnalysis: { enabled: false, blockThreshold: 5, notifyMode: 'admin', notifyModes: ['admin'], notifyEmails: [], notifyEnabled: true } } };
  const plan = compileVoiceAiPartialUpdate(current, { languages: ['en-US', 'fr'], spamConfig: { postCallAnalysis: { enabled: true } } },
    { agentId: 'a', locationId: LOC });
  assert.deepEqual(plan.body.languages, ['en-US', 'fr']);
  assert.deepEqual(plan.body.spamConfig, { postCallAnalysis: { enabled: true, blockThreshold: 5, notifyModes: ['admin'], notifyEmails: [] } });
  assert.throws(() => compileVoiceAiPartialUpdate(current, { beginAfterUserSilenceMs: 300 }, { agentId: 'a', locationId: LOC }), code('SPEC_KEY_UNAPPLIED'));
  const withMode = compileVoiceAiPartialUpdate(current, { welcomeMessageMode: 'user_first', beginAfterUserSilenceMs: 300 }, { agentId: 'a', locationId: LOC });
  assert.equal(withMode.body.beginAfterUserSilenceMs, 300);
});

// --- (d) Managed Agent build that stops for input --------------------------------------------------------------------

const buildEvents = [
  { event: 'conversation_started', data: { inlineQuestionsEnabled: true } },
  { event: 'build_question', data: { id: 'q1', prompt: 'Which calendar should it book into?', allowMultiple: false,
    options: [{ value: 'cal-1', label: 'Intro call' }, { value: 'cal-2', label: 'Demo' }] } },
  { event: 'awaiting_input', data: { count: 1, sessionId: 'sess-9' } },
];

test('awaitingInput names the questions and the session; null without the pause', () => {
  assert.deepEqual(awaitingInput(buildEvents), { sessionId: 'sess-9', count: 1, stale: false, inlineQuestionsEnabled: true, questions: [
    { id: 'q1', prompt: 'Which calendar should it book into?', allowMultiple: false,
      options: [{ value: 'cal-1', label: 'Intro call' }, { value: 'cal-2', label: 'Demo' }] }] });
  assert.equal(awaitingInput(buildEvents.slice(0, 2)), null);
});

test('a studio build that stops for input fails STUDIO_BUILD_AWAITING_INPUT and sends nothing after the build', async () => {
  const calls = []; let streamOpts = null;
  const gw = {
    loc: LOC,
    stream: async (_m, _p, _b, opts) => { streamOpts = opts; return { ok: true, status: 200, events: buildEvents, terminal: buildEvents.at(-1) }; },
    call: async (method, path) => { calls.push({ method, path }); return { ok: true, status: 200, json: {} }; },
  };
  const plan = { create: { method: 'POST', path: '/agent-studio/super-agents/build', body: {} },
    followUps: [{ method: 'PUT', path: '/agent-studio/super-agent/agents/{agentId}', body: {} }] };
  const result = await executeAgentPlan({ plan, gw });
  assert.equal(result.code, 'STUDIO_BUILD_AWAITING_INPUT');
  assert.equal(result.awaitingInput.questions[0].prompt, 'Which calendar should it book into?');
  assert.equal(calls.length, 0, 'no config PUT and no verification read');
  // the pause ends the stream without done/agent_saved; the gateway must be told it is terminal or it throws SSE_INCOMPLETE
  assert.ok(streamOpts.terminalEvents.includes('awaiting_input'));
  // CONTROL: the same stream finishing with agent_saved proceeds to the config PUT
  const done = [...buildEvents.slice(0, 1), { event: 'agent_saved', data: { id: 'ag-1' } }, { event: 'done', data: {} }];
  const ok = await executeAgentPlan({ plan: { ...plan, verifyExpected: { x: 1 } },
    gw: { ...gw, stream: async () => ({ ok: true, status: 200, events: done, terminal: done.at(-1) }) } });
  assert.notEqual(ok.code, 'STUDIO_BUILD_AWAITING_INPUT');
  assert.equal(calls[0].method, 'PUT');
});

test('Voice update: a spamConfig write verifies against a read that adds notifyMode / notifyEnabled in its own key order', async () => {
  const before = { locationId: LOC, agentName: 'v', spamConfig: { postCallAnalysis: { enabled: true, blockThreshold: 7, notifyMode: 'admin', notifyModes: ['admin'], notifyEmails: [], notifyEnabled: true } } };
  const plan = compileVoiceAiPartialUpdate(before, { spamConfig: { postCallAnalysis: { blockThreshold: 6 } } }, { agentId: 'a', locationId: LOC });
  const after = { ...before, spamConfig: { postCallAnalysis: { enabled: true, blockThreshold: 6, notifyMode: 'admin', notifyModes: ['admin'], notifyEmails: [], notifyEnabled: true } } };
  const gw = { call: async (method) => (method === 'GET' ? { ok: true, status: 200, json: { agent: after } } : { ok: true, status: 200, json: {} }) };
  const r = await executeVoiceAiUpdate({ plan, before, gw, serverMessage: () => null });
  assert.equal(r.ok, true);
  assert.deepEqual(r.verification.confirmed, ['spamConfig']);
  // CONTROL: a threshold the read does not carry is a mismatch
  const wrong = { ...before, spamConfig: { postCallAnalysis: { ...after.spamConfig.postCallAnalysis, blockThreshold: 7 } } };
  const r2 = await executeVoiceAiUpdate({ plan, before, gw: { call: async (m) => (m === 'GET' ? { ok: true, status: 200, json: { agent: wrong } } : { ok: true, status: 200, json: {} }) }, serverMessage: () => null });
  assert.equal(r2.code, 'AGENT_VERIFY_MISMATCH');
});
