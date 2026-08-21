import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from './catalog.mjs';
import { evaluateMergeTags, checkMergeTags } from './merge-tags.mjs';
const catalog = loadCatalog();
const M = catalog.mergeTags;
const tpl = (body) => [{ id: 's', type: 'sms', name: 'S', attributes: { body } }];

test('catalog: static tags + corpus-derived closed namespaces', () => {
  assert.ok(M.tags.length > 300);
  assert.ok(M.closedNamespaces.includes('right_now') && M.closedNamespaces.includes('user'));
  assert.ok(!M.closedNamespaces.includes('contact'), 'contact takes custom-field keys — must stay OPEN');
});

test('unknown key in a CLOSED namespace warns; open/dynamic namespaces never do; known tags pass', () => {
  assert.equal(evaluateMergeTags(tpl('Hi {{contact.first_name}}, it is {{right_now.day_of_week}}'), M).length, 0);
  assert.match(evaluateMergeTags(tpl('{{right_now.dayy_of_week}}'), M)[0].msg, /closed namespace 'right_now'/);
  assert.equal(evaluateMergeTags(tpl('{{contact.preferred_name}} {{opportunity.budget}} {{custom_webhook.1.response.url}} {{chatgpt.2.response}}'), M).length, 0);
});

test('unbalanced braces warn; checkMergeTags routes to ctx.warn and never throws', () => {
  assert.match(evaluateMergeTags(tpl('Hello {{contact.first_name}'), M)[0].msg, /unbalanced/);
  const warns = [];
  const r = checkMergeTags(tpl('{{user.nmae}}'), catalog, { warn: (m) => warns.push(m) });
  assert.equal(r.length, 1); assert.match(warns[0], /MERGE_TAG_SOFT/);
  assert.deepEqual(checkMergeTags(tpl('{{user.nmae}}'), catalog, { skipMergeTagCheck: true }), []);
});
