import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '../../skills/create-ghl-workflow/scripts');
const { isRunTag, withPlannedTags, judgeTrigger, EVENT_SETS } = await import(join(SCRIPTS, 'published-trigger-census.mjs'));
const { judgeAgent } = await import(join(SCRIPTS, 'convai-census.mjs'));
const CORE = EVENT_SETS.core;
const tagTrig = (value) => ({ type: 'contact_tag', active: true, conditions: [{ field: 'tagsAdded', operator: 'index-of-true', value }] });
const agent = (tag) => ({ id: 'a1', detailRead: true, detail: { mode: 'auto' }, outboundRead: true, outbound: { triggers: [{ type: 'contact_tag', enabled: true, tagName: tag }] } });

test('isRunTag recognises generic, stamp, lane-tagged and exactly planned tags; nothing else', () => {
  for (const t of ['test-conf', 'TEST-CONF-123456', 'test-conf-123456-x', 'test-conf-w9-drift-123456', 'TEST-CONF-W9-DRIFT-123456-a', 'test-conf-w9-forms-folder2-654321', 'test-conf-w9-wf-pause-654321', 'test-conf-w9-agent-d22-654321', 'test-conf-w9-wf-bl919-new', 'test-conf-w9-forms-f2-a', 'test-conf-w9-123456', 'test-conf-w9-drift']) assert.ok(isRunTag(t), t);
  for (const t of ['ai:handover', 'test-conf-w9', 'test-conf-w9-', 'test-conf-wx9-drift-1', 'vip', '']) assert.ok(!isRunTag(t), t);
  assert.ok(isRunTag('my-planned-tag', ['My-Planned-Tag']));
  assert.ok(!isRunTag('my-planned-tag-2', ['my-planned-tag']), 'exact, not a prefix');
});
test('a non-TEST published trigger on every lane-tag shape BLOCKS (it used to be "cannot match")', () => {
  for (const t of ['test-conf-w9-forms-folder2-654321', 'test-conf-w9-wf-pause-654321', 'test-conf-w9-agent-d22-654321', 'test-conf-w9-wf-bl919-new', 'test-conf-w9-forms-f2-a', 'test-conf-w9-123456']) { assert.equal(judgeTrigger(tagTrig(t), CORE).decision, 'blocks', t); assert.equal(judgeAgent(agent(t)).blocks, true, t); }
  assert.equal(judgeTrigger(tagTrig('test-conf-w9-drift-654321'), CORE).decision, 'blocks');
  assert.equal(judgeTrigger(tagTrig('ai:handover'), CORE).decision, 'blocks');
});
test('a non-TEST published trigger on an exactly planned tag BLOCKS, and only with the plan passed', () => {
  assert.equal(judgeTrigger(tagTrig('drift-probe-x'), CORE).decision, 'blocks');
  assert.equal(judgeTrigger(tagTrig('drift-probe-x'), withPlannedTags(CORE, ['drift-probe-x'])).decision, 'blocks');
  assert.equal(judgeTrigger(tagTrig('other'), withPlannedTags(CORE, ['drift-probe-x'])).decision, 'blocks');
});
test('a Conversation AI outbound contact_tag trigger on the lane shape or a planned tag blocks', () => {
  assert.equal(judgeAgent(agent('test-conf-w9-drift-654321')).blocks, true);
  assert.equal(judgeAgent(agent('drift-probe-x'), ['drift-probe-x']).blocks, true);
  assert.equal(judgeAgent(agent('drift-probe-x')).blocks, true, 'default-block: an unplanned, unrelated tag blocks too (no exemption exists)');
});
