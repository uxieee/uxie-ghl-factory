import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = '../../skills/ghl-forms/scripts/';
const SCRIPTS = ['d18-folder-proof.mjs', 'd18-forms-funnels-proof.mjs'].map((n) => fileURLToPath(new URL(DIR + n, import.meta.url)));
const S = 'c'.repeat(40);
const PAST = '2020-01-01T00:00:00Z';
const run = (script, args, env) => spawnSync('node', [script, ...args], { env: { PATH: process.env.PATH, GHL_LOCATION: 'LOCtest', GHL_INTERNAL_TOK_FILE: '/nonexistent/tok.txt', ...env }, encoding: 'utf8' });

for (const script of SCRIPTS) {
  const name = script.split('/').pop();
  test(`${name}: with nothing set it refuses with exit 2 before any tool is imported or called`, () => {
    const r = run(script, [], {}); assert.equal(r.status, 2); assert.match(r.stderr, /REFUSED, nothing was run/); assert.doesNotMatch(r.stdout, /PASS|FAIL|RESIDUE/);
  });
  test(`${name}: each of S, QA_CLEARED and --go alone is not enough`, () => {
    for (const [args, env] of [[[`--go=${PAST}`], {}], [[], { D18_RUNNER_S: S, QA_CLEARED: S }], [[`--go=${PAST}`], { D18_RUNNER_S: S }], [[`--go=${PAST}`], { D18_RUNNER_S: S, QA_CLEARED: 'd'.repeat(40) }], [['--go=2999-01-01T00:00:00Z'], { D18_RUNNER_S: S, QA_CLEARED: S }], [[`--go=${PAST}`], { D18_RUNNER_S: 'short', QA_CLEARED: 'short' }]]) {
      const r = run(script, args, env); assert.equal(r.status, 2, JSON.stringify([args, env])); assert.doesNotMatch(r.stdout, /PASS|FAIL|RESIDUE/);
    }
  });
  test(`${name}: --smoke and --dry run without S, clearance or GO and make no account call`, () => {
    for (const f of ['--smoke', '--dry']) { const r = run(script, [f], {}); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /no account call/); }
  });
}

for (const script of SCRIPTS) {
  const name = script.split('/').pop();
  test(`${name}: with S, QA_CLEARED and a passed --go ALL set, a typo flag (--smok) is still refused: unknown argument, exit 2, before any auth or tool use`, () => {
    for (const args of [[`--go=${PAST}`, '--smok'], ['--smok', `--go=${PAST}`], [`--go=${PAST}`, '--bogus'], ['--smoke', '--live'], ['--dry', 'extra']]) {
      const r = run(script, args, { D18_RUNNER_S: S, QA_CLEARED: S }); assert.equal(r.status, 2, JSON.stringify(args)); assert.match(r.stderr, /unknown argument/); assert.doesNotMatch(r.stdout, /PASS|FAIL|RESIDUE|SWEEP/);
    }
  });
  test(`${name}: --smoke and --dry exit 0 without reading the token file or loading a tool`, () => {
    for (const f of ['--smoke', '--dry']) { const r = run(script, [f], { GHL_INTERNAL_TOK_FILE: '/nonexistent/tok.txt' }); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /tools are not loaded and no account call/); assert.equal(r.stderr, ''); }
  });
}
