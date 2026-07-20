#!/usr/bin/env node
/**
 * Launchpad compiler — spec JSON in, built GHL Memberships course out.
 *
 *   GHL_TOKEN='eyJ...' node build-course.mjs <spec.json> [--dry-run]
 *   GHL_TOKEN='eyJ...' node build-course.mjs --delete <productId>
 *
 * The spec is the IR an AI would emit from a franchisor's videos/SOPs.
 * Everything it drives is EXECUTED-proven — see ../BUILD-API.md "Proof levels"
 * and `node ../conformance.mjs`.
 *
 * COVERS: course, chapters (order/drip/nesting/gating), lessons (rich HTML body,
 * video, audio, PDFs), quizzes WITH questions, assignments, free offer, theme,
 * credential templates, and enrollment.
 *
 * DOES NOT COVER (deliberately — unproven, see BUILD-API.md "Remaining gaps"):
 *   - paid offers  : one_time/recurring 500 on this account (no payment provider)
 *   - embed lessons: content_type is a closed ENUM; embedMediaId minting is uncaptured
 */
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { loadToken, assertHeadroom } from '../engine/auth.mjs';
import { GhlMembershipsApi } from '../engine/api.mjs';
import { Assessments } from '../engine/assessments.mjs';
import { Credentials } from '../engine/credentials.mjs';
import { Members } from '../engine/members.mjs';
import { makeCliMembershipsGateway } from './cli-gateway.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const deleteIdx = args.indexOf('--delete');
const deleteTarget = deleteIdx === -1 ? null : args[deleteIdx + 1];
const specPath = args.find(a => !a.startsWith('--') && a !== deleteTarget);

const LESSON_TYPES = ['lesson', 'quiz', 'assignment'];

// ---------- spec validation (fail before touching the account) ----------
function validate(spec) {
  const errs = [];
  if (!spec.course?.title) errs.push('course.title is required');
  if (!Array.isArray(spec.chapters) || !spec.chapters.length) errs.push('chapters[] must be non-empty');

  (spec.chapters || []).forEach((ch, i) => {
    if (!ch.title) errs.push(`chapters[${i}].title is required`);
    (ch.lessons || []).forEach((ls, j) => {
      const at = `chapters[${i}].lessons[${j}]`;
      if (!ls.title) errs.push(`${at}.title is required`);
      if (ls.type && !LESSON_TYPES.includes(ls.type)) {
        errs.push(`${at}.type must be ${LESSON_TYPES.join('|')} — note content_type is a closed ENUM; there is no embed/html/pdf lesson type`);
      }
      if (ls.type === 'quiz' && ls.questions) {
        if (!Array.isArray(ls.questions)) errs.push(`${at}.questions must be an array`);
        else ls.questions.forEach((q, k) => {
          const qat = `${at}.questions[${k}]`;
          if (!q.title) errs.push(`${qat}.title is required`);
          if (!Array.isArray(q.options) || q.options.length < 2) errs.push(`${qat}.options needs >= 2 entries`);
          else if (!q.options.some(o => o.isCorrect)) errs.push(`${qat} has no correct option (set isCorrect on at least one)`);
          if (q.questionType && !['single', 'multiple'].includes(q.questionType))
            errs.push(`${qat}.questionType must be single|multiple`);
        });
      }
      if (ls.embed && !ls.embed.src && !ls.embed.iframe)
        errs.push(`${at}.embed needs either {src,width,height} or {iframe:"<iframe ...>"}`);
      if (ls.embed && ls.video) errs.push(`${at} cannot have both video and embed`);
    });
  });

  const otype = spec.offer?.type;
  if (otype && !['free', 'one_time', 'recurring'].includes(otype)) {
    errs.push('offer.type must be free|one_time|recurring');
  } else if (otype && otype !== 'free') {
    errs.push(`offer.type "${otype}" is NOT supported by this compiler: paid offer creation returns 500 on an account with no payment provider connected. Only "free" is proven.`);
  }

  if (spec.credential && !spec.credential.title) errs.push('credential.title is required when credential is present');
  if (spec.enroll && !Array.isArray(spec.enroll)) errs.push('enroll must be an array of contactIds');
  return errs;
}

