// rel-10 (2026-11-07): the privacy gate denies a sandbox location id by its HASH. This public repo never carries the id
// itself, so the test proves the mechanism on a SYNTHETIC id: the synthetic id's hash is handed to the gate for one run
// (PRIVACY_EXTRA_DENY_HASHES), and the same file passes without it. The sandbox id's own hash is pinned in the gate's list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GATE = fileURLToPath(new URL('../../../../scripts/check-privacy.mjs', import.meta.url));
const SYNTHETIC_ID = 'Lq7TestLoc0000000001';
// The hash of the synthetic id, computed by `node scripts/check-privacy.mjs --hash <id>`.
const SYNTHETIC_HASH = 'ae9edf9af2014977d5f3172e6523477eec45ccd6fb93d340f53696f6ca2d8b0e';
// The sandbox location id's hash, pinned in the gate's list. The hex is fine in a public repo; the id is not.
const SANDBOX_ID_HASH = '2bdf35474a3ff3aa9018f37b6eefc8aec29897936b9ed54e9c5e9e86a02342e4';

// The plugin gate scans the git-listed files of its working directory, so each case is a throwaway git repo holding one file.
// The refusal text itself (rel-10b masking): a refusal must never print the matched value.
const gateStderr = (name, content, extraEnv = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'privacy-mask-'));
  execFileSync('git', ['init', '-q', dir]); writeFileSync(join(dir, name), content);
  try { execFileSync('node', [GATE], { cwd: dir, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, ...extraEnv } }); return ''; }
  catch (e) { return String(e.stderr ?? '') + String(e.stdout ?? ''); }
};
// rel-10b (QA finding): the plugin's own rule path (an email) must also be masked.
test('a rule hit (an email) names the file and the line, and never prints the address', () => {
  // Assembled from parts on separate lines: the gate matches an address per file, and a joined literal would be refused.
  const addr = [
    'person.name',
    '@acme-test.io',
  ].join('');
  const err = gateStderr('email.test.mjs', `const to = '${addr}';\n`);
  assert.match(err, /email\.test\.mjs:1/);
  assert.ok(!err.includes(addr), 'the address must not be printed');
});

test('a refusal names the file and the line, and never prints the matched value', () => {
  const err = gateStderr('masked.test.mjs', `const r = { location: '${SYNTHETIC_ID}' };\n`, { PRIVACY_EXTRA_DENY_HASHES: SYNTHETIC_HASH });
  assert.match(err, /masked\.test\.mjs:1/);
  assert.ok(!err.includes(SYNTHETIC_ID), 'the matched value must not be printed');
});

const gateRefuses = (name, content, extraEnv = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'privacy-sandbox-'));
  execFileSync('git', ['init', '-q', dir]); writeFileSync(join(dir, name), content);
  try {
    execFileSync('node', [GATE], { cwd: dir, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, ...extraEnv } });
    return false;
  } catch { return true; }
};

test('the gate refuses a file carrying an id whose hash it is given for the run', () => {
  const content = `const r = { location: '${SYNTHETIC_ID}' };\n`;
  assert.equal(gateRefuses('proof-fixture.test.mjs', content, { PRIVACY_EXTRA_DENY_HASHES: SYNTHETIC_HASH }), true);
});

test('CONTROL: the same file passes without that hash (only the hash decides)', () => {
  assert.equal(gateRefuses('proof-fixture.test.mjs', `const r = { location: '${SYNTHETIC_ID}' };\n`), false);
});

test('the refusal also covers the id inside a corpus path or a URL', () => {
  assert.equal(gateRefuses('evidence.json', JSON.stringify({ evidence: [`corpus:foo/${SYNTHETIC_ID}`] }), { PRIVACY_EXTRA_DENY_HASHES: SYNTHETIC_HASH }), true);
  assert.equal(gateRefuses('endpoint.json', JSON.stringify({ url: `https://example.com/contact/${SYNTHETIC_ID}` }), { PRIVACY_EXTRA_DENY_HASHES: SYNTHETIC_HASH }), true);
});

