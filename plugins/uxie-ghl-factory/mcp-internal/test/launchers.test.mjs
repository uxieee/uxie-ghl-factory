// SERVER:test/launchers.test.mjs — the two stable launchers.
//
// DELIBERATELY NOT IN bundle.test.mjs. That file rebuilds and diffs the committed bundles, so
// it fails on ANY core source edit and manufactures a kill for every mutant — which means any
// mutation run has to exclude it, and anything living in it is excluded too. These assertions
// are about launcher behaviour, they are cheap, and they must stay mutable-and-checked.
//
// What these pin is a failure that unit tests structurally cannot reach: the launcher is the
// only code that runs BEFORE the server exists, so nothing inside the server can defend it. A
// launcher that resolves the wrong bundle hands an operator the full read-write registry while
// they believe they are read-only, and every downstream read-only guarantee is then a
// statement about a process that is not the one running.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..');
const FULL_LAUNCHER = join(ROOT, 'launch.mjs');

// Builds a fake plugin cache under a throwaway HOME. `bundles` names which dist files exist
// per version, so a version that predates the audit profile is expressible — that is the
// scenario the fail-closed rule exists for and it cannot be tested any other way.
function fakeHome(versions) {
  const home = mkdtempSync(join(tmpdir(), 'ghl-launcher-'));
  for (const [version, bundles] of Object.entries(versions)) {
    const dist = join(home, '.claude', 'plugins', 'cache', 'uxieee', 'uxie-ghl-factory', version, 'mcp-internal', 'dist');
    mkdirSync(dist, { recursive: true });
    for (const bundle of bundles) {
      // Each fake bundle announces which file and which version actually got imported, so a
      // launcher that resolved the wrong one is caught by identity rather than by exit code.
      writeFileSync(join(dist, bundle), `process.stdout.write('LAUNCHED ${bundle} v${version}');\n`);
    }
  }
  return home;
}

const runLauncher = (launcher, home) => {
  try {
    const stdout = execFileSync(process.execPath, [launcher], {
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return { code: error.status ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
};

const cleanup = (home) => rmSync(home, { recursive: true, force: true });

test('the launcher picks the NEWEST installed build by semver, not lexicographically', async () => {
  // '0.9.0' sorts after '0.10.0' as a string, so a plain .sort() serves a build six releases
  // stale and reports nothing wrong. This project has already been bitten by version
  // comparison once — a manifest left at 0.5.1 while the other reached 0.7.2 stranded six
  // releases because the harness compared numbers the repo never bumped.
  const home = fakeHome({ '0.9.0': ['server.mjs'], '0.10.0': ['server.mjs'] });
  try {
    assert.equal(runLauncher(FULL_LAUNCHER, home).stdout, 'LAUNCHED server.mjs v0.10.0');
  } finally { cleanup(home); }
});

test('the launcher refuses cleanly when no plugin is installed at all', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ghl-launcher-empty-'));
  try {
    const result = runLauncher(FULL_LAUNCHER, home);
    assert.notEqual(result.code, 0, 'the launcher must exit non-zero with no plugin installed');
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /uxie-ghl-internal-mcp/, 'the refusal must identify itself to an operator reading stderr');
  } finally { cleanup(home); }
});
