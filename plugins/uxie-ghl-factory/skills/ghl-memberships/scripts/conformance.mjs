#!/usr/bin/env node
/**
 * LIVE CONFORMANCE SUITE for the GHL Memberships internal API.
 *
 *   GHL_TOKEN='<LC JWT>' node conformance.mjs
 *   GHL_TOKEN='...' GHL_LOCATION='<locId>' node conformance.mjs --keep
 *   ... node conformance.mjs --allow-sends          # the sends: grant, revoke, credential issue, set_course_access live (gate G4).
 *                                                   Publishes NOTHING.
 *   ... node conformance.mjs --allow-publish        # publishes the test offer (gate G6). Never implied by --allow-sends.
 *   GHL_PUBLIC_API_MCP_DIR=<public-api-mcp> GHL_ACCOUNTS_FILE=<file> node conformance.mjs   # enables the public-rail edit_course check
 *
 * DEFAULT MODE sends nothing and publishes nothing: every created object is a draft. The tools exercised live are edit_quiz_questions
 * (on this run's own draft quiz), get_course_progress (read), edit_course (public rail, own draft course) and, only with
 * --allow-sends, set_course_access.
 *
 * WHY THIS EXISTS
 * ---------------
 * These are UNDOCUMENTED internal endpoints. They drift without notice — this
 * project has already seen GHL migrate workflow-builder auth (token-id → Bearer)
 * mid-flight, silently breaking every runbook written against it. A reference doc
 * rots invisibly: it keeps looking authoritative while being wrong.
 *
 * This suite exercises the real admin-side lifecycle against a live sub-account and
 * asserts on EFFECTS (not status codes), so the day GHL changes something you get a
 * red line instead of a mystery.
 *
 * COVERAGE HONESTY
 * ----------------
 * Three writes CANNOT be covered here: learner submission, user-post-completion,
 * and grading. All require a logged-in portal member, and portal signup is
 * OTP-gated, so they cannot run unattended. They are reported as SKIPPED with the
 * reason — never silently omitted. Run them via the member flow in BUILD-API.md.
 *
 * Everything created is named TEST-CONF-* and torn down at the end (unless --keep).
 */

import { GhlMembershipsApi } from '../engine/api.mjs';
import { Members, accessOutcome } from '../engine/members.mjs';
import { Assessments, mergeQuestions, validateQuestions, compareQuizContent } from '../engine/assessments.mjs';
import { Credentials } from '../engine/credentials.mjs';
import { Communities } from '../engine/communities.mjs';
import { loadToken, safeClaims } from '../engine/auth.mjs';
import { makeCliMembershipsGateway } from './cli-gateway.mjs';
import { makeCourseTools } from '../../../mcp-internal/core/course-tools.mjs';
import { parseConformanceFlags } from './conformance-flags.mjs';

const LOCATION = process.env.GHL_LOCATION || process.env.GHL_LOC;
if (!LOCATION) {
  console.error('GHL_LOCATION (or GHL_LOC) is required — the sub-account to run against.\n' +
    "  GHL_TOKEN='<jwt>' GHL_LOCATION='<locationId>' node conformance.mjs");
  process.exit(1);
}
const FLAGS = parseConformanceFlags(process.argv.slice(2));
const KEEP = FLAGS.keep;
// Sections 4 and 5 send e-mail (a grant, a credential issue) and publish an offer. They run only with --allow-sends, and only on the
// orchestrator's go (G4 sends, G6 publish). Without the flag they are reported as SKIP, never run.
const SENDS = FLAGS.sends;
const PUBLISH = FLAGS.publish;
// The public rail (edit_course) runs through the ghl-multi stdio server. Both paths are configured by the caller; without them the
// public section is SKIPPED, never failed. GHL_PUBLIC_API_MCP_DIR = the public-api-mcp checkout; GHL_ACCOUNTS_FILE = its accounts file.
const PUBLIC_DIR = process.env.GHL_PUBLIC_API_MCP_DIR || null;
const ACCOUNTS_FILE = process.env.GHL_ACCOUNTS_FILE || null;
const TOOLS_W8 = makeCourseTools({ describe: (_n, t) => t, schema: (shape) => ({ shape }), guard: async (fn) => fn() });
const w8Tool = (name) => TOOLS_W8.find((t) => t.name === name);
const STAMP = Date.now().toString().slice(-6);
const NAME = (s) => `TEST-CONF-${s}-${STAMP}`;

