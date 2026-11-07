import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseTree, makeCourseTools } from '../core/course-tools.mjs';

// The seam (p2) hands makeCourseTools the same three helpers tools.mjs uses; these stand-ins keep the test independent of
// the 14k-line registry. The handler reads deps.makeGw at call time, so the fake gateway is injected per test.
const describe = (name, text) => text;
const schema = (shape) => ({ shape });
const guard = async (fn) => ({ content: [{ type: 'text', text: JSON.stringify(await fn()) }] });

function fakeGateway({ product, tree } = {}) {
  const calls = [];
  return {
    loc: 'LOC1',
    uid: 'USER1',
    calls,
    async call(method, path) {
      calls.push({ method, path });
      if (method === 'GET' && /\/products\/[^/]+$/.test(path)) return { status: 200, ok: true, json: product ?? { id: 'COURSE1', title: 'Launchpad', description: 'd', offers: [{ id: 'OFFER1', title: 'Free', type: 'free', visibility: 'draft', amount: '0.00', currency: 'EUR' }] } };
      if (method === 'GET' && /\/categories\?/.test(path)) return { status: 200, ok: true, json: tree ?? [
        { id: 'CH2', title: 'Two', sequenceNo: 1, posts: [{ id: 'L3', title: 'Third', sequenceNo: 0, contentType: 'quiz', visibility: 'draft' }] },
        { id: 'CH1', title: 'One', sequenceNo: 0, posts: [
          { id: 'L2', title: 'Second', sequenceNo: 1, contentType: 'video', visibility: 'published', post_materials: [{ id: 'M1' }], asset_urls: { url: 'https://signed.example/x?token=secret' } },
          { id: 'L1', title: 'First', sequenceNo: 0, contentType: null, visibility: 'draft' },
        ] },
      ] };
      return { status: 404, ok: false, json: { msg: 'no fixture' } };
    },
  };
}

test('get_course is read only, with locationId and courseId required; the course tools are edit_quiz_questions, get_course, get_course_progress and set_course_access', () => {
  const tools = makeCourseTools({ describe, schema, guard });
  assert.deepEqual(tools.map((t) => t.name).sort(), ['edit_quiz_questions', 'get_course', 'get_course_progress', 'set_course_access']);
  const get = tools.find((t) => t.name === 'get_course');
  assert.deepEqual(get.capabilities.map((c) => c.method), ['GET', 'GET']);
  assert.ok(get.inputSchema.shape.courseId);
});

test('normaliseTree orders chapters and lessons by sequenceNo and drops joins and signed URLs', () => {
  const tree = normaliseTree([
    { id: 'CH2', title: 'Two', sequenceNo: 1, posts: [{ id: 'L3', title: 'Third', sequenceNo: 0, contentType: 'quiz', visibility: 'draft' }] },
    { id: 'CH1', title: 'One', sequenceNo: 0, posts: [
      { id: 'L2', title: 'Second', sequenceNo: 1, contentType: 'video', visibility: 'published', post_materials: [{ id: 'M1' }], asset_urls: { url: 'https://signed.example/x' } },
      { id: 'L1', title: 'First', sequenceNo: 0, contentType: null, visibility: 'draft' },
    ] },
  ], 'PRODUCT1');
  assert.equal(tree.productId, 'PRODUCT1');
  assert.deepEqual(tree.chapters.map((c) => c.id), ['CH1', 'CH2']);
  assert.deepEqual(tree.chapters[0].lessons, [
    { id: 'L1', title: 'First', contentType: null, sequenceNo: 0, visibility: 'draft' },
    { id: 'L2', title: 'Second', contentType: 'video', sequenceNo: 1, visibility: 'published' },
  ]);
  const json = JSON.stringify(tree);
  assert.ok(!json.includes('signed.example'), 'signed URLs must not reach the tree');
  assert.ok(!json.includes('post_materials'));
});

