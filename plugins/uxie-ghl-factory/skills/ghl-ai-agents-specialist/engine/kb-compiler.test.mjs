import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRichTextDoc, compileRichTextDelete, AUTH_HEADER } from './kb-compiler.mjs';
import { IRError } from './convai-ir.mjs';

// Matches captures/knowledge-base-richtext.json's create request_body field-for-field.
const doc = {
  knowledgeBaseId: 'tJdoJJkFGwqhsWKmHLEd',
  title: 'TEST-CAP-KB',
  contentHtml: '<h2>TEST-CAP-KB Heading</h2><p>This is a <strong>bold</strong> word in a sentence.</p><ul><li>First item</li></ul>',
};

test('compileRichTextDoc: create body matches knowledge-base-richtext.json shape', () => {
  const { create, statusPoll, authHeader } = compileRichTextDoc(doc, { locationId: 'wdzEoUZnXO9tB3PPzcot' });
  assert.equal(create.method, 'POST');
  assert.equal(create.path, '/knowledge-base/rich-text/');
  assert.deepEqual(create.body, {
    locationId: 'wdzEoUZnXO9tB3PPzcot',
    knowledgeBaseId: 'tJdoJJkFGwqhsWKmHLEd',
    title: 'TEST-CAP-KB',
    content: doc.contentHtml,
  });
  assert.equal(statusPoll.method, 'GET');
  assert.equal(statusPoll.path, '/knowledge-base/rich-text/:id/status');
  assert.equal(authHeader, 'token-id');
  assert.equal(AUTH_HEADER, 'token-id');
});

test('compileRichTextDoc: content is passed through as raw HTML, not transformed', () => {
  const html = '<p>literal &amp; unescaped</p>';
  const { create } = compileRichTextDoc({ ...doc, contentHtml: html }, { locationId: 'LOC' });
  assert.equal(create.body.content, html);
});

test('compileRichTextDoc: empty content rejected', () => {
  assert.throws(() => compileRichTextDoc({ ...doc, contentHtml: '' }, { locationId: 'LOC' }),
    (e) => e instanceof IRError && e.code === 'EMPTY_CONTENT');
});

test('compileRichTextDoc: whitespace-only content rejected', () => {
  assert.throws(() => compileRichTextDoc({ ...doc, contentHtml: '   \n  ' }, { locationId: 'LOC' }),
    (e) => e.code === 'EMPTY_CONTENT');
});

test('compileRichTextDoc: missing content field rejected', () => {
  const { contentHtml, ...noContent } = doc;
  assert.throws(() => compileRichTextDoc(noContent, { locationId: 'LOC' }), (e) => e.code === 'EMPTY_CONTENT');
});

test('compileRichTextDoc: missing title rejected', () => {
  const { title, ...noTitle } = doc;
  assert.throws(() => compileRichTextDoc(noTitle, { locationId: 'LOC' }), (e) => e.code === 'SCHEMA');
});

test('compileRichTextDoc: empty-string title rejected', () => {
  assert.throws(() => compileRichTextDoc({ ...doc, title: '' }, { locationId: 'LOC' }), (e) => e.code === 'SCHEMA');
});

test('compileRichTextDoc: missing knowledgeBaseId rejected', () => {
  const { knowledgeBaseId, ...noKb } = doc;
  assert.throws(() => compileRichTextDoc(noKb, { locationId: 'LOC' }), (e) => e.code === 'SCHEMA');
});

// Matches knowledge-base-internal.md's delete op: DELETE /knowledge-base/rich-text/:id
test('compileRichTextDelete: builds delete descriptor', () => {
  const { method, path, authHeader } = compileRichTextDelete('V31wUySI8JZr4sytQCEL');
  assert.equal(method, 'DELETE');
  assert.equal(path, '/knowledge-base/rich-text/V31wUySI8JZr4sytQCEL');
  assert.equal(authHeader, 'token-id');
});

test('compileRichTextDelete: requires a non-empty id', () => {
  assert.throws(() => compileRichTextDelete(), (e) => e.code === 'MISSING_FIELD');
  assert.throws(() => compileRichTextDelete(''), (e) => e.code === 'MISSING_FIELD');
});
