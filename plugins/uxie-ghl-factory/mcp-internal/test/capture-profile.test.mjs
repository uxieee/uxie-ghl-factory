// ONE BROWSER PROFILE PER TOKEN FILE (0.51.0).
//
// Until 0.51.0 capture-token.mjs hardcoded ONE Chrome profile for every folder on the machine.
// A Chrome profile holds a GHL session, so the agency logged in last was the agency the next
// capture ran in, whichever folder asked for it. Measured 2026-09-03: a chat in one client's
// folder drove that shared browser to that client's sub-account and landed on a DIFFERENT
// client's agency launchpad. The per-folder token binding was correct the whole time; the
// browser it was handed was machine-wide.
//
// These tests pin the properties that make that impossible to reintroduce. The derivation is a
// pure function precisely so it can be tested without launching Chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProfileDir } from '../scripts/capture-token.mjs';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'capture-token.mjs');
const HOME_DIR = join(homedir(), '.uxie-ghl-internal-mcp');
const tokenFileIn = (project) => join(project, '.ghl', 'uxie-ghl-internal-mcp-tok.txt');

test('two different client folders never share a profile', () => {
  const a = resolveProfileDir({ tokenFile: tokenFileIn('/clients/Northwind Labs'), env: {} });
  const b = resolveProfileDir({ tokenFile: tokenFileIn('/clients/Contoso Roofing'), env: {} });
  assert.notEqual(a, b);
});

test('the same token file always resolves to the same profile, so a login persists', () => {
  const tok = tokenFileIn('/clients/Fabrikam Health');
  assert.equal(resolveProfileDir({ tokenFile: tok, env: {} }), resolveProfileDir({ tokenFile: tok, env: {} }));
});

test('a relative path and its absolute form are one profile, not two', () => {
  const abs = resolveProfileDir({ tokenFile: join(process.cwd(), '.ghl', 'tok.txt'), env: {} });
  assert.equal(resolveProfileDir({ tokenFile: join('.ghl', 'tok.txt'), env: {} }), abs);
});

test('two folders whose basenames collide still get different profiles', () => {
  // The readable half of the name would be identical here; only the hash separates them. Without
  // it, two clients with the same folder name under different agencies would share one GHL session.
  const a = resolveProfileDir({ tokenFile: tokenFileIn('/clients/alpha/Duplicate Name'), env: {} });
  const b = resolveProfileDir({ tokenFile: tokenFileIn('/clients/beta/Duplicate Name'), env: {} });
  assert.notEqual(a, b);
  assert.ok(a.includes('duplicate-name') && b.includes('duplicate-name'), 'the readable half should survive');
});

test('the profile is named after the PROJECT folder, not the .ghl directory', () => {
  // The token file lives at <project>/.ghl/<file>, so the useful name is the grandparent. Naming
  // it after the parent would label every profile "ghl" and defeat the point of a readable name.
  const p = resolveProfileDir({ tokenFile: tokenFileIn('/clients/Tailwind Dental'), env: {} });
  assert.ok(p.includes('tailwind-dental'), p);
  assert.ok(!/[/-]ghl-[0-9a-f]{8}$/.test(p), p);
});

test('a token file NOT under a .ghl directory is named after its own parent', () => {
  const p = resolveProfileDir({ tokenFile: join(HOME_DIR, 'tok.txt'), env: {} });
  assert.ok(p.includes('uxie-ghl-internal-mcp'), p);
});

test('GHL_INTERNAL_PW_PROFILE overrides the derivation', () => {
  const p = resolveProfileDir({ tokenFile: tokenFileIn('/clients/Northwind Labs'), env: { GHL_INTERNAL_PW_PROFILE: '/tmp/explicit-profile' } });
  assert.equal(p, resolve('/tmp/explicit-profile'));
});

test('a blank or whitespace override is ignored rather than resolving to the cwd', () => {
  // `resolve('')` is the process cwd, which would silently write a Chrome profile into whatever
  // directory the capture happened to run from.
  const derived = resolveProfileDir({ tokenFile: tokenFileIn('/clients/Northwind Labs'), env: {} });
  for (const blank of ['', '   ', undefined, null]) {
    assert.equal(resolveProfileDir({ tokenFile: tokenFileIn('/clients/Northwind Labs'), env: { GHL_INTERNAL_PW_PROFILE: blank } }), derived, JSON.stringify(blank));
  }
});

test('NOTHING resolves to the pre-0.51.0 shared profile', () => {
  // The old path must never be handed back, not even as a fallback: seeding a client's slot with
  // it would restore the exact cross-agency session bleed this change exists to end.
  const shared = join(HOME_DIR, 'pw-profile');
  for (const tok of ['/clients/Northwind Labs', '/clients/Contoso Roofing', '/clients/Woodgrove Legal'].map(tokenFileIn).concat(join(HOME_DIR, 'tok.txt'))) {
    assert.notEqual(resolveProfileDir({ tokenFile: tok, env: {} }), shared);
  }
});

test('symlinked token files resolve to ONE profile — they are one login', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ghl-profile-'));
  const project = join(tmp, 'Real Client');
  mkdirSync(join(project, '.ghl'), { recursive: true });
  const real = tokenFileIn(project);
  writeFileSync(real, 'Bearer x\n');
  const link = join(tmp, 'link.tok');
  symlinkSync(real, link);
  assert.equal(resolveProfileDir({ tokenFile: link, env: {} }), resolveProfileDir({ tokenFile: real, env: {} }));
});

test('--print-profile-dir answers without launching a browser', () => {
  // Same seam as --print-token-file: the operator (and this suite) can ask which profile a
  // capture would use. If this ever launches Chrome, the test hangs instead of passing.
  const out = execFileSync(process.execPath, [SCRIPT, '--print-profile-dir'], {
    encoding: 'utf8',
    env: { ...process.env, GHL_TOK_FILE: '', GHL_INTERNAL_TOK_FILE: tokenFileIn('/clients/Northwind Labs') },
    timeout: 20_000,
  }).trim();
  assert.equal(out, resolveProfileDir({ tokenFile: tokenFileIn('/clients/Northwind Labs'), env: {} }));
});
