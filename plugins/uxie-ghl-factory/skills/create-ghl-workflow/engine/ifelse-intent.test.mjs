// bl-401: an intent row written as operator 'matches_intent' on message.body was refused, and the refusal named a hatch
// (skipIfElseVocab) no tool accepted. GHL's picker stores intent as its OWN leaf — conditionSubType 'matches_intent',
// operator == / !=, value schedule-yes | schedule-no (ifelse_conditions.ts message-contains-intent; stored client workflows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';
import { orchestrate } from './orchestrate.mjs';

const ir = (cond) => ({ name: 'W', triggers: [], graph: [{ ref: 'b', kind: 'if_else', name: 'Intent', branches: [
  { ref: 'y', name: 'Yes', conditions: [cond], then: [] }, { ref: 'n', name: 'Else', else: true, then: [] }] }] });
const ctx = (extra = {}) => ({ loc: 'L', cid: 'C', uid: 'U', companyAge: 0, idGen: makeSeededIdGen('i'), catalog: loadCatalog(), warn: () => {}, ...extra });

test('the stored intent shape compiles (subType matches_intent, ==, schedule-yes)', () => {
  assert.doesNotThrow(() => compile(ir({ conditionType: 'contact_reply', conditionSubType: 'matches_intent', conditionOperator: '==', conditionValue: 'schedule-yes' }), ctx()));
});

test('operator matches_intent on message.body is refused, and the refusal names the stored shape', () => {
  assert.throws(() => compile(ir({ conditionType: 'contact_reply', conditionSubType: 'message.body', conditionOperator: 'matches_intent', conditionValue: 'schedule-yes' }), ctx()),
    (e) => e.code === 'IFELSE_VOCAB' && /conditionSubType 'matches_intent'/.test(e.message) && /schedule-yes/.test(e.message));
});

test('skipIfElseVocab is reachable: build_workflow and edit_workflow declare it, and orchestrate passes it to compile', async () => {
  const src = readFileSync(new URL('../../../mcp-internal/core/tools.mjs', import.meta.url), 'utf8');
  const decl = src.match(/skipIfElseVocab: z\.boolean\(\)/g) ?? [];
  assert.ok(decl.length >= 2, `declared ${decl.length} time(s)`);
  const calls = [];
  const gw = { loc: 'L', uid: 'U', call: async (m, p, b) => { calls.push({ m, p }); return { ok: true, status: 200, json: m === 'POST' && /\/workflow\/L$/.test(p) ? { id: 'W1' } : {} }; } };
  const r = await orchestrate(ir({ conditionType: 'contact_reply', conditionSubType: 'message.body', conditionOperator: 'matches_intent', conditionValue: 'x' }), gw, { dryRun: true, skipIfElseVocab: true });
  assert.equal(r.check.errors.some((e) => e.code === 'IFELSE_VOCAB'), false, JSON.stringify(r.check.errors));
});
