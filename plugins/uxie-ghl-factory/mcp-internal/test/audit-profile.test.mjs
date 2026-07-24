import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { AUDIT_TOOL_NAMES, toolsForProfile } from '../core/audit-profile.mjs';

const runtimeTool = {
  name: 'get_workflow_runtime_window',
  capabilities: [{ method: 'GET', path: '/workflows/logs/v2' }],
  inputSchema: {},
  handler() {},
};
const rosterTool = {
  name: 'list_workflows_complete',
  capabilities: [{ method: 'GET', path: '/workflow/{loc}/list' }],
  inputSchema: {},
  handler() {},
};
const aiTool = {
  name: 'get_ai_configuration_bundle',
  capabilities: [{ method: 'GET', path: '/voice-ai/agents/{agentId}' }],
  inputSchema: {},
  handler() {},
};
const futureTools = [...TOOLS, runtimeTool, rosterTool, aiTool];

test('audit profile exposes the exact read-only set', () => {
  assert.deepEqual(AUDIT_TOOL_NAMES, [
    'auth_status',
    'list_workflows_complete',
    'get_workflow',
    'export_workflow',
    'get_workflow_runtime_window',
    'get_ai_configuration_bundle',
  ]);
  const selected = toolsForProfile('audit', futureTools);
  assert.deepEqual(selected.map((tool) => tool.name), AUDIT_TOOL_NAMES);
  assert.ok(selected.every((tool) => tool.name === 'auth_status'
    || tool.capabilities.every((capability) => capability.method === 'GET')));
  assert.ok(selected.every((tool) => !['raw_request', 'set_token_file', 'list_courses'].includes(tool.name)));
});

test('audit selection rejects duplicate missing or capability-free escape tools', () => {
  assert.throws(() => toolsForProfile('audit', [...futureTools, futureTools[0]]), /DUPLICATE_TOOL/);
  assert.throws(() => toolsForProfile('audit', futureTools.filter((tool) => tool.name !== 'auth_status')), /MISSING_AUDIT_TOOL/);
  const broken = futureTools.map((tool) => tool.name === 'list_workflows_complete'
    ? { ...tool, capabilities: [] }
    : tool);
  assert.throws(() => toolsForProfile('audit', broken), /UNAPPROVED_AUDIT_TOOL/);
});
