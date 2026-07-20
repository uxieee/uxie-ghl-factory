import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeFF } from './ff.mjs';

const payload = Buffer.from(JSON.stringify({ authClassId: 'USER_COMPAT' })).toString('base64url');
const fixtureJwt = `fixture.${payload}.signature`;

test('scripts/ff.mjs preserves the shipped makeFF({loc,tok}) import API without a live call', () => {
  let ff;
  assert.doesNotThrow(() => {
    ff = makeFF({ loc: 'LOC_COMPAT', tok: fixtureJwt });
  }, 'the legacy constructor must remain callable after engine extraction');

  assert.equal(ff.loc, 'LOC_COMPAT');
  assert.equal(ff.uid, 'USER_COMPAT');
  assert.equal(typeof ff.countPerStep, 'function');
  assert.equal(typeof ff.move, 'function');
});

test('scripts/ff.mjs also accepts the extracted gateway call shape', () => {
  const gw = { loc: 'LOC_GW', uid: 'USER_GW', call: async () => ({ status: 200, ok: true, json: [] }) };
  const ff = makeFF({ gw });

  assert.equal(ff.loc, 'LOC_GW');
  assert.equal(ff.uid, 'USER_GW');
});

test('ff CLI with no args prints usage, exits 2, and cannot make an account call', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./ff.mjs', import.meta.url))], {
    encoding: 'utf8',
    env: { ...process.env, GHL_TOK_FILE: '' },
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: ff\.mjs/);
  assert.equal(result.stdout, '');
});
