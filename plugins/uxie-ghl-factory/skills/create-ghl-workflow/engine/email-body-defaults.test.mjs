// Email BODY fallbacks are read at send from the inline data-cv-defaults attribute on the html's FIRST tag, not from
// attributes.htmlDefaults: an API-written map alone rendered the tag empty (live 2026-09-28, knowledge
// sniffs/workflows-wave1-2026-09-25/live-3AD-mergetags.json), the attribute rendered :0 and :1 each in place
// (live-3AE-inline-cv-defaults.json). The compiler writes the builder's shape (Email.ts:1102-1105): orphans cleaned, map + attribute.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { loadCatalog } from './catalog.mjs';
import { applyHtmlDefaults, findVariableOccurrences } from './email-defaults.mjs';

const compileEmail = (attributes) => {
  let n = 0; const warnings = [];
  const t = compile({ name: 'wf', triggers: [], graph: [{ ref: 'e', kind: 'action', type: 'email', name: 'E', attributes }] },
    { loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: () => `id-${++n}`, catalog: loadCatalog(), warn: (m) => warnings.push(m) })
    .autoSaveBody.workflowData.templates[0];
  return { a: t.attributes, warnings };
};
const attr = (html) => JSON.parse(html.match(/data-cv-defaults='([^']*)'/)[1].replace(/&#39;/g, "'").replace(/&amp;/g, '&'));

test('htmlDefaults is written into the html as data-cv-defaults on the first tag, and kept as the map', () => {
  const html = '<p>A=[{{contact.company_name}}] B=[{{contact.company_name}}]</p><p>{{contact.first_name}}</p>';
  const map = { 'contact.company_name:0': 'X0', 'contact.company_name:1': 'X1' };
  const { a } = compileEmail({ subject: 's', html, htmlDefaults: map });
  // control: the authored html carries no attribute, so passing it through (main before this change) sends an inert map
  assert.equal(/data-cv-defaults/.test(html), false);
  assert.match(a.html, /^<p data-cv-defaults='[^']*'>A=\[/);
  assert.deepEqual(attr(a.html), map);
  assert.deepEqual(a.htmlDefaults, map);
  assert.equal(a.html.match(/data-cv-defaults/g).length, 1);
});

test('orphaned keys are dropped from both, with a warning', () => {
  const { a, warnings } = compileEmail({ subject: 's', html: '<p>{{contact.company_name}}</p>',
    htmlDefaults: { 'contact.company_name:0': 'X', 'contact.company_name:1': 'gone', 'contact.city:0': 'gone' } });
  assert.deepEqual(a.htmlDefaults, { 'contact.company_name:0': 'X' });
  assert.deepEqual(attr(a.html), { 'contact.company_name:0': 'X' });
  assert.ok(warnings.some((w) => /htmlDefaults/.test(w) && /contact\.company_name:1/.test(w) && /contact\.city:0/.test(w)), warnings.join('\n'));
});

test('an attribute already in the html with no map is kept, and seeds the map (the drawer does the same on open)', () => {
  const html = `<p data-cv-defaults='{"contact.company_name:0":"Keep"}'>{{contact.company_name}}</p>`;
  const { a } = compileEmail({ subject: 's', html });
  assert.deepEqual(attr(a.html), { 'contact.company_name:0': 'Keep' });
  assert.deepEqual(a.htmlDefaults, { 'contact.company_name:0': 'Keep' });
});

test('a stale attribute is replaced by the authored map, never duplicated', () => {
  const html = `<div data-cv-defaults='{"contact.company_name:0":"Old"}'><p>{{contact.company_name}}</p></div>`;
  const { a } = compileEmail({ subject: 's', html, htmlDefaults: { 'contact.company_name:0': 'New' } });
  assert.equal(a.html.match(/data-cv-defaults/g).length, 1);
  assert.deepEqual(attr(a.html), { 'contact.company_name:0': 'New' });
});

test('no map and no attribute: html is sent byte-identical', () => {
  const html = '<p>Hi {{contact.first_name}}</p>';
  const { a } = compileEmail({ subject: 's', html });
  assert.equal(a.html, html);
  assert.deepEqual(a.htmlDefaults, {});
});

test('occurrence index is per variable (a tag inside {{#if}} counts, as in the builder); helper tags, {{default …}}, this.* and #each bodies are skipped; no tag text is touched', () => {
  const html = '<p>{{#if contact.x}}{{contact.company_name}}{{/if}} {{default contact.company_name "D"}} {{#each items}}{{contact.company_name}}{{/each}} {{contact.company_name}} {{this.name}}</p>';
  assert.deepEqual(findVariableOccurrences(html).map((o) => `${o.variable}:${o.occurrenceIndex}`), ['contact.company_name:0', 'contact.company_name:1']);
  const map = { 'contact.company_name:0': 'A', 'contact.company_name:1': 'B', 'contact.company_name:2': 'orphan' };
  const out = applyHtmlDefaults(html, map);
  assert.deepEqual(out.htmlDefaults, { 'contact.company_name:0': 'A', 'contact.company_name:1': 'B' });
  assert.equal(out.html.replace(/ data-cv-defaults='[^']*'/, ''), html); // only the attribute is added; no tag text changes
});

test("a value with ' and & is entity-escaped inside the single-quoted attribute", () => {
  const { a } = compileEmail({ subject: 's', html: '<p>{{contact.company_name}}</p>', htmlDefaults: { 'contact.company_name:0': "O'Brien & Co" } });
  assert.match(a.html, /&#39;/); assert.match(a.html, /&amp;/);
  assert.deepEqual(attr(a.html), { 'contact.company_name:0': "O'Brien & Co" });
});

test('template-mode email (template_id) is untouched: no html, no htmlDefaults', () => {
  const { a } = compileEmail({ subject: 's', template_id: 'T1', htmlDefaults: { 'x:0': 'y' } });
  assert.equal(a.html, undefined); assert.equal(a.htmlDefaults, undefined);
});
