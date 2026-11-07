// bl-512, bl-380, bl-389, bl-393: requirements the edit engine enforces that the tool description never said.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

// What a client shows: the tool description plus each argument's description (the tool description has a 2048 cap).
const tool = TOOLS.find((t) => t.name === 'edit_workflow');
const d = [tool.description, tool.inputSchema.shape.ops.description, tool.inputSchema.shape.opsPath.description].join(' ');

test('the description says a branching insert mid-flow needs attachTailTo', () => assert.match(d, /attachTailTo/));
test('the description says insertAfter takes steps[] and that anchors take refs and unique id prefixes', () => {
  assert.match(d, /steps: \[/); assert.match(d, /prefix/);
});
test('the description says assign_user needs user_list or customUserList', () => assert.match(d, /assign_user needs user_list or customUserList/));
test('the description names opsPath', () => assert.match(d, /opsPath/));
test('dissolveContainer and deleteTrigger keepIfElseRows are discoverable (bl-387, bl-419)', () => {
  assert.match(d, /dissolveContainer \{containerId, keep\}/); assert.match(d, /keepIfElseRows/);
});
