import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { refusal } from '../../skills/create-ghl-workflow/scripts/entry-gate.mjs';
const PAUSE = fileURLToPath(new URL('../../skills/create-ghl-workflow/scripts/pause-restore-proof.mjs', import.meta.url));
const S = 'a'.repeat(40), PAST = '2020-01-01T00:00:00Z';
const run = (args, env = {}) => spawnSync('node', [PAUSE, ...args], { env: { PATH: process.env.PATH, GHL_LOCATION: 'LOCtest', GHL_INTERNAL_TOK_FILE: '/nonexistent/tok.txt', ...env }, encoding: 'utf8' });
test('pure: every missing gate input refuses with 2; all present passes; smoke/dry exit 0', () => {
  const ok = { D18_RUNNER_S: S, QA_CLEARED: S };
  assert.equal(refusal(ok, [`--go=${PAST}`]), null);
  for (const [env, a] of [[{}, [`--go=${PAST}`]], [ok, []], [{ D18_RUNNER_S: S }, [`--go=${PAST}`]], [{ D18_RUNNER_S: S, QA_CLEARED: 'b'.repeat(40) }, [`--go=${PAST}`]], [ok, ['--go=2999-01-01T00:00:00Z']], [{ D18_RUNNER_S: 'short', QA_CLEARED: 'short' }, [`--go=${PAST}`]]]) assert.equal(refusal(env, a).code, 2, JSON.stringify([env, a]));
  for (const f of ['--smoke', '--dry']) assert.equal(refusal({}, [f]).code, 0);
});
test('pause-restore-proof refuses a bare start, partial gates, and unknown flags, before any import of auth or tools', () => {
  for (const [a, e] of [[[], {}], [[`--go=${PAST}`], {}], [[], { D18_RUNNER_S: S, QA_CLEARED: S }], [[`--go=${PAST}`, '--smok'], { D18_RUNNER_S: S, QA_CLEARED: S }], [['--dry', '--typo'], {}]]) {
    const r = run(a, e); assert.equal(r.status, 2, JSON.stringify(a)); assert.match(r.stderr, /REFUSED, nothing was run/); assert.doesNotMatch(r.stdout, /pause-restore proof|PASS|FAIL/);
  }
});
test('pause-restore-proof --smoke and --dry exit 0 with no call', () => {
  for (const f of ['--smoke', '--dry']) { const r = run([f]); assert.equal(r.status, 0); assert.match(r.stdout, /no account call/); assert.doesNotMatch(r.stdout, /pause-restore proof/); }
});
test('pause-restore-proof future objects carry the lane tag (ruling A): names TEST-CONF-W9-DRIFT-…, tags test-conf-w9-drift-…', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(PAUSE, 'utf8');
  assert.match(src, /`TEST-CONF-W9-DRIFT-\$\{s\}-\$\{STAMP\}`/);
  assert.equal((src.match(/`test-conf-w9-drift-\$\{STAMP\}-pause/g) ?? []).length, 3);
  assert.ok(!/`test-conf-\$\{STAMP\}/.test(src), 'no stamp-only tag shape is left');
});
