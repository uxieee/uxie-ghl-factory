// Deterministic compiler: Knowledge-Base rich-text IR -> GHL internal
// /knowledge-base/rich-text/* payloads. Ground truth:
//   research/ai-agents-internal/knowledge-base-internal.md
//   research/ai-agents-internal/captures/knowledge-base-richtext.json
// (ghl-workflow-api-docs repo). This module produces request DESCRIPTORS
// ({method, path, body}) — it never makes a live HTTP call. Auth is `token-id`
// (NOT `Authorization: Bearer`), same as the ConvAI compiler; the caller
// attaches the header value.
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
