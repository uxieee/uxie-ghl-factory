// bl-405: modifyStep on a multi-path Wait (reply) was refused by GHL with transition-id-not-in-parent-transitions-attr. Not
// GHL's doing: modifyStep re-ran the stored wait through the compiler (wait is not in NORMALIZE_SKIP), which rebuilt
// attributes.transitions as [] and reset convertToMultipath/cat — the child transition nodes then named transitions their
// parent no longer listed. Shape from a stored client multi-path reply wait (knowledge samples).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modifyStep } from './edit.mjs';
import { loadCatalog } from './catalog.mjs';
import { makeSeededIdGen } from './idgen.mjs';

const ctx = () => ({ loc: 'L', uid: 'U', companyAge: 0, idGen: makeSeededIdGen('mw'), catalog: loadCatalog(), warn: () => {} });
const doc = () => [
  { id: 'W', type: 'wait', name: 'Wait for reply', next: ['T1', 'T2'], attributes: { type: 'reply', startAfter: { type: 'minutes', value: 30, when: 'after' },
    name: 'Wait for reply', cat: 'multi-path', reply: 'any', replyLabel: 'Any reply', isHybridAction: true, hybridActionType: 'wait', convertToMultipath: true,
    transitions: [{ id: 'T1', conditionType: 'user-defined', name: 'wait' }, { id: 'T2', conditionType: 'user-defined', name: 'timeout' }] } },
  { id: 'T1', type: 'transition', name: 'wait', parent: 'W', parentKey: 'W', next: null, attributes: {} },
  { id: 'T2', type: 'transition', name: 'timeout', parent: 'W', parentKey: 'W', next: null, attributes: {} },
];

test('modifyStep on a multi-path wait changes startAfter and leaves its branch wiring exactly as stored', () => {
  const before = doc()[0];
  const after = modifyStep(doc(), 'W', { startAfter: { type: 'days', value: 2, when: 'after' } }, null, ctx()).templates.find((t) => t.id === 'W');
  assert.deepEqual(after.attributes.startAfter, { type: 'days', value: 2, when: 'after' });
  for (const k of ['transitions', 'convertToMultipath', 'cat']) assert.deepEqual(after.attributes[k], before.attributes[k], k);
});
