#!/usr/bin/env node
// Cut a release. One command, refuses at the first thing that is not true.
//
//   npm run release -- 0.52.0                      # the whole thing
//   npm run release -- 0.52.0 --dry-run            # everything up to the commit; touches no git state
//   npm run release -- 0.52.0 --title "..."        # override the title derived from the CHANGELOG
//   npm run release -- 0.52.0 --no-install         # skip `claude plugin update` at the end
//   npm run release -- 0.52.0 --no-mirror          # skip publishing the standalone skill mirror
//
// Why this exists: a release is the only moment anyone receives a corpus update — `claude plugin
// update` compares VERSION STRINGS and pulls nothing without a bump — so "the plugin is up to date
// with the corpus" can only ever mean "up to date as of the last release". Two releases were cut
// wrong in one day: 0.50.0 shipped with a red test because the suite was run on the development
// branch and not the tree that was tagged, and a second 0.50.0 was prepared on a branch that had
// not fetched. Both are preflight failures here.
//
// The order is the contract:
//   1. preflight        main, fetched, not behind, clean; version above current; CHANGELOG entry
//                       for it exists, dated today, non-empty; gh + claude on PATH
//   2. show drift       run the freshness gate ONCE before regenerating — this is the loud diff
//                       of what the corpus changed since the last release, and it is printed
//                       whether or not it fails
//   3. regenerate       scripts/sync-generated.mjs — the same step knowledge/'s post-commit hook runs
//   4. freshness gate   must now be green — regeneration is idempotent or something is wrong
//   5. bump             both manifests, in lockstep
//   6. test             the FULL suite on THIS tree (pretest runs privacy, parity, freshness)
//   7. commit · tag · push · GitHub release · standalone skill mirror · claude plugin update
//
// --dry-run stops after step 6 with the manifests UNBUMPED (the bump is reverted), so a dry run
// leaves the tree exactly as it found it except for regenerated artefacts — which, if they
// changed, you wanted to see anyway.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bumpManifestText, changelogSection, preflightFailures, releaseCommitMessage, releaseTitle,
} from './release-lib.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const PLUGIN = join(REPO, 'plugins/uxie-ghl-factory');
const MCP = join(PLUGIN, 'mcp-internal');
const KNOWLEDGE = resolve(REPO, '..', 'knowledge');
const MANIFESTS = [join(PLUGIN, '.claude-plugin/plugin.json'), join(PLUGIN, '.codex-plugin/plugin.json')];
const CHANGELOG = join(REPO, 'CHANGELOG.md');

const args = process.argv.slice(2);
const version = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const DRY = flag('--dry-run');
if (!version) {
  console.error('usage: npm run release -- <MAJOR.MINOR.PATCH> [--dry-run] [--title "..."] [--no-install]');
  process.exit(2);
}

