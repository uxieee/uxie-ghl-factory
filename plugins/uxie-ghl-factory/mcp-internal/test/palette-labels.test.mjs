// A `colors` entry that reuses a built-in label with another value is refused: a builder save relabels it and restores the
// built-in value (measured live, knowledge sniffs/funnels-wave32-kindcss-live-2026-09-30). A custom label passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = TOOLS.find((t) => t.name === 'build_funnel_page');
const deps = { state: {}, makeGw: () => ({ uid: 'U', call: async () => ({ ok: true, status: 200, json: {} }) }) };
const base = { locationId: 'LOC', funnelId: 'F1', pageId: 'P1', stepId: 'S1', sections: [{ columns: [{ elements: [{ meta: 'heading', html: 'x' }] }] }] };

test('a built-in label with another value is refused, naming the label and the way out', async () => {
  const r = await tool.handler({ ...base, colors: [{ label: 'Primary', value: '#7a2fd0' }] }, deps);
  assert.equal(r.code, 'VALIDATION_FAILED');
  assert.match(r.detail, /"Primary" is a built-in palette colour given another value/);
  assert.match(JSON.stringify(r), /custom colour its own single-word label/);
});
test('the built-in label with its own value, and a custom label, pass', async () => {
  for (const colors of [[{ label: 'Primary', value: '#37ca37' }], [{ label: 'Brand', value: '#7a2fd0' }], [{ label: 'primary', value: '#37CA37' }]]) {
    const r = await tool.handler({ ...base, colors }, deps);
    assert.notEqual(r.code, 'VALIDATION_FAILED', JSON.stringify(r).slice(0, 300));
  }
});
