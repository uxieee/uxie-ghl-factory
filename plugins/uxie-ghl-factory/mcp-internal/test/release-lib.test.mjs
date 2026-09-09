import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bumpManifestText, changelogSection, compareSemver, parseSemver, preflightFailures,
  releaseCommitMessage, releaseTitle,
} from '../../../../scripts/release-lib.mjs';

// scripts/release.mjs is the one door a version leaves through. Its rules live in release-lib.mjs
// so they can be pinned here without cutting a release: what a CHANGELOG entry must look like,
// which trees may be released from, and that the bump touches exactly one field per manifest.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..', '..');

test('semver: parse, compare, and refuse anything that is not MAJOR.MINOR.PATCH', () => {
  assert.deepEqual(parseSemver('0.51.0'), [0, 51, 0]);
  assert.equal(compareSemver('0.51.0', '0.50.0'), 1);
  assert.equal(compareSemver('0.9.9', '0.10.0'), -1, 'numeric, not lexical');
  assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
  assert.throws(() => parseSemver('v0.51.0'), /not a MAJOR\.MINOR\.PATCH/);
  assert.throws(() => parseSemver('0.51'), /not a MAJOR\.MINOR\.PATCH/);
});

test('changelogSection finds the entry as this repo writes it, with its date and body, and nothing past the next heading', () => {
  const text = readFileSync(resolve(REPO, 'CHANGELOG.md'), 'utf8');
  const s = changelogSection(text, '0.51.0');
  assert.ok(s, 'the 0.51.0 entry exists');
  assert.equal(s.date, '2026-09-03');
  assert.match(s.body, /^One browser profile per token file\./);
  assert.ok(!s.body.includes('## [0.50.0]'), 'the body stops at the next entry');
  assert.ok(!s.body.includes('Agent Logs surface'), 'the body does not bleed into 0.50.0');
  assert.equal(changelogSection(text, '9.9.9'), null);
});

test('changelogSection reads a heading without a date, so preflight can name that as the defect', () => {
  const s = changelogSection('# x\n\n## [0.52.0]\n\nBody.\n\n## [0.51.0] — 2026-09-03\n', '0.52.0');
  assert.equal(s.date, null);
  assert.equal(s.body, 'Body.');
});

test('releaseTitle is the first sentence of the first paragraph, markdown stripped, phrase-length', () => {
  assert.equal(releaseTitle('One browser profile per token file. The per-folder binding…'), 'One browser profile per token file');
  assert.equal(releaseTitle('### Fixed\n\n- bullet first\n\nThe `capture` step now **refuses** a shared profile. More.'),
    'The capture step now refuses a shared profile');
  assert.equal(releaseTitle('anything', '  Given title  '), 'Given title');
  const long = releaseTitle(`${'word '.repeat(30)}end.`);
  assert.ok(long.length <= 81 && long.endsWith('…'), `long first sentences are cut at a word: "${long}"`);
  assert.equal(releaseTitle(''), '');
});

test('bumpManifestText changes exactly the version field and keeps the file byte-identical otherwise', () => {
  for (const rel of ['plugins/uxie-ghl-factory/.claude-plugin/plugin.json', 'plugins/uxie-ghl-factory/.codex-plugin/plugin.json']) {
    const json = readFileSync(resolve(REPO, rel), 'utf8');
    const current = JSON.parse(json).version;
    const bumped = bumpManifestText(json, '9.9.9');
    assert.equal(JSON.parse(bumped).version, '9.9.9');
    assert.equal(bumped.replace('9.9.9', current), json, `${rel}: only the version changed`);
  }
  assert.throws(() => bumpManifestText('{"version":"1.0.0","nested":{"version":"1.0.0"}}', '1.0.1'), /exactly one "version"/);
  assert.throws(() => bumpManifestText('{"name":"x"}', '1.0.1'), /exactly one "version"/);
  assert.throws(() => bumpManifestText('{"version":"1.0.0"}', 'v2'), /not a MAJOR/);
});

test('preflight names every failure at once — branch, behind, dirty, version order, missing or misdated entry, tools', () => {
  const failures = preflightFailures({
    branch: 'feat/x', behind: 2, ahead: 0, dirty: ['CHANGELOG.md'], current: '0.51.0', next: '0.51.0',
    section: null, today: '2026-09-03', tools: { gh: false, claude: true },
  });
  assert.equal(failures.length, 6, failures.join('\n'));
  assert.match(failures[0], /branch "feat\/x"/);
  assert.match(failures[1], /2 commit\(s\) behind/);
  assert.match(failures[2], /CHANGELOG\.md/);
  assert.match(failures[3], /not above the current/);
  assert.match(failures[4], /no "## \[0\.51\.0\] — YYYY-MM-DD" entry/);
  assert.match(failures[5], /"gh" is not on PATH/);
});

test('preflight passes a clean main with a dated, non-empty entry for the next version; ahead is a note, not a failure', () => {
  const base = {
    branch: 'main', behind: 0, ahead: 0, dirty: [], current: '0.51.0', next: '0.52.0',
    section: { heading: '## [0.52.0] — 2026-09-03', date: '2026-09-03', body: 'Something.' }, today: '2026-09-03', tools: { gh: true, claude: true },
  };
  assert.deepEqual(preflightFailures(base), []);
  const ahead = preflightFailures({ ...base, ahead: 3 });
  assert.equal(ahead.length, 1);
  assert.match(ahead[0], /^note: main is 3 commit\(s\) ahead/);
  assert.match(preflightFailures({ ...base, section: { ...base.section, date: '2026-09-01' } })[0], /dated 2026-09-01; today is 2026-09-03/);
  assert.match(preflightFailures({ ...base, section: { ...base.section, date: null } })[0], /has no date/);
  assert.match(preflightFailures({ ...base, section: { ...base.section, body: '' } })[0], /is empty/);
});

test('the commit message is the shape the log already uses', () => {
  assert.equal(releaseCommitMessage('0.52.0', 'a title'), 'release: 0.52.0 — a title');
});

test('preflight REFUSES when untracked files would be left out of the release', () => {
  // Step 7 stages with `git add -u` — tracked files only. A new file is not staged, not committed,
  // and not in the release, while every gate stays green: privacy scans the working tree, freshness
  // compares regenerated artefacts, and the tests pass because the file is on disk. 0.70.0 had six
  // such files, staged by hand; nothing in the pipeline would have caught it.
  const base = {
    branch: 'main', behind: 0, ahead: 0, dirty: [], current: '0.51.0', next: '0.52.0',
    section: { heading: '## [0.52.0] — 2026-09-03', date: '2026-09-03', body: 'Something.' },
    today: '2026-09-03', tools: { gh: true, claude: true },
  };
  assert.deepEqual(preflightFailures(base), [], 'no untracked files is still a clean release');
  assert.deepEqual(preflightFailures({ ...base, untracked: [] }), [], 'an empty list is not a failure');

  const f = preflightFailures({ ...base, untracked: ['core/site-audit.mjs', 'test/site-audit.test.mjs'] });
  assert.equal(f.length, 1);
  assert.match(f[0], /would NOT ship/);
  assert.match(f[0], /core\/site-audit\.mjs/, 'the files must be NAMED — a count alone cannot be acted on');
  assert.match(f[0], /git add/, 'and it must say what to do about them');
  assert.ok(!f[0].startsWith('note:'), 'this aborts the release; it is not advisory');
});
