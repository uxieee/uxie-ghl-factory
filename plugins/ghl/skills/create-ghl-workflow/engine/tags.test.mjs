import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectRequiredTags, missingTags } from './tags.mjs';

const ir = {
  name: 'W',
  triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [{ field: 'tagsAdded', value: ['VIP'] }] }],
  graph: [
    { ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'A', attributes: { tags: ['welcomed'] } },
    { ref: 'b', kind: 'if_else', name: 'B', branches: [
      { ref: 'y', name: 'Yes', conditions: [{ conditionType: 'contact_detail', conditionSubType: 'tag', conditionValue: 'high-value' }], then: [
        { ref: 'yt', kind: 'action', type: 'add_contact_tag', name: 'P', attributes: { tags: ['premium'] } } ] },
      { ref: 'n', name: 'No', else: true, then: [] },
    ] },
  ],
};

test('collectRequiredTags gathers names from triggers, steps, and conditions', () => {
  assert.deepEqual(new Set(collectRequiredTags(ir)), new Set(['VIP', 'welcomed', 'high-value', 'premium']));
});

test('collectRequiredTags dedupes case-insensitively, keeps first casing', () => {
  const ir2 = { triggers: [], graph: [
    { ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'A', attributes: { tags: ['VIP', 'vip', 'Vip'] } },
  ] };
  assert.deepEqual(collectRequiredTags(ir2), ['VIP']);
});

test('missingTags returns names not already present (case-insensitive)', () => {
  assert.deepEqual(missingTags(['VIP', 'welcomed', 'premium'], ['vip', 'Premium']), ['welcomed']);
});