test('get_course returns course, tree and offers from GETs only, and writes nothing', async () => {
  const gw = fakeGateway();
  const tool = makeCourseTools({ describe, schema, guard }).find((t) => t.name === 'get_course');
  const out = await tool.handler({ locationId: 'LOC1', courseId: 'COURSE1' }, { makeGw: () => gw, state: {} });
  const body = JSON.parse(out.content[0].text).data;
  assert.equal(body.course.id, 'COURSE1');
  assert.equal(body.course.title, 'Launchpad');
  assert.deepEqual(body.offers.map((o) => o.id), ['OFFER1']);
  assert.deepEqual(body.tree.chapters.map((c) => c.id), ['CH1', 'CH2']);
  assert.ok(gw.calls.every((c) => c.method === 'GET'), 'get_course must not write');
});

// ── w8-4: set_course_access (grant or revoke one contact on one offer, decided by a membership read before and after) ──
function accessGateway({ members = [], landOnGrant = true, landOnRevoke = true, productId = 'COURSE1', offerLocation = 'LOC1' } = {}) {
  const calls = [];
  const state = { members: new Set(members) };
  return {
    loc: 'LOC1',
    uid: 'USER1',
    calls,
    state,
    async call(method, path, body) {
      calls.push({ method, path, body });
      if (method === 'GET' && /\/offers\/OFFER1$/.test(path)) {
        return { status: 200, ok: true, json: { id: 'OFFER1', title: 'Free', type: 'free', visibility: 'draft', locationId: offerLocation, products: [{ id: productId }] } };
      }
      if (method === 'GET' && /\/user-progress\//.test(path)) {
        const page = Number(/pageNumber=(\d+)/.exec(path)?.[1] ?? 1);
        const limit = Number(/pageLimit=(\d+)/.exec(path)?.[1] ?? 50);
        const all = [...state.members].map((contactId) => ({ contactId, userId: `U-${contactId}` }));
        return { status: 200, ok: true, json: all.slice((page - 1) * limit, page * limit) };
      }
      if (method === 'POST' && /attach-offer-user/.test(path)) {
        if (landOnGrant) state.members.add(body.contactId);
        return { status: 200, ok: true, json: { ok: true, msg: 'The request to attach the offer to the user has been successfully queued' } };
      }
      if (method === 'DELETE' && /user-offer-management/.test(path)) {
        if (landOnRevoke) state.members.delete(body.contactId);
        return { status: 200, ok: true, json: { ok: true, msg: 'Offer access has been revoked successfully' } };
      }
      return { status: 404, ok: false, json: { msg: 'no fixture' } };
    },
  };
}
const accessPoll = { attempts: 2, intervalMs: 0 };
const accessTool = () => makeCourseTools({ describe, schema, guard }).find((t) => t.name === 'set_course_access');
const readJson = (out) => JSON.parse(out.content[0].text).data;

test('w8-4: set_course_access is registered with contact, offer, action and confirm', () => {
  const t = accessTool();
  assert.ok(t);
  assert.ok(t.inputSchema.shape.contactId && t.inputSchema.shape.offerId && t.inputSchema.shape.action && t.inputSchema.shape.confirm);
});

test('w8-4: preview makes no account call and says whether the grant sends', async () => {
  const gw = accessGateway();
  const out = await accessTool().handler({ locationId: 'LOC1', contactId: 'CONTACT1', offerId: 'OFFER1', action: 'grant', confirm: false }, { makeGw: () => gw, state: {} });
  const body = readJson(out);
  assert.equal(gw.calls.length, 0, 'preview must not call the account');
  assert.equal(body.sends, 'unknown', 'a grant e-mails or not: not measured, so unknown, never false');
});

test('w8-4: a revoke preview says it does not send', async () => {
  const out = await accessTool().handler({ locationId: 'LOC1', contactId: 'CONTACT1', offerId: 'OFFER1', action: 'revoke', confirm: false }, { makeGw: () => accessGateway(), state: {} });
  assert.equal(readJson(out).sends, false);
});

