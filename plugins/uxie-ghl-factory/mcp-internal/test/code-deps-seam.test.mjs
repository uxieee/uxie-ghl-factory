// fn-4 (2026-11-08): codeDeps finds a tool that core/tools.mjs imports rather than declares (the p2 seam: compare_page_renders lives in
// core/funnel-render-tools.mjs). The proof record needs its code, or `proof.mjs record` refuses with "no tool block". Tools declared in
// tools.mjs keep their keys, so existing proof records do not go stale. A fixture pins the rule: the seam tool's body is hashed, its
// description is not (writing a proof label must never stale the proof it describes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeDeps } from '../../../../scripts/lib/code-deps.mjs';
import { tempDir } from './_tmp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MI = resolve(HERE, '..');
const ROOT = resolve(HERE, '../../../..');
const TOOLS = join(MI, 'core/tools.mjs');

test('compare_page_renders is found through the seam: its block lives in core/funnel-render-tools.mjs, not core/tools.mjs', () => {
  const keys = Object.keys(codeDeps({ toolsFile: TOOLS, tool: 'compare_page_renders', root: ROOT }));
  assert.equal(keys[0], 'plugins/uxie-ghl-factory/mcp-internal/core/funnel-render-tools.mjs#compare_page_renders', keys.join('\n'));
  assert.ok(keys.includes('plugins/uxie-ghl-factory/mcp-internal/core/funnel-render-check.mjs'), 'the comparer the tool calls is a dependency');
  assert.ok(keys.includes('plugins/uxie-ghl-factory/mcp-internal/core/errors.mjs'), 'the codes it returns are a dependency');
});

test('a tool still declared in core/tools.mjs keeps its tools.mjs key, so existing proof records do not go stale', () => {
  const keys = Object.keys(codeDeps({ toolsFile: TOOLS, tool: 'audit_site', root: ROOT }));
  assert.equal(keys[0], 'plugins/uxie-ghl-factory/mcp-internal/core/tools.mjs#audit_site');
});

test('a tool that no module declares is still refused', () => {
  assert.throws(() => codeDeps({ toolsFile: TOOLS, tool: 'no_such_tool_xyz', root: ROOT }), /no tool block for no_such_tool_xyz/);
});

function fixture(description, body) {
  const dir = tempDir('codedeps-seam-');
  mkdirSync(join(dir, 'core'));
  writeFileSync(join(dir, 'core/helper.mjs'), 'export const add = (a, b) => a + b;\n');
  writeFileSync(join(dir, 'core/seam.mjs'), [
    "import { add } from './helper.mjs';",
    'export function makeSeam() {',
    '  return [',
    '    {',
    "      name: 'seam_tool',",
    `      description: '${description}',`,
    `      handler: async (args) => ${body},`,
    '    },',
    '  ];',
    '}',
    '',
  ].join('\n'));
  writeFileSync(join(dir, 'core/tools.mjs'), "import { makeSeam } from './seam.mjs';\nexport const TOOLS = [...makeSeam()];\n");
  return dir;
}

test('fixture: a seam tool at a deeper indent is found, its imports are dependencies, and its description is not hashed', () => {
  const a = fixture('first wording', 'add(args.a, 1)');
  const b = fixture('second wording, same code', 'add(args.a, 1)');
  try {
    const da = codeDeps({ toolsFile: join(a, 'core/tools.mjs'), tool: 'seam_tool', root: a });
    const db = codeDeps({ toolsFile: join(b, 'core/tools.mjs'), tool: 'seam_tool', root: b });
    assert.equal(Object.keys(da)[0], 'core/seam.mjs#seam_tool');
    assert.ok('core/helper.mjs' in da, 'the helper the handler calls is a dependency');
    assert.equal(da['core/seam.mjs#seam_tool'], db['core/seam.mjs#seam_tool'], 'a description-only change must not stale the proof');
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

test('fixture: changing the seam tool body changes its hash', () => {
  const a = fixture('same', 'add(args.a, 1)');
  const b = fixture('same', 'add(args.a, 2)');
  try {
    const da = codeDeps({ toolsFile: join(a, 'core/tools.mjs'), tool: 'seam_tool', root: a });
    const db = codeDeps({ toolsFile: join(b, 'core/tools.mjs'), tool: 'seam_tool', root: b });
    assert.notEqual(da['core/seam.mjs#seam_tool'], db['core/seam.mjs#seam_tool']);
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});
