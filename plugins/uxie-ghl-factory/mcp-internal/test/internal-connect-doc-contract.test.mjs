import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// commands/internal-connect.md is a procedure nothing else executes: its node blocks import the
// scripts/ modules by literal path and hand-copy the gateway's headers, and no test bound any of
// it to the code it restates. That has bitten before — this file and capture-token.mjs asserted
// OPPOSITE referer rules for months until test/capture-referer.test.mjs pinned them together.
// This test pins the two things that have actually drifted: the module paths the command imports,
// and the header literals it copies from core/gateway.mjs.
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMMAND = readFileSync(join(PLUGIN_ROOT, 'commands', 'internal-connect.md'), 'utf8');

test('every scripts/ module the command imports exists on disk', () => {
  // The command's blocks read: const R = process.env.CLAUDE_PLUGIN_ROOT + '/mcp-internal/scripts';
  // then `const load = (f) => import(pathToFileURL(R + '/' + f).href)` and `await load('<name>.mjs')`.
  // A rename under scripts/ breaks the command silently — nothing else imports these modules.
  const imported = [...COMMAND.matchAll(/await load\('([A-Za-z0-9._-]+\.mjs)'\)/g)].map((m) => m[1]);
  assert.ok(imported.length >= 3, `expected the command to import scripts modules, found ${imported.length}`);
  const missing = [...new Set(imported)].filter(
    (f) => !existsSync(join(PLUGIN_ROOT, 'mcp-internal', 'scripts', f)),
  );
  assert.deepEqual(missing, [], `command imports missing scripts: ${missing.join(', ')}`);
});

// PR #4 (zedricedwardc, 2026-08-31): a bare `C:/...` specifier is rejected by Node's ESM loader
// on Windows (ERR_UNSUPPORTED_ESM_URL_SCHEME), so every dynamic import of a filesystem path in
// the command must go through pathToFileURL — the pattern launch.mjs and capture-token.mjs
// already use. This is the guard that PR asked for: it fails the moment a raw-path import is
// reintroduced, and it would have caught the six sites the PR fixed.
test('the command never imports a filesystem path without pathToFileURL', () => {
  const raw = [...COMMAND.matchAll(/await import\(\s*R\s*\+/g)];
  assert.deepEqual(raw.map((m) => m.index), [],
    `raw-path import() found in the command at offsets ${raw.map((m) => m.index).join(', ')} — use load()`);
  const helpers = [...COMMAND.matchAll(/const load = \(f\) => import\(pathToFileURL\(R \+ '\/' \+ f\)\.href\)/g)];
  assert.ok(helpers.length >= 3, `expected the load() helper in each node block, found ${helpers.length}`);
});

test('the command\'s hand-copied discovery headers match core/gateway.mjs verbatim', () => {
  // The discovery block bypasses the gateway (it must — it runs under OTHER folders' credentials),
  // so its headers are a second copy. Read the authoritative literal out of gateway.mjs and
  // require the command to carry it character-for-character.
  const gateway = readFileSync(join(PLUGIN_ROOT, 'mcp-internal', 'core', 'gateway.mjs'), 'utf8');
  const m = gateway.match(/channel: 'APP', source: 'WEB_USER', version: '[0-9-]+'/);
  assert.ok(m, 'gateway.mjs no longer contains the header literal this test reads — update both');
  assert.ok(
    COMMAND.includes(m[0]),
    `commands/internal-connect.md no longer carries the gateway's header literal verbatim:\n  ${m[0]}`,
  );
});
