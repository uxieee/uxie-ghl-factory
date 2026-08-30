// Entry-point-level coverage of the 0.43.0 hard rename's migration guard: GHL_TOK_FILE ->
// GHL_INTERNAL_TOK_FILE. Only the NEW name is ever read as a value (no compatibility
// fallback); a registration that still sets only the OLD name must be refused loudly rather
// than silently falling back to DEFAULT_TOKEN_FILE (core/auth.mjs:12) — see CHANGELOG.md
// [0.43.0] and the unit-level coverage in test/auth.test.mjs.
//
// These tests spawn REAL child processes with controlled env, so they prove the wiring all the
// way from the entry point through to the tool contract — not just the readCredentials() unit.
// HOME is pinned to a throwaway temp directory for every spawn so DEFAULT_TOKEN_FILE
// (~/.uxie-ghl-internal-mcp/tok.txt) resolves inside it rather than to whatever real credential
// file happens to exist on the machine running the suite.
//
// Parametrised over BOTH stdio entry points, not just the full server: the audit rail has the
// identical silent-wrong-account hazard (core/auth.mjs's guard is entry-point-agnostic, and
// stdio-audit.mjs computes legacyTokenFileEnv the same way stdio.mjs does), and auth_status is
// one of the audit profile's own tools — see test/audit-registration.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY_POINTS = [
  { label: 'stdio.mjs', path: resolve(HERE, '../stdio.mjs') },
  { label: 'stdio-audit.mjs', path: resolve(HERE, '../stdio-audit.mjs') },
];

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwtWith = (claims) => `eyJhbGciOiJIUzI1NiJ9.${b64(claims)}.sig`;
const future = Math.floor(Date.now() / 1000) + 3600;

function validTokenFile(dir) {
  const p = join(dir, 'tok.txt');
  const jwt = jwtWith({ authClassId: 'migration-test-user', exp: future });
  writeFileSync(p, `Bearer ${jwt}\n`);
  return p;
}

// A throwaway HOME per test, so DEFAULT_TOKEN_FILE never points at a real credential file on
// the machine running the suite — see file header.
function scratchHome() {
  return mkdtempSync(join(tmpdir(), 'ghl-rename-home-'));
}

// Builds the child's env from process.env + HOME override, then applies `overrides` — a value
// of `undefined` DELETES the key rather than setting it to the literal string "undefined" (which
// child_process.spawn would otherwise do with a naive spread), so a scenario can reliably force
// GHL_TOK_FILE / GHL_INTERNAL_TOK_FILE to be genuinely UNSET regardless of the host shell's env.
function childEnv(overrides) {
  const env = { ...process.env, HOME: scratchHome() };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

async function callAuthStatus(entryPath, overrides) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entryPath],
    env: childEnv(overrides),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'legacy-env-test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
  try {
    const result = await client.callTool({ name: 'auth_status', arguments: {} });
    return JSON.parse(result.content[0].text);
  } finally {
    await client.close().catch(() => {});
  }
}

for (const { label, path } of ENTRY_POINTS) {
  test(`${label}: old name only (GHL_TOK_FILE set, GHL_INTERNAL_TOK_FILE unset) — auth_status reports LEGACY_TOKEN_FILE_ENV, not a silent fallback`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ghl-rename-old-'));
    const tokFile = validTokenFile(dir);
    const contract = await callAuthStatus(path, { GHL_TOK_FILE: tokFile, GHL_INTERNAL_TOK_FILE: undefined });
    assert.equal(contract.ok, true, 'auth_status must REPORT the misconfiguration, not hard-fail the tool call');
    assert.equal(contract.data.jwtClaims.present, false, 'must not have read the old-name file at all');
    assert.equal(contract.data.error.code, 'LEGACY_TOKEN_FILE_ENV');
    assert.match(contract.data.error.detail, /GHL_TOK_FILE/);
    assert.match(contract.data.error.detail, /GHL_INTERNAL_TOK_FILE/);
    assert.match(contract.data.error.remediation, /GHL_INTERNAL_TOK_FILE/);
  });

  test(`${label}: new name only (GHL_INTERNAL_TOK_FILE set) — works exactly as before the rename`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ghl-rename-new-'));
    const tokFile = validTokenFile(dir);
    const contract = await callAuthStatus(path, { GHL_INTERNAL_TOK_FILE: tokFile, GHL_TOK_FILE: undefined });
    assert.equal(contract.ok, true);
    assert.equal(contract.data.jwtClaims.present, true);
    assert.equal(contract.data.error, undefined, 'a correctly migrated registration gets no error at all');
  });

  test(`${label}: both set — the new name wins, no refusal`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ghl-rename-both-'));
    const goodTokFile = validTokenFile(dir);
    // The OLD var points somewhere that would fail if it were ever consulted — proving the new
    // name's value is what actually gets used, not merely that both happen to agree.
    const contract = await callAuthStatus(path, { GHL_INTERNAL_TOK_FILE: goodTokFile, GHL_TOK_FILE: '/should-never-be-read/tok.txt' });
    assert.equal(contract.ok, true);
    assert.equal(contract.data.jwtClaims.present, true);
    assert.equal(contract.data.error, undefined);
  });

  test(`${label}: neither set — unchanged from before the rename (falls to DEFAULT_TOKEN_FILE, reports TOKEN_MISSING)`, async () => {
    const contract = await callAuthStatus(path, { GHL_TOK_FILE: undefined, GHL_INTERNAL_TOK_FILE: undefined });
    assert.equal(contract.ok, true);
    assert.equal(contract.data.jwtClaims.present, false);
    assert.equal(contract.data.error.code, 'TOKEN_MISSING', 'no env var set at all is not the legacy-migration case');
  });
}
