// The form builder opens a form EMPTY when an element lacks keys it reads (bisected live: a Submit element with only type/tag/label hides every field).
// Pinned: for every built-in tag, the tool's element built from the tag alone carries every key, with the value, the builder wrote when the tile was
// dropped and the form saved (test/fixtures/form-builder-fields.json; knowledge sniffs/funnels-wave43-reproof-forms-2026-09-30).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderableFields } from '../core/form-fields.mjs';
import { shapeForBuilder, BUILDER_FIELD_SHAPES } from '../core/form-builder-shapes.mjs';

const FIX = JSON.parse(readFileSync(new URL('./fixtures/form-builder-fields.json', import.meta.url), 'utf8')).fields;
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const tool = (tag, extra = {}) => shapeForBuilder(renderableFields([{ tag, ...(tag === 'image' ? { url: 'https://x.test/a.png' } : {}), ...extra }]).fields).fields[0];

for (const [tag, built] of Object.entries(FIX)) {
  test(`${tag}: built from the tag alone, every key the builder wrote is there with the builder's value`, () => {
    const t = tool(tag);
    const diffs = Object.entries(built).filter(([k, v]) => canon(t[k]) !== canon(v)).map(([k, v]) => `${k}: builder ${canon(v).slice(0, 60)} tool ${canon(t[k])?.slice(0, 60)}`);
    assert.deepEqual(diffs, []);
  });
}

test('the Submit element carries the styling the builder canvas reads (without it the builder shows an empty form)', () => {
  const b = tool('button');
  for (const k of ['padding', 'border', 'borderColor', 'borderRadius', 'borderType', 'shadow', 'bgColor', 'color', 'weight', 'align', 'fullwidth', 'subTextColor', 'subTextWeight', 'submitSubText', 'placeholder', 'fieldWidthPercentage', 'active']) {
    assert.ok(k in b, `button.${k}`);
  }
  assert.equal(b.padding.top, 9);
});

test('what the caller sent is never changed; a custom-field question is left alone; a caller\'s other renderer keeps its own typeLabel', () => {
  const sent = { tag: 'email', label: 'Work email', type: 'email', required: false, placeholder: '<your-address>' };
  const out = shapeForBuilder([sent, { tag: 'AbCdEf123456789', type: 'text', label: 'Q' }, { tag: 'phone', type: 'phone' }]);
  assert.equal(out.fields[0].label, 'Work email'); assert.equal(out.fields[0].required, false); assert.equal(out.fields[0].placeholder, '<your-address>');
  assert.deepEqual(out.fields[1], { tag: 'AbCdEf123456789', type: 'text', label: 'Q' });
  assert.equal(out.fields[2].type, 'phone'); assert.equal(out.fields[2].typeLabel, undefined, 'the builder\'s "Text" would name the wrong renderer');
  assert.equal(sent.typeLabel, undefined, 'the input object is not mutated');
});

test('the table covers every built-in tag the tool completes', async () => {
  const { STANDARD_ELEMENTS } = await import('../core/form-fields.mjs');
  const missing = Object.keys(STANDARD_ELEMENTS).filter((t) => !(t in BUILDER_FIELD_SHAPES) && !['address', 'city', 'state', 'country', 'postal_code'].includes(t));
  assert.deepEqual(missing, [], 'address children are the address group\'s (form-fields.mjs ADDRESS_CHILDREN, measured in the same capture)');
});