const step = (n, title) => console.log(`\n── ${n}. ${title} ${'─'.repeat(Math.max(0, 70 - title.length))}`);
const die = (msg) => { console.error(`\nrelease: ${msg}`); process.exit(1); };
const sh = (cmd, argv, { cwd = REPO, quiet = false } = {}) => {
  const r = spawnSync(cmd, argv, { cwd, encoding: 'utf8', stdio: quiet ? 'pipe' : ['inherit', 'pipe', 'pipe'] });
  if (!quiet) { if (r.stdout) process.stdout.write(r.stdout); if (r.stderr) process.stderr.write(r.stderr); }
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
const git = (...argv) => execFileSync('git', argv, { cwd: REPO, encoding: 'utf8' }).trim();
const onPath = (name) => spawnSync('which', [name], { encoding: 'utf8' }).status === 0;

// ── 1. preflight ─────────────────────────────────────────────────────────────────────────────
step(1, 'preflight');
git('fetch', '--quiet', 'origin');
const current = JSON.parse(readFileSync(MANIFESTS[0], 'utf8')).version;
const changelogText = readFileSync(CHANGELOG, 'utf8');
const section = changelogSection(changelogText, version);
// LOCAL date, not UTC: the CHANGELOG is written by a person at their desk (this one at +08:00),
// and toISOString() said "still yesterday" to an entry dated after local midnight.
const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dirty = git('status', '--porcelain').split('\n').filter((l) => l && !l.startsWith('??')).map((l) => l.slice(3));
const failures = preflightFailures({
  branch: git('branch', '--show-current'),
  behind: Number(git('rev-list', '--count', 'HEAD..origin/main')),
  ahead: Number(git('rev-list', '--count', 'origin/main..HEAD')),
  dirty, current, next: version, section, today,
  tools: DRY ? {} : { gh: onPath('gh'), claude: flag('--no-install') ? true : onPath('claude') },
});
const hard = failures.filter((f) => !f.startsWith('note:'));
for (const f of failures) console.log(`   ${f.startsWith('note:') ? '·' : '✗'} ${f}`);
if (hard.length) die(`${hard.length} preflight failure(s) — nothing was touched`);
const title = releaseTitle(section.body, opt('--title'));
if (!title) die('could not derive a release title from the CHANGELOG entry — pass --title');
console.log(`   ✓ main, fetched, clean · ${current} → ${version} · "${title}"`);
console.log(`   ✓ knowledge/ ${existsSync(join(KNOWLEDGE, 'scripts')) ? 'present — corpus-derived artefacts will be regenerated' : 'ABSENT — only plugin-local artefacts can be regenerated'}`);

// ── 2. show drift ────────────────────────────────────────────────────────────────────────────
step(2, 'what changed since the last release (freshness gate, before regenerating)');
const before = sh('node', [join(REPO, 'scripts/check-generated-freshness.mjs')]);
console.log(before.code === 0 ? '   nothing drifted — every shipped artefact already matches regeneration' : '   ↑ that is the diff this release carries');

// ── 3. regenerate ────────────────────────────────────────────────────────────────────────────
step(3, 'regenerate every generated artefact (scripts/sync-generated.mjs)');
if (sh('node', [join(REPO, 'scripts/sync-generated.mjs')]).code !== 0) die('regeneration failed');

// ── 4. freshness gate ────────────────────────────────────────────────────────────────────────
step(4, 'freshness gate after regeneration');
if (sh('node', [join(REPO, 'scripts/check-generated-freshness.mjs')]).code !== 0) {
  die('still stale after regenerating — a generator is not idempotent, or writes somewhere the gate does not read. Stop here.');
}

// ── 5. bump ──────────────────────────────────────────────────────────────────────────────────
step(5, `bump both manifests ${current} → ${version}`);
const originals = MANIFESTS.map((p) => readFileSync(p, 'utf8'));
const restoreManifests = () => MANIFESTS.forEach((p, i) => writeFileSync(p, originals[i]));
try {
  MANIFESTS.forEach((p, i) => writeFileSync(p, bumpManifestText(originals[i], version)));
} catch (e) { restoreManifests(); die(e.message); }
console.log(`   ✓ ${MANIFESTS.map((p) => p.replace(`${PLUGIN}/`, '')).join(' + ')}`);

// ── 6. test ──────────────────────────────────────────────────────────────────────────────────
step(6, 'the full suite, on this tree');
const tests = sh('npm', ['test'], { cwd: MCP, quiet: true });
const summary = tests.out.split('\n').filter((l) => /^ℹ (tests|pass|fail)|^✖|privacy check|manifest parity|^freshness:/.test(l));
console.log(summary.map((l) => `   ${l}`).join('\n'));
if (tests.code !== 0) {
  if (DRY) restoreManifests();
  const failing = tests.out.split('\n').filter((l) => /^✖|AssertionError|Error:/.test(l)).slice(0, 20);
  die(`tests failed — not releasing.\n${failing.map((l) => `   ${l}`).join('\n')}`);
}

if (DRY) {
  restoreManifests();
  step(7, 'dry run — stopping before any git state changes');
  console.log(`   would commit: ${releaseCommitMessage(version, title)}`);
  console.log(`   would tag:    v${version}`);
  console.log(`   would push:   origin main v${version}   (pre-push gates: mcp contract, type catalog, freshness)`);
  console.log(`   would create: GitHub release "${version} — ${title}" from the CHANGELOG entry`);
  console.log(`   would publish: the standalone ghl-system-conventions mirror at v${version}`);
  console.log(`   manifests restored to ${current}; regenerated artefacts left in place (see step 3)`);
  process.exit(0);
}

// ── 7. commit · tag · push · release · install ───────────────────────────────────────────────
step(7, 'commit · tag · push · GitHub release · mirror · install');
git('add', '-u');
git('commit', '-q', '-m', releaseCommitMessage(version, title));
git('tag', '-a', `v${version}`, '-m', `${version} — ${title}`);
console.log(`   ✓ ${git('log', '--oneline', '-1')}`);
const push = sh('git', ['push', 'origin', 'main', `v${version}`]);
if (push.code !== 0) die(`push failed — the commit and tag exist locally; fix the gate it reports and push by hand`);
const notes = join(mkdtempSync(join(tmpdir(), 'release-notes-')), `${version}.md`);
writeFileSync(notes, `${section.body}\n`);
const rel = sh('gh', ['release', 'create', `v${version}`, '--title', `${version} — ${title}`, '--notes-file', notes]);
if (rel.code !== 0) die('GitHub release failed — the tag is pushed; create the release by hand');
if (!flag('--no-mirror')) {
  // The standalone skill repo is a mirror of this release — published last so it can only ever
  // carry a version that exists as a plugin release.
  const mirror = sh('node', [join(REPO, 'scripts/publish-standalone.mjs'), '--version', version]);
  if (mirror.code !== 0) console.error('   standalone mirror publish failed — run `npm run publish-skill -- --version ' + version + '` by hand');
}
if (!flag('--no-install')) {
  const up = sh('claude', ['plugin', 'update', 'uxie-ghl-factory@uxieee']);
  if (up.code !== 0) console.error('   claude plugin update failed — run it by hand');
}
console.log(`\nreleased ${version}. Restart the session to run it.`);
