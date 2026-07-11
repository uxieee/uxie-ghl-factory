// Deterministic compiler: Knowledge-Base IR -> GHL internal /knowledge-base/* payloads,
// for all three captured content-source types (rich text, tables, files). Ground truth:
//   research/ai-agents-internal/knowledge-base-internal.md
//   research/ai-agents-internal/captures/knowledge-base-richtext.json
//   research/ai-agents-internal/captures/knowledge-base-tables-files.json
// (ghl-workflow-api-docs repo). This module produces request DESCRIPTORS
// ({method, path, body}) — it never makes a live HTTP call, and (for Tables/Files) never
// builds actual multipart bodies: uploads are inherently binary (a real CSV/PDF/DOCX file
// on disk), so those descriptors describe the request shape (method, path, content-type,
// and — where captured — the JSON-body fields) and leave attaching the actual file bytes
// to the caller/executor. Auth is `token-id` (NOT `Authorization: Bearer`), same as the
// ConvAI compiler; the caller attaches the header value.
import { IRError } from './convai-ir.mjs';

export const AUTH_HEADER = 'token-id';

// Full validation for a rich-text KB doc. Required: knowledgeBaseId, title
// (non-empty string), contentHtml (non-empty HTML string — the capture shows
// this is raw TipTap/ProseMirror HTML, NOT markdown or plain text).
function parseRichTextDocIR(doc) {
  if (!doc || typeof doc !== 'object') throw new IRError('SCHEMA', 'rich-text doc must be an object');
  if (typeof doc.knowledgeBaseId !== 'string' || doc.knowledgeBaseId.length === 0)
    throw new IRError('SCHEMA', 'knowledgeBaseId must be a non-empty string');
  if (typeof doc.title !== 'string' || doc.title.length === 0)
    throw new IRError('SCHEMA', 'title must be a non-empty string');
  if (typeof doc.contentHtml !== 'string' || doc.contentHtml.trim().length === 0)
    throw new IRError('EMPTY_CONTENT', 'contentHtml must be a non-empty HTML string');
  return { ...doc };
}

// POST /knowledge-base/rich-text/ — body: {locationId, knowledgeBaseId, title, content}
// (knowledge-base-richtext.json's request_body). `content` carries the caller's HTML
// verbatim (server persists it as-is and separately derives `contentMarkdown` — that
// derivation is server-side only, not something this compiler reproduces).
//
// Create is async: the response comes back `status:"training"`; the caller must poll
// `statusPoll` (GET .../:id/status, `id` filled in by the caller once known) until the
// polled `status` is `"trained"`.
export function compileRichTextDoc(doc, { locationId } = {}) {
  const norm = parseRichTextDocIR(doc);
  const body = {
    locationId,
    knowledgeBaseId: norm.knowledgeBaseId,
    title: norm.title,
    content: norm.contentHtml,
  };
  return {
    create: { method: 'POST', path: '/knowledge-base/rich-text/', body },
    statusPoll: { method: 'GET', path: '/knowledge-base/rich-text/:id/status' },
    authHeader: AUTH_HEADER,
  };
}

// DELETE /knowledge-base/rich-text/:id (knowledge-base-internal.md's delete op).
export function compileRichTextDelete(id) {
  if (typeof id !== 'string' || id.length === 0) throw new IRError('MISSING_FIELD', 'compileRichTextDelete requires a non-empty id');
  return { method: 'DELETE', path: `/knowledge-base/rich-text/${id}`, authHeader: AUTH_HEADER };
}

// ============================================================================
// KB Tables (CSV-only content source; captures/knowledge-base-tables-files.json's
// `tables` section). The UI wizard is a 3-step async pipeline — upload -> schema
// auto-detect -> select-columns (which actually queues the Parquet conversion) — so
// this compiler returns one descriptor per step. `fileId` is server-assigned on the
// upload response, so every step after upload uses a literal `:fileId` path
// placeholder for the caller to fill in once known (same pattern as
// compileRichTextDoc's statusPoll above).
// ============================================================================

const TABLE_SELECT_COLUMNS_PROCESSING_OPTIONS_DEFAULT = { chunkSize: 1000, compressionType: 'snappy' };

function parseKbTableUploadIR({ knowledgeBaseId, csvFilename } = {}) {
  if (typeof knowledgeBaseId !== 'string' || knowledgeBaseId.length === 0)
    throw new IRError('SCHEMA', 'knowledgeBaseId must be a non-empty string');
  if (typeof csvFilename !== 'string' || csvFilename.length === 0)
    throw new IRError('SCHEMA', 'csvFilename must be a non-empty string');
  return { knowledgeBaseId, csvFilename };
}

