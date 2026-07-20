import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('build-course CLI with no args prints usage, exits non-zero, and needs no token', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./build-course.mjs', import.meta.url))], {
    encoding: 'utf8',
    env: { ...process.env, GHL_TOKEN: '', GHL_LOC: '' },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /usage: GHL_TOKEN=.*build-course\.mjs/);
  assert.equal(result.stdout, '');
});
