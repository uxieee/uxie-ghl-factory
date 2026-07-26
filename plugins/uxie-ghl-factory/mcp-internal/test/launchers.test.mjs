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
const AUDIT_LAUNCHER = join(ROOT, 'launch-audit.mjs');

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

test('the audit launcher exists and boots the AUDIT bundle', async () => {
  // The gap this closes: launch.mjs resolved dist/server.mjs only, so there was no launcher
  // for the audit profile at all and an MCP client could not connect to it. The brief's own
  // words: resolve this BEFORE the canary, not at canary time.
  const home = fakeHome({ '0.11.2': ['server.mjs', 'audit-server.mjs'] });
  try {
    const result = runLauncher(AUDIT_LAUNCHER, home);
    assert.equal(result.code, 0, `audit launcher failed: ${result.stderr}`);
    assert.equal(result.stdout, 'LAUNCHED audit-server.mjs v0.11.2',
      'the audit launcher must import the audit bundle, not the full one');
  } finally { cleanup(home); }
});

test('the audit launcher REFUSES rather than falling back to the full server', async () => {
  // THE ASSERTION THIS FILE EXISTS FOR. On a build that predates the audit profile there is
  // no audit-server.mjs, and the tempting repair is to fall back to server.mjs so the launch
  // "works". That starts the FULL registry — writes included — for a caller who asked for the
  // read-only profile and cannot tell the difference from outside the process. A launch that
  // cannot be read-only must not launch.
  const home = fakeHome({ '0.9.0': ['server.mjs'] });
  try {
    const result = runLauncher(AUDIT_LAUNCHER, home);
    assert.notEqual(result.code, 0, 'a missing audit bundle must be a non-zero exit, not a silent downgrade');
    assert.equal(result.stdout, '', 'nothing may be imported when the audit bundle is absent');
    assert.match(result.stderr, /audit-server\.mjs/, 'the refusal must name what it looked for');
    assert.match(result.stderr, /NOT fall back/i, 'the refusal must state that it will not downgrade');
    assert.match(result.stderr, /0\.9\.0/, 'the refusal must name the versions it did find, or it is undiagnosable');
  } finally { cleanup(home); }
});

test('the audit launcher never references the full bundle at all', async () => {
  // Belt and braces on the test above, and cheaper to keep true: the string `dist/server.mjs`
  // simply does not occur in this file. A future edit that reintroduces a fallback has to
  // reintroduce the filename, and it fails here before anyone reasons about control flow.
  const source = readFileSync(AUDIT_LAUNCHER, 'utf8');
  const withoutAudit = source.replaceAll('audit-server.mjs', '');
  assert.ok(!withoutAudit.includes('server.mjs'),
    'launch-audit.mjs must not name the full server bundle, even in a fallback it never takes');
});

test('both launchers pick the NEWEST installed build by semver, not lexicographically', async () => {
  // '0.9.0' sorts after '0.10.0' as a string, so a plain .sort() serves a build six releases
  // stale and reports nothing wrong. This project has already been bitten by version
  // comparison once — a manifest left at 0.5.1 while the other reached 0.7.2 stranded six
  // releases because the harness compared numbers the repo never bumped.
  const versions = { '0.9.0': ['server.mjs', 'audit-server.mjs'], '0.10.0': ['server.mjs', 'audit-server.mjs'] };
  const home = fakeHome(versions);
  try {
    assert.equal(runLauncher(FULL_LAUNCHER, home).stdout, 'LAUNCHED server.mjs v0.10.0');
    assert.equal(runLauncher(AUDIT_LAUNCHER, home).stdout, 'LAUNCHED audit-server.mjs v0.10.0');
  } finally { cleanup(home); }
});

test('the audit launcher skips a newer build that lacks the audit bundle', async () => {
  // The two rules composed, and they could easily have been written to contradict each other:
  // "newest wins" plus "audit only" must mean "newest build that HAS an audit bundle", not
  // "fail because the newest one lacks it". A newer full-only build is a plugin mid-rollout,
  // not a reason to refuse a perfectly good audit bundle one version down.
  const home = fakeHome({ '0.10.0': ['server.mjs'], '0.9.0': ['server.mjs', 'audit-server.mjs'] });
  try {
    const result = runLauncher(AUDIT_LAUNCHER, home);
    assert.equal(result.code, 0, `audit launcher failed: ${result.stderr}`);
    assert.equal(result.stdout, 'LAUNCHED audit-server.mjs v0.9.0');
  } finally { cleanup(home); }
});

test('both launchers refuse cleanly when no plugin is installed at all', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ghl-launcher-empty-'));
  try {
    for (const launcher of [FULL_LAUNCHER, AUDIT_LAUNCHER]) {
      const result = runLauncher(launcher, home);
      assert.notEqual(result.code, 0, `${launcher} must exit non-zero with no plugin installed`);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /uxie-ghl-internal-mcp/, 'the refusal must identify itself to an operator reading stderr');
    }
  } finally { cleanup(home); }
});

test('the shipped audit entry point is the one the audit launcher would reach', async () => {
  // Ties the launcher to the artefact the rest of the suite checks. Without this the launcher
  // could be perfect about a filename nothing produces.
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.bin['ghl-internal-mcp-audit'], './stdio-audit.mjs',
    'the audit bin entry must point at the audit stdio entry point');
  assert.ok(readFileSync(join(ROOT, 'dist', 'audit-server.mjs'), 'utf8').length > 0,
    'dist/audit-server.mjs must exist — it is what launch-audit.mjs resolves');
});
