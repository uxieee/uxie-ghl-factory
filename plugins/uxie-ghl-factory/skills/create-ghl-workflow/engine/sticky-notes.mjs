// STICKY NOTES — the canvas note layer, as a contract.
//
// A sticky note is a SEPARATE resource from the workflow document (the builder creates it the
// moment it is placed on the canvas, not on save). Source: services/api/sticky-notes.ts +
// hooks/api/use-sticky-notes.ts (recovered 2026-08-22 from the use-sticky-notes chunk), the
// sticky-note node component (tiptap editor, 5,000-char cap, 10 colour swatches), and LIVE:
//   POST  /workflows/sticky-note?locationId={loc}   {color,content,positionX,positionY,width,height,workflowId,locationId} → 201
//   PATCH /workflows/sticky-note?_id={id}&locationId={loc}   partial {content?,color?,positionX?,positionY?,width?,height?} → 200
//   GET   /workflows/sticky-notes-all?workflowId={wid}&locationId={loc} → {data:[…],count}
//   (PUT /workflows/sticky-note/{id} 404s — there is no path-segment form for any verb.)
// Not exercised here: DELETE /workflows/sticky-note?_id=&locationId= (soft delete, server-side).
//
// IR surface: `stickyNotes: [{ content, color?, x?, y?, width?, height? }]` at the top level of a
// build, and the edit op `{ op:'addStickyNote', note:{…} }` / `{ op:'updateStickyNote', noteId, note:{…} }`.
import { IRError } from './ir.mjs';

export const STICKY_COLORS = ['yellow', 'blue', 'green', 'orange', 'cyan', 'gray', 'teal', 'purple', 'fuchsia', 'rose'];
export const STICKY_DEFAULTS = Object.freeze({ color: 'yellow', width: 400, height: 400, x: 320, y: 180 });
export const STICKY_MIN = Object.freeze({ width: 150, height: 80 });
export const STICKY_MAX_CONTENT = 5000;
const NOTE_KEYS = new Set(['content', 'color', 'x', 'y', 'width', 'height', 'positionX', 'positionY', 'ref']);

const escapeHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const looksLikeHtml = (t) => /^\s*<[a-z!]/i.test(t);   // authored HTML starts with a tag; '<c>' mid-sentence is text

/** Validate one authored note → the exact create/patch body fields (minus ids). */
export function normalizeStickyNote(note, { partial = false, skipStickyCheck = false } = {}) {
  const refuse = (msg) => { if (!skipStickyCheck) throw new IRError('STICKY_NOTE', msg); };
  if (!note || typeof note !== 'object' || Array.isArray(note)) { refuse(`a sticky note must be an object {content, color?, x?, y?, width?, height?}`); return {}; }
  const unknown = Object.keys(note).filter((k) => !NOTE_KEYS.has(k));
  if (unknown.length) refuse(`sticky note has unknown key(s) [${unknown.join(', ')}] — known: content, color, x, y, width, height`);
  const out = {};
  if (note.content !== undefined || !partial) {
    if (typeof note.content !== 'string') refuse(`sticky note 'content' must be a string (plain text is wrapped in <p>…</p>; HTML is kept as-is)`);
    const raw = typeof note.content === 'string' ? note.content : '';
    out.content = raw === '' ? '' : (looksLikeHtml(raw) ? raw : `<p>${escapeHtml(raw)}</p>`);
    if (out.content.length > STICKY_MAX_CONTENT) refuse(`sticky note content is ${out.content.length} chars; the editor caps it at ${STICKY_MAX_CONTENT}`);
  }
  if (note.color !== undefined || !partial) {
    const c = note.color ?? STICKY_DEFAULTS.color;
    if (!STICKY_COLORS.includes(c)) refuse(`sticky note color '${c}' is not one of the 10 swatches: ${STICKY_COLORS.join(', ')}`);
    out.color = STICKY_COLORS.includes(c) ? c : STICKY_DEFAULTS.color;
  }
  const num = (k, def, min) => {
    const v = note[k] ?? (k === 'x' ? note.positionX : k === 'y' ? note.positionY : undefined);
    if (v === undefined) return partial ? undefined : def;
    if (!Number.isFinite(v)) { refuse(`sticky note '${k}' must be a number (got ${JSON.stringify(v)})`); return def; }
    if (min !== undefined && v < min) refuse(`sticky note '${k}' ${v} is below the UI minimum ${min}`);
    return Math.round(v);
  };
  const x = num('x', STICKY_DEFAULTS.x), y = num('y', STICKY_DEFAULTS.y);
  const width = num('width', STICKY_DEFAULTS.width, STICKY_MIN.width), height = num('height', STICKY_DEFAULTS.height, STICKY_MIN.height);
  if (x !== undefined) out.positionX = x;
  if (y !== undefined) out.positionY = y;
  if (width !== undefined) out.width = width;
  if (height !== undefined) out.height = height;
  return out;
}

/** Build-time: the authored list → create bodies (positions auto-staggered when not given). */
export function planStickyNotes(notes, { loc, wid, skipStickyCheck } = {}) {
  if (notes === undefined || notes === null) return [];
  if (!Array.isArray(notes)) throw new IRError('STICKY_NOTE', `stickyNotes must be an array of {content, color?, x?, y?, width?, height?}`);
  return notes.map((n, i) => {
    const body = normalizeStickyNote({ ...n, x: n?.x ?? n?.positionX ?? (STICKY_DEFAULTS.x + i * 40), y: n?.y ?? n?.positionY ?? (STICKY_DEFAULTS.y + i * 40) }, { skipStickyCheck });
    return { method: 'POST', path: `/workflows/sticky-note?${new URLSearchParams({ locationId: loc })}`, body: { ...body, workflowId: wid, locationId: loc }, ref: n?.ref ?? null };
  });
}

/** Edit-time: op → request plan entry. */
export function planStickyNoteOp(op, { loc, wid, skipStickyCheck } = {}) {
  if (op.op === 'addStickyNote') {
    const body = normalizeStickyNote(op.note, { skipStickyCheck });
    return { op: op.op, method: 'POST', path: `/workflows/sticky-note?${new URLSearchParams({ locationId: loc })}`, body: { ...body, workflowId: wid, locationId: loc } };
  }
  if (op.op === 'updateStickyNote') {
    if (!op.noteId || typeof op.noteId !== 'string') throw new IRError('STICKY_NOTE', `updateStickyNote needs 'noteId' (the note's _id from export_workflow / sticky-notes-all)`);
    const body = normalizeStickyNote(op.note ?? {}, { partial: true, skipStickyCheck });
    if (!Object.keys(body).length) throw new IRError('STICKY_NOTE', `updateStickyNote: 'note' carries nothing to change (content, color, x, y, width, height)`);
    return { op: op.op, method: 'PATCH', path: `/workflows/sticky-note?${new URLSearchParams({ _id: op.noteId, locationId: loc })}`, body };
  }
  throw new IRError('STICKY_NOTE', `unknown sticky-note op ${JSON.stringify(op.op)}`);
}
export const STICKY_OPS = new Set(['addStickyNote', 'updateStickyNote']);
