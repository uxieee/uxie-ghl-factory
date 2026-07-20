import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, registerTools } from '../core/tools.mjs';

test('every tool has a name, description, schema, handler and declared capabilities', () => {
  assert.ok(TOOLS.length > 0);
  for (const t of TOOLS) {
    assert.ok(t.name && typeof t.name === 'string', 'name');
    assert.ok(t.description && t.description.length > 10, `${t.name} description`);
    assert.ok(t.inputSchema && typeof t.inputSchema === 'object', `${t.name} schema`);
    assert.equal(typeof t.handler, 'function', `${t.name} handler`);
    assert.ok(Array.isArray(t.capabilities), `${t.name} capabilities`);
  }
});

test('descriptions come from the docs-repo generated catalog, carrying proof labels', () => {
  const withRows = TOOLS.filter(t => t.capabilities.length > 0);
  for (const t of withRows) assert.match(t.description, /proof:/, `${t.name} carries a proof label`);
});

test('no read-plan tool declares a non-GET capability', () => {
  for (const t of TOOLS) for (const c of t.capabilities) {
    assert.equal(c.method, 'GET', `${t.name} declares ${c.method} — writes belong to Plan 3`);
  }
});

test('registerTools registers each tool exactly once', () => {
  const seen = [];
  registerTools({ registerTool: (name) => seen.push(name) }, { state: {}, makeGw: () => {} });
  assert.deepEqual(seen.sort(), TOOLS.map(t => t.name).sort());
});

test('auth errors are returned as the error contract, never thrown', async () => {
  const tool = TOOLS.find(t => t.name === 'list_workflows');
  const res = await tool.handler({ locationId: 'L' }, {
    state: { tokenFile: '/nope/tok.txt' },
    makeGw: () => { const e = new Error('nope'); e.code = 'TOKEN_MISSING'; e.detail = 'no token file'; e.remediation = 'capture'; throw e; },
  });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'TOKEN_MISSING');
});
