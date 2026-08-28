// list_marketplace_apps against the REAL gateway (stubbed fetch). marketplace-tools.test.mjs
// fakes makeGw and therefore ignores the two inputs the gateway asserts on — rail and base —
// which is how a tool that threw on every live call stayed green for eleven releases (F5-11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeGateway } from '../core/gateway.mjs';
import { TOOLS, makeGatewayFactory } from '../core/tools.mjs';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = `eyJhbGciOiJIUzI1NiJ9.${b64({ authClassId: 'u-1', exp })}.sig`;
const tokenId = `eyJhbGciOiJIUzI1NiJ9.${b64({ iss: 'securetoken.google.com/highlevel-backend', role: 'admin', type: 'agency', exp })}.sig`;
const tokenFile = () => {
  const p = join(mkdtempSync(join(tmpdir(), 'mkt-')), 'tok.txt');
  writeFileSync(p, `Bearer ${jwt}\ntoken-id: ${tokenId}\n`);
  return p;
};
const APP = {
  appId: 'APP1', name: 'Test App', companyName: 'Vendor', isInstalled: true,
  actions: [{ key: 'act_a', version: '1.0', templateId: 'T1', inputs: [] }],
  triggers: [{ key: 'trg_a', version: '1.3', templateId: 'T2', customVars: [] }],
};

test('list_marketplace_apps reaches the AI host with both credentials through the real gateway', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { status: 200, ok: true, text: async () => JSON.stringify([APP]) };
  };
  const state = { tokenFile: tokenFile() };
  const makeGw = makeGatewayFactory({
    state,
    gatewayImpl: (o) => makeGateway({ ...o, fetchImpl, sleepImpl: async () => {} }),
  });
  const tool = TOOLS.find((t) => t.name === 'list_marketplace_apps');
  const res = await tool.handler({ locationId: 'LOC', type: 'both', compact: true }, { state, makeGw });

  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.data.complete, true);
  assert.equal(calls.length, 2, 'one GET per leg');
  for (const c of calls) {
    assert.ok(
      c.url.startsWith('https://services.leadconnectorhq.com/marketplace/core/search/module?'),
      `wrong host: ${c.url}`,
    );
    assert.equal(c.init.headers['token-id'], tokenId);
    assert.match(c.init.headers.authorization, /^Bearer /);
  }
});
