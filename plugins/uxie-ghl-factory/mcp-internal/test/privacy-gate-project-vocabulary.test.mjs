// The privacy gate must refuse one harvested project's vocabulary that leaked into hand-curated step examples (found 2026-09-30),
// and the shipped step examples must be free of it. Probes are assembled from FOUR parts so this file never contains a value the
// gate would refuse (the scanner joins at most three adjacent words). 
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GATE = fileURLToPath(new URL('../../../../scripts/check-privacy.mjs', import.meta.url));
const EXAMPLES = fileURLToPath(new URL('../../skills/create-ghl-workflow/catalog/step-examples/', import.meta.url));
// The plugin gate scans the git-listed files of its working directory, so each case is a throwaway git repo holding one file.
const gateRefuses = (name, content) => {
  const dir = mkdtempSync(join(tmpdir(), 'privacy-vocab-'));
  execFileSync('git', ['init', '-q', dir]); writeFileSync(join(dir, name), content);
  try { execFileSync('node', [GATE], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }); return false; } catch { return true; }
};
const PROBES = [['ha', 'bit', 'bud', 'dy'], ['ha', 'bit ', 'bud', 'dy'], ['H', 'B ', 'Time', 'zone'], ['h', 'b_days', '_si', 'nce'], ['ha', 'bit_', 'tar', 'get']].map((p) => p.join(''));

test('each of the five hashed forms is in the gate (asserted by hash, no plaintext here)', () => {
  const src = readFileSync(GATE, 'utf8');
  for (const probe of PROBES) {
    const hash = execFileSync('node', [GATE, '--hash', probe], { encoding: 'utf8' }).match(/[0-9a-f]{64}/)?.[0];
    assert.ok(hash && src.includes(hash), 'a hashed form is missing from the gate');
  }
});
test('the gate refuses the vocabulary end to end, and the neutral spelling passes (CONTROL)', () => {
  assert.equal(gateRefuses('probes.json', JSON.stringify({ titles: PROBES, url: `https://${PROBES[0]}-bot-services.workers.dev/reminders/x` })), true);
  assert.equal(gateRefuses('neutral.json', JSON.stringify({ title: 'Timezone', url: 'https://example.com/hooks/x', html: '{{contact.event_notes}}' })), false);
});
test('no shipped step example carries the vocabulary', () => {
  const all = readdirSync(EXAMPLES).filter((f) => f.endsWith('.json')).map((f) => readFileSync(join(EXAMPLES, f), 'utf8')).join('\n');
  assert.equal(gateRefuses('all-examples.json', all), false);
});
