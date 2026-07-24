import { TOOLS } from './tools.mjs';

export const AUDIT_TOOL_NAMES = Object.freeze([
  'auth_status',
  'list_workflows_complete',
  'get_workflow',
  'export_workflow',
  'get_workflow_runtime_window',
  'get_ai_configuration_bundle',
]);

export function toolsForProfile(profile, tools = TOOLS) {
  if (profile !== 'audit') throw new Error('UNKNOWN_TOOL_PROFILE');
  const byName = new Map();
  for (const tool of tools) {
    if (byName.has(tool.name)) throw new Error('DUPLICATE_TOOL');
    byName.set(tool.name, tool);
  }
  const selected = AUDIT_TOOL_NAMES.map((name) => {
    const tool = byName.get(name);
    if (!tool) throw new Error(`MISSING_AUDIT_TOOL:${name}`);
    return tool;
  });
  for (const tool of selected) {
    if (tool.name === 'auth_status') continue;
    if (tool.capabilities.length === 0) throw new Error(`UNAPPROVED_AUDIT_TOOL:${tool.name}`);
    if (tool.capabilities.some((capability) => capability.method !== 'GET')) {
      throw new Error(`UNAPPROVED_AUDIT_TOOL:${tool.name}`);
    }
  }
  return selected;
}
