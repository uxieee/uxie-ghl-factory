import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseConformanceFlags } from './conformance-flags.mjs';

// w8-9 (orchestrator ruling): --allow-sends never publishes. The publish of the test offer has its own flag, --allow-publish (G6).

test('--allow-sends alone sends and publishes nothing', () => {
  assert.deepEqual(parseConformanceFlags(['--allow-sends']), { keep: false, sends: true, publish: false });
});

test('--allow-publish alone publishes and sends nothing', () => {
  assert.deepEqual(parseConformanceFlags(['--allow-publish']), { keep: false, sends: false, publish: true });
});

test('no flags: nothing is sent and nothing is published', () => {
  assert.deepEqual(parseConformanceFlags([]), { keep: false, sends: false, publish: false });
});

test('both gates together, with --keep', () => {
  assert.deepEqual(parseConformanceFlags(['--allow-sends', '--allow-publish', '--keep']), { keep: true, sends: true, publish: true });
});

test('the offer publish in conformance.mjs is the only publish call, and it is gated on the publish flag alone', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'conformance.mjs'), 'utf8');
  const calls = src.match(/publishOffer\(/g) ?? [];
  assert.equal(calls.length, 1, 'exactly one publish call');
  const idx = src.indexOf('publishOffer(');
  assert.match(src.slice(Math.max(0, idx - 200), idx), /if \(PUBLISH\)/, 'the publish call sits inside if (PUBLISH)');
  assert.doesNotMatch(src.slice(Math.max(0, idx - 200), idx), /SENDS\)/, 'and not behind the sends flag');
});