test('w8-4: a grant that lands is granted, read back on a separate read', async () => {
  const gw = accessGateway({ members: [] });
  const out = await accessTool().handler({ locationId: 'LOC1', contactId: 'CONTACT1', offerId: 'OFFER1', action: 'grant', confirm: true }, { makeGw: () => gw, state: {}, accessPoll });
  const body = readJson(out);
  assert.equal(body.outcome, 'granted');
  assert.equal(body.before, false);
  assert.equal(body.after, true);
});

test('w8-4: a grant answered 200 that does not land is queued-unconfirmed, never granted (review focus 1)', async () => {
  const gw = accessGateway({ members: [], landOnGrant: false });
  const out = await accessTool().handler({ locationId: 'LOC1', contactId: 'CONTACT1', offerId: 'OFFER1', action: 'grant', confirm: true }, { makeGw: () => gw, state: {}, accessPoll });
  assert.equal(readJson(out).outcome, 'queued-unconfirmed');
});

test('w8-4: granting a contact who is already a member is already-had', async () => {
  const gw = accessGateway({ members: ['CONTACT1'] });
  const out = await accessTool().handler({ locationId: 'LOC1', contactId: 'CONTACT1', offerId: 'OFFER1', action: 'grant', confirm: true }, { makeGw: () => gw, state: {}, accessPoll });
  assert.equal(readJson(out).outcome, 'already-had');
});

test('w8-4: revoke of a member is revoked; revoke of a non-member is already-absent', async () => {
  const member = accessGateway({ members: ['CONTACT1'] });
  const a = await accessTool().handler({ locationId: 'LOC1', contactId: 'CONTACT1', offerId: 'OFFER1', action: 'revoke', confirm: true }, { makeGw: () => member, state: {}, accessPoll });
  assert.equal(readJson(a).outcome, 'revoked');
  const none = accessGateway({ members: [] });
  const b = await accessTool().handler({ locationId: 'LOC1', contactId: 'CONTACT1', offerId: 'OFFER1', action: 'revoke', confirm: true }, { makeGw: () => none, state: {}, accessPoll });
  assert.equal(readJson(b).outcome, 'already-absent');
});

// ── security review (w8-4): id shape, offer location, and a complete membership read ───────────────────────────────────
test('security: ids are checked against a strict shape before they reach a path', async () => {
  const { isSafeId } = await import('../core/course-tools.mjs');
  assert.equal(isSafeId('00000000-0000-4000-8000-000000000000'), true);
  assert.equal(isSafeId('Fixture0000000000000'), true);
  for (const bad of ['../offers/x', 'a/b', 'a?b=1', 'a b', '', 'x'.repeat(65), 'a%2Fb']) assert.equal(isSafeId(bad), false, bad);
});

test('security: an offer that belongs to another location is refused, and nothing is sent', async () => {
  const gw = accessGateway({ members: [], offerLocation: 'OTHERLOC' });
  await assert.rejects(accessTool().handler({ locationId: 'LOC1', contactId: 'CONTACT1', offerId: 'OFFER1', action: 'grant', confirm: true }, { makeGw: () => gw, state: {}, accessPoll }));
  assert.equal(gw.calls.some((c) => c.method === 'POST' || c.method === 'DELETE'), false, 'no write was sent');
});

test('security: a membership list longer than one page is read in full; the contact on page two is found', async () => {
  const many = Array.from({ length: 60 }, (_, i) => `FILLER${String(i).padStart(3, '0')}`);
  const gw = accessGateway({ members: [...many, 'CONTACT1'] });
  const out = await accessTool().handler({ locationId: 'LOC1', contactId: 'CONTACT1', offerId: 'OFFER1', action: 'revoke', confirm: true }, { makeGw: () => gw, state: {}, accessPoll });
  assert.equal(readJson(out).before, true, 'a member on page two must count as a member');
  assert.equal(readJson(out).outcome, 'revoked');
});

