import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { toolBlocks, withoutDescription, codeDeps } from '../../../../scripts/lib/code-deps.mjs';

let root, toolsFile;
const TOOLS_SRC = (desc = 'Build it', helper = 'return 1;') => `import { compile } from '../engine/compiler.mjs';
import { unrelated } from '../engine/other.mjs';

const guard = (fn) => fn();
function shape() { ${helper} }
const noise = 5;

export const TOOLS = [
  {
    name: 'build_thing',
    description: \`\${describe('build_thing', '${desc}')}
      continues here\`,
    inputSchema: {},
    handler: async () => guard(() => compile(shape())),
  },
  {
    name: 'other_thing',
    description: 'x',
    handler: async () => unrelated(noise),
  },
];
`;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'code-'));
  mkdirSync(join(root, 'mi/core'), { recursive: true });
  mkdirSync(join(root, 'mi/engine'), { recursive: true });
  writeFileSync(join(root, 'mi/engine/compiler.mjs'), "import { util } from './util.mjs';\nexport const compile = (x) => util(x);\n");
  writeFileSync(join(root, 'mi/engine/util.mjs'), 'export const util = (x) => x;\n');
  writeFileSync(join(root, 'mi/engine/other.mjs'), 'export const unrelated = (x) => x;\n');
  toolsFile = join(root, 'mi/core/tools.mjs');
  writeFileSync(toolsFile, TOOLS_SRC());
});

test('toolBlocks finds one block per name', () => {
  const b = toolBlocks(TOOLS_SRC());
  assert.deepEqual([...b.keys()], ['build_thing', 'other_thing']);
  assert.match(b.get('build_thing'), /handler: async \(\) => guard/);
});

test('withoutDescription removes a multi-line description and nothing else', () => {
  const b = withoutDescription(toolBlocks(TOOLS_SRC()).get('build_thing'));
  assert.doesNotMatch(b, /describe|continues here/);
  assert.match(b, /inputSchema/);
});

test('codeDeps follows helpers and the import closure, and only those', () => {
  const d = codeDeps({ toolsFile, tool: 'build_thing', root });
  assert.deepEqual(Object.keys(d).sort(), ['mi/core/tools.mjs#build_thing', 'mi/engine/compiler.mjs', 'mi/engine/util.mjs']);
});

test('a description edit does not change the hash; a helper edit does', () => {
  const before = codeDeps({ toolsFile, tool: 'build_thing', root });
  writeFileSync(toolsFile, TOOLS_SRC('Build it — proof: live-runtime (2026-09-20); risk: write'));
  assert.deepEqual(codeDeps({ toolsFile, tool: 'build_thing', root }), before);
  writeFileSync(toolsFile, TOOLS_SRC('Build it', 'return 2;'));
  assert.notEqual(codeDeps({ toolsFile, tool: 'build_thing', root })['mi/core/tools.mjs#build_thing'], before['mi/core/tools.mjs#build_thing']);
  writeFileSync(toolsFile, TOOLS_SRC());
});

test('an unknown tool throws', () => {
  assert.throws(() => codeDeps({ toolsFile, tool: 'nope', root }), /no tool block/);
});
