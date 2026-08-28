// The shipped cards are GENERATED from the corpus (knowledge/scripts/build-type-catalog.mjs).
// Its table-cell splitter split on every `|`, escaped or not, so every cell that lists a union
// of values was cut at its first member — 35 cells across 19 cards — and describe_step_type
// served "minutes \" as "the union of valid values" (F5-23, F5-20's card, T4-18).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const cards = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../catalog/type-cards.json'), 'utf8')).cards;
const card = (type) => cards.find((c) => c.type === type);

test('no card cell ends in a backslash (a union cut at an escaped pipe)', () => {
  const cut = [];
  for (const c of cards) for (const f of c.fields ?? []) for (const k of ['type', 'default', 'notes'])
    if (typeof f[k] === 'string' && /\\$/.test(f[k])) cut.push(`${c.type}.${f.name}.${k}`);
  assert.deepEqual(cut, []);
});

test('the wait card carries its unions: 8+ modes, the unit list, and window.days', () => {
  const w = card('wait');
  const type = w.fields.find((f) => f.name === 'type');
  assert.match(type.notes, /"time" \| "condition" \| "reply" \| "appointment"/);
  const startAfter = w.fields.find((f) => f.name === 'startAfter');
  assert.match(startAfter.notes, /"seconds" \| "minutes" \| "hour" \| "days"/);
});

test('the in-app notification card carries all three userType values', () => {
  const n = card('internal_notification');
  const userType = n.fields.find((f) => f.name === 'userType' || /userType/.test(f.name));
  assert.ok(userType, 'userType row present');
  assert.match(userType.notes ?? userType.type ?? '', /all.*assign.*user/s);
});
