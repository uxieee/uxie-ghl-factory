// Action NOTES — the node ⋯ → "Notes" popover (components/workflow/CommentSection.vue, recovered).
// One record per note, stored on the step as `comments[]`, NEWEST FIRST (the UI unshifts):
//   { id: uuid(), userId: AppState.user.id, timestamp: moment.utc().format(), comment: <editor HTML> }
// moment.utc().format() is ISO-8601 without milliseconds ('2026-08-22T10:00:00Z'). Saved with the
// workflow — no separate endpoint. Shared by the compiler (IR node `notes:`) and the edit engine
// (`addStepNote` op) so both write byte-identical records.
export function stepNoteRecord(text, { uid, now, idGen } = {}) {
  if (typeof text !== 'string' || !text.trim()) throw new Error(`a step note needs non-empty text`);
  const html = /^\s*<[a-z!]/i.test(text) ? text : `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
  const ts = (now ? new Date(now) : new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return { id: idGen ? idGen() : crypto.randomUUID(), userId: uid ?? null, timestamp: ts, comment: html };
}
/** Authored list → stored comments[] (successive unshifts: the LAST authored note ends up first). */
export function stepNotesToComments(notes, ctx = {}) {
  return notes.map((t) => stepNoteRecord(t, { uid: ctx.uid, now: ctx.now, idGen: ctx.idGen })).reverse();
}
