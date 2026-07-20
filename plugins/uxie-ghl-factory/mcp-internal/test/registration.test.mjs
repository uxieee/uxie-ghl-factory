// The test that SHOULD have existed in Task 5. The mock-based registerTools test
// asserted our own calling convention, not the SDK's — so a JSON-Schema inputSchema
// passed the suite and crashed the moment a real McpServer was constructed.
//
// This registers every tool against a REAL McpServer, and additionally boots
// stdio.mjs as a child process to prove the entry point actually starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOLS, registerTools } from '../core/tools.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('every tool registers against a real McpServer without throwing', () => {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  assert.doesNotThrow(() => {
    registerTools(server, { state: {}, makeGw: () => { throw new Error('unused'); } });
  });
});

test('each tool registers individually — names the offender if one fails', () => {
  for (const t of TOOLS) {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    assert.doesNotThrow(
      () => registerTools(server, { state: {}, makeGw: () => {} }, [t]),
      `tool "${t.name}" failed to register`,
    );
  }
});

test('stdio.mjs boots and stays alive (real process, not a mock)', async () => {
  const child = spawn(process.execPath, [resolve(HERE, '../stdio.mjs')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GHL_TOK_FILE: '/nonexistent/tok.txt' },
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });

  const outcome = await new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise({ alive: true }), 1500);
    child.on('exit', (code) => { clearTimeout(timer); resolvePromise({ alive: false, code }); });
    child.on('error', (err) => { clearTimeout(timer); resolvePromise({ alive: false, err: String(err) }); });
  });
  child.kill();

  assert.equal(outcome.alive, true,
    `stdio.mjs exited instead of serving (code ${outcome.code}). stderr:\n${stderr}`);
  // A missing token file must NOT prevent startup — credentials are read per call.
  assert.ok(!/inputSchema|Zod/i.test(stderr), `schema error on boot:\n${stderr}`);
});