const results = [];
let created = {};

function ok(name, detail = '') { results.push({ status: 'PASS', name, detail }); console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
function bad(name, detail) { results.push({ status: 'FAIL', name, detail }); console.log(`  ❌ ${name} — ${detail}`); }
function skip(name, why) { results.push({ status: 'SKIP', name, detail: why }); console.log(`  ⏭️  ${name} — ${why}`); }

function assert(name, cond, detail = '') {
  if (cond) ok(name, detail); else bad(name, detail || 'assertion failed');
  return !!cond;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const { token, secondsRemaining } = loadToken();
  console.log(`\nGHL Memberships — live conformance`);
  console.log(`location : ${LOCATION}`);
  console.log(`token    : ${secondsRemaining}s remaining (${JSON.stringify(safeClaims(token).authClass)})`);
  if (secondsRemaining < 300) {
    console.log('\n⚠️  Token has <5min left; the suite takes ~1min. Re-mint first.\n');
  }

  const gw = makeCliMembershipsGateway({ token, loc: LOCATION, uid: safeClaims(token).userId });
  const api = new GhlMembershipsApi({ gw });
  const members = new Members(api);
  const assess = new Assessments(api);
  const creds = new Credentials(api);
  const comms = new Communities(api);

  try {
    // ═══════════ 1. COURSE STRUCTURE ═══════════
    console.log('\n[1] course structure');
    const product = await api.createProduct({ title: NAME('COURSE'), description: 'conformance run' });
    created.productId = product.id;
    assert('product created', !!product.id, product.id);

    const category = await api.createCategory({ title: 'Chapter 1', productId: product.id, sequenceNo: 0, visibility: 'draft' });
    created.categoryId = category.id;
    assert('category created', !!category.id);

    // text lesson = OMIT contentType (content_type is a MySQL ENUM; 'text' is invalid)
    const textLesson = await api.createPost({
      title: 'Text lesson', description: '<p>body</p>',
      categoryId: category.id, productId: product.id, sequenceNo: 0, contentType: undefined, visibility: 'draft',
    });
    assert('text lesson created (contentType omitted)', !!textLesson.id);

    let enumGuard = false;
    try { await api.createPost({ title: 'bad', categoryId: category.id, productId: product.id, contentType: 'text' }); }
    catch { enumGuard = true; }
    assert("contentType 'text' still rejected (ENUM guard)", enumGuard,
      enumGuard ? 'server rejects as expected' : 'SERVER NOW ACCEPTS text — docs need updating');

    // ═══════════ 2. QUIZ + QUESTIONS ═══════════
    console.log('\n[2] quiz + questions');
    const { post: quizPost } = await assess_createQuiz(api, assess, product.id, category.id);
    const quiz = await assess.getQuizByPost(quizPost.id);
    created.quizId = quiz.id;
    assert('quizId differs from postId', quiz.id !== quizPost.id, `${quiz.id} vs ${quizPost.id}`);

    await assess.addQuestions(quiz.id, [
      { title: 'Capital of France?', questionType: 'single', explanation: 'Paris.',
        options: [{ statement: 'Berlin' }, { statement: 'Paris', isCorrect: true }] },
      { title: 'Primes?', questionType: 'multiple', explanation: '2 and 5.',
        options: [{ statement: '2', isCorrect: true }, { statement: '4' }, { statement: '5', isCorrect: true }] },
    ]);
    const qRead = await assess.getQuizQuestions(quiz.id);
    const qs = Array.isArray(qRead) ? qRead : (qRead.questions || []);
    assert('2 questions persisted', qs.length === 2, `${qs.length}`);
    const multi = qs.find(q => q.questionType === 'multiple');
    assert('multi-choice keeps 2 correct options',
      !!multi && multi.options.filter(o => o.isCorrect).length === 2,
      multi ? String(multi.options.filter(o => o.isCorrect).length) : 'missing');

    // bl-843 sentinel (2026-11-07): the batch write on a non-empty quiz REPLACES the whole set. If GHL starts appending, this fails and
    // the ledger note, the tool description and the memberships skill are wrong. Draft quiz on a TEST-CONF object; no send, no publish.
    await assess.addQuestions(quiz.id, [{ title: 'Replace sentinel', questionType: 'single', explanation: null,
      options: [{ statement: 'x', isCorrect: true }, { statement: 'y' }] }]);
    const qSentinel = await assess.getQuizQuestions(quiz.id);
    const qSentinelList = Array.isArray(qSentinel) ? qSentinel : (qSentinel.questions || []);
    assert('bl-843 sentinel: a one-question batch on a two-question quiz REPLACES the set (count 1)', qSentinelList.length === 1,
      `count=${qSentinelList.length}`);

    // edit_quiz_questions (the tool itself, live) on THIS run's own draft quiz only: the stored set (the sentinel question) is re-posted
    // in full with two additions, then read back by content. Never a shared quiz.
    const eqOut = await w8Tool('edit_quiz_questions').handler({ locationId: LOCATION, quizId: quiz.id, confirm: true, add: [
      { title: 'Tool check A', questionType: 'single', explanation: 'A.', options: [{ statement: 'p', isCorrect: true }, { statement: 'q' }] },
      { title: 'Tool check B', questionType: 'single', options: [{ statement: 'r' }, { statement: 's', isCorrect: true }] },
    ] }, { makeGw: () => gw, state: {} });
    assert('edit_quiz_questions (tool, live, own draft quiz): outcome added, 1 stored + 2 added read back by content',
      eqOut.data?.outcome === 'added' && eqOut.data?.after?.count === 3,
      JSON.stringify({ outcome: eqOut.data?.outcome, after: eqOut.data?.after?.count, postFailed: eqOut.data?.postFailed }));

    // ═══════════ 3. ASSIGNMENT ═══════════
    console.log('\n[3] assignment');
    const asgPost = await api.createPost({
      title: 'Upload licence', categoryId: category.id, productId: product.id,
      sequenceNo: 2, contentType: 'assignment', visibility: 'draft',
    });
    await api.req('POST', `${api.M}/assessments/assignment`, { title: 'Upload licence', postId: asgPost.id, productId: product.id });
    const asg = await assess.getAssignmentByPost(asgPost.id);
    assert('assignment object readable', !!asg.id, asg.id);

    if (!SENDS) {
      skip('sections 4-5: enrolment, grant, revoke, credential issue', 'need --allow-sends (G4: e-mail sends); the offer publish also needs --allow-publish (G6)');
    } else {
    // ═══════════ 4. ENROLLMENT ROUND-TRIP ═══════════
    console.log('\n[4] enrollment round-trip');
    const offer = await api.createOffer({ title: NAME('OFFER'), productIds: [product.id] });
    created.offerId = offer.id;
    if (PUBLISH) {
      await members.publishOffer(offer.id);
      assert('offer created + published (--allow-publish, G6)', !!offer.id, offer.id);
    } else {
      assert('offer created as a draft (publish needs --allow-publish, G6)', !!offer.id, offer.id);
    }

    const contact = await api.req('POST', 'https://backend.leadconnectorhq.com/contacts/', {
      locationId: LOCATION, firstName: 'TEST-CONF', lastName: 'MEMBER',
      email: `test-conf-${STAMP}@example.invalid`, tags: ['test-conf-delete-me'],
    });
    created.contactId = contact.contact.id;
    assert('contact created', !!created.contactId, created.contactId);

    // The grant's own 200 is worthless — it says "successfully queued" for an empty body too.
    // Assert on THIS contact appearing, not on the row count: a count check passes on somebody
    // else's row, which is how a broken grant reads as a working one.
    await members.grantOffer({ contactId: created.contactId, offerId: offer.id });
    let enrolled = [];
    try {
      enrolled = await members.waitForEnrollment(product.id, { timeoutMs: 25000, expectContactIds: [created.contactId] });
    } catch (e) { /* asserted below */ }
    assert('GRANT: THIS contact appears in user-progress',
      enrolled.some(r => String(r?.contactId) === String(created.contactId)),
      `${enrolled.length} row(s), contactIds=[${enrolled.map(r => r?.contactId).join(', ')}]`);

    // The response is the same for a request that cannot possibly grant anything. Proving that
    // here keeps the "never trust the 200" rule in members.grantOffer true rather than merely
    // written down. No ids are real, so nothing is created; the sibling-path 404 that shows the
    // 200 is this route replying is recorded in the corpus, not re-run against the account.
    const emptyAck = await members.req('POST', 'https://backend.leadconnectorhq.com/membership/smart-list/attach-offer-user', {});
    assert('trap holds: attach-offer-user acks an EMPTY body with the same 200',
      emptyAck && emptyAck.ok === true && /successfully queued/i.test(emptyAck.msg || ''), JSON.stringify(emptyAck));

    await members.revokeOffer({ contactId: created.contactId, offerId: offer.id });
    await sleep(3000);
    const afterRevoke = await members.productProgress(product.id);
    assert('REVOKE: user-progress back to empty',
      Array.isArray(afterRevoke) && afterRevoke.length === 0, `${(afterRevoke || []).length} row(s)`);

    // documented trap — assert the trap still holds so the doc stays true
    const purchases = await members.purchaseCount(product.id);
    assert('trap holds: purchaseCount ignores admin-attached offers',
      purchases && purchases.count === 0, `count=${purchases?.count}`);

    // ═══════════ 5. CREDENTIALS ═══════════
    console.log('\n[5] credentials');
    const tpl = await creds.createTemplate({ title: NAME('CERT'), type: 'certificate' });
    created.templateId = tpl._id;
    assert('credential template created', !!tpl._id, tpl._id);
    assert('known quirk: create response type is an EVENT name',
      tpl.type === 'TEMPLATE_CREATED', `type=${tpl.type}`);

    const fetched = await creds.getTemplate(tpl._id);
    assert('stored type is the real credential type', fetched.type === 'certificate', `type=${fetched.type}`);

    await creds.issue({
      templateId: tpl._id, certificateTitle: NAME('CERT'),
      fromName: 'Conformance Runner', subject: 'TEST-CONF credential',
      recipients: [`test-conf-${STAMP}@example.invalid`], contactIds: [created.contactId],
    });
    await sleep(3000);
    const issued = await creds.listIssued({ type: 'certificate' });
    const mine = (issued.issuedCertificates || []).filter(x => x.contactId === created.contactId);
    assert('ISSUE: registry record created', mine.length === 1, `${mine.length}`);
    if (mine[0]) {
      created.issuedId = mine[0]._id;
      assert('issued record has downloadUrl + offline_certificate source',
        !!mine[0].downloadUrl && mine[0].source === 'offline_certificate', mine[0].source);
    }

    // set_course_access (the tool, live): only here, under --allow-sends. Preview first (no call), then grant and revoke, each read back.
    const accessArgs = { locationId: LOCATION, contactId: created.contactId, offerId: offer.id };
    const accessPreview = await w8Tool('set_course_access').handler({ ...accessArgs, action: 'grant', confirm: false }, { makeGw: () => gw, state: {} });
    assert('set_course_access (tool): preview makes no call and says a grant sends unknown',
      accessPreview.data?.preview === true && accessPreview.data?.sends === 'unknown', JSON.stringify(accessPreview.data?.sends));
    const accessGrant = await w8Tool('set_course_access').handler({ ...accessArgs, action: 'grant', confirm: true }, { makeGw: () => gw, state: {} });
    assert('set_course_access (tool): a grant is granted, read back on a separate request', accessGrant.data?.outcome === 'granted',
      JSON.stringify({ outcome: accessGrant.data?.outcome, reason: accessGrant.data?.reason }));
    const accessRevoke = await w8Tool('set_course_access').handler({ ...accessArgs, action: 'revoke', confirm: true }, { makeGw: () => gw, state: {} });
    assert('set_course_access (tool): the revoke is revoked, read back on a separate request', accessRevoke.data?.outcome === 'revoked',
      JSON.stringify({ outcome: accessRevoke.data?.outcome, reason: accessRevoke.data?.reason }));
    } // end of the --allow-sends block (sections 4-5)

    // ═══════════ 9. TOOLS ON THIS RUN'S OWN DRAFT COURSE (default mode) ═══════════
    console.log('\n[9] get_course_progress (read) and edit_course (public rail) on the suite\'s own draft course');
    const progressOut = await w8Tool('get_course_progress').handler({ locationId: LOCATION, courseId: product.id }, { makeGw: () => gw, state: {} });
    assert('get_course_progress (tool, read): the walk completes on the draft course with no student rows',
      progressOut.data?.complete === true && Array.isArray(progressOut.data?.perStudent) && progressOut.data.perStudent.length === 0,
      JSON.stringify({ complete: progressOut.data?.complete, rows: progressOut.data?.perStudent?.length, failure: progressOut.data?.failure }));
    if (!PUBLIC_DIR || !ACCOUNTS_FILE) {
      skip('edit_course (public rail): edit the draft course and read it back', 'set GHL_PUBLIC_API_MCP_DIR and GHL_ACCOUNTS_FILE to run it');
    } else {
      const marker = `conformance edit ${STAMP}`;
      const up = await publicCall('courses-v3__update-course', { productId: product.id, description: marker }, { confirm: true });
      assert('edit_course (public rail): update-course accepted', !up.isError, up.text.slice(0, 160));
      const back = await publicCall('courses-v3__get-course', { productId: product.id });
      assert('edit_course (public rail): read back on a separate request shows the edit', !back.isError && back.text.includes(marker),
        back.isError ? back.text.slice(0, 160) : 'marker present');
    }

    // ═══════════ 6. COMMUNITIES (admin rail) ═══════════
    console.log('\n[6] communities (admin rail)');
    // discovery:false: the test group must not list on the marketplace (bl-725; the create form's default is ON).
    const group = await comms.createGroup({ name: NAME('GROUP'), slug: `test-conf-${STAMP}`, description: 'conformance', discovery: false });
    created.groupId = group._id;
    assert('group created', !!group._id, group._id);
    assert('group auto-status Active', group.status === 'Active', group.status);

    let sourceGate = false;
    try { await api.req('GET', `https://services.leadconnectorhq.com/communities/${LOCATION}/groups/${group._id}`); }
    catch (e) { sourceGate = /403|restricted|Forbidden/i.test(String(e.message)); }
    assert('trap holds: group internals still PORTAL_USER-gated to admin token', sourceGate,
      sourceGate ? '403 as documented' : 'ADMIN TOKEN NOW READS INTERNALS — docs need updating');

    // ═══════════ 7. MEMBER-SIDE (cannot run unattended) ═══════════
    console.log('\n[7] member-side');
    skip('learner assignment submit', 'needs a portal session; signup is OTP-gated');
    skip('user-post-completion (progress write)', 'needs a portal session');
    skip('assessment grading (courses/…/review)', 'needs an existing learner submission');
    skip('communities join + post create', 'needs a PORTAL_USER token (24h TTL) — run semi-attended');

    // ═══════════ 8. W8 PURE CHECKS (no account call) ═══════════
    console.log('\n[8] W8 pure checks (no account call)');
    const storedOne = [{ id: 'Q1', title: 'One', questionType: 'single', sequenceNumber: 1, explanation: null,
      options: [{ sequence: 1, statement: 'a', isCorrect: true }, { sequence: 2, statement: 'b', isCorrect: false }] }];
    const addedOne = [{ title: 'Two', questionType: 'single', options: [{ statement: 'c', isCorrect: true }, { statement: 'd' }] }];
    const merged = mergeQuestions(storedOne, { add: validateQuestions(addedOne) });
    assert('edit_quiz_questions: the merge re-posts the stored question in full, the addition numbered after it',
      merged.length === 2 && merged[0].options[0].statement === 'a' && merged[1].sequenceNumber === 2);
    const flipped = JSON.parse(JSON.stringify(merged));
    flipped[0].options[0].isCorrect = false;
    assert('edit_quiz_questions: the content check catches one flipped isCorrect', compareQuizContent(merged, flipped, { storedCount: 1 }).match === false);
    assert('set_course_access: a grant that lands is granted (read back, not the 200)',
      accessOutcome({ action: 'grant', before: false, after: true, sent: 'unknown' }) === 'granted');
    assert('set_course_access: a grant that does not land is queued-unconfirmed, never granted',
      accessOutcome({ action: 'grant', before: false, after: false, sent: 'unknown' }) === 'queued-unconfirmed');

  } catch (err) {
    bad('suite aborted', err.message);
  } finally {
    if (!KEEP) await teardown(api, creds, comms);
    else console.log('\n--keep set: leaving objects in place —', JSON.stringify(created));
    report();
  }
}

/** The quiz post stays a DRAFT (w8-9, 2026-11-07): the default run must publish nothing (no lesson, course or offer publish in a build
 *  without the orchestrator's go). The quiz questions, grading routes and batch replace are all exercised on a draft. */
async function assess_createQuiz(api, assess, productId, categoryId) {
  const post = await api.createPost({
    title: 'Knowledge check', categoryId, productId, sequenceNo: 1,
    contentType: 'quiz', visibility: 'draft',
  });
  await api.req('POST', `${api.M}/assessments/quiz`, { title: 'Knowledge check', postId: post.id, productId });
  return { post };
}

async function teardown(api, creds, comms) {
  console.log('\n[teardown]');
  const step = async (label, fn) => {
    try { await fn(); console.log(`  🧹 ${label}`); }
    catch (e) { console.log(`  ⚠️  ${label} — ${String(e.message).slice(0, 120)}`); }
  };
  if (created.issuedId) await step('issued credential', () => creds.deleteIssued(created.issuedId));
  if (created.templateId) await step('credential template', () => creds.deleteTemplate(created.templateId));
  if (created.offerId) await step('offer', () => api.req('DELETE', `${api.M}/offers/${created.offerId}`));
  if (created.productId) await step('product (cascades)', () => api.deleteProduct(created.productId));
  if (created.groupId) await step('community group (deactivate — no hard delete)', () => comms.deactivateGroup(created.groupId));
  if (created.contactId) await step('contact', () => api.req('DELETE', `https://backend.leadconnectorhq.com/contacts/${created.contactId}`));

  // NOTE: assessment submissions cannot be deleted (no route) — none created here.
}

/** One execute_action call on the ghl-multi public server (stdio), as the lane harness makes it. Used only when the public paths are
 *  configured. Returns { isError, text }. The server is started per call and killed after it. */
async function publicCall(actionId, params, flags = {}) {
  const { spawn } = await import('node:child_process');
  const child = spawn('npx', ['tsx', `${PUBLIC_DIR}/src/stdio.ts`], {
    cwd: PUBLIC_DIR, env: { ...process.env, GHL_ACCOUNTS_FILE: ACCOUNTS_FILE }, stdio: ['pipe', 'pipe', 'inherit'],
  });
  let buf = '';
  const waiting = new Map();
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
    }
  });
  let nextId = 1;
  const rpc = (method, rparams) => {
    const id = nextId++;
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: rparams })}\n`);
    return new Promise((resolve, reject) => {
      waiting.set(id, resolve);
      setTimeout(() => reject(new Error(`timeout on ${method}`)), 120000);
    });
  };
  try {
    await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'memberships-conformance', version: '0' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
    const reply = await rpc('tools/call', { name: 'execute_action', arguments: { action_id: actionId, params, locationId: LOCATION, ...flags } });
    return { isError: !!reply.result?.isError || !!reply.error, text: reply.result?.content?.[0]?.text ?? JSON.stringify(reply.error ?? reply.result ?? {}) };
  } finally {
    try { child.stdin.end(); } catch { /* already closed */ }
    child.kill('SIGKILL');
  }
}

function report() {
  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL');
  const skipped = results.filter(r => r.status === 'SKIP').length;
  console.log('\n' + '─'.repeat(60));
  console.log(`RESULT: ${pass} passed, ${fail.length} failed, ${skipped} skipped (member-side, unattendable)`);
  if (fail.length) {
    console.log('\nFAILURES — the API has likely drifted; re-verify against BUILD-API.md:');
    for (const f of fail) console.log(`  ❌ ${f.name}: ${f.detail}`);
  }
  console.log('─'.repeat(60) + '\n');
  process.exit(fail.length ? 1 : 0);
}

main().catch(e => { console.error('\nFATAL:', e.message); process.exit(1); });
