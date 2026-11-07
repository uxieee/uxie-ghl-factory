#!/usr/bin/env node
// Writes the saved tools/list responses ({tools:[{name, description, inputSchema}]}) of the eval harness, one per mock
// set, for EVERY tool that has a <tool>.md mock there. It imports the real server's TOOLS table only — it never starts
// the server, reads no token and makes no request.
//
// - evals/mocks/uxie-ghl-internal-mcp/_tools.json (e2e suite): the REAL descriptions and input schemas, so the model
//   sees what a user's session sees.
// - evals-skill/mocks/uxie-ghl-internal-mcp/_tools.json (skill suite): the real input schemas with every
//   `description` stripped, and the NEUTRAL one-line descriptions below (shapes only: no arming, send-class, lead-form,
//   campaign or consequence prose), so only the skill can supply that knowledge.
//
// Usage: node eval-harness/scripts/gen-tools-json.mjs   (from the plugin repo root, or anywhere)
import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const harness = join(here, '..', 'uxie-ghl-factory-eval');
const { TOOLS } = await import(join(repo, 'plugins/uxie-ghl-factory/mcp-internal/core/tools.mjs'));
const { z } = await import(join(repo, 'plugins/uxie-ghl-factory/mcp-internal/node_modules/zod/index.js'));

const NEUTRAL = {
  build_workflow: 'Build a workflow draft. spec: {name, triggers, graph}.',
  create_convai_agent: 'Create a Conversation AI agent from spec. Returns a preview unless confirm:true.',
  create_studio_agent: 'Create a Managed Agent (Agent Studio) from spec. Returns a preview unless confirm:true.',
  get_form: 'Read one form by id: its fields and formData.',
  describe_endpoint: 'Detail for one internal endpoint, by id from search_endpoints.',
  get_ai_agent_options: 'List the models available on a location. product selects the roster.',
  get_ai_configuration_bundle: "Read a location's Conversation AI, Voice AI and Agent Studio agents with their detail, routing and outbound records.",
  raw_request: 'Send a request to an internal path. host "workflow" (default) or "ai". A non-GET returns a preview unless confirm:true; acknowledge takes a token from the preview when it has one.',
  search_endpoints: 'Search the internal endpoint catalogue by intent. Hits: {id, method, path, coveredBy}.',
  set_convai_outbound: "Change a Conversation AI agent's outbound configs and triggers. activate: {sendingNumber} or false. triggers: [{type, config, enabled}]. Returns a preview unless confirm:true; acknowledge takes a token from the preview when it has one.",
  update_convai_agent: 'Update a Conversation AI agent. spec: the agent fields to change. Returns a preview unless confirm:true; acknowledge takes a token from the preview when it has one.',
};

const stripDescriptions = (node) => {
  if (Array.isArray(node)) return node.map(stripDescriptions);
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).filter(([k]) => k !== 'description').map(([k, v]) => [k, stripDescriptions(v)]));
  }
  return node;
};

for (const { suite, neutral } of [{ suite: 'evals', neutral: false }, { suite: 'evals-skill', neutral: true }]) {
  const mockDir = join(harness, suite, 'mocks', 'uxie-ghl-internal-mcp');
  const mocked = readdirSync(mockDir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
    .map((f) => f.slice(0, -3))
    .sort();
  const tools = mocked.map((name) => {
    const t = TOOLS.find((x) => x.name === name);
    if (!t) throw new Error(`mock ${suite}/${name}.md has no tool of that name in the real server`);
    let inputSchema = z.toJSONSchema(t.inputSchema, { io: 'input' });
    delete inputSchema.$schema;
    if (!neutral) return { name: t.name, description: t.description, inputSchema };
    if (!NEUTRAL[name]) throw new Error(`no neutral description for ${name}`);
    inputSchema = stripDescriptions(inputSchema);
    return { name: t.name, description: NEUTRAL[name], inputSchema };
  });
  writeFileSync(join(mockDir, '_tools.json'), `${JSON.stringify({ tools }, null, 2)}\n`);
  console.log(`${suite}: wrote ${tools.length} tools${neutral ? ' (neutral)' : ''}: ${mocked.join(', ')}`);
}
