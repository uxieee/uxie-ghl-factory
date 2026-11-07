import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS } from '../core/tools.mjs';
import { countPlugin, checkSpans, READMES, PLUGIN } from '../../../../scripts/doc-counts.mjs';

test('the tool count equals TOOLS.length', async () => {
  const values = await countPlugin();
  assert.equal(values.tools, TOOLS.length);
});

test('a plugin README number that disagrees with the tree fails --check', async () => {
  const values = await countPlugin();
  const span = (k, v) => `<!-- doc-counts:${k} -->${v}<!-- /doc-counts -->`;
  const good = `| ${span('publicOperations', values.publicOperations)} operations across ${span('categories', values.categories)} categories | ${span('internalEndpoints', values.internalEndpoints)} |`;
  assert.deepEqual(checkSpans(good, values, ['publicOperations', 'categories', 'internalEndpoints'], 'fixture'), []);
  const typed = good.replace(span('publicOperations', values.publicOperations), span('publicOperations', 671));
  const problems = checkSpans(typed, values, ['publicOperations'], 'fixture');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /publicOperations states 671/);
});

test('a README that drops a required span fails --check, so a number cannot be typed back in unmarked', () => {
  const problems = checkSpans('operations across 90 categories', { tools: 1 }, ['tools'], 'fixture');
  assert.match(problems[0], /no doc-counts span for tools/);
});

test('the real READMEs carry every span they must, and agree with the tree', async () => {
  const values = await countPlugin();
  for (const { file, keys } of READMES) {
    assert.deepEqual(checkSpans(readFileSync(file, 'utf8'), values, keys, file), [], file);
  }
});

test('a README whose as-of stamp is not a date fails --check, so the source line cannot be left blank', () => {
  const problems = checkSpans('Counts as of <!-- doc-counts:asof -->sometime<!-- /doc-counts -->', { asof: '2026-11-07' }, ['asof'], 'fixture');
  assert.match(problems[0], /as-of date is not YYYY-MM-DD/);
  assert.deepEqual(checkSpans('as of <!-- doc-counts:asof -->2026-11-07<!-- /doc-counts -->', { asof: '2026-11-07' }, ['asof'], 'fixture'), []);
});

test('every README in READMES requires its as-of stamp: a README without the span fails --check', async () => {
  const values = await countPlugin();
  for (const { file, keys } of READMES) {
    assert.ok(keys.includes('asof'), `${file} must carry the as-of stamp in READMES`);
    const stripped = readFileSync(file, 'utf8').replace(/<!-- doc-counts:asof -->[^<]*<!-- \/doc-counts -->/g, '');
    const problems = checkSpans(stripped, values, keys, file);
    assert.ok(problems.some((p) => p.includes('no doc-counts span for asof')), `${file} without its date must fail`);
  }
});

test('a count README with its numbers but no as-of span fails --check against the registry keys', async () => {
  const values = await countPlugin();
  const undated = `Counts: <!-- doc-counts:tools -->${values.tools}<!-- /doc-counts --> tools.`;
  const problems = checkSpans(undated, values, READMES.find((r) => r.keys.includes('tools')).keys, 'fixture');
  assert.ok(problems.some((p) => p.includes('no doc-counts span for asof')));
});

test('reads nothing outside plugin/ (the knowledge corpus has its own counts)', () => {
  const src = readFileSync(join(PLUGIN, 'scripts/doc-counts.mjs'), 'utf8');
  assert.ok(!/\.\.\/knowledge|knowledge\//.test(src), 'no reference to the knowledge tree');
});