/** Rough wall-clock estimate so we fail before the ~1h token expires mid-build. */
function estimateSeconds(spec) {
  let s = 10;
  for (const ch of spec.chapters || []) {
    s += 2;
    for (const ls of ch.lessons || []) {
      s += 2;
      if (ls.video) s += 12;
      s += (ls.files || []).length * 5;
      if (ls.questions?.length) s += 2;
    }
  }
  if (spec.credential) s += 4;
  if (spec.enroll?.length) s += 3 + spec.enroll.length;
  if (spec.theme) s += 6;
  return s;
}

async function main() {
  if (deleteIdx !== -1) return doDelete(deleteTarget);

  if (!specPath) {
    console.error('usage: GHL_TOKEN=... node build-course.mjs <spec.json> [--dry-run]');
    process.exit(1);
  }
  const specDir = dirname(resolve(specPath));
  const spec = JSON.parse(await readFile(resolve(specPath), 'utf8'));

  const errs = validate(spec);
  if (errs.length) {
    console.error('Spec invalid:\n' + errs.map(e => ' - ' + e).join('\n'));
    process.exit(1);
  }
  const items = spec.chapters.reduce((n, c) => n + (c.lessons?.length || 0), 0);
  const est = estimateSeconds(spec);
  console.log(`Spec OK. ${spec.chapters.length} chapter(s), ${items} item(s). ~${est}s estimated.`);
  if (dryRun) { console.log('--dry-run: nothing sent.'); return; }

  const { token, claims, secondsRemaining } = loadToken();
  assertHeadroom(token, est);
  console.log(`Token OK (user ${claims.userId}, ${secondsRemaining}s left)`);

  const locationId = spec.locationId || process.env.GHL_LOC;
  const gw = makeCliMembershipsGateway({ token, loc: locationId, uid: claims.userId });
  const api = new GhlMembershipsApi({ gw });
  const assess = new Assessments(api);
  const creds = new Credentials(api);
  const members = new Members(api);

  const built = { locationId, chapters: [] };

  // ---------- 0. credential template (built first so lessons can reference it) ----------
  let certificateTemplateId = null;
  if (spec.credential) {
    const tpl = await creds.createTemplate({
      title: spec.credential.title,
      type: spec.credential.type || 'certificate',
    });
    certificateTemplateId = tpl._id;
    built.credentialTemplateId = tpl._id;
    console.log(`+ credential template "${spec.credential.title}" -> ${tpl._id}`);
  }

  // ---------- 1. course ----------
  const product = await api.createProduct(spec.course);
  built.productId = product.id;
  console.log(`+ course "${spec.course.title}" -> ${product.id}`);

  // ---------- 2. chapters + items ----------
  for (const [ci, ch] of spec.chapters.entries()) {
    const cat = await api.createCategory({
      title: ch.title, productId: product.id, sequenceNo: ci,
      dripDays: ch.dripDays ?? 0, description: ch.description ?? '',
    });
    console.log(`  + chapter "${ch.title}" -> ${cat.id}${ch.dripDays ? ` (drip ${ch.dripDays}d)` : ''}`);
    const chOut = { id: cat.id, title: ch.title, lessons: [] };

    for (const [li, ls] of (ch.lessons || []).entries()) {
      const type = ls.type || 'lesson';

      // ----- quiz (+ questions) -----
      if (type === 'quiz') {
        const post = await api.createPost({
          title: ls.title, description: ls.text || '', categoryId: cat.id,
          productId: product.id, sequenceNo: li, contentType: 'quiz',
          visibility: ls.visibility || 'published',
        });
        await api.req('POST', `${api.M}/assessments/quiz`,
          { title: ls.title, postId: post.id, productId: product.id });
        // quizId !== postId — must re-read to get the quiz's own id
        const quiz = await assess.getQuizByPost(post.id);
        const out = { type, postId: post.id, quizId: quiz.id, title: ls.title, questionCount: 0 };
        if (ls.questions?.length) {
          await assess.addQuestions(quiz.id, ls.questions);
          out.questionCount = ls.questions.length;
        }
        console.log(`    + quiz "${ls.title}" -> ${quiz.id} (${out.questionCount} question(s))`);
        chOut.lessons.push(out);
        continue;
      }

      // ----- assignment -----
      if (type === 'assignment') {
        const post = await api.createPost({
          title: ls.title, description: ls.text || '', categoryId: cat.id,
          productId: product.id, sequenceNo: li, contentType: 'assignment',
          visibility: ls.visibility || 'published',
        });
        await api.req('POST', `${api.M}/assessments/assignment`,
          { title: ls.title, postId: post.id, productId: product.id });
        const asg = await assess.getAssignmentByPost(post.id);
        console.log(`    + assignment "${ls.title}" -> ${asg.id}`);
        chOut.lessons.push({ type, postId: post.id, assignmentId: asg.id, title: ls.title });
        continue;
      }

      // ----- normal lesson -----
      // A text-only lesson must OMIT contentType: content_type is a MySQL ENUM
      // (video|audio|quiz|assignment) and 'text' is NOT a member of it.
      const contentType = ls.video ? 'video' : (ls.audio ? 'audio' : undefined);
      const embed = ls.embed
        ? (ls.embed.iframe ? GhlMembershipsApi.parseIframe(ls.embed.iframe) : ls.embed)
        : null;
      const post = await api.createPost({
        title: ls.title, description: ls.text || '', categoryId: cat.id,
        productId: product.id, sequenceNo: li, contentType,
        visibility: ls.visibility || 'published',
        embed,
      });
      const out = { type, postId: post.id, title: ls.title, embed: !!embed };
      const kind = embed ? 'embed' : (contentType || 'text');
      console.log(`    + lesson "${ls.title}" -> ${post.id} (${kind})`);

      // embedJson only persists via PUT — POST drops it silently (see api.setEmbed)
      if (embed) {
        const p = await api.setEmbed(post.id, embed);
        console.log(`        embed ${p.embedJson?.src ? 'OK' : 'FAILED'} (${embed.src})`);
      }

      const mediaPath = ls.video || ls.audio;
      if (mediaPath) {
        const { licenseId } = await api.uploadVideo({
          filePath: resolve(specDir, mediaPath), postId: post.id, title: ls.title,
        });
        out.licenseId = licenseId;
        console.log(`        media ${mediaPath} uploaded (license ${licenseId})`);
      }
      for (const [fi, f] of (ls.files || []).entries()) {
        await api.uploadMaterial({ filePath: resolve(specDir, f), postId: post.id, sequenceNo: fi + 1 });
        console.log(`        file  ${f} attached`);
      }
      chOut.lessons.push(out);
    }
    built.chapters.push(chOut);
  }

  // ---------- 3. offer ----------
  if (spec.offer !== null) {
    const o = spec.offer || {};
    const offer = await api.createOffer({
      title: o.title || spec.course.title, productIds: [product.id],
      type: 'free', amount: 0, currency: o.currency || 'EUR',
    });
    built.offerId = offer.id;
    if (o.publish !== false) {
      await members.publishOffer(offer.id);
      console.log(`+ offer (free, published) -> ${offer.id}`);
    } else {
      console.log(`+ offer (free, draft) -> ${offer.id}`);
    }
  }

  // ---------- 4. theme ----------
  if (spec.theme) {
    const { brandColor, heroTitleColor, instructor } = spec.theme;
    const { themeId } = await api.applyTheme({
      productId: product.id,
      templateId: spec.theme.templateId || 'NeoClassic',
      name: spec.theme.name || `${spec.course.title} Theme`,
      mutate: (t) => {
        if (brandColor && t?.product?.layout?.colorTheme?.accentColor)
          t.product.layout.colorTheme.accentColor.primaryAccent = brandColor;
        if (heroTitleColor && t?.product?.hero?.courseInfo?.title)
          t.product.hero.courseInfo.title.color = heroTitleColor;
        if (instructor) {
          const blk = (t?.product?.sidebar?.blocks || []).find(b => b.id === 'instructorBlock');
          if (blk) {
            if (instructor.name) blk.name.inputValue = instructor.name;
            if (instructor.title) blk.title.inputValue = instructor.title;
            if (instructor.bio) blk.bio.inputValue = instructor.bio;
          }
        }
      },
    });
    built.themeId = themeId;
    console.log(`+ theme applied -> ${themeId}`);
  }

  // ---------- 4b. auto-issue the credential on course completion ----------
  if (certificateTemplateId) {
    await creds.attach({
      templateId: certificateTemplateId,
      productId: product.id,
      type: spec.credential.type || 'certificate',
      eventType: 'product_complete',
    });
    const att = await creds.listAttachments(product.id);
    const n = (att.attachments || []).length;
    built.credentialAttached = n > 0;
    console.log(`+ credential auto-issue attached (event: product_complete) — ${n} attachment(s)`);
  }

  // ---------- 5. enrollment ----------
  if (spec.enroll?.length && built.offerId) {
    built.enrolled = [];
    for (const contactId of spec.enroll) {
      await members.grantOffer({ contactId, offerId: built.offerId });
      built.enrolled.push(contactId);
      console.log(`+ granted access to contact ${contactId}`);
    }
    try {
      const rows = await members.waitForEnrollment(product.id, { timeoutMs: 25000 });
      console.log(`  enrollment confirmed: ${rows.length} member(s) in user-progress`);
    } catch {
      console.log(`  ⚠️  enrollment not visible yet (grant is async — re-check user-progress)`);
    }
  }

  // ---------- 6. verify ----------
  // Must use GET /posts/{id} — the category tree omits post_materials + asset_urls.
  console.log('\n--- verify ---');
  let bad = 0;
  for (const ch of built.chapters) {
    for (const l of ch.lessons) {
      if (l.type === 'quiz') {
        const got = await assess.getQuizQuestions(l.quizId);
        const n = Array.isArray(got) ? got.length : (got.questions || []).length;
        if (n !== l.questionCount) { bad++; console.log(`FAIL ${l.title}: expected ${l.questionCount} question(s), found ${n}`); }
        else console.log(`PASS ${l.title} (${n} question(s))`);
        continue;
      }
      if (l.type === 'assignment') { console.log(`PASS ${l.title} (assignment)`); continue; }

      const full = await api.getPost(l.postId);
      const checks = {
        text: !!full.description,
        media: l.licenseId ? !!full.video?.id : true,
        playback: l.licenseId ? !!full.asset_urls?.url : true,
        embed: l.embed ? !!full.embedJson?.src : true,
      };
      const fail = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
      if (fail.length) { bad++; console.log(`FAIL ${l.title}: ${fail.join(', ')}`); }
      else console.log(`PASS ${l.title}`);
    }
  }

  console.log(`\n${bad ? bad + ' PROBLEM(S)' : 'BUILD OK'}`);
  console.log(JSON.stringify(built, null, 2));
  console.log(`\nOpen it: Memberships > Courses > Products > "${spec.course.title}"`);
  console.log(`Remove it: GHL_TOKEN=... node build-course.mjs --delete ${built.productId}`);
}

async function doDelete(productId) {
  if (!productId) { console.error('--delete needs a productId'); process.exit(1); }
  const { token, claims } = loadToken();
  const gw = makeCliMembershipsGateway({ token, loc: process.env.GHL_LOC, uid: claims.userId });
  const api = new GhlMembershipsApi({ gw });
  await api.deleteProduct(productId);
  const left = await api.listProducts();
  const gone = !left.some(p => p.id === productId);
  console.log(gone ? `Deleted ${productId}. Remaining: ${left.length}` : `WARNING: ${productId} still listed`);
  console.log('NOTE: offers and credential templates do NOT cascade — delete those separately.');
  process.exit(gone ? 0 : 1);
}

main().catch(e => { console.error('\n' + e.message); process.exit(1); });
