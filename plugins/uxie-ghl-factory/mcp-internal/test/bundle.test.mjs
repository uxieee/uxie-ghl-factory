import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TOOLS } from '../core/tools.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const root = resolve(HERE, '..');
const distServer = resolve(root, 'dist/server.mjs');

// The whole point of the committed bundle is that it boots on a user's machine with just
// `node` — no `npm install`. This spawns the ACTUAL committed dist and drives it over stdio.
test('committed dist/server.mjs boots over stdio and registers every tool', async () => {
  const t = new StdioClientTransport({ command: 'node', args: [distServer], stderr: 'pipe' });
  let err = '';
  t.stderr?.on('data', (d) => { err += d.toString(); });
  const c = new Client({ name: 'bundle-test', version: '0' }, { capabilities: {} });
  try {
    await c.connect(t);
    const { tools } = await c.listTools();
    assert.equal(tools.length, TOOLS.length, `bundle should register all ${TOOLS.length} tools`);
    const names = new Set(tools.map((x) => x.name));
    for (const tool of TOOLS) assert.ok(names.has(tool.name), `bundle missing tool ${tool.name}`);
  } catch (e) {
    assert.fail(`bundle failed to boot: ${e.message}\n--- server stderr ---\n${err.slice(0, 800)}`);
  } finally {
    await c.close().catch(() => {});
  }
});

// A stale committed dist would ship old behavior while the source looks fixed — this
// project's "green tests != live" trap, at the packaging layer. Rebuild in-memory and diff.
test('committed dist/server.mjs is in sync with source (rebuild-and-diff)', async () => {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const result = await build({
    entryPoints: [resolve(root, 'stdio.mjs')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    define: { __MCP_VERSION__: JSON.stringify(pkg.version) },
    write: false,
    logLevel: 'silent',
  });
  const fresh = result.outputFiles[0].text;
  const committed = readFileSync(distServer, 'utf8');
  assert.equal(fresh, committed, 'dist/server.mjs is stale — run `npm run build` and commit dist/');
});
