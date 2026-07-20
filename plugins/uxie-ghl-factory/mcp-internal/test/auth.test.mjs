import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { authStatus, readCredentials, safeClaims, secondsRemaining } from '../core/auth.mjs';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwtWith = (claims) => `eyJhbGciOiJIUzI1NiJ9.${b64(claims)}.sig`;
const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 60;

function fixture(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'ghlauth-'));
  const p = join(dir, 'tok.txt');
  writeFileSync(p, contents);
  return p;
}

test('extracts bearer JWT, uid and token-id from a capture file', () => {
  const jwt = jwtWith({ authClassId: 'user-123', companyId: 'co-9', exp: future });
  const p = fixture(`authorization: Bearer ${jwt}\ntoken-id: tid-abc\n`);
  const c = readCredentials({ tokenFile: p });
  assert.equal(c.jwt, jwt);
  assert.equal(c.uid, 'user-123');
  assert.equal(c.tokenId, 'tid-abc');
});

test('token-id is optional', () => {
  const p = fixture(`Bearer ${jwtWith({ authClassId: 'u', exp: future })}`);
  assert.equal(readCredentials({ tokenFile: p }).tokenId, null);
});

test('expired JWT throws TOKEN_EXPIRED', () => {
  const p = fixture(`Bearer ${jwtWith({ authClassId: 'u', exp: past })}`);
  assert.throws(() => readCredentials({ tokenFile: p }), (e) => e.code === 'TOKEN_EXPIRED');
});

test('missing file throws TOKEN_MISSING', () => {
  assert.throws(() => readCredentials({ tokenFile: '/nope/tok.txt' }), (e) => e.code === 'TOKEN_MISSING');
});

test('file with no bearer throws TOKEN_MISSING', () => {
  assert.throws(() => readCredentials({ tokenFile: fixture('nothing here') }), (e) => e.code === 'TOKEN_MISSING');
});

test('safeClaims never exposes the raw token', () => {
  const jwt = jwtWith({ authClassId: 'u', companyId: 'c', exp: future });
  const s = safeClaims(jwt);
  assert.ok(!JSON.stringify(s).includes(jwt));
  assert.equal(s.uid, 'u');
  assert.ok(secondsRemaining(jwt) > 3500);
});

test('auth status reports token-id claims only, never its value', () => {
  const jwt = jwtWith({ authClassId: 'u', exp: future });
  const tokenId = jwtWith({ iss: 'securetoken.google.com/highlevel-backend', role: 'admin', type: 'agency', exp: future });
  const status = authStatus({ tokenFile: fixture(`Bearer ${jwt}\ntoken-id: ${tokenId}\n`) });
  assert.equal(status.tokenId.present, true);
  assert.equal(status.tokenId.issuer, 'securetoken.google.com/highlevel-backend');
  assert.equal(status.tokenId.role, 'admin');
  assert.equal(status.tokenId.scope, 'agency');
  assert.equal(status.tokenId.exp, future);
  assert.equal(JSON.stringify(status).includes(tokenId), false);
});

test('re-reads the file each call so mid-session recapture is picked up', () => {
  const p = fixture(`Bearer ${jwtWith({ authClassId: 'first', exp: future })}`);
  assert.equal(readCredentials({ tokenFile: p }).uid, 'first');
  writeFileSync(p, `Bearer ${jwtWith({ authClassId: 'second', exp: future })}`);
  assert.equal(readCredentials({ tokenFile: p }).uid, 'second');
});
