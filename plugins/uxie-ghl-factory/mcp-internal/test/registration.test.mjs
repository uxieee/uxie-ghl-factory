// The test that SHOULD have existed in Task 5. The mock-based registerTools test
// asserted our own calling convention, not the SDK's — so a JSON-Schema inputSchema
// passed the suite and crashed the moment a real McpServer was constructed.
//
// This registers every tool against a REAL McpServer, and additionally boots
// stdio.mjs as a child process to prove the entry point actually starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TOOLS, registerTools } from '../core/tools.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function validTokenFile() {
  const dir = mkdtempSync(join(tmpdir(), 'ghl-registration-'));
  const path = join(dir, 'tok.txt');
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${b64({ authClassId: 'u', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
  writeFileSync(path, `Authorization: Bearer ${jwt}\ntoken-id: tid-fixture\n`);
  return { path, jwt };
}

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

test('real MCP tools/list publishes every tool with an SDK-generated object schema', async () => {
  const server = new McpServer({ name: 'test-server', version: '0.0.0' });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  registerTools(server, { state: {}, makeGw: () => { throw new Error('unused'); } });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((candidate) => candidate.name).sort(),
      TOOLS.map((candidate) => candidate.name).sort(),
    );
    for (const candidate of listed.tools) {
      assert.equal(candidate.inputSchema.type, 'object', `${candidate.name} schema type`);
      assert.ok(candidate.inputSchema.properties, `${candidate.name} schema properties`);
      assert.notEqual(candidate.inputSchema.additionalProperties, false,
        `${candidate.name} must let the sanitized handler reject unknown keys`);
    }
  } finally {
    await client.close();
  }
});

test('real MCP tools/call sanitizes secret unknown keys and rejects all unknown fields before state mutation', async () => {
  const server = new McpServer({ name: 'test-server', version: '0.0.0' });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const state = { tokenFile: '/existing/tok.txt' };
  registerTools(server, { state, makeGw: () => { throw new Error('unused'); } });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { path, jwt } = validTokenFile();
    const tokenIdKey = 'token-id: opaque-token-id-value-123';
    const cases = [
      { label: 'JWT property key', args: { path, [jwt]: true }, secret: jwt, code: 'TOKEN_MISSING' },
      { label: 'token-id-like property key', args: { path, [tokenIdKey]: true }, secret: tokenIdKey, code: 'TOKEN_MISSING' },
      { label: 'ordinary unknown field', args: { path, surprise: 'harmless' }, secret: 'surprise', code: 'VALIDATION_FAILED' },
    ];

    for (const scenario of cases) {
      const result = await client.callTool({ name: 'set_token_file', arguments: scenario.args });
      assert.notEqual(result.isError, true, `${scenario.label} became a protocol validation error`);
      const contract = JSON.parse(result.content[0].text);
      assert.equal(contract.ok, false, scenario.label);
      assert.equal(contract.code, scenario.code, scenario.label);
      assert.ok(!JSON.stringify(result).includes(scenario.secret), `${scenario.label} leaked`);
      assert.equal(state.tokenFile, '/existing/tok.txt', `${scenario.label} mutated state`);
    }

    const knownFieldTypeError = await client.callTool({
      name: 'set_token_file',
      arguments: { path: 123 },
    });
    assert.equal(knownFieldTypeError.isError, true, 'known-field validation must remain SDK-backed');
    assert.equal(state.tokenFile, '/existing/tok.txt');
  } finally {
    await client.close();
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
