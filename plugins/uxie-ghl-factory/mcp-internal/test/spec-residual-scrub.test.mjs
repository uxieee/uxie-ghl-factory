// W6 item 2: the lifted spec's residual names stored keys by PATH, so the key-name scrub over every result never sees
// them as keys. A value is scrubbed where it sits — inside a copy of its stored step — so the pair rule (a header
// {key:'X-Hook-Secret', value}) and the header-map rule apply exactly as they do to the document itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubSpecResidual } from '../core/spec-scrub.mjs';

const SECRET = 's3cr3t-value-not-a-word-1234';
const steps = [{ id: 'S1', type: 'custom_webhook', attributes: {
  headers: [{ key: 'X-Hook-Secret', value: SECRET }],
  headerMap: {}, params: { 'X-Hook-Secret': SECRET },
  apiKey: SECRET, body: 'plain text' } }];
const spec = (entries) => ({ graph: [], triggers: [], stored: { residual: { S1: entries } } });

test('a value inside a secret-named header pair is redacted, f and t', () => {
  const out = scrubSpecResidual(spec([{ p: ['attributes', 'headers', 0, 'value'], f: 'compiled-' + SECRET, t: SECRET }]), steps);
  assert.ok(!JSON.stringify(out).includes(SECRET), JSON.stringify(out));
});

test('a secret-named key of a header-like map is redacted', () => {
  const out = scrubSpecResidual(spec([{ p: ['attributes', 'params', 'X-Hook-Secret'], t: SECRET }]), steps);
  assert.ok(!JSON.stringify(out).includes(SECRET));
});

test('a secret-named key at the end of the path is redacted; a plain value is kept', () => {
  const out = scrubSpecResidual(spec([{ p: ['attributes', 'apiKey'], t: SECRET }, { p: ['attributes', 'body'], f: 'x', t: 'plain text' }]), steps);
  assert.ok(!JSON.stringify(out).includes(SECRET));
  assert.deepEqual(out.stored.residual.S1[1], { p: ['attributes', 'body'], f: 'x', t: 'plain text' });
});

test('a whole header array in the residual is scrubbed pair by pair; the step itself is not changed', () => {
  const before = JSON.stringify(steps);
  const out = scrubSpecResidual(spec([{ p: ['attributes', 'headers'], t: [{ key: 'X-Hook-Secret', value: SECRET }] }]), steps);
  assert.ok(!JSON.stringify(out).includes(SECRET));
  assert.equal(JSON.stringify(steps), before);
});
