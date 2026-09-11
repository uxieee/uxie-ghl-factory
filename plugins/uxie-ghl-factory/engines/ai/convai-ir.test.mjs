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

test('channels enum matches captured values', () => {
  assert.deepEqual(CHANNELS, ['SMS', 'IG', 'FB', 'WebChat', 'Live_Chat', 'WhatsApp']);
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
