import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadData, searchCatalog, renderCard, renderMarkdown, summary } from './query-catalog.mjs';

const d = loadData();

test('summary reports full catalog counts', () => {
  const s = summary(d);
  assert.match(s, /316 step types/);
  assert.match(s, /59 trigger types/);
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
  assert.match(md, /Regenerate: `node engine\/query-catalog\.mjs --md/);
});

test('committed references/capabilities.md is in sync with the catalog', () => {
  const p = resolve(dirname(fileURLToPath(import.meta.url)), '../references/capabilities.md');
  assert.ok(existsSync(p), 'references/capabilities.md missing — regenerate it');
  assert.equal(readFileSync(p, 'utf8'), renderMarkdown(d),
    'capabilities.md is stale — run: node engine/query-catalog.mjs --md > references/capabilities.md');
});
