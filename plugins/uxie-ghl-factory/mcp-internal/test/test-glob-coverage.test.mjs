// Every test file in this plugin must be REACHED by `npm test`.
//
// Eight test files under engines/ — 211 assertions covering the convai, voiceai, studio and
// knowledge-base compilers — were outside the runner's globs and had not executed in any release
// gate for as long as they existed. They all passed when finally run, which is the point: nobody
// knew either way, and "the suite is green" meant "the suite we happened to glob is green".
//
// That is how a real regression shipped. 0.64.0 replaced the convai partial-PUT compiler with a
// read-merge-write one and dropped `wait`/`sleep` handling; it surfaced months later on a live
// client account, as a write tool reporting success while changing nothing.
//
// A directory that is not globbed is worse than one with no tests at all — it looks covered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP = resolve(HERE, '..');
const PLUGIN = resolve(MCP, '..');

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist' || e.startsWith('.')) continue;
    const p = resolve(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.test.mjs')) out.push(p);
  }
  return out;
};

test('every .test.mjs in the plugin is inside the npm test globs', () => {
  const script = JSON.parse(readFileSync(resolve(MCP, 'package.json'), 'utf8')).scripts.test;
  // the globs are relative to mcp-internal; turn each into the directory prefix it covers
  const roots = [...script.matchAll(/"([^"]+)"/g)]
    .map((m) => m[1])
    .map((g) => resolve(MCP, g.split('**')[0]));
  assert.ok(roots.length >= 2, `expected several globs in the test script, got: ${script}`);

  const missed = walk(PLUGIN)
    .filter((f) => !roots.some((r) => f.startsWith(r)))
    .map((f) => relative(PLUGIN, f));

  assert.deepEqual(missed, [],
    `${missed.length} test file(s) exist but are never run by \`npm test\` — add the directory to the `
    + 'test script\'s globs, or the tests in them are decoration:\n  ' + missed.join('\n  '));
});