test('the sandbox location id hash is pinned in the gate’s deny list', () => {
  const src = readFileSync(GATE, 'utf8');
  assert.ok(src.includes(`'${SANDBOX_ID_HASH}'`), 'the sandbox id hash must be in NAME_HASHES');
});

// rel-10 fix 2: a whole-token id (a UUID) is denied by its hash too. The synthetic UUID's hash is injected for one run.
const SYNTHETIC_UUID = '00000000-0000-4000-8000-0000000000e9';
const SYNTHETIC_UUID_HASH = '9d74e4ace232fdb872f4ac3ea79242c5d7d4a320b8bc90c9b560663ff3ab2c9a';
test('the gate refuses a whole-token UUID by its hash', () => {
  const content = `const r = { id: '${SYNTHETIC_UUID}' };\n`;
  assert.equal(gateRefuses('uuid-fixture.test.mjs', content, { PRIVACY_EXTRA_DENY_HASHES: SYNTHETIC_UUID_HASH }), true);
  assert.equal(gateRefuses('uuid-fixture.test.mjs', content), false, 'CONTROL: the same UUID passes without its hash');
});

// The hashes of the real ids QA's sweep found. Pinned by hash only: the ids themselves are never in this repo.
const REAL_ID_HASHES = [
  '227c416a100538ce1ef7a898cc1c665c081c1dcc5d725d05f6f6dc91e2258aec',
  'a7727880496782a29a047b9b03057b058a50a384da2deac1fa9235c6d3b608f5',
  'e182f7788601bf23696d15f60a0bcc8cc31b6617aa842b6461468543e46d90e2',
  'cb0f98c9a93d70901b42a8c7dca6fa2d55ab690623e77c1f8850e64f732d0d44',
  'a8c6cbd67b874b266733b0e37ed52829b19fe2adc5dd73252a1c55351539f50b',
  '615428735bf121f168cfdad2a8fb98ceea94e4a16708983a1fb089aec96d4529',
  '485965590c06848bbe1ec104a68845463379c5622ebee720740a84d7a87bf64f',
  '39532233b759cb1a688db2e1e4790eb0a9433963e3448e6c6b217aacdc5f53fc',
  '795a1261bc237a0c70db66386577dec1652cd3c7a93195f1863b3f1136c8cf70',
  '675ca3122d74acaa4039ca936085e1d2813dd63782010b2cc4302aedf7ce2497',
  '37180eb56e77d2ae7a489d4e5c6fd6dbb66584fcb642ebfe45c5f0d9bc2954d2',
  '730a8aa1915a7e0f0fead4ebad9a41c5173166c9a0c39a9ff4be828ce62850aa',
  '85e32da5960981d5f97ae6766aae331f0bb6c4ea3ceae5ec72b0f54a4aae4417',
  '7cf3b2ca244915d1525f20e43780b30ae3cab2aec0e30b7c6c7f6a14e75a7a91',
  '3359f7ad911127e59d840410c86bcfaaa8182d79d856921666b92a1a6dc97728',
  '7d0ed087c381932c392ceb5762e6042e01b7b248428fc6d94f11ef8069beb642',
  'a296fc956175b1cf2d5555fd7ff51a1cf0ca523709dc4ff2ee6b38de01149b59',
  'ec767b583e5ad935c3cf90e7a6987209a32364e6df639e63ed645bf10de034c6',
];
test('the real-id hashes are all in the gate\u2019s deny list (pinned by hash, never the id)', () => {
  const src = readFileSync(GATE, 'utf8');
  for (const h of REAL_ID_HASHES) assert.ok(src.includes(`'${h}'`), `hash ${h.slice(0, 8)} missing from NAME_HASHES`);
});

test('CONTROL: prose about a sandbox sub-account without its id passes', () => {
  assert.equal(gateRefuses('readme.md', 'Tested against the designated sandbox sub-account, by its last four characters.\n'), false);
});
