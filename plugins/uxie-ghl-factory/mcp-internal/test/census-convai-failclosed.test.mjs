import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '../../skills/create-ghl-workflow/scripts');
const { publishedTriggerCensus, censusClean, convAiClean, EVENT_SETS } = await import(join(SCRIPTS, 'published-trigger-census.mjs'));
// (run with GHL_INTERNAL_TOK_FILE=/nonexistent/tok.txt; nothing here reads a token or makes a call)
const world = (workflows, triggers = {}) => ({
  call: async () => ({ ok: true, data: { complete: true, workflows } }),
  gw: { call: async (_m, path) => { const id = decodeURIComponent(path.split('workflowId=')[1]); return { ok: true, json: { triggers: triggers[id] ?? [] } }; } },
});
const CONVAI_FLOW = { w: [{ id: 'w1', name: 'Bot flow' }], t: { w1: [{ type: 'conv_ai_session_started', active: true, conditions: [] }] } };
const NONE = { w: [], t: {} };
const states = { blocked: { ok: true, blocks: true, reason: 'an agent can fire' }, unreadable: { ok: false, blocks: true, reason: 'not a complete read' }, 'ok but blocks missing': { ok: true }, missing: undefined, null: null };
test('convAiClean / censusClean: clean ONLY when ok === true and blocks === false', () => {
  assert.equal(convAiClean({ ok: true, blocks: false }), true);
  for (const v of Object.values(states)) assert.equal(convAiClean(v), false);
  assert.equal(censusClean({ ok: true, blockers: [], convAi: { ok: true, blocks: false } }), true);
  assert.equal(censusClean({ ok: true, blockers: [], convAi: { ok: true, blocks: true } }), false);
  assert.equal(censusClean({ ok: true, blockers: [{}], convAi: { ok: true, blocks: false } }), false);
  assert.equal(censusClean({ ok: false, blockers: [], convAi: { ok: true, blocks: false } }), false);
});
for (const [label, w] of [['zero published workflows', NONE], ['a conv_ai_* published workflow', CONVAI_FLOW]]) {
  for (const [state, convAi] of Object.entries(states)) {
    test(`${label}: a Conversation AI census that is "${state}" is NOT clean`, async () => {
      const c = await publishedTriggerCensus({ ...world(w.w, w.t), LOCATION: 'L', eventSet: EVENT_SETS.conversation, ...(convAi === undefined ? {} : { convAi }) });
      assert.equal(c.ok, false, 'the census must not read ok'); assert.equal(censusClean(c), false); assert.match(c.reason, /Conversation AI census is not clean/);
    });
  }
  test(`${label}: a clean Conversation AI census (ok true, blocks false) reads clean when nothing else blocks`, async () => {
    const c = await publishedTriggerCensus({ ...world(w.w, w.t), LOCATION: 'L', eventSet: EVENT_SETS.core, convAi: { ok: true, blocks: false, agents: [] } });
    assert.equal(c.ok, true);
  });
}
test('conformance.mjs censusGate uses the same helper and no longer builds its own clean flag', () => {
  const src = readFileSync(join(SCRIPTS, 'conformance.mjs'), 'utf8');
  assert.match(src, /const clean = censusClean\(c\);/); assert.ok(!/const clean = c\.ok === true && c\.blockers\.length === 0/.test(src));
});