// compileKbTableUpload — the full Tables pipeline, one descriptor per captured step:
//   1. upload         POST .../upload (multipart) -> {fileId, name, ...}
//   2. schema         GET  .../:fileId/schema      -> auto-detected column schema
//   3. selectColumns  POST .../:fileId/select-columns -> finalizes schema, queues Parquet
//   4. parquetStatus  GET  .../:fileId/parquet-status  -> poll until COLUMNS_VALIDATED/READY
//   5. summary        GET  .../:fileId/summary         -> feeds the wizard's Summary step
//   6. delete         DELETE .../:fileId
// This module never builds the multipart body itself — the note on `upload` documents
// what the caller must supply. `selectColumns`'s body is a template, not a literal
// request body: the capture shows `selectedColumns` must be the (possibly caller-edited)
// `availableColumns` array from the `schema` response — this compiler has no network
// access to fetch that response, so it cannot fill the array in for the caller.
export function compileKbTableUpload(input, { locationId } = {}) {
  const { knowledgeBaseId, csvFilename } = parseKbTableUploadIR(input);
  const base = `/knowledge-base/table/location/${locationId}/kb/${knowledgeBaseId}`;
  return {
    upload: {
      method: 'POST',
      path: `${base}/upload`,
      contentType: 'multipart/form-data',
      // NOTE (knowledge-base-tables-files.json): the capture confirms the file is one
      // multipart part and the table `name` is a form field (defaults to the filename
      // minus its extension) — locationId/knowledgeBaseId are path params, not body
      // fields. The caller supplies the actual CSV file bytes; this descriptor only
      // carries the known non-binary form field.
      body: { name: csvFilename.replace(/\.csv$/i, '') },
    },
    schema: { method: 'GET', path: `${base}/:fileId/schema` },
    selectColumns: {
      method: 'POST',
      path: `${base}/:fileId/select-columns`,
      contentType: 'application/json',
      // Template, not a literal body — see the function doc comment above. The caller
      // must supply `selectedColumns` (the `schema` response's `availableColumns`
      // array, or a caller-edited subset/retype of it); `processingOptions` defaults to
      // the capture's observed values (chunkSize is client-supplied and NOT echoed back
      // server-side per the capture's notes — only compressionType persists).
      bodyTemplate: {
        selectedColumns: null, // caller fills in: array of {name, originalType, selectedType, isSelected, sampleValue, displayName, searchable, required}
        processingOptions: { ...TABLE_SELECT_COLUMNS_PROCESSING_OPTIONS_DEFAULT },
      },
    },
    parquetStatus: { method: 'GET', path: `${base}/:fileId/parquet-status` },
    summary: { method: 'GET', path: `${base}/:fileId/summary` },
    delete: { method: 'DELETE', path: `${base}/:fileId` },
    authHeader: AUTH_HEADER,
  };
}

// ============================================================================
// KB Files (PDF/DOC/DOCX/MD content source; captures/knowledge-base-tables-files.json's
// `files` section). Unlike Tables, one multipart POST does everything — upload AND
// register the KB file record — so there is no separate finalize step. Processing is
// async and goes through MORE pipeline stages than rich-text/tables (CONVERSION ->
// EXTRACTION -> CHUNKING -> EMBEDDING), polled via the status endpoint.
// ============================================================================

function parseKbFileUploadIR({ knowledgeBaseId, filename, mimeType } = {}) {
  if (typeof knowledgeBaseId !== 'string' || knowledgeBaseId.length === 0)
    throw new IRError('SCHEMA', 'knowledgeBaseId must be a non-empty string');
  if (typeof filename !== 'string' || filename.length === 0)
    throw new IRError('SCHEMA', 'filename must be a non-empty string');
  if (typeof mimeType !== 'string' || mimeType.length === 0)
    throw new IRError('SCHEMA', 'mimeType must be a non-empty string');
  return { knowledgeBaseId, filename, mimeType };
}

// compileKbFileUpload — the Files pipeline:
//   1. upload  POST /knowledge-base/files (multipart) -> {fileId, url, folderPath}
//   2. status  GET  /knowledge-base/files/:fileId/status -> poll pipeline stages
//   3. delete  DELETE /knowledge-base/files/:fileId
// TODO/best-effort: the capture explicitly notes the exact multipart FIELD names for
// locationId/knowledgeBaseId/the file itself were NOT visible via the network inspector
// (binary form-data body not rendered as text by the capture tooling) — `bodyFieldsBestEffort`
// below is an unverified guess at conventional field names, NOT a proven wire contract.
// The endpoint (POST /knowledge-base/files, no path params — unlike Tables) and the
// status/delete flow ARE accurately captured.
export function compileKbFileUpload(input, { locationId } = {}) {
  const { knowledgeBaseId, filename, mimeType } = parseKbFileUploadIR(input);
  return {
    upload: {
      method: 'POST',
      path: '/knowledge-base/files',
      contentType: 'multipart/form-data',
      // TODO/best-effort — see the function doc comment above.
      bodyFieldsBestEffort: { locationId, knowledgeBaseId, file: filename, mimeType },
    },
    status: { method: 'GET', path: '/knowledge-base/files/:fileId/status' },
    delete: { method: 'DELETE', path: '/knowledge-base/files/:fileId' },
    authHeader: AUTH_HEADER,
  };
}
