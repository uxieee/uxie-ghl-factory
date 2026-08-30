// Entry-point-level coverage of the 0.43.0 hard rename's SECOND migration guard: GHL_LOCATIONS
// -> GHL_INTERNAL_LOCATIONS. Added after review caught that "an unbound registration fails
// safe" is only true of WRITES — checkLocationBinding returns null (allowed) for an unbound
// registration's READS (core/location-binding.mjs), so a registration that migrated
// GHL_INTERNAL_TOK_FILE but left GHL_LOCATIONS stale would silently WIDEN reads from its bound
// set to every location the credential reaches, while writes kept looking safe because they
// were already refused. See CHANGELOG.md [0.43.0] and the unit-level guard in
// core/location-binding.mjs (checkLocationBinding's legacyLocationsEnvSet param).
//
// Only stdio.mjs is covered: the audit profile has never read GHL_LOCATIONS/
// GHL_INTERNAL_LOCATIONS at all (README.md "Location binding" section, "moot for it") and
// still doesn't — stdio-audit.mjs's state carries no allowedLocations/legacyLocationsEnv.
//
// Technique: every scenario points GHL_INTERNAL_TOK_FILE at a file that does not exist, so a
// call that gets PAST the location guard reaches readCredentials() and fails with
// TOKEN_MISSING before any network access (the same "before any network access" proof
// test/audit-registration.test.mjs already relies on) — never a real request to GHL. So
// TOKEN_MISSING here means "the location guard let it through"; LEGACY_LOCATIONS_ENV means
// "the guard caught the stale env var"; LOCATION_FORBIDDEN would mean the OLD variable's value
// was consulted after all, which the "both set" case is written to catch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const STDIO_ENTRY = resolve(HERE, '../stdio.mjs');

const TARGET_LOC = 'LOCTARGETLOCATION001';
const OTHER_LOC = 'LOCPOISONOTHERLOC001';

// Same env-building discipline as test/legacy-token-file-env.test.mjs: `undefined` DELETES the
// key rather than child_process.spawn stringifying it to the literal "undefined", and HOME is
// pinned to a scratch dir so DEFAULT_TOKEN_FILE never resolves to a real credential file that
// might exist on the machine running the suite (this test never gets far enough to read it —
// GHL_INTERNAL_TOK_FILE always points at a guaranteed-nonexistent path below — but keeping the
// same discipline avoids depending on that fact).
function childEnv(overrides) {
  const env = { ...process.env, HOME: mkdtempSync(join(tmpdir(), 'ghl-rename-home-')) };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

async function callGetWorkflow(locationOverrides) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [STDIO_ENTRY],
    env: childEnv({
      GHL_TOK_FILE: undefined,
      GHL_INTERNAL_TOK_FILE: join(mkdtempSync(join(tmpdir(), 'ghl-rename-notok-')), 'tok.txt'), // never written — guaranteed missing
      GHL_LOCATIONS: undefined,
      GHL_INTERNAL_LOCATIONS: undefined,
      ...locationOverrides,
    }),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'legacy-locations-test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
  try {
    const result = await client.callTool({ name: 'get_workflow', arguments: { locationId: TARGET_LOC, workflowId: 'wid-1' } });
    return JSON.parse(result.content[0].text);
  } finally {
    await client.close().catch(() => {});
  }
}

test('old name only (GHL_LOCATIONS set, GHL_INTERNAL_LOCATIONS unset): a READ is refused with LEGACY_LOCATIONS_ENV, not silently widened', async () => {
  const contract = await callGetWorkflow({ GHL_LOCATIONS: OTHER_LOC });
  assert.equal(contract.ok, false);
  assert.equal(contract.code, 'LEGACY_LOCATIONS_ENV');
  assert.match(contract.detail, /GHL_LOCATIONS/);
  assert.match(contract.detail, /GHL_INTERNAL_LOCATIONS/);
  assert.match(contract.remediation, /GHL_INTERNAL_LOCATIONS/);
  // The exact vulnerability this guard closes: without it, this call would have passed
  // (unbound reads pass by design) and reached TOKEN_MISSING like the scenarios below.
});

test('new name only (GHL_INTERNAL_LOCATIONS set): a bound READ works exactly as before the rename', async () => {
  const contract = await callGetWorkflow({ GHL_INTERNAL_LOCATIONS: TARGET_LOC });
  assert.equal(contract.ok, false);
  assert.equal(contract.code, 'TOKEN_MISSING', 'must have cleared the location guard and reached credential resolution');
});

test('both set: the new name wins, no refusal — poisoning the old value proves it, not just agreement', async () => {
  // GHL_LOCATIONS (old) is bound to a DIFFERENT location than the call targets. If it were ever
  // consulted as the allowed set, this call would come back LOCATION_FORBIDDEN instead.
  const contract = await callGetWorkflow({ GHL_LOCATIONS: OTHER_LOC, GHL_INTERNAL_LOCATIONS: TARGET_LOC });
  assert.equal(contract.ok, false);
  assert.equal(contract.code, 'TOKEN_MISSING', 'GHL_INTERNAL_LOCATIONS must be the value actually consulted');
});

test('neither set: unchanged from before the rename (unbound, reads still pass)', async () => {
  const contract = await callGetWorkflow({});
  assert.equal(contract.ok, false);
  assert.equal(contract.code, 'TOKEN_MISSING', 'an unbound registration must keep letting reads through, same as pre-0.43.0');
});
