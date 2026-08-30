import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { authStatus, readCredentials, safeClaims, secondsRemaining } from '../core/auth.mjs';
import { ok, CODES } from '../core/errors.mjs';

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
  assert.equal(status.tokenIdClaims.present, true);
  assert.equal(status.tokenIdClaims.issuer, 'securetoken.google.com/highlevel-backend');
  assert.equal(status.tokenIdClaims.role, 'admin');
  assert.equal(status.tokenIdClaims.scope, 'agency');
  assert.equal(status.tokenIdClaims.exp, future);
  assert.equal(JSON.stringify(status).includes(tokenId), false);
});

// The regression that made this rename necessary: the claims are returned through the
// tool contract, which scrubs any secret-NAMED key's whole subtree. Named `jwt`/`tokenId`
// they came back as "<redacted>" and auth_status could no longer show expiry at all
// (live-caught 2026-07-21). Assert the claims SURVIVE the contract boundary — while the
// credentials themselves still do not.
test('auth status claims survive the contract scrubber, credentials still do not', () => {
  const jwt = jwtWith({ authClassId: 'u', exp: future });
  const tokenId = jwtWith({ iss: 'securetoken.google.com/highlevel-backend', role: 'admin', type: 'agency', exp: future });
  const status = authStatus({ tokenFile: fixture(`Bearer ${jwt}\ntoken-id: ${tokenId}\n`) });
  const contract = ok(status);
  assert.equal(contract.data.jwtClaims.present, true, 'jwt claims must not be blanked');
  assert.ok(typeof contract.data.jwtClaims.secondsRemaining === 'number', 'expiry must remain visible');
  assert.equal(contract.data.tokenIdClaims.role, 'admin', 'token-id claims must not be blanked');
  const serialized = JSON.stringify(contract);
  assert.equal(serialized.includes(jwt), false, 'jwt value must never appear');
  assert.equal(serialized.includes(tokenId), false, 'token-id value must never appear');
});

test('re-reads the file each call so mid-session recapture is picked up', () => {
  const p = fixture(`Bearer ${jwtWith({ authClassId: 'first', exp: future })}`);
  assert.equal(readCredentials({ tokenFile: p }).uid, 'first');
  writeFileSync(p, `Bearer ${jwtWith({ authClassId: 'second', exp: future })}`);
  assert.equal(readCredentials({ tokenFile: p }).uid, 'second');
});

// Finding 2 (task-4 fix round 1): the LOCATION_UNBOUND-guard's `allowedLocations` count on
// authStatus previously had coverage only on the error branch (readCredentials throwing on an
// unreadable file lands in the catch at core/auth.mjs:108). The success branch at
// core/auth.mjs:98 — the one an operator actually sees when their token is healthy — had no
// test and would stay green if deleted. This exercises that branch directly with a real,
// readable token file.
test('auth status success path reports the binding as a count, never the ids', () => {
  // Same synthetic location ids used throughout test/location-binding.test.mjs.
  const PERMITTED = 'LOCPERMITTED0000001';
  const FOREIGN = 'LOCFOREIGN000000001';
  const jwt = jwtWith({ authClassId: 'u', exp: future });
  const p = fixture(`Bearer ${jwt}\n`);

  const bound = authStatus({ tokenFile: p, allowedLocations: new Set([PERMITTED, FOREIGN]) });
  assert.equal(bound.jwtClaims.present, true, 'this must hit the success branch, not the catch');
  assert.equal(bound.allowedLocations, 2);
  const serializedBound = JSON.stringify(bound);
  assert.equal(serializedBound.includes(PERMITTED), false, 'permitted id must not be echoed');
  assert.equal(serializedBound.includes(FOREIGN), false, 'foreign id must not be echoed');

  const unbound = authStatus({ tokenFile: p, allowedLocations: null });
  assert.equal(unbound.jwtClaims.present, true);
  assert.equal(unbound.allowedLocations, null);
});

// ---------------------------------------------------------------------------
// 0.43.0 hard rename: GHL_TOK_FILE -> GHL_INTERNAL_TOK_FILE. readCredentials'
// `legacyTokenFileEnv` flag is a plain boolean the entry points compute from the OLD name's
// PRESENCE (never its value) — these tests exercise readCredentials/authStatus directly, since
// that flag is where the actual refusal lives. Entry-point-level (real env var, real
// subprocess) coverage of the four migration scenarios lives in
// test/legacy-token-file-env.test.mjs.
// ---------------------------------------------------------------------------

test('legacyTokenFileEnv true refuses with LEGACY_TOKEN_FILE_ENV, naming both variables and the fix, before any file is touched', () => {
  // The path does not exist, proving the guard fires BEFORE the file-existence check —
  // a stale env var is a more useful diagnosis than "no token file at <default path>".
  assert.throws(
    () => readCredentials({ tokenFile: '/nope/tok.txt', legacyTokenFileEnv: true }),
    (e) => {
      assert.equal(e.code, CODES.LEGACY_TOKEN_FILE_ENV);
      assert.match(e.detail, /GHL_TOK_FILE/);
      assert.match(e.detail, /GHL_INTERNAL_TOK_FILE/);
      assert.match(e.remediation, /GHL_INTERNAL_TOK_FILE/);
      assert.match(e.remediation, /GHL_TOK_FILE/);
      return true;
    },
  );
});

test('legacyTokenFileEnv false (the default) leaves readCredentials byte-identical to before the rename', () => {
  const jwt = jwtWith({ authClassId: 'u', exp: future });
  const p = fixture(`Bearer ${jwt}`);
  const withFlag = readCredentials({ tokenFile: p, legacyTokenFileEnv: false });
  const withoutFlag = readCredentials({ tokenFile: p });
  assert.deepEqual(withFlag, withoutFlag);
  assert.equal(withFlag.uid, 'u');
});

test('authStatus reports LEGACY_TOKEN_FILE_ENV as a graceful diagnostic (ok-shaped), same as TOKEN_MISSING', () => {
  const status = authStatus({ tokenFile: '/nope/tok.txt', legacyTokenFileEnv: true });
  assert.equal(status.jwtClaims.present, false);
  assert.equal(status.error.code, CODES.LEGACY_TOKEN_FILE_ENV);
  assert.match(status.error.remediation, /GHL_INTERNAL_TOK_FILE/);
});

test('a valid tokenFile plus legacyTokenFileEnv:true still refuses — presence of the old var alone is disqualifying', () => {
  // Guards against a shortcut implementation that only checks legacyTokenFileEnv when the
  // resolved tokenFile is otherwise unusable.
  const jwt = jwtWith({ authClassId: 'u', exp: future });
  const p = fixture(`Bearer ${jwt}`);
  assert.throws(
    () => readCredentials({ tokenFile: p, legacyTokenFileEnv: true }),
    (e) => e.code === CODES.LEGACY_TOKEN_FILE_ENV,
  );
});
