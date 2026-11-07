import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConvaiIR, parseConvaiPartialIR, IRError, MODES, CHANNELS, VERIFIED_ACTION_TYPES } from './convai-ir.mjs';

const validIR = () => ({
  name: 'Support Bot',
  mode: 'suggestive',
  channels: ['SMS', 'WebChat'],
  personality: 'Friendly assistant.',
  goal: 'Answer support questions.',
  instructions: 'Be concise.',
});

test('valid IR passes through unchanged', () => {
  const out = parseConvaiIR(validIR());
  assert.equal(out.name, 'Support Bot');
  assert.equal(out.mode, 'suggestive');
  assert.deepEqual(out.channels, ['SMS', 'WebChat']);
});

test('missing name rejected', () => {
  const ir = validIR(); delete ir.name;
  assert.throws(() => parseConvaiIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('empty-string name rejected', () => {
  const ir = validIR(); ir.name = '';
  assert.throws(() => parseConvaiIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('mode not in enum rejected', () => {
  const ir = validIR(); ir.mode = 'aggressive';
  assert.throws(() => parseConvaiIR(ir), (e) => e instanceof IRError && e.code === 'BAD_MODE');
});

test('mode enum matches captured values', () => {
  // The WIRE spelling is hyphenated. Measured on GROM Sandbox 2026-09-11 against
  // POST /ai-employees/employees — see the note in convai-ir.mjs.
  assert.deepEqual(MODES, ['off', 'suggestive', 'auto-pilot']);
});

test('channel not in enum rejected', () => {
  const ir = validIR(); ir.channels = ['SMS', 'Telegram'];
  assert.throws(() => parseConvaiIR(ir), (e) => e instanceof IRError && e.code === 'BAD_CHANNELS');
});

test('empty channels array rejected', () => {
  const ir = validIR(); ir.channels = [];
  assert.throws(() => parseConvaiIR(ir), (e) => e instanceof IRError && e.code === 'BAD_CHANNELS');
});

test('channels enum is the server list (its 422, 2026-09-26), TIKTOK and Email included', () => {
  assert.deepEqual([...CHANNELS].sort(), ['Email', 'FB', 'GMB', 'IG', 'Live_Chat', 'SMS', 'TIKTOK', 'WebChat', 'WhatsApp']);
});

test('llm primary and secondary cannot be the same model', () => {
  assert.throws(() => parseConvaiPartialIR({ llm: { primary: 'gpt-4.1', secondary: 'gpt-4.1' } }), (e) => e.code === 'SCHEMA');
  assert.doesNotThrow(() => parseConvaiPartialIR({ llm: { primary: 'gpt-4.1', secondary: 'gpt-4.1-mini' } }));
  assert.throws(() => parseConvaiPartialIR({ llm: { model: 'gpt-4.1' } }), (e) => e.code === 'SCHEMA');
});

test('responseLength is the server enum; businessName cannot be empty (200 that clears nothing)', () => {
  assert.throws(() => parseConvaiPartialIR({ responseLength: 'short' }), (e) => e.code === 'SCHEMA');
  assert.doesNotThrow(() => parseConvaiPartialIR({ responseLength: 'detailed' }));
  assert.throws(() => parseConvaiPartialIR({ businessName: '' }), (e) => e.code === 'SCHEMA');
});

test('summary.minimumMessages is bounded 3..100 by the server', () => {
  assert.throws(() => parseConvaiPartialIR({ summary: { minimumMessages: 2 } }), (e) => e.code === 'SCHEMA');
  assert.throws(() => parseConvaiPartialIR({ summary: { minimumMessages: 101 } }), (e) => e.code === 'SCHEMA');
  assert.doesNotThrow(() => parseConvaiPartialIR({ summary: { minimumMessages: 100 } }));
});

test('action missing type rejected', () => {
  const ir = validIR(); ir.actions = [{ name: 'Handover' }];
  assert.throws(() => parseConvaiIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('action missing name rejected', () => {
  const ir = validIR(); ir.actions = [{ type: 'humanHandOver' }];
  assert.throws(() => parseConvaiIR(ir), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('verified action types cover all 7 captured convai action types', () => {
  assert.deepEqual(VERIFIED_ACTION_TYPES, [
    'humanHandOver',
    'appointmentBooking',
    'triggerWorkflow',
    'updateContactField',
    'stopBot',
    'transferBot',
    'advancedFollowup',
  ]);
});

test('valid humanHandOver action passes', () => {
  const ir = validIR();
  ir.actions = [{ type: 'humanHandOver', name: 'Human Requested', details: { handoverType: 'contactRequest' } }];
  const out = parseConvaiIR(ir);
  assert.equal(out.actions[0].type, 'humanHandOver');
});

test('partial IR: empty object passes (all fields optional)', () => {
  const out = parseConvaiPartialIR({});
  assert.deepEqual(out, {});
});

test('partial IR: present-but-invalid mode still rejected', () => {
  assert.throws(() => parseConvaiPartialIR({ mode: 'nope' }), (e) => e.code === 'BAD_MODE');
});

test('partial IR: present-but-invalid channel still rejected', () => {
  assert.throws(() => parseConvaiPartialIR({ channels: ['Telegram'] }), (e) => e.code === 'BAD_CHANNELS');
});

test('partial IR: knowledgeBaseTriggers passthrough (only KB ids array-checked)', () => {
  const out = parseConvaiPartialIR({ knowledgeBaseIds: ['kb1'] });
  assert.deepEqual(out.knowledgeBaseIds, ['kb1']);
});

// 🔴 This test asserted the OPPOSITE until 2026-09-11, on a 2026-09-02 note claiming GHL accepts
// `autoPilot` on the write and stores `auto-pilot`. Measured live on GROM Sandbox 2026-09-11,
// POST /ai-employees/employees: `autoPilot` is REFUSED —
//   422 ["mode must be one of the following values: off, suggestive, auto-pilot"]
// — and `auto-pilot` is accepted (201) and read back as `auto-pilot`. Write and read agree; both
// want the hyphen. The engine had been normalising the accepted spelling into the refused one, so
// no agent with a non-`off` mode could be created at all. Green tests proved the assumption, not
// the API. `autoPilot` stays ACCEPTED from callers — anyone working from the old note has it in
// hand — but it is normalised to the wire spelling rather than emitted.
test('mode accepts the camelCase spelling callers may hold, and normalises it to the hyphenated wire spelling', () => {
  const spec = (mode) => ({
    name: 'A', botType: 'PROMPT_BASED_BOT', mode,
    channels: ['Live_Chat'], personality: 'p', goal: 'g', locationId: 'LOC',
  });
  assert.equal(parseConvaiIR(spec('autoPilot')).mode, 'auto-pilot',
    'the camelCase spelling must normalise to the spelling the server accepts');
  // the wire spelling passes through untouched
  assert.equal(parseConvaiIR(spec('auto-pilot')).mode, 'auto-pilot');
  // and a genuinely wrong value still fails, naming the accepted set
  assert.throws(() => parseConvaiIR(spec('turbo')), (e) => e.code === 'BAD_MODE');
});

// ---- W5a Task 5: the 2026-10 wave's agent-level keys -------------------------------------------
// Shapes are the editor's own save bodies (knowledge sniffs/convai-wave-2026-10-29: ui-capture-04-prompt-rich.json,
// ui-capture-06-mcp-outbound-msg.json), with the free text replaced by placeholders.
import { BOT_TYPES, checkOutboundOpener, checkOutboundDisclaimer, checkRichElementSettings } from './convai-ir.mjs';

const OPENER_STATIC = { mode: 'static', body: 'Hi {{contact.first_name}}, this is the team checking in. Reply here if you need anything.' };
const OPENER_AI = { mode: 'ai_generated', body: 'Send a short, friendly greeting.' };
const DISCLAIMER_CUSTOM = { enabled: true, style: 'custom', customText: 'Sent by an AI assistant' };
const DISCLAIMER_CONCISE = { enabled: true, style: 'concise' };
// capture 04, as SENT
const RICH_SENT = { enabled: true, customRulesOnly: false,
  elements: { richText: { enabled: true }, quickReplies: { enabled: true }, linkButtons: { enabled: true }, list: { enabled: true }, image: { enabled: false }, file: { enabled: true } },
  customInstructions: [{ name: 'Rule 1', type: 'quickReplies', trigger: 'the contact asks what services exist', enabled: true }] };
// capture 04, as READ BACK (the server adds carousel, the rule id and its timestamps; a read-merge-write echoes them)
const RICH_READ = { ...RICH_SENT,
  elements: { ...RICH_SENT.elements, carousel: { enabled: false } },
  customInstructions: [{ id: 'rule_1', ...RICH_SENT.customInstructions[0], createdAt: '2026-10-29T15:37:00.027Z', updatedAt: '2026-10-29T15:37:00.027Z' }] };
const code = (c) => (e) => e instanceof IRError && e.code === c;

test('BOT_TYPES knows FLOW_BUILDER_BOT_V2 (the 2026-10 flow agent), so a V2 record is not refused as an unknown type', () => {
  assert.ok(BOT_TYPES.includes('FLOW_BUILDER_BOT_V2'));
  assert.doesNotThrow(() => parseConvaiPartialIR({ botType: 'FLOW_BUILDER_BOT_V2' }));
});

test('outboundOpeningMessage: the captured static and ai_generated openers pass', () => {
  assert.doesNotThrow(() => checkOutboundOpener(OPENER_STATIC));
  assert.doesNotThrow(() => checkOutboundOpener(OPENER_AI));
  assert.doesNotThrow(() => checkOutboundOpener(undefined));
});

test('outboundOpeningMessage: a static opener needs a body; mode is ai_generated|static; 201 words is BAD_OPENER, 200 passes', () => {
  assert.throws(() => checkOutboundOpener({ mode: 'static' }), code('BAD_OPENER'));
  assert.throws(() => checkOutboundOpener({ mode: 'static', body: '   ' }), code('BAD_OPENER'));
  assert.throws(() => checkOutboundOpener({ mode: 'template', body: 'hi' }), code('BAD_OPENER'));
  assert.throws(() => checkOutboundOpener({ body: 'hi' }), code('BAD_OPENER'));
  assert.throws(() => checkOutboundOpener('hi'), code('BAD_OPENER'));
  assert.throws(() => checkOutboundOpener({ mode: 'static', body: 'hi', extra: 1 }), code('BAD_OPENER'));
  const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  assert.doesNotThrow(() => checkOutboundOpener({ mode: 'static', body: words(200) }));
  assert.throws(() => checkOutboundOpener({ mode: 'static', body: words(201) }), code('BAD_OPENER'));
  assert.throws(() => checkOutboundOpener({ mode: 'ai_generated', body: words(201) }), code('BAD_OPENER'));
});

test('outboundDisclaimer: concise and custom pass; custom needs customText; enabled is a boolean; style concise|custom', () => {
  assert.doesNotThrow(() => checkOutboundDisclaimer(DISCLAIMER_CUSTOM));
  assert.doesNotThrow(() => checkOutboundDisclaimer(DISCLAIMER_CONCISE));
  assert.doesNotThrow(() => checkOutboundDisclaimer({ enabled: false, style: 'concise' }));
  assert.throws(() => checkOutboundDisclaimer({ enabled: true, style: 'custom' }), code('BAD_DISCLAIMER'));
  assert.throws(() => checkOutboundDisclaimer({ enabled: true, style: 'custom', customText: ' ' }), code('BAD_DISCLAIMER'));
  assert.throws(() => checkOutboundDisclaimer({ enabled: 'true', style: 'concise' }), code('BAD_DISCLAIMER'));
  assert.throws(() => checkOutboundDisclaimer({ enabled: true, style: 'long' }), code('BAD_DISCLAIMER'));
  assert.throws(() => checkOutboundDisclaimer({ enabled: true }), code('BAD_DISCLAIMER'));
  assert.throws(() => checkOutboundDisclaimer({ enabled: true, style: 'concise', tone: 'x' }), code('BAD_DISCLAIMER'));
});

test('richElementSettings: the captured shapes (as sent and as read back) pass on a prompt bot', () => {
  assert.doesNotThrow(() => checkRichElementSettings(RICH_SENT, { botType: 'PROMPT_BASED_BOT' }));
  assert.doesNotThrow(() => checkRichElementSettings(RICH_READ, { botType: 'PROMPT_BASED_BOT' }));
  assert.doesNotThrow(() => checkRichElementSettings({ enabled: false }, { botType: 'PROMPT_BASED_BOT' }));
});

test('richElementSettings: only a PROMPT_BASED_BOT carries them (the builder strips them otherwise)', () => {
  for (const botType of ['FLOW_BUILDER_BOT', 'FLOW_BUILDER_BOT_V2', 'FORM_BASED_BOT']) {
    assert.throws(() => checkRichElementSettings(RICH_SENT, { botType }), code('RICH_ELEMENTS_PROMPT_ONLY'), botType);
  }
});

test('richElementSettings: wrong shapes are BAD_RICH_ELEMENTS', () => {
  const P = { botType: 'PROMPT_BASED_BOT' };
  assert.throws(() => checkRichElementSettings({ customRulesOnly: false }, P), code('BAD_RICH_ELEMENTS'), 'enabled is required');
  assert.throws(() => checkRichElementSettings({ enabled: 'yes' }, P), code('BAD_RICH_ELEMENTS'));
  assert.throws(() => checkRichElementSettings({ enabled: true, customRulesOnly: 'no' }, P), code('BAD_RICH_ELEMENTS'));
  assert.throws(() => checkRichElementSettings({ enabled: true, elements: { video: { enabled: true } } }, P), code('BAD_RICH_ELEMENTS'));
  assert.throws(() => checkRichElementSettings({ enabled: true, elements: { image: true } }, P), code('BAD_RICH_ELEMENTS'));
  assert.throws(() => checkRichElementSettings({ enabled: true, customInstructions: {} }, P), code('BAD_RICH_ELEMENTS'));
  assert.throws(() => checkRichElementSettings({ enabled: true, customInstructions: [{ name: 'r', type: 'video', trigger: 't', enabled: true }] }, P), code('BAD_RICH_ELEMENTS'));
  assert.throws(() => checkRichElementSettings({ enabled: true, customInstructions: [{ name: 'r', type: 'list', trigger: '', enabled: true }] }, P), code('BAD_RICH_ELEMENTS'));
  assert.throws(() => checkRichElementSettings({ enabled: true, rules: [] }, P), code('BAD_RICH_ELEMENTS'));
});

test('partial IR runs the wave checks', () => {
  assert.throws(() => parseConvaiPartialIR({ outboundOpeningMessage: { mode: 'static' } }), code('BAD_OPENER'));
  assert.throws(() => parseConvaiPartialIR({ outboundDisclaimer: { enabled: true, style: 'custom' } }), code('BAD_DISCLAIMER'));
  assert.throws(() => parseConvaiPartialIR({ richElementSettings: { enabled: 1 } }), code('BAD_RICH_ELEMENTS'));
  assert.doesNotThrow(() => parseConvaiPartialIR({ outboundOpeningMessage: OPENER_STATIC, outboundDisclaimer: DISCLAIMER_CUSTOM, richElementSettings: RICH_SENT }));
});

test('llm takes any roster id — Claude and Gemini included (accepted and read back live 2026-10-29)', () => {
  assert.doesNotThrow(() => parseConvaiPartialIR({ llm: { primary: 'claude-haiku-5-5', secondary: 'gemini-3.5-flash-lite' } }));
});
