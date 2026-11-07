// w7-2 QA follow-up: the compose path of build_funnel_page warns before the write, like the edit path does (bl-517).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = TOOLS.find((t) => t.name === 'build_funnel_page');
const deps = () => ({ state: {}, makeGw: () => ({ call: async () => { throw new Error('no network in a preview'); } }) });
const base = { locationId: 'LOC', funnelId: 'F1', pageId: 'P1', stepId: 'S1' };
const feature = { meta: 'image-feature' };

test('a compose preview with a class-level image radius rule reports builderSaveWouldChange', async () => {
  const r = await tool.handler({ ...base, pageStyles: '.image-feature img{border-radius:12px}',
    sections: [{ columns: [{ elements: [feature] }] }] }, deps());
  assert.equal(r.code, 'CONFIRM_REQUIRED');
  assert.ok(Array.isArray(r.data?.builderSaveWouldChange), 'the compose preview names the drift before any write');
  assert.equal(r.data.builderSaveWouldChange[0].written, '12px');
  assert.equal(r.data.builderSaveWouldChange[0].builderWouldWrite, '0px');
  // A composed image node carries its own styles.borderRadius default (0px), so that is the native key the fix sets.
  assert.equal(r.data.builderSaveWouldChange[0].nativeKey, 'styles.borderRadius');
});

test('a compose preview with no radius rule reports no drift', async () => {
  const r = await tool.handler({ ...base, sections: [{ columns: [{ elements: [feature] }] }] }, deps());
  assert.equal(r.code, 'CONFIRM_REQUIRED');
  assert.equal(r.data?.builderSaveWouldChange, undefined);
});
