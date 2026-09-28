// bl-282: build_funnel_page read only the element-spec keys it knew and dropped the rest, so a button given `text:`
// instead of `html:` was stored with empty text (an empty bar in the builder) while every write answered 201
// (knowledge sniffs/funnels-wave19-tool-drift-2026-09-29/live-tool.build_funnel_page.unknown-key-dropped.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { elementSpecProblem, elementSpecKeys } from '../core/element-spec.mjs';
import { ELEMENTS } from '../core/funnel-pages.mjs';

test('the allow-list is read off the registry: html only where the kind stores text, openPopup only where it has popupId', () => {
  assert.ok(elementSpecKeys('button').includes('html'));
  assert.ok(elementSpecKeys('button').includes('hoverAnimation'));
  assert.ok(!elementSpecKeys('image').includes('html'), 'an image has no text prop');
  assert.ok(!elementSpecKeys('heading').includes('hoverAnimation'));
  for (const meta of Object.keys(ELEMENTS)) {
    assert.equal(elementSpecKeys(meta).includes('html'), ELEMENTS[meta].extraProps.includes('text'), meta);
  }
});

test('control: every key the tool reads passes; `text` on a button is refused with "did you mean html"', () => {
  assert.equal(elementSpecProblem({ meta: 'button', html: 'Go', css: { background: '#0a0' }, styles: {}, extra: {}, hoverAnimation: { name: 'grow' }, openPopup: 'P' }), null);
  assert.equal(elementSpecProblem({ meta: 'heading', html: '<h1>x</h1>', font: 'headline', tag: 'h1', entranceAnimation: { name: 'fadeIn' } }), null);
  assert.match(elementSpecProblem({ meta: 'button', text: 'Go' }), /unknown key `text` — did you mean html\?.*Keys button takes: meta, html/);
  assert.match(elementSpecProblem({ meta: 'image', html: 'x' }), /`html` is not offered on image/);
  assert.equal(elementSpecProblem({ meta: 'nope', text: 1 }), null, 'an unknown meta is makeLeaf\'s refusal, not this one');
});

test('build_funnel_page refuses an unknown element key before any write, in sections and in popups', async () => {
  const calls = [];
  const deps = { state: {}, makeGw: () => ({ uid: 'U', call: async (m, p) => { calls.push({ m, p }); return { ok: true, status: 200, json: {} }; } }) };
  const tool = TOOLS.find((t) => t.name === 'build_funnel_page');
  const r = await tool.handler({ locationId: 'L', funnelId: 'F', pageId: 'P', stepId: 'S', confirm: true,
    sections: [{ columns: [{ elements: [{ meta: 'button', text: 'Bare button' }] }] }] }, deps);
  assert.equal(r.code, 'VALIDATION_FAILED');
  assert.match(JSON.stringify(r), /did you mean html/);
  const p = await tool.handler({ locationId: 'L', funnelId: 'F', pageId: 'P', stepId: 'S', confirm: true,
    sections: [{ columns: [{ elements: [{ meta: 'heading', html: '<h1>x</h1>' }] }] }],
    popups: [{ name: 'P1', columns: [{ elements: [{ meta: 'paragraph', content: 'hi' }] }] }] }, deps);
  assert.equal(p.code, 'VALIDATION_FAILED');
  assert.match(JSON.stringify(p), /unknown key `content`/);
  assert.ok(!calls.some((c) => c.m !== 'GET'), 'nothing was written');
});
