import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The ghl-system-conventions skill ships the type catalogue so it works STANDALONE. Three
// things must stay true or the standalone user is quietly worse off than the plugin user:
// the copy is byte-identical to the plugin's own catalogue, the index names every type,
// and the CLI renders a card a person can read. The plugin-only and standalone paths carry
// the same data — that is the whole promise of the mirror.

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = resolve(HERE, '..', '..');
const REPO = resolve(PLUGIN, '..', '..');
const SKILL = join(PLUGIN, 'skills/ghl-system-conventions');
const types = await import(join(SKILL, 'scripts/types.mjs'));
const publish = await import(join(REPO, 'scripts/publish-standalone.mjs'));

test('the skill\'s type-cards.json is byte-identical to create-ghl-workflow\'s', () => {
  const a = readFileSync(join(PLUGIN, 'skills/create-ghl-workflow/catalog/type-cards.json'), 'utf8');
  const b = readFileSync(join(SKILL, 'catalog/type-cards.json'), 'utf8');
  assert.equal(a, b, 'run scripts/build-skill-types.mjs (or npm run sync)');
});

test('the index names every type exactly once, native with a summary, marketplace as a bare row', () => {
  const cards = types.loadCards();
  const index = readFileSync(join(SKILL, 'references/ghl-types-index.md'), 'utf8');
  assert.equal(index, types.renderIndex(cards), 'the shipped index is a fresh render');
  // A key may legitimately live in two families (dnd_contact is both a trigger and a step), so
  // the invariant is one row per CARD, not one row per key.
  const byKey = new Map();
  for (const c of cards) byKey.set(c.type, (byKey.get(c.type) ?? 0) + 1);
  for (const [type, n] of byKey) {
    const hits = index.split('\n').filter((l) => l.startsWith(`| \`${type}\` |`));
    assert.equal(hits.length, n, `${type}: ${n} card(s), ${hits.length} index row(s)`);
  }
  assert.ok(byKey.get('dnd_contact') === 2, 'dnd_contact is both a trigger and a step in the corpus');
  assert.ok(!cards.some((c) => c.family === '.'), 'picker-taxonomy is a routing page, not a type');
  assert.match(index, /## Triggers \(native\) \(\d+\)/);
  assert.match(index, /## Steps \(marketplace apps\) \(\d+\)/);
});

test('renderCard prints the fields table for a step and the notes for a trigger', () => {
  const cards = types.loadCards();
  const wait = types.renderCard(cards.find((c) => c.type === 'wait'));
  assert.match(wait, /^# wait  \(steps\)/);
  assert.match(wait, /\*\*status:\*\* source-derived/);
  assert.match(wait, /\| appointmentCondition \|/, 'the field table is rendered');
  const trigger = cards.find((c) => c.family === 'triggers' && c.notes);
  const t = types.renderCard(trigger);
  assert.match(t, /## Notes/);
});

test('search matches key, title and summary; an exact key wins on the CLI', () => {
  const cards = types.loadCards();
  assert.ok(types.search(cards, 'appointment').length > 1);
  const r = spawnSync('node', [join(SKILL, 'scripts/types.mjs'), 'wait'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^# wait/);
  const miss = spawnSync('node', [join(SKILL, 'scripts/types.mjs'), 'definitely-not-a-type-zzz'], { encoding: 'utf8' });
  assert.equal(miss.status, 1);
  assert.match(miss.stdout, /does NOT prove GHL lacks it/);
});

test('build-skill-types.mjs is idempotent: a second render into a temp dir matches what ships', () => {
  const out = mkdtempSync(join(tmpdir(), 'skill-types-'));
  const r = spawnSync('node', [join(REPO, 'scripts/build-skill-types.mjs'), '--out-dir', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(out, 'ghl-types-index.md'), 'utf8'), readFileSync(join(SKILL, 'references/ghl-types-index.md'), 'utf8'));
});

test('the mirror README template renders every placeholder from the skill itself', () => {
  const template = readFileSync(join(REPO, 'scripts/standalone-readme.template.md'), 'utf8');
  const out = publish.renderReadme(template, { version: '9.9.9', skillDescription: 'DESC', typeCount: 293, nativeCount: 145 });
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(out), 'no placeholder left');
  assert.match(out, /npx skills add uxieee\/ghl-system-conventions/);
  assert.match(out, /currently \*\*9\.9\.9\*\*/);
  assert.match(out, /293 step and trigger\ntypes\*\* \(145 native/);
  assert.match(out, /This repo is a mirror/);
});
