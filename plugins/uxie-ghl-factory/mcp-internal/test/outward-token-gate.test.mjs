// bl-946 (DECISIONS 2026-11-09, part of w6): the outward tools took a two-step token. Since 2026-11-18 none needs it (confirm:true writes in
// one call), but each still DECLARES confirmationToken so an older caller that sends one is not rejected. Original note: each must DECLARE confirmationToken in
// its input schema: an undeclared field is stripped before the handler sees it, and the gate would then refuse every confirmed call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

// publish_workflow left this list on 2026-11-18 (repo owner): it publishes in one call with confirm:true and ignores a token.
const GATED = [
  'build_funnel_page', 'edit_funnel', 'copy_workflow_to_location', 'push_snapshot', 'fast_forward_contacts', 'set_agent_deployment',
  'publish_studio_site',
];

for (const name of GATED) {
  test(`bl-946: ${name} declares confirmationToken in its input schema`, () => {
    const tool = TOOLS.find((t) => t.name === name);
    assert.ok(tool, `${name} is registered`);
    const shape = tool.inputSchema.shape ?? tool.inputSchema._def.shape();
    assert.ok('confirmationToken' in shape, `${name} must declare confirmationToken`);
    assert.ok('confirm' in shape, `${name} keeps confirm`);
  });
}
