import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDynamicText, DTR_TRANSFORMS } from '../core/dynamic-text.mjs';
import { makeLeaf, makeColumn, makeSection, buildPageData, resetIds, val } from '../core/funnel-pages.mjs';
import { applyPageEdits, findNode, verifyEdits } from '../core/page-edit.mjs';
import { elementSpecProblem } from '../core/element-spec.mjs';

test('the pill is the builder\'s measured shape and extra.dtr carries default / transform / normalize', () => {
  const r = applyDynamicText('<p>Hello {{query_param.f10_name}}!</p>', { f10_name: { default: 'friend', transform: 'upper' } });
  assert.equal(r.html, '<p>Hello <span data-dtr-token="f10_name" data-dtr-default="friend" data-dtr-transform="upper" class="dtr-token">{{ query_param.f10_name }}</span>!</p>');
  assert.deepEqual(r.dtr, { f10_name: { default: 'friend', transform: 'upper', normalize: true } });
});

test('defaults, escaping, repeated placeholders, and normalize:false', () => {
  const r = applyDynamicText('<p>{{ query_param.a }} and {{query_param.a}}</p>', { a: { default: 'say "hi" <b>', normalize: false } });
  assert.equal((r.html.match(/data-dtr-token="a"/g) ?? []).length, 2);
  assert.match(r.html, /data-dtr-default="say &quot;hi&quot; &lt;b&gt;" data-dtr-transform="none"/);
  assert.deepEqual(r.dtr.a, { default: 'say "hi" <b>', transform: 'none', normalize: false });
});

test('refusals: bad name, unknown transform, missing placeholder, empty spec', () => {
  assert.throws(() => applyDynamicText('<p>{{query_param.a b}}</p>', { 'a b': {} }), /not a URL parameter name/);
  assert.throws(() => applyDynamicText('<p>{{query_param.a}}</p>', { a: { transform: 'shout' } }), new RegExp(`one of ${DTR_TRANSFORMS.join(', ')}`));
  assert.throws(() => applyDynamicText('<p>plain</p>', { a: {} }), /no \{\{query_param\.a\}\} placeholder/);
  assert.throws(() => applyDynamicText('<p>x</p>', {}), /give an object/);
});

test('a second call updates a pill already in the text instead of failing', () => {
  const one = applyDynamicText('<p>{{query_param.a}}</p>', { a: { default: 'x', transform: 'upper' } });
  const two = applyDynamicText(one.html, { a: { default: 'y', transform: 'lower' } });
  assert.match(two.html, /data-dtr-default="y" data-dtr-transform="lower"/);
  assert.equal((two.html.match(/data-dtr-token/g) ?? []).length, 1);
});

const fixture = () => {
  resetIds();
  const p = makeLeaf({ meta: 'paragraph', extra: { text: val('<p>Hi {{query_param.who}}</p>') } });
  const h = makeLeaf({ meta: 'button', extra: { text: val('Go') } });
  const col = makeColumn({ children: [p, h], widthPct: 100 });
  const section = makeSection({ columns: [{ col, leaves: [p, h], widthPct: 100 }], pageId: 'P', funnelId: 'F', locationId: 'L' });
  return { p, h, data: buildPageData({ pageId: 'P', stepId: 'S', funnelId: 'F', locationId: 'L', sections: [section] }) };
};

test('set dynamicText writes the pill and extra.dtr, verifies by value, and refuses other kinds', () => {
  const { p, h, data } = fixture();
  const { pageData, report, errors } = applyPageEdits(data, [{ op: 'set', nodeId: p.id, dynamicText: { who: { default: 'there', transform: 'title' } } }]);
  assert.deepEqual(errors, []);
  const n = findNode(pageData, p.id).node;
  assert.match(n.extra.text.value, /data-dtr-token="who" data-dtr-default="there" data-dtr-transform="title"/);
  assert.deepEqual(n.extra.dtr, { who: { default: 'there', transform: 'title', normalize: true } });
  assert.equal(verifyEdits(pageData, report)[0].applied, true);
  const bad = applyPageEdits(data, [{ op: 'set', nodeId: h.id, dynamicText: { who: {} } }]);
  assert.match(JSON.stringify(bad.errors), /not on button/);
});

test('the element spec takes title and dynamicText (paragraph, heading, sub-heading only); `name` points to title', () => {
  assert.equal(elementSpecProblem({ meta: 'paragraph', html: '<p>x</p>', title: 'Intro', dynamicText: { a: {} } }), null);
  assert.match(elementSpecProblem({ meta: 'button', html: 'x', dynamicText: {} }), /`dynamicText` is not offered on button/);
  assert.match(elementSpecProblem({ meta: 'paragraph', name: 'x' }), /did you mean title/);
});
