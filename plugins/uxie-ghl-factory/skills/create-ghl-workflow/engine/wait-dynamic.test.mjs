// bl-252: the dynamic delay keys survive compile (live 2026-09-28: the runtime honours dynamicTimePeriod).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';
const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('d'), catalog: loadCatalog() });
const one = (attributes) => compile({ name: 'W', triggers: [], graph: [{ ref: 'w', kind: 'wait', name: 'Wait', waitType: 'time', attributes }] }, ctx())
  .autoSaveBody.workflowData.templates[0].attributes;
const SA = { type: 'minutes', value: 1, when: 'after' };

test('dynamic period and unit are emitted alongside startAfter', () => {
  const a = one({ type: 'time', startAfter: SA, timePeriodInputMode: 'dynamic', dynamicTimePeriod: '{{contact.n}}', unitInputMode: 'dynamic', dynamicUnit: '{{contact.u}}' });
  assert.equal(a.timePeriodInputMode, 'dynamic'); assert.equal(a.dynamicTimePeriod, '{{contact.n}}');
  assert.equal(a.unitInputMode, 'dynamic'); assert.equal(a.dynamicUnit, '{{contact.u}}');
  assert.deepEqual(a.startAfter, SA);
});

test('a static wait carries no dynamic keys (control)', () => {
  const a = one({ type: 'time', startAfter: SA });
  assert.equal('timePeriodInputMode' in a, false); assert.equal('dynamicTimePeriod' in a, false);
});

test('a dynamic value that is not a {{merge tag}} is refused, like the builder', () => {
  assert.throws(() => one({ type: 'time', startAfter: SA, dynamicTimePeriod: '3' }), (e) => e.code === 'WAIT_DYNAMIC');
});
