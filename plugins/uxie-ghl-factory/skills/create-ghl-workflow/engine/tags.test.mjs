import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectOpTags } from './tags.mjs';

// The edit path had NO tag pre-creation (orchestrate does it for builds only), so an edit
// could reference a tag that didn't exist — "Referenced Tag does not exist", and a tag
// trigger on a missing tag never fires. Found live 2026-07-17.
test('collectOpTags: addTrigger tag-filter value', () => {
  assert.deepEqual(collectOpTags([
    { op: 'addTrigger', trigger: { type: 'contact_tag', name: 'T', filters: [{ field: 'tagsAdded', value: 'vip' }] } },
  ]), ['vip']);
});

test('collectOpTags: modifyTrigger with no `type` (inherited from the live trigger) still collects', () => {
  assert.deepEqual(collectOpTags([
    { op: 'modifyTrigger', name: 'X', trigger: { filters: [{ field: 'tagsRemoved', value: 'gold' }] } },
  ]), ['gold']);
});

test('collectOpTags: step ops, modifyStep patches, and addBranch conditions', () => {
  const got = collectOpTags([
    { op: 'appendStep', step: { type: 'add_contact_tag', attributes: { tags: ['a'] } } },
    { op: 'insertAfter', afterId: 'x', step: { type: 'remove_contact_tag', attributes: { tags: ['b'] } } },
    { op: 'modifyStep', stepId: 's', attrPatch: { tags: ['c'] } },
    { op: 'addBranch', containerId: 'k', name: 'B', conditions: [{ conditionType: 'contact_detail', tag: 'd' }] },
  ]);
  assert.deepEqual(got.sort(), ['a', 'b', 'c', 'd']);
});

test('collectOpTags: de-dupes case-insensitively and ignores non-tag ops', () => {
  assert.deepEqual(collectOpTags([
    { op: 'addTrigger', trigger: { type: 'contact_tag', name: 'T', filters: [{ field: 'tagsAdded', value: 'VIP' }] } },
    { op: 'appendStep', step: { type: 'add_contact_tag', attributes: { tags: ['vip'] } } },
    { op: 'deleteStep', stepId: 's1' },
    { op: 'appendStep', step: { type: 'sms', attributes: { body: 'hi' } } },
  ]), ['VIP']);   // first-seen casing wins
});

test('collectOpTags: a non-tag trigger contributes nothing', () => {
  assert.deepEqual(collectOpTags([
    { op: 'addTrigger', trigger: { type: 'form_submission', name: 'F', filters: [{ field: 'form_id', value: 'abc' }] } },
  ]), []);
});
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

test('collectRequiredTags: new authoring — simple `tag:` intent key AND plural tags/array shape', () => {
  const ir2 = {
    triggers: [],
    graph: [
      { ref: 'b', kind: 'if_else', name: 'B', branches: [
        // simple intent key
        { ref: 'y', name: 'Y', conditions: [{ conditionType: 'contact_detail', tag: 'vip' }], then: [] },
        // full/normalized shape: plural subType + ARRAY value (possibly multi-tag)
        { ref: 'z', name: 'Z', conditions: [{ conditionType: 'contact_detail', conditionSubType: 'tags', conditionOperator: 'index-of-true', conditionValue: ['gold', 'silver'] }], then: [] },
        { ref: 'n', name: 'No', else: true, then: [] },
      ] },
    ],
  };
  assert.deepEqual(new Set(collectRequiredTags(ir2)), new Set(['vip', 'gold', 'silver']));
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
