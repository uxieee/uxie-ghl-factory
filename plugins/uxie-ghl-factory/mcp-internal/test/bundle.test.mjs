import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { TOOLS } from '../core/tools.mjs';
import { buildOptions, OUTFILE } from '../scripts/esbuild-config.mjs';

const distServer = OUTFILE;

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
  const result = await build(buildOptions({ write: false, logLevel: 'silent' }));
  const fresh = result.outputFiles[0].text;
  const committed = readFileSync(distServer, 'utf8');
  assert.equal(fresh, committed, 'dist/server.mjs is stale — run `npm run build` and commit dist/');
});

// P1 — the bundle must be SELF-CONTAINED, which is the whole reason defines exist. It was not:
// the endpoint catalog was read from a sibling catalog/ directory, so search_endpoints worked in
// this repo and failed anywhere else. The test above never caught it because listing tools does
// not touch the catalog. This copies the committed bundle somewhere with no siblings and CALLS it.
test('committed bundles carry the endpoint catalog with no sibling files', async () => {
  const { mkdtemp, copyFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const dir = await mkdtemp(join(tmpdir(), 'ghl-bundle-'));
  try {
    const lone = join(dir, 'server.mjs');
    await copyFile(distServer, lone);
    const t = new StdioClientTransport({ command: 'node', args: [lone], stderr: 'pipe' });
    const c = new Client({ name: 'isolated-bundle-test', version: '0' }, { capabilities: {} });
    try {
      await c.connect(t);
      const res = await c.callTool({
        name: 'search_endpoints',
        arguments: { intent: 'list the workflow folders', limit: 3 },
      });
      const parsed = JSON.parse(res.content[0].text);
      assert.equal(parsed.ok, true, `isolated bundle could not search: ${parsed.detail ?? ''}`);
      assert.ok(parsed.data.results.length > 0, 'isolated bundle returned no endpoint rows');
    } finally {
      await c.close().catch(() => {});
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
