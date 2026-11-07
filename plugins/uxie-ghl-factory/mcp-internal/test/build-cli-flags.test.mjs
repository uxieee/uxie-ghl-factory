// scripts/build.mjs read only --publish and --ignore-unresolved and IGNORED every other flag, so `--dry-run` would have
// built for real. A dry run exists now (W6a item 4); an unknown flag is refused before any token is read or call made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = resolve(HERE, '../../skills/create-ghl-workflow/scripts/build.mjs');
const run = (args) => {
  const home = mkdtempSync(join(tmpdir(), 'build-cli-'));
  const ir = join(home, 'ir.json');
  writeFileSync(ir, JSON.stringify({ name: 'W', triggers: [], graph: [] }));
  // no token file exists in this HOME: a run that got past the flag check would fail on the token, not the flag
  return spawnSync(process.execPath, [BUILD, ir, 'LOC', ...args], { env: { PATH: process.env.PATH, HOME: home }, encoding: 'utf8' });
};

test('an unknown flag is refused by name, before the token is read', () => {
  const r = run(['--dryrun']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown flag --dryrun/);
  assert.doesNotMatch(r.stderr, /Bearer token|ENOENT/);
});

test('--dry-run is a known flag (it gets as far as the token read)', () => {
  const r = run(['--dry-run']);
  assert.doesNotMatch(r.stderr, /unknown flag/);
});

test('--dry-run together with --publish is refused: a check cannot publish', () => {
  const r = run(['--dry-run', '--publish']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--dry-run and --publish/);
});