test('security: a membership read that cannot be completed sends nothing and says so', async () => {
  const gw = accessGateway({ members: [] });
  const realCall = gw.call.bind(gw);
  gw.call = async (method, path, body) => {
    if (method === 'GET' && /\/user-progress\//.test(path)) return { status: 500, ok: false, json: { msg: 'boom' } };
    return realCall(method, path, body);
  };
  await assert.rejects(accessTool().handler({ locationId: 'LOC1', contactId: 'CONTACT1', offerId: 'OFFER1', action: 'grant', confirm: true }, { makeGw: () => gw, state: {}, accessPoll }));
  assert.equal(gw.calls.some((c) => c.method === 'POST'), false, 'a grant must not be sent when the before-read failed');
});

test('security review: an offer that names no product is refused before any write (not reported as queued)', async () => {
  const gw = accessGateway({ members: [], productId: 'not a safe id!' });
  await assert.rejects(accessTool().handler({ locationId: 'LOC1', contactId: 'CONTACT1', offerId: 'OFFER1', action: 'grant', confirm: true }, { makeGw: () => gw, state: {}, accessPoll }), /product/);
  assert.equal(gw.calls.some((c) => c.method === 'POST' || c.method === 'DELETE'), false, 'no write was sent');
});

// ── w8-5: get_course_progress (walks every page; complete:false when it cannot finish; email filter) ───────────────────
function progressGateway(rows, { failOnPage = null } = {}) {
  const calls = [];
  return {
    loc: 'LOC1',
    uid: 'USER1',
    calls,
    async call(method, path) {
      calls.push({ method, path });
      if (method !== 'GET' || !/\/user-progress\//.test(path)) return { status: 404, ok: false, json: { msg: 'no fixture' } };
      const page = Number(/pageNumber=(\d+)/.exec(path)?.[1] ?? 1);
      const limit = Number(/pageLimit=(\d+)/.exec(path)?.[1] ?? 50);
      const email = decodeURIComponent(/email=([^&]*)/.exec(path)?.[1] ?? '');
      if (failOnPage === page) return { status: 500, ok: false, json: { msg: 'page failed' } };
      const matched = email ? rows.filter((r) => r.userEmail === email) : rows;
      return { status: 200, ok: true, json: matched.slice((page - 1) * limit, page * limit) };
    },
  };
}
// The real user-progress row carries userEmail, completedPercentage and lastLogin (course-level percent; no lesson counts).
const progressRow = (i, extra = {}) => ({
  contactId: `C${String(i).padStart(3, '0')}`, userEmail: `fixture-student-${i}`, userId: `U${i}`,
  completedPercentage: i % 2 ? 50 : 100, lastLogin: '2026-11-07T00:00:00.000Z', ...extra,
});
const progressTool = () => makeCourseTools({ describe, schema, guard }).find((t) => t.name === 'get_course_progress');

test('w8-5: get_course_progress walks three pages and sums them; complete is true', async () => {
  const rows = Array.from({ length: 120 }, (_, i) => progressRow(i));
  const gw = progressGateway(rows);
  const out = await progressTool().handler({ locationId: 'LOC1', courseId: 'COURSE1' }, { makeGw: () => gw, state: {} });
  const body = readJson(out);
  assert.equal(body.perStudent.length, 120);
  assert.equal(body.pages, 3);
  assert.equal(body.complete, true);
  assert.equal(body.perCourse.students, 120);
  assert.equal(body.perCourse.completed, 60, 'rows at 100 percent count as completed');
  assert.equal(gw.calls.filter((c) => /user-progress/.test(c.path)).length, 3);
});

test('w8-5: a page error reports complete:false with the pages read, never a silent partial list', async () => {
  const rows = Array.from({ length: 120 }, (_, i) => progressRow(i));
  const gw = progressGateway(rows, { failOnPage: 2 });
  const out = await progressTool().handler({ locationId: 'LOC1', courseId: 'COURSE1' }, { makeGw: () => gw, state: {} });
  const body = readJson(out);
  assert.equal(body.complete, false);
  assert.equal(body.pages, 1);
  assert.equal(body.perStudent.length, 50, 'only the rows of the pages that were read');
});

test('w8-5: the email filter returns one student', async () => {
  const rows = Array.from({ length: 60 }, (_, i) => progressRow(i));
  const gw = progressGateway(rows);
  const out = await progressTool().handler({ locationId: 'LOC1', courseId: 'COURSE1', email: 'fixture-student-7' }, { makeGw: () => gw, state: {} });
  const body = readJson(out);
  assert.equal(body.perStudent.length, 1);
  assert.equal(body.perStudent[0].contactId, 'C007');
  assert.equal(body.perStudent[0].email, 'fixture-student-7');
  assert.equal(body.complete, true);
});

// ── w8-6: edit_quiz_questions. The batch POST replaces the whole set (measured on the sandbox, 2026-11-07), so a confirmed add
// re-posts the stored set in full and then the new questions. The fixture echoes what is posted, as the server does; the other
// modes model the two wrong outcomes the tool must catch: an append, and a server that keeps only the additions.
function quizGateway({ stored = [], mode = 'replace', failPost = false, failPostApplied = false, notAList = false, keepLast = 0 } = {}) {
  const calls = [];
  const state = { questions: stored.map((q) => JSON.parse(JSON.stringify(q))) };
  return {
    loc: 'LOC1',
    uid: 'USER1',
    calls,
    state,
    async call(method, path, body) {
      calls.push({ method, path, body });
      if (method === 'GET' && /\/assessments\/quiz\/questions\/QUIZ1$/.test(path)) {
        return { status: 200, ok: true, json: notAList ? { msg: 'not a list' } : state.questions.map((q) => JSON.parse(JSON.stringify(q))) };
      }
      if (method === 'POST' && /\/assessments\/quiz\/questions$/.test(path)) {
        if (failPost) return { status: 500, ok: false, json: { msg: 'Internal server error' } };
        const echoed = body.questions.map((q, i) => ({
          id: `NEW${i + 1}`, quizId: q.quizId, title: q.title, questionType: q.questionType, sequenceNumber: q.sequenceNumber,
          explanation: q.explanation ?? null, originId: null,
          options: q.options.map((o) => ({ sequence: o.sequence, statement: o.statement, isCorrect: o.isCorrect })),
        }));
        if (mode === 'append') state.questions = [...state.questions, ...echoed];
        else if (keepLast) state.questions = echoed.slice(-keepLast);
        else state.questions = echoed;
        if (failPostApplied) return { status: 500, ok: false, json: { msg: 'gateway timeout after the write landed' } };
        return { status: 200, ok: true, json: { questions: echoed } };
      }
      return { status: 404, ok: false, json: { msg: 'no fixture' } };
    },
  };
}
const storedThree = [
  { id: 'Q1', quizId: 'QUIZ1', title: 'One', questionType: 'single', sequenceNumber: 1, explanation: null, originId: null, options: [{ sequence: 1, statement: 'a', isCorrect: true }, { sequence: 2, statement: 'b', isCorrect: false }] },
  { id: 'Q2', quizId: 'QUIZ1', title: 'Two', questionType: 'single', sequenceNumber: 2, explanation: 'why', originId: null, options: [{ sequence: 1, statement: 'c', isCorrect: false }, { sequence: 2, statement: 'd', isCorrect: true }] },
  { id: 'Q3', quizId: 'QUIZ1', title: 'Three', questionType: 'single', sequenceNumber: 3, explanation: null, originId: null, options: [{ sequence: 1, statement: 'e', isCorrect: true }, { sequence: 2, statement: 'f', isCorrect: false }] },
];
const twoNew = [
  { title: 'Four', questionType: 'single', options: [{ statement: 'x', isCorrect: true }, { statement: 'y' }] },
  { title: 'Five', questionType: 'single', options: [{ statement: 'p', isCorrect: true }, { statement: 'q' }] },
];
function quizTool() {
  return makeCourseTools({ describe, schema, guard }).find((t) => t.name === 'edit_quiz_questions');
}

test('w8-6: edit_quiz_questions is registered with the quiz id, the batch and confirm, and its two capabilities', () => {
  const tool = quizTool();
  assert.ok(tool.inputSchema.shape.quizId);
  assert.ok(tool.inputSchema.shape.add);
  assert.ok(tool.inputSchema.shape.confirm);
  assert.deepEqual(tool.capabilities.map((c) => c.method), ['GET', 'POST']);
});

test('w8-6: preview (confirm false) reads the quiz and writes nothing; it says what would be re-posted', async () => {
  const gw = quizGateway({ stored: storedThree });
  const out = await quizTool().handler({ locationId: 'LOC1', quizId: 'QUIZ1', add: twoNew }, { makeGw: () => gw, state: {} });
  const body = readJson(out);
  assert.equal(body.preview, true);
  assert.equal(body.sends, false);
  assert.equal(body.before.count, 3);
  assert.equal(body.expectedAfter, 5);
  assert.ok(gw.calls.every((c) => c.method === 'GET'), 'a preview must not write');
});

test('w8-6: a replace argument is refused before any call (the whole-set write is not offered as an option)', async () => {
  const gw = quizGateway({ stored: storedThree });
  await assert.rejects(
    quizTool().handler({ locationId: 'LOC1', quizId: 'QUIZ1', add: twoNew, replace: [] }, { makeGw: () => gw, state: {} }),
    /replacing the whole question set is not offered/,
  );
  assert.equal(gw.calls.length, 0, 'nothing may be sent');
});

test('w8-6: a duplicate question in the batch is refused before any call', async () => {
  const gw = quizGateway({ stored: storedThree });
  await assert.rejects(
    quizTool().handler({ locationId: 'LOC1', quizId: 'QUIZ1', add: [twoNew[0], { ...twoNew[0] }] }, { makeGw: () => gw, state: {} }),
    /duplicate question text/,
  );
  assert.equal(gw.calls.length, 0);
});

test('w8-6: a quizId that is not a plain id is refused before any call', async () => {
  const gw = quizGateway({ stored: storedThree });
  await assert.rejects(
    quizTool().handler({ locationId: 'LOC1', quizId: 'QUIZ1/../x', add: twoNew, confirm: true }, { makeGw: () => gw, state: {} }),
    /quizId must be a plain id/,
  );
  assert.equal(gw.calls.length, 0);
});

test('w8-6: a quiz whose questions cannot be read as a list refuses before any write', async () => {
  const gw = quizGateway({ stored: storedThree, notAList: true });
  await assert.rejects(
    quizTool().handler({ locationId: 'LOC1', quizId: 'QUIZ1', add: twoNew, confirm: true }, { makeGw: () => gw, state: {} }),
    /could not be read as a question list; nothing was sent/,
  );
  assert.ok(gw.calls.every((c) => c.method === 'GET'));
});

test('w8-6: a stored question whose option text cannot be read refuses before any POST, in preview and in confirm (the 2026-11-06 loss)', async () => {
  const unreadable = [{ ...storedThree[0], options: [{ sequence: 1, isCorrect: true }, { sequence: 2, isCorrect: false }] }, storedThree[1], storedThree[2]];
  const gw = quizGateway({ stored: unreadable });
  await assert.rejects(quizTool().handler({ locationId: 'LOC1', quizId: 'QUIZ1', add: twoNew }, { makeGw: () => gw, state: {} }), /"One".*option text cannot be read/);
  await assert.rejects(quizTool().handler({ locationId: 'LOC1', quizId: 'QUIZ1', add: twoNew, confirm: true }, { makeGw: () => gw, state: {} }), /option text cannot be read/);
  assert.ok(gw.calls.every((c) => c.method === 'GET'), 'no POST may be sent for a quiz whose stored content cannot be re-posted in full');
});

test('w8-6: a confirmed add re-posts the stored set in full, then the additions, reads back on a separate request, and reports added', async () => {
  const gw = quizGateway({ stored: storedThree });
  const out = await quizTool().handler({ locationId: 'LOC1', quizId: 'QUIZ1', add: twoNew, confirm: true }, { makeGw: () => gw, state: {} });
  const body = readJson(out);
  assert.equal(body.outcome, 'added');
  assert.equal(body.before.count, 3);
  assert.equal(body.after.count, 5);
  assert.deepEqual(body.kept, ['One', 'Two', 'Three'], 'kept comes from the read-back, by content');
  assert.deepEqual(body.added, ['Four', 'Five']);
  const post = gw.calls.find((c) => c.method === 'POST');
  assert.equal(post.body.questions.length, 5, 'the stored set is re-posted with the additions');
  assert.deepEqual(post.body.questions.map((q) => q.title), ['One', 'Two', 'Three', 'Four', 'Five']);
  assert.deepEqual(post.body.questions[0].options.map((o) => o.statement), ['a', 'b'], 'stored option text is sent, not dropped');
  assert.deepEqual(post.body.questions.map((q) => q.sequenceNumber), [1, 2, 3, 4, 5]);
  assert.deepEqual(gw.calls.map((c) => c.method), ['GET', 'POST', 'GET']);
});

test('w8-6: an append (the server adds instead of replacing) is caught: unverified, with the full before list', async () => {
  const gw = quizGateway({ stored: storedThree, mode: 'append' });
  const out = await quizTool().handler({ locationId: 'LOC1', quizId: 'QUIZ1', add: twoNew, confirm: true }, { makeGw: () => gw, state: {} });
  const body = readJson(out);
  assert.equal(body.outcome, 'unverified');
  assert.equal(body.after.count, 8, 'the stored set posted twice, then the additions');
  assert.deepEqual(body.beforeQuestions.map((q) => q.options[0].statement), ['a', 'c', 'e'], 'the full before list, with option text, for a restore');
});

test('w8-6: a server that keeps only the additions is unverified; kept lists only the stored questions that came back', async () => {
  const gw = quizGateway({ stored: storedThree, keepLast: 2 });
  const out = await quizTool().handler({ locationId: 'LOC1', quizId: 'QUIZ1', add: twoNew, confirm: true }, { makeGw: () => gw, state: {} });
  const body = readJson(out);
  assert.equal(body.outcome, 'unverified');
  assert.equal(body.after.count, 2);
  assert.deepEqual(body.kept, [], 'no stored question came back, so none is kept');
  assert.deepEqual(body.beforeQuestions.map((q) => q.id), ['Q1', 'Q2', 'Q3']);
});

test('w8-6: a failed batch POST still reads the quiz back and returns unverified, with the full before list and the after read (the route replaces, so a failed POST may have changed the set)', async () => {
  const gw = quizGateway({ stored: storedThree, failPost: true });
  const out = await quizTool().handler({ locationId: 'LOC1', quizId: 'QUIZ1', add: twoNew, confirm: true }, { makeGw: () => gw, state: {} });
  const body = readJson(out);
  assert.equal(body.outcome, 'unverified');
  assert.deepEqual(gw.calls.map((c) => c.method), ['GET', 'POST', 'GET'], 'a second read ran after the failed POST');
  assert.match(body.postFailed, /^500 on POST/, 'the HTTP status and the failing call are reported');
  assert.deepEqual(body.beforeQuestions.map((q) => q.title), ['One', 'Two', 'Three'], 'the full before list is returned');
  assert.equal(body.after.count, 3, 'the after read is returned');
  assert.deepEqual(body.kept, ['One', 'Two', 'Three'], 'nothing changed on the server: the stored set is still there');
});

test('w8-6: a failed batch POST whose write landed anyway is reported as added, with the failure noted', async () => {
  const gw = quizGateway({ stored: storedThree, failPostApplied: true });
  const out = await quizTool().handler({ locationId: 'LOC1', quizId: 'QUIZ1', add: twoNew, confirm: true }, { makeGw: () => gw, state: {} });
  const body = readJson(out);
  assert.equal(body.outcome, 'added', 'the read matches the expected set, so the write did land');
  assert.match(body.postFailed, /^500 on POST/);
  assert.equal(body.after.count, 5);
});

test('w8-6: a failed batch POST whose after read also fails returns unverified with after null, not a thrown error', async () => {
  const gw = quizGateway({ stored: storedThree, failPost: true });
  const realCall = gw.call.bind(gw);
  let reads = 0;
  gw.call = async (method, path, body) => {
    if (method === 'GET' && /\/assessments\/quiz\/questions\/QUIZ1$/.test(path)) { reads += 1; if (reads === 2) return { status: 500, ok: false, json: { msg: 'read failed' } }; }
    return realCall(method, path, body);
  };
  const out = await quizTool().handler({ locationId: 'LOC1', quizId: 'QUIZ1', add: twoNew, confirm: true }, { makeGw: () => gw, state: {} });
  const body = readJson(out);
  assert.equal(body.outcome, 'unverified');
  assert.equal(body.after, null);
  assert.match(body.postFailed, /^500 on POST/);
  assert.equal(body.beforeQuestions.length, 3);
});

test('w8-6: the confirmed POST carries each stored question with its explanation, and its options in sequence order (QA)', async () => {
  const outOfOrder = storedThree.map((q, i) => (i === 1 ? { ...q, options: [
    { sequence: 2, statement: 'd', isCorrect: true },
    { sequence: 1, statement: 'c', isCorrect: false },
  ] } : q));
  const gw = quizGateway({ stored: outOfOrder });
  await quizTool().handler({ locationId: 'LOC1', quizId: 'QUIZ1', add: twoNew, confirm: true }, { makeGw: () => gw, state: {} });
  const post = gw.calls.find((c) => c.method === 'POST');
  assert.equal(post.body.questions[1].title, 'Two');
  assert.equal(post.body.questions[1].explanation, 'why', 'the stored explanation travels');
  assert.deepEqual(post.body.questions[1].options.map((o) => o.statement), ['c', 'd'], 'options in sequence order');
  assert.deepEqual(post.body.questions[1].options.map((o) => o.isCorrect), [false, true], 'correctness travels with its option');
});

// ── w8-6: every save re-mints every question id (measured 2026-11-07: before 9354c71c, 25f96994; after new ids for all three).
// So the tool says so in its description and in every output, and no question id is kept as a reference across an edit.
test('w8-6: the description says ids change on every save', () => {
  assert.match(quizTool().description, /ids change on every save/);
});

test('w8-6: a preview and a confirmed result both say that every question id is re-minted on each save', async () => {
  const gw = quizGateway({ stored: storedThree });
  const preview = readJson(await quizTool().handler({ locationId: 'LOC1', quizId: 'QUIZ1', add: twoNew }, { makeGw: () => gw, state: {} }));
  assert.match(preview.idsChange, /every question id is re-minted on every save/);
  const confirmed = readJson(await quizTool().handler({ locationId: 'LOC1', quizId: 'QUIZ1', add: twoNew, confirm: true }, { makeGw: () => gw, state: {} }));
  assert.match(confirmed.idsChange, /every question id is re-minted on every save/);
  assert.notDeepEqual(confirmed.after.ids, confirmed.before.ids, 'the ids really do change on a save');
});
