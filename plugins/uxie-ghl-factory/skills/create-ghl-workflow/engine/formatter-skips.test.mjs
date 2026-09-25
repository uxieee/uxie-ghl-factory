// T10 / W2-6: formatter shapes that save clean and are SKIPPED at run time (live 2026-09-25).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';
import { lintFormatterSkips, numberFormatterFieldTypes } from './lints/formatter-skips.mjs';
import { runLints } from './lints/runner.mjs';

const ctx = (warns = []) => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('f'), catalog: loadCatalog(), warn: (m) => warns.push(m) });
const one = (node, c = ctx()) => compile({ name: 'W', triggers: [], graph: [{ ref: 'n', kind: 'action', name: 'N', ...node }] }, c)
  .autoSaveBody.workflowData.templates[0];

test('the builder derivation: split on _to_, strip formatted_', () => {
  assert.deepEqual(numberFormatterFieldTypes('number_to_currency'), { fromFieldType: 'number', toFieldType: 'currency' });
  assert.deepEqual(numberFormatterFieldTypes('string_to_formatted_number'), { fromFieldType: 'string', toFieldType: 'number' });
  assert.equal(numberFormatterFieldTypes('random_number'), null);
});

test('compile derives absent number_formatter field types from the action', () => {
  const t = one({ type: 'number_formatter', attributes: { action: 'number_to_currency', format: { fromField: '1234.5', options: { currency: { currencyCode: 'USD_US', currencyLocale: 'en-US' } } } } });
  assert.equal(t.attributes.format.fromFieldType, 'number');
  assert.equal(t.attributes.format.toFieldType, 'currency');
  assert.equal(t.attributes.format.fromField, '1234.5');
});

test('compile refuses a contradicting fromFieldType (the live-skipped shape)', () => {
  assert.throws(() => one({ type: 'number_formatter', attributes: { action: 'number_to_currency', format: { fromField: '1', fromFieldType: 'string' } } }),
    (e) => e.code === 'FORMATTER_FIELD_TYPE');
});

test('compile keeps matching field types and leaves random_number alone (controls)', () => {
  const t = one({ type: 'number_formatter', attributes: { action: 'string_to_number', format: { fromField: '1', fromFieldType: 'string', toFieldType: 'number', options: { inputDecimalMark: 'period' } } } });
  assert.equal(t.attributes.format.fromFieldType, 'string');
  const r = one({ type: 'number_formatter', attributes: { action: 'random_number', random: { min: 1, max: 10, decimalPlaces: 0 } } });
  assert.equal(r.attributes.format, undefined);
});

test('compile drops trim skip 0 with a warning; skip > 0 is kept', () => {
  const w = [];
  const t = one({ type: 'text_formatter', attributes: { formatterType: 'trim', field: 'abc', extras: { maxLength: 5, skip: 0 } } }, ctx(w));
  assert.equal('skip' in t.attributes.extras, false);
  assert.equal(t.attributes.extras.maxLength, 5);
  assert.ok(w.some((m) => /FORMATTER_SKIP_ZERO/.test(m)));
  const k = one({ type: 'text_formatter', attributes: { formatterType: 'trim', field: 'abc', extras: { maxLength: 6, skip: 2 } } });
  assert.equal(k.attributes.extras.skip, 2);
});

test('lint reports both stored shapes; clean shapes report nothing', () => {
  const T = [
    { id: 'a', type: 'number_formatter', name: 'A', attributes: { action: 'number_to_currency', format: { fromFieldType: 'string', toFieldType: 'currency' } } },
    { id: 'b', type: 'text_formatter', name: 'B', attributes: { formatterType: 'trim', extras: { skip: '0' } } },
    { id: 'c', type: 'number_formatter', name: 'C', attributes: { action: 'number_to_currency', format: { fromFieldType: 'number', toFieldType: 'currency' } } },
    { id: 'd', type: 'text_formatter', name: 'D', attributes: { formatterType: 'trim', extras: { skip: 2 } } },
  ];
  assert.deepEqual(lintFormatterSkips(T).map((f) => f.stepId), ['a', 'b']);
  const r = runLints({ templates: T, triggers: [] }, { packs: ['platform'] });
  assert.deepEqual(r.platform.filter((f) => f.rule === 'FORMATTER_RUNTIME_SKIP').map((f) => f.stepId), ['a', 'b']);
});
