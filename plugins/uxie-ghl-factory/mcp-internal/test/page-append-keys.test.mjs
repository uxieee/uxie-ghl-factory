// w7-1 QA: the append keys are page-op keys. A caller's appendCss / appendHeaderCode / appendFooterCode on any other op is
// refused by build_funnel_page before anything is written. The font path's own internal appendCss on a set op still works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { appendKeyRefusal, PAGE_APPEND_KEYS } from '../core/page-edit.mjs';

const tool = TOOLS.find((t) => t.name === 'build_funnel_page');
const base = { locationId: 'LOC', funnelId: 'F1', pageId: 'P1', stepId: 'S1', stepName: 'Landing', confirm: true };

// A recording gateway: the funnel names step S1 "Landing" with page P1, the page has one section; other calls are recorded.
const deps = (calls) => ({
  state: {},
  makeGw: () => ({
    uid: 'USER1',
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (path.startsWith('/funnels/funnel/fetch')) return { ok: true, status: 200, json: { steps: [{ id: 'S1', name: 'Landing', pages: ['P1'] }] } };
      if (path.startsWith('/funnels/builder/page/data')) return { ok: true, status: 200, json: { sections: [{ id: 'S-1', elements: [] }] } };
      throw new Error(`unexpected call ${method} ${path}`);
    },
  }),
});

test('appendKeyRefusal refuses every append key on a non-page op, names the key and the op, and passes page ops', () => {
  for (const op of ['set', 'insert', 'move', 'clone', 'remove-node', 'append-section']) {
    for (const key of PAGE_APPEND_KEYS) {
      const msg = appendKeyRefusal({ op, nodeId: 'n1', [key]: '.x{}' }, 2);
      assert.ok(msg, `${op} with ${key} must be refused`);
      assert.match(msg, new RegExp(`edits\\[2\\]: ${key} is a page op key`));
      assert.match(msg, new RegExp(`a ${op} op`));
    }
  }
  assert.equal(appendKeyRefusal({ op: 'page', appendCss: '.x{}' }, 0), null);
  assert.equal(appendKeyRefusal({ op: 'set', nodeId: 'n1', extra: {} }, 0), null, 'an edit with no append key is not refused');
});

test('build_funnel_page refuses appendCss on a set op with VALIDATION_FAILED and writes nothing', async () => {
  const calls = [];
  const res = await tool.handler({ ...base, edits: [{ op: 'set', nodeId: 'n1', appendCss: '.x{color:red}' }] }, deps(calls));
  assert.equal(res.ok, false);
  assert.equal(res.code, 'VALIDATION_FAILED');
  assert.match(res.detail, /edits\[0\]: appendCss is a page op key and a set op does not take it/);
  assert.ok(!calls.some((c) => c.path.startsWith('/funnels/builder/autosave/')), 'no autosave: nothing is written');
});

test('build_funnel_page refuses appendHeaderCode and appendFooterCode on other ops too', async () => {
  for (const key of ['appendHeaderCode', 'appendFooterCode']) {
    const calls = [];
    const res = await tool.handler({ ...base, edits: [{ op: 'remove-node', nodeId: 'n1', [key]: '<!--x-->' }] }, deps(calls));
    assert.equal(res.code, 'VALIDATION_FAILED', key);
    assert.match(res.detail, new RegExp(`${key} is a page op key and a remove-node op`));
    assert.ok(!calls.some((c) => c.path.startsWith('/funnels/builder/autosave/')), key);
  }
});
