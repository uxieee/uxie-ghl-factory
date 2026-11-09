import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { cleanGitEnv, gitOut } from '../../../../scripts/lib/git.mjs';
import { tempDir } from './_tmp.mjs';

const repo = (name) => {
  const dir = tempDir(`${name}-`);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
};

test('the hook variables are removed and everything else is kept', () => {
  const env = cleanGitEnv({ GIT_DIR: '/x/.git', GIT_INDEX_FILE: '/x/index', GIT_WORK_TREE: '/x', GIT_COMMON_DIR: '/x', PATH: '/bin', HOME: '/h' });
  assert.equal(env.GIT_DIR, undefined);
  assert.equal(env.GIT_INDEX_FILE, undefined);
  assert.equal(env.GIT_WORK_TREE, undefined);
  assert.equal(env.GIT_COMMON_DIR, undefined);
  assert.equal(env.PATH, '/bin');
  assert.equal(env.HOME, '/h');
});

test('a status taken in this repo reports this repo, even when GIT_DIR names another one (the hook case)', () => {
  const here = repo('here');
  const other = repo('other');
  writeFileSync(join(here, 'mine.txt'), 'x');
  writeFileSync(join(other, 'theirs.txt'), 'y');
  const out = gitOut(['status', '--porcelain'], here, { env: { ...process.env, GIT_DIR: join(other, '.git'), GIT_INDEX_FILE: join(other, '.git', 'index') } });
  assert.match(out, /mine\.txt/, 'this repo\'s file is reported');
  assert.doesNotMatch(out, /theirs\.txt/, 'the other repo\'s file is not');
});

test('a status larger than the 1 MB default buffer does not overflow (ENOBUFS)', () => {
  const dir = repo('big');
  const pad = 'p'.repeat(110);
  const n = 12000;
  for (let i = 0; i < n; i += 1) writeFileSync(join(dir, `f-${i}-${pad}.txt`), '');
  const out = gitOut(['status', '--porcelain'], dir);
  assert.ok(out.length > 1024 * 1024, `the fixture makes more than 1 MB of status (${out.length} bytes)`);
  assert.equal(out.split('\n').length, n, 'every file is listed');
  mkdirSync(join(dir, 'unused'));
});
