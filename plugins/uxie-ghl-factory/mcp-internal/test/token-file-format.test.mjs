// The write side of capture-token.mjs had NO test, and that is exactly how it shipped a file the
// server cannot read: the script printed `WROTE … (0600)` over bare lines while
// core/auth.mjs:69,72 parses labelled ones. This test asserts the ROUND TRIP against the real
// reader, and asserts the old bare format still FAILS, so the defect cannot silently return.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatTokenFile } from '../scripts/capture-token.mjs';
import { readCredentials } from '../core/auth.mjs';

// A syntactically valid JWT whose payload decodes. No real credential is ever used in a test.
const jwt = (payload) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.${'s'.repeat(43)}`;
};
const inOneHour = Math.floor(Date.now() / 1000) + 3600;
const BEARER = jwt({ authClassId: 'user-abc', exp: inOneHour });
const TOKEN_ID = jwt({ iss: 'firebase', role: 'admin', exp: inOneHour });

const fixture = (contents) => {
  const p = join(mkdtempSync(join(tmpdir(), 'tokfmt-')), 'tok.txt');
  writeFileSync(p, contents, { mode: 0o600 });
  return p;
};

test('formatTokenFile output round-trips through readCredentials', () => {
  const path = fixture(formatTokenFile({ bearer: BEARER, tokenId: TOKEN_ID }));
  const creds = readCredentials({ tokenFile: path });
  assert.equal(creds.jwt, BEARER);
  assert.equal(creds.tokenId, TOKEN_ID);
  assert.equal(creds.uid, 'user-abc');
});

test('a missing token-id omits the line entirely and still parses', () => {
  const contents = formatTokenFile({ bearer: BEARER, tokenId: null });
  assert.ok(!contents.includes('token-id:'), 'no empty token-id line may be written');
  const creds = readCredentials({ tokenFile: fixture(contents) });
  assert.equal(creds.jwt, BEARER);
  assert.equal(creds.tokenId, null);
});

test('the OLD bare format is still rejected — the defect must not silently return', () => {
  const path = fixture(`${BEARER}\n${TOKEN_ID}\n`);
  assert.throws(() => readCredentials({ tokenFile: path }), /no Bearer token found/);
});
