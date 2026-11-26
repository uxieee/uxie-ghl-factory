// codeDeps finds a tool one import level deeper than the seam: core/tools.mjs imports a module, that module imports the factory that declares the tool
// (get_workflow_linked_assets: tools.mjs -> workflow-w6c-tools.mjs -> workflow-linked-assets.mjs). A tool found at the first two levels keeps its key
// (existing proof records must not go stale). A nested tool's body is hashed, its description is not, and a tool no module declares is still refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeDeps } from '../../../../scripts/lib/code-deps.mjs';
import { tempDir } from './_tmp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MI = resolve(HERE, '..');
const ROOT = resolve(HERE, '../../../..');
const TOOLS = join(MI, 'core/tools.mjs');

test('get_workflow_linked_assets is found two levels down, keyed by the file that declares it', () => {
  const keys = Object.keys(codeDeps({ toolsFile: TOOLS, tool: 'get_workflow_linked_assets', root: ROOT }));
  assert.equal(keys[0], 'plugins/uxie-ghl-factory/mcp-internal/core/workflow-linked-assets.mjs#get_workflow_linked_assets', keys.join('\n'));
});

test('tools found at the first two levels keep their keys', () => {
  const a = Object.keys(codeDeps({ toolsFile: TOOLS, tool: 'list_ai_agent_skills', root: ROOT }))[0];
  const b = Object.keys(codeDeps({ toolsFile: TOOLS, tool: 'compare_page_renders', root: ROOT }))[0];
  const c = Object.keys(codeDeps({ toolsFile: TOOLS, tool: 'audit_site', root: ROOT }))[0];
  assert.equal(a, 'plugins/uxie-ghl-factory/mcp-internal/core/workflow-w6c-tools.mjs#list_ai_agent_skills');
  assert.equal(b, 'plugins/uxie-ghl-factory/mcp-internal/core/funnel-render-tools.mjs#compare_page_renders');
  assert.equal(c, 'plugins/uxie-ghl-factory/mcp-internal/core/tools.mjs#audit_site');
});

test('a tool no module declares, at any depth, is still refused', () => {
  assert.throws(() => codeDeps({ toolsFile: TOOLS, tool: 'no_such_tool_xyz', root: ROOT }), /no tool block for no_such_tool_xyz/);
});

function fixture(description, body, { duplicateAtFirstLevel = false } = {}) {
  const dir = tempDir('codedeps-nested-');
  mkdirSync(join(dir, 'core'));
  writeFileSync(join(dir, 'core/helper.mjs'), 'export const add = (a, b) => a + b;\n');
  const tool = (d, b) => [
    '    {',
    "      name: 'nested_tool',",
    `      description: '${d}',`,
    `      handler: async (args) => ${b},`,
    '    },',
  ];
  writeFileSync(join(dir, 'core/nested.mjs'), ["import { add } from './helper.mjs';", 'export function makeNested() {', '  return [', ...tool(description, body), '  ];', '}', ''].join('\n'));
  writeFileSync(join(dir, 'core/mid.mjs'), ["import { makeNested } from './nested.mjs';", 'export function makeMid() {', '  return [...makeNested()];', '}', ''].join('\n'));
  if (duplicateAtFirstLevel) writeFileSync(join(dir, 'core/direct.mjs'), ['export function makeDirect() {', '  return [', ...tool('direct', '0'), '  ];', '}', ''].join('\n'));
  writeFileSync(join(dir, 'core/tools.mjs'), `import { makeMid } from './mid.mjs';\n${duplicateAtFirstLevel ? "import { makeDirect } from './direct.mjs';\n" : ''}export const TOOLS = [...makeMid()${duplicateAtFirstLevel ? ', ...makeDirect()' : ''}];\n`);
  return dir;
}

test('fixture: a nested tool\'s body is hashed, its imports are dependencies, its description is not', () => {
  const a = fixture('first wording', 'add(args.a, 1)'); const b = fixture('second wording', 'add(args.a, 1)'); const c = fixture('first wording', 'add(args.a, 2)');
  try {
    const d = (x) => codeDeps({ toolsFile: join(x, 'core/tools.mjs'), tool: 'nested_tool', root: x });
    const da = d(a);
    assert.equal(Object.keys(da)[0], 'core/nested.mjs#nested_tool');
    assert.ok('core/helper.mjs' in da, 'the helper the handler calls is a dependency');
    assert.equal(da['core/nested.mjs#nested_tool'], d(b)['core/nested.mjs#nested_tool'], 'a description-only change must not stale the proof');
    assert.notEqual(da['core/nested.mjs#nested_tool'], d(c)['core/nested.mjs#nested_tool'], 'a body change must change the hash');
  } finally { for (const x of [a, b, c]) rmSync(x, { recursive: true, force: true }); }
});

test('fixture: a tool also declared at the first level resolves to the first-level block', () => {
  const a = fixture('same', 'add(args.a, 1)', { duplicateAtFirstLevel: true });
  try {
    const keys = Object.keys(codeDeps({ toolsFile: join(a, 'core/tools.mjs'), tool: 'nested_tool', root: a }));
    assert.equal(keys[0], 'core/direct.mjs#nested_tool');
  } finally { rmSync(a, { recursive: true, force: true }); }
});
