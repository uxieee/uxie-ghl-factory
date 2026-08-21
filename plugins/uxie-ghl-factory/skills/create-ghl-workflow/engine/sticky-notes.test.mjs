import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStickyNote, planStickyNotes, planStickyNoteOp, STICKY_COLORS, STICKY_DEFAULTS } from './sticky-notes.mjs';

test('a plain-text note becomes <p>…</p> HTML with the UI defaults (yellow, 400×400); HTML is kept', () => {
  assert.deepEqual(normalizeStickyNote({ content: 'a & b <c>' }), { content: '<p>a &amp; b &lt;c&gt;</p>', color: 'yellow', positionX: STICKY_DEFAULTS.x, positionY: STICKY_DEFAULTS.y, width: 400, height: 400 });
  assert.equal(normalizeStickyNote({ content: '<p>x</p>', color: 'rose', x: 10.6, y: 20 }).content, '<p>x</p>');
  assert.equal(normalizeStickyNote({ content: 'x', x: 10.6 }).positionX, 11);
  assert.equal(STICKY_COLORS.length, 10);
});

test('refusals: unknown key, bad colour, content over 5000, size below the UI minimum, non-numeric position', () => {
  const code = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };
  assert.equal(code(() => normalizeStickyNote({ content: 'x', colour: 'blue' })), 'STICKY_NOTE');
  assert.equal(code(() => normalizeStickyNote({ content: 'x', color: 'pink' })), 'STICKY_NOTE');
  assert.equal(code(() => normalizeStickyNote({ content: 'x'.repeat(5001) })), 'STICKY_NOTE');
  assert.equal(code(() => normalizeStickyNote({ content: 'x', width: 100 })), 'STICKY_NOTE');
  assert.equal(code(() => normalizeStickyNote({ content: 'x', x: 'left' })), 'STICKY_NOTE');
  assert.equal(code(() => normalizeStickyNote({ color: 'blue' })), 'STICKY_NOTE', 'content is required on create');
  assert.equal(normalizeStickyNote({ content: 'x', width: 100 }, { skipStickyCheck: true }).width, 100, 'hatch keeps the value');
});

test('build plan: one POST per note, positions staggered when not given, placeholder wid swapped later', () => {
  const plans = planStickyNotes([{ content: 'one' }, { content: 'two', color: 'teal', x: 900, y: 50 }], { loc: 'LOC', wid: '__WID__' });
  assert.equal(plans.length, 2);
  assert.equal(plans[0].method, 'POST'); assert.equal(plans[0].path, '/workflows/sticky-note?locationId=LOC');
  assert.deepEqual(plans[0].body, { content: '<p>one</p>', color: 'yellow', positionX: STICKY_DEFAULTS.x, positionY: STICKY_DEFAULTS.y, width: 400, height: 400, workflowId: '__WID__', locationId: 'LOC' });
  assert.equal(plans[1].body.positionX, 900); assert.equal(plans[1].body.color, 'teal');
  assert.deepEqual(planStickyNotes(undefined, { loc: 'L', wid: 'W' }), []);
  assert.throws(() => planStickyNotes({ content: 'x' }, { loc: 'L', wid: 'W' }), (e) => e.code === 'STICKY_NOTE');
});

test('edit plans: addStickyNote POSTs; updateStickyNote PATCHes with _id as a QUERY param and a partial body', () => {
  const add = planStickyNoteOp({ op: 'addStickyNote', note: { content: 'hi', color: 'blue' } }, { loc: 'LOC', wid: 'WID' });
  assert.equal(add.method, 'POST'); assert.equal(add.body.workflowId, 'WID'); assert.equal(add.body.color, 'blue');
  const upd = planStickyNoteOp({ op: 'updateStickyNote', noteId: 'abc123', note: { color: 'green' } }, { loc: 'LOC', wid: 'WID' });
  assert.equal(upd.method, 'PATCH'); assert.equal(upd.path, '/workflows/sticky-note?_id=abc123&locationId=LOC');
  assert.deepEqual(upd.body, { color: 'green' }, 'partial: untouched fields are not sent');
  assert.throws(() => planStickyNoteOp({ op: 'updateStickyNote', note: { color: 'green' } }, { loc: 'L', wid: 'W' }), /noteId/);
  assert.throws(() => planStickyNoteOp({ op: 'updateStickyNote', noteId: 'x', note: {} }, { loc: 'L', wid: 'W' }), /nothing to change/);
});
