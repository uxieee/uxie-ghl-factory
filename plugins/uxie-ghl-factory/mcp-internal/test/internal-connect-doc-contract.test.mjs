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
  // then await import(R + '/<name>.mjs'). A rename under scripts/ breaks the command silently —
  // nothing else imports these modules.
  const imported = [...COMMAND.matchAll(/import\(R \+ '\/([A-Za-z0-9._-]+\.mjs)'\)/g)].map((m) => m[1]);
  assert.ok(imported.length >= 3, `expected the command to import scripts modules, found ${imported.length}`);
  const missing = [...new Set(imported)].filter(
    (f) => !existsSync(join(PLUGIN_ROOT, 'mcp-internal', 'scripts', f)),
  );
  assert.deepEqual(missing, [], `command imports missing scripts: ${missing.join(', ')}`);
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
