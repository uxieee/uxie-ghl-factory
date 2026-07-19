#!/usr/bin/env node
/**
 * LIVE CONFORMANCE SUITE for the GHL Memberships internal API.
 *
 *   GHL_TOKEN='<LC JWT>' node conformance.mjs
 *   GHL_TOKEN='...' GHL_LOCATION='<locId>' node conformance.mjs --keep
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
import { Members } from '../engine/members.mjs';
import { Assessments } from '../engine/assessments.mjs';
import { Credentials } from '../engine/credentials.mjs';
import { Communities } from '../engine/communities.mjs';
import { loadToken, safeClaims } from '../engine/auth.mjs';

const LOCATION = process.env.GHL_LOCATION || process.env.GHL_LOC;
if (!LOCATION) {
  console.error('GHL_LOCATION (or GHL_LOC) is required — the sub-account to run against.\n' +
    "  GHL_TOKEN='<jwt>' GHL_LOCATION='<locationId>' node conformance.mjs");
  process.exit(1);
}
const KEEP = process.argv.includes('--keep');
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

  const api = new GhlMembershipsApi({ token, locationId: LOCATION, userId: safeClaims(token).userId });
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

    const category = await api.createCategory({ title: 'Chapter 1', productId: product.id, sequenceNo: 0 });
    created.categoryId = category.id;
    assert('category created', !!category.id);

    // text lesson = OMIT contentType (content_type is a MySQL ENUM; 'text' is invalid)
    const textLesson = await api.createPost({
      title: 'Text lesson', description: '<p>body</p>',
      categoryId: category.id, productId: product.id, sequenceNo: 0, contentType: undefined,
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

    // ═══════════ 3. ASSIGNMENT ═══════════
    console.log('\n[3] assignment');
    const asgPost = await api.createPost({
      title: 'Upload licence', categoryId: category.id, productId: product.id,
      sequenceNo: 2, contentType: 'assignment',
    });
    await api.req('POST', `${api.M}/assessments/assignment`, { title: 'Upload licence', postId: asgPost.id, productId: product.id });
    const asg = await assess.getAssignmentByPost(asgPost.id);
    assert('assignment object readable', !!asg.id, asg.id);

    // ═══════════ 4. ENROLLMENT ROUND-TRIP ═══════════
    console.log('\n[4] enrollment round-trip');
    const offer = await api.createOffer({ title: NAME('OFFER'), productIds: [product.id] });
    created.offerId = offer.id;
    await members.publishOffer(offer.id);
    assert('offer created + published', !!offer.id, offer.id);

    const contact = await api.req('POST', 'https://backend.leadconnectorhq.com/contacts/', {
      locationId: LOCATION, firstName: 'TEST-CONF', lastName: 'MEMBER',
      email: `test-conf-${STAMP}@example.invalid`, tags: ['test-conf-delete-me'],
    });
    created.contactId = contact.contact.id;
    assert('contact created', !!created.contactId, created.contactId);

    await members.grantOffer({ contactId: created.contactId, offerId: offer.id });
    let enrolled = [];
    try { enrolled = await members.waitForEnrollment(product.id, { timeoutMs: 25000 }); } catch (e) { /* asserted below */ }
    assert('GRANT: member appears in user-progress', enrolled.length === 1, `${enrolled.length} row(s)`);

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

    // ═══════════ 6. COMMUNITIES (admin rail) ═══════════
    console.log('\n[6] communities (admin rail)');
    const group = await comms.createGroup({ name: NAME('GROUP'), slug: `test-conf-${STAMP}`, description: 'conformance' });
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

  } catch (err) {
    bad('suite aborted', err.message);
  } finally {
    if (!KEEP) await teardown(api, creds, comms);
    else console.log('\n--keep set: leaving objects in place —', JSON.stringify(created));
    report();
  }
}

/** createQuiz in api.mjs sets visibility draft; we want it published for realism. */
async function assess_createQuiz(api, assess, productId, categoryId) {
  const post = await api.createPost({
    title: 'Knowledge check', categoryId, productId, sequenceNo: 1,
    contentType: 'quiz', visibility: 'published',
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
