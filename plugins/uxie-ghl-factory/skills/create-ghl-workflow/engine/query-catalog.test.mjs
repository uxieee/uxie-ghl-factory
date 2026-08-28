import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadData, searchCatalog, renderCard, renderMarkdown, summary } from './query-catalog.mjs';

const d = loadData();

test('summary reports full catalog counts', () => {
  const s = summary(d);
  // Assert against the data rather than a literal, so a regen does not need a test edit —
  // but keep a FLOOR, because the failure that actually matters is the catalog silently
  // shrinking (a missing sniffs/ input makes gen-catalog emit a smaller catalog, not an
  // error). The floor is the pre-rulebook size: 316 steps / 59 triggers.
  assert.match(s, new RegExp(`${Object.keys(d.steps).length} step types`));
  assert.match(s, new RegExp(`${Object.keys(d.triggers).length} trigger types`));
  assert.ok(Object.keys(d.steps).length >= 316, 'catalog lost step types');
  assert.ok(Object.keys(d.triggers).length >= 59, 'catalog lost trigger types');
});

test('search finds a step by fuzzy name and a trigger by type', () => {
  const step = searchCatalog(d, 'internal notification');
  assert.equal(step[0].type, 'internal_notification');
  const trig = searchCatalog(d, 'customer_reply');
  assert.equal(trig[0].type, 'customer_reply');
  assert.equal(trig[0].kind, 'trigger');
});

test('cards carry the authorable shape (attrs, filters, IR line)', () => {
  const [step] = searchCatalog(d, 'internal_notification');
  const card = renderCard(step);
  assert.match(card, /attrs: type, sms/);
  assert.match(card, /kind: action/);
  const [trig] = searchCatalog(d, 'customer_reply');
  assert.match(renderCard(trig), /filters: .*message\.body/);
});

test('container steps render their IR sugar kind', () => {
  const [split] = searchCatalog(d, 'workflow_split');
  assert.match(renderCard(split), /kind: split/);
});

test('markdown index lists EVERY step and trigger type', () => {
  const md = renderMarkdown(d);
  for (const t of Object.keys(d.steps)) assert.ok(md.includes('`' + t + '`'), `step ${t} missing from index`);
  for (const t of Object.keys(d.triggers)) assert.ok(md.includes('`' + t + '`'), `trigger ${t} missing from index`);
  assert.match(md, /Regenerate: `node scripts\/query-catalog-cli\.mjs --md/);
  assert.match(md, /Native pause.*every step type/i);
  assert.match(md, /advanceCanvasMeta\.isDisabled/);
});

test('renderMarkdown surfaces a docNote inline for both a step and a trigger', () => {
  // The sync test above only proves the committed file matches renderMarkdown's OWN output —
  // if the docNote branch silently dropped the note, both sides of that byte-diff would agree
  // and it would still pass. This drives renderMarkdown directly with a minimal fixture, so a
  // regression in the docNote branch itself fails here regardless of what's committed.
  const fixture = {
    stepCount: 1,
    triggerCount: 1,
    steps: {
      fake_step: {
        type: 'fake_step', section: 'test-section', confidence: 'verified-live',
        docNote: 'STEP_DOC_NOTE_MARKER',
      },
    },
    triggers: {
      fake_trigger: {
        type: 'fake_trigger', category: 'test-category', confidence: 'verified-live',
        masterType: 'internal', docNote: 'TRIGGER_DOC_NOTE_MARKER',
      },
    },
  };
  const md = renderMarkdown(fixture);
  assert.match(md, /`fake_step`[^\n]*STEP_DOC_NOTE_MARKER/,
    'a step docNote must render on its own bullet line, not just live on the catalog entry');
  assert.match(md, /`fake_trigger`[^\n]*TRIGGER_DOC_NOTE_MARKER/,
    'a trigger docNote must render on its own bullet line, not just live on the catalog entry');
});

test('committed references/capabilities.md is in sync with the catalog', () => {
  const p = resolve(dirname(fileURLToPath(import.meta.url)), '../references/capabilities.md');
  assert.ok(existsSync(p), 'references/capabilities.md missing — regenerate it');
  assert.equal(readFileSync(p, 'utf8'), renderMarkdown(d),
    'capabilities.md is stale — run: node scripts/query-catalog-cli.mjs --md > references/capabilities.md');
});
