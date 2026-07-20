import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRichTextDoc, compileRichTextDelete, compileKbTableUpload, compileKbFileUpload, AUTH_HEADER } from './kb-compiler.mjs';
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
  assert.equal(authHeader, 'ai');
  assert.equal(AUTH_HEADER, 'ai');
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
  assert.equal(authHeader, 'ai');
});

test('compileRichTextDelete: requires a non-empty id', () => {
  assert.throws(() => compileRichTextDelete(), (e) => e.code === 'MISSING_FIELD');
  assert.throws(() => compileRichTextDelete(''), (e) => e.code === 'MISSING_FIELD');
});

// --- compileKbTableUpload (captures/knowledge-base-tables-files.json's `tables` section) --

const KB_ID = 'tJdoJJkFGwqhsWKmHLEd';
const LOCATION_ID = 'wdzEoUZnXO9tB3PPzcot';

test('compileKbTableUpload: upload descriptor matches knowledge-base-tables-files.json shape', () => {
  const { upload, authHeader } = compileKbTableUpload({ knowledgeBaseId: KB_ID, csvFilename: 'TEST-CAP-TABLE.csv' }, { locationId: LOCATION_ID });
  assert.equal(upload.method, 'POST');
  assert.equal(upload.path, `/knowledge-base/table/location/${LOCATION_ID}/kb/${KB_ID}/upload`);
  assert.equal(upload.contentType, 'multipart/form-data');
  assert.equal(upload.body.name, 'TEST-CAP-TABLE');
  assert.equal(authHeader, 'ai');
  assert.equal(AUTH_HEADER, 'ai');
});

test('compileKbTableUpload: schema/selectColumns/parquetStatus/summary/delete descriptors use the :fileId placeholder', () => {
  const base = `/knowledge-base/table/location/${LOCATION_ID}/kb/${KB_ID}`;
  const d = compileKbTableUpload({ knowledgeBaseId: KB_ID, csvFilename: 'data.csv' }, { locationId: LOCATION_ID });
  assert.equal(d.schema.method, 'GET');
  assert.equal(d.schema.path, `${base}/:fileId/schema`);
  assert.equal(d.selectColumns.method, 'POST');
  assert.equal(d.selectColumns.path, `${base}/:fileId/select-columns`);
  assert.deepEqual(d.selectColumns.bodyTemplate.processingOptions, { chunkSize: 1000, compressionType: 'snappy' });
  assert.equal(d.selectColumns.bodyTemplate.selectedColumns, null);
  assert.equal(d.parquetStatus.method, 'GET');
  assert.equal(d.parquetStatus.path, `${base}/:fileId/parquet-status`);
  assert.equal(d.summary.method, 'GET');
  assert.equal(d.summary.path, `${base}/:fileId/summary`);
  assert.equal(d.delete.method, 'DELETE');
  assert.equal(d.delete.path, `${base}/:fileId`);
});

test('compileKbTableUpload: rejects missing knowledgeBaseId', () => {
  assert.throws(() => compileKbTableUpload({ csvFilename: 'x.csv' }, { locationId: LOCATION_ID }), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('compileKbTableUpload: rejects missing csvFilename', () => {
  assert.throws(() => compileKbTableUpload({ knowledgeBaseId: KB_ID }, { locationId: LOCATION_ID }), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

// --- compileKbFileUpload (captures/knowledge-base-tables-files.json's `files` section) ----

test('compileKbFileUpload: upload descriptor matches knowledge-base-tables-files.json shape', () => {
  const { upload, status, delete: del, authHeader } = compileKbFileUpload(
    { knowledgeBaseId: KB_ID, filename: 'TEST-CAP-FILE.md', mimeType: 'text/markdown' },
    { locationId: LOCATION_ID },
  );
  assert.equal(upload.method, 'POST');
  assert.equal(upload.path, '/knowledge-base/files');
  assert.equal(upload.contentType, 'multipart/form-data');
  assert.deepEqual(upload.bodyFieldsBestEffort, { locationId: LOCATION_ID, knowledgeBaseId: KB_ID, file: 'TEST-CAP-FILE.md', mimeType: 'text/markdown' });
  assert.equal(status.method, 'GET');
  assert.equal(status.path, '/knowledge-base/files/:fileId/status');
  assert.equal(del.method, 'DELETE');
  assert.equal(del.path, '/knowledge-base/files/:fileId');
  assert.equal(authHeader, 'ai');
});

test('compileKbFileUpload: rejects missing knowledgeBaseId', () => {
  assert.throws(() => compileKbFileUpload({ filename: 'x.md', mimeType: 'text/markdown' }, { locationId: LOCATION_ID }), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('compileKbFileUpload: rejects missing filename', () => {
  assert.throws(() => compileKbFileUpload({ knowledgeBaseId: KB_ID, mimeType: 'text/markdown' }, { locationId: LOCATION_ID }), (e) => e instanceof IRError && e.code === 'SCHEMA');
});

test('compileKbFileUpload: rejects missing mimeType', () => {
  assert.throws(() => compileKbFileUpload({ knowledgeBaseId: KB_ID, filename: 'x.md' }, { locationId: LOCATION_ID }), (e) => e instanceof IRError && e.code === 'SCHEMA');
});
