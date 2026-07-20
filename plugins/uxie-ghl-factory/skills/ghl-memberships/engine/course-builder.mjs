import { isAbsolute, resolve } from 'node:path';
import { GhlMembershipsApi } from './api.mjs';
import { Assessments } from './assessments.mjs';
import { Credentials } from './credentials.mjs';
import { Members } from './members.mjs';

const LESSON_TYPES = ['lesson', 'quiz', 'assignment'];

// Known spec keys, per level. An unrecognised key is REJECTED at validation rather than
// ignored — LIVE-CAUGHT 2026-07-21 (GROM AU): a spec whose lessons carried `body` instead
// of `text` previewed as `valid: true, errors: []`, then built two lessons with EMPTY
// bodies. The failure only surfaced in post-build verification, i.e. after the objects
// already existed on the account. A preview that green-lights a broken spec is worse than
// no preview: it is the confirm gate telling you it is safe to proceed.
// Derived from what the engine ACTUALLY reads (grep of `lesson.` / `chapter.` / `spec.` /
// `question.` across engine/*.mjs) cross-checked against references/course-spec.md and
// example-spec.json — NOT guessed. Guessing here is worse than not guarding: a key the
// engine honours but this list omits would be rejected as "unknown" and break valid specs.
const KNOWN_KEYS = {
  spec: ['locationId', 'course', 'theme', 'offer', 'credential', 'chapters', 'enroll'],
  course: ['title', 'description'],
  chapter: ['title', 'description', 'dripDays', 'lessons'],
  // `awardCredential` is authored in the shipped example spec but is consumed indirectly,
  // so a grep of `lesson.*` misses it — the example-spec regression test below is what
  // catches an over-strict list. Do not narrow this without re-running that test.
  lesson: ['title', 'text', 'type', 'video', 'audio', 'files', 'embed', 'questions',
    'visibility', 'awardCredential'],
  question: ['title', 'options', 'questionType', 'explanation'],
};

function checkKeys(obj, allowed, at, errors, hints = {}) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  for (const key of Object.keys(obj)) {
    if (allowed.includes(key)) continue;
    const hint = hints[key] ? ` — did you mean "${hints[key]}"?` : '';
    errors.push(`${at} has unknown key "${key}"${hint}. Known keys: ${allowed.join(', ')}. `
      + 'Unknown keys are not silently ignored: they would build an object missing that content.');
  }
}

// Near-miss keys seen in the wild, mapped to what the author almost certainly meant.
const LESSON_KEY_HINTS = { body: 'text', html: 'text', content: 'text', description: 'text' };

export function validateCourseSpec(spec, { requireAbsoluteMediaPaths = false } = {}) {
  const errors = [];
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return ['spec must be an object'];
  }
  checkKeys(spec, KNOWN_KEYS.spec, 'spec', errors);
  checkKeys(spec.course, KNOWN_KEYS.course, 'spec.course', errors);
  if (!spec.course?.title) errors.push('course.title is required');
  if (!Array.isArray(spec.chapters) || !spec.chapters.length) {
    errors.push('chapters[] must be non-empty');
  }

  (spec.chapters || []).forEach((chapter, chapterIndex) => {
    checkKeys(chapter, KNOWN_KEYS.chapter, `chapters[${chapterIndex}]`, errors);
    if (!chapter.title) errors.push(`chapters[${chapterIndex}].title is required`);
    if (chapter.lessons !== undefined && !Array.isArray(chapter.lessons)) {
      errors.push(`chapters[${chapterIndex}].lessons must be an array`);
      return;
    }
    (chapter.lessons || []).forEach((lesson, lessonIndex) => {
      const at = `chapters[${chapterIndex}].lessons[${lessonIndex}]`;
      checkKeys(lesson, KNOWN_KEYS.lesson, at, errors, LESSON_KEY_HINTS);
      if (!lesson.title) errors.push(`${at}.title is required`);
      if (lesson.type && !LESSON_TYPES.includes(lesson.type)) {
        errors.push(`${at}.type must be ${LESSON_TYPES.join('|')} — content_type is a closed enum; embed/html/pdf/text are not lesson types`);
      }
      if (lesson.type === 'quiz' && lesson.questions) {
        if (!Array.isArray(lesson.questions)) errors.push(`${at}.questions must be an array`);
        else lesson.questions.forEach((question, questionIndex) => {
          const questionAt = `${at}.questions[${questionIndex}]`;
          checkKeys(question, KNOWN_KEYS.question, questionAt, errors);
          if (!question.title) errors.push(`${questionAt}.title is required`);
          if (!Array.isArray(question.options) || question.options.length < 2) {
            errors.push(`${questionAt}.options needs >= 2 entries`);
          } else if (!question.options.some((option) => option.isCorrect)) {
            errors.push(`${questionAt} has no correct option (set isCorrect on at least one)`);
          }
          if (question.questionType && !['single', 'multiple'].includes(question.questionType)) {
            errors.push(`${questionAt}.questionType must be single|multiple`);
          }
        });
      }
      if (lesson.embed && !lesson.embed.src && !lesson.embed.iframe) {
        errors.push(`${at}.embed needs either {src,width,height} or {iframe:"<iframe ...>"}`);
      }
      if (lesson.embed && (lesson.video || lesson.audio)) {
        errors.push(`${at} cannot combine embed with video or audio`);
      }
      if (lesson.video && lesson.audio) errors.push(`${at} cannot have both video and audio`);

      if (requireAbsoluteMediaPaths) {
        const paths = [lesson.video, lesson.audio, ...(Array.isArray(lesson.files) ? lesson.files : [])]
          .filter((value) => typeof value === 'string' && value.length > 0);
        for (const mediaPath of paths) {
          if (!isAbsolute(mediaPath)) {
            errors.push(`${at} local media path "${mediaPath}" must be an absolute local path when invoked through MCP`);
          }
        }
      }
    });
  });

  const offerType = spec.offer?.type;
  if (offerType && !['free', 'one_time', 'recurring'].includes(offerType)) {
    errors.push('offer.type must be free|one_time|recurring');
  } else if (offerType && offerType !== 'free') {
    errors.push(`offer.type "${offerType}" is unsupported: paid offers return 500 without a payment provider. Only "free" is proven.`);
  }
  if (spec.credential && !spec.credential.title) {
    errors.push('credential.title is required when credential is present');
  }
  if (spec.enroll && !Array.isArray(spec.enroll)) {
    errors.push('enroll must be an array of contactIds');
  }
  return errors;
}

export function estimateCourseSeconds(spec) {
  let seconds = 10;
  for (const chapter of spec?.chapters || []) {
    seconds += 2;
    for (const lesson of chapter.lessons || []) {
      seconds += 2;
      if (lesson.video || lesson.audio) seconds += 12;
      seconds += (lesson.files || []).length * 5;
      if (lesson.questions?.length) seconds += 2;
    }
  }
  if (spec?.credential) seconds += 4;
  if (spec?.enroll?.length) seconds += 3 + spec.enroll.length;
  if (spec?.theme) seconds += 6;
  return seconds;
}

export function previewCourseSpec(spec, options = {}) {
  const errors = validateCourseSpec(spec, options);
  const chapters = Array.isArray(spec?.chapters) ? spec.chapters : [];
  const lessons = chapters.flatMap((chapter) => Array.isArray(chapter.lessons) ? chapter.lessons : []);
  const quizzes = lessons.filter((lesson) => lesson.type === 'quiz');
  const assignments = lessons.filter((lesson) => lesson.type === 'assignment');
  const ordinaryLessons = lessons.filter((lesson) => !['quiz', 'assignment'].includes(lesson.type));
  const localMedia = lessons.flatMap((lesson) => [
    lesson.video ? { kind: 'video', path: lesson.video, lesson: lesson.title } : null,
    lesson.audio ? { kind: 'audio', path: lesson.audio, lesson: lesson.title } : null,
    ...(Array.isArray(lesson.files)
      ? lesson.files.map((path) => ({ kind: 'material', path, lesson: lesson.title }))
      : []),
  ].filter(Boolean));

  return {
    valid: errors.length === 0,
    errors,
    estimatedSeconds: estimateCourseSeconds(spec),
    wouldCreate: {
      counts: {
        courses: spec?.course?.title ? 1 : 0,
        chapters: chapters.length,
        lessons: ordinaryLessons.length,
        quizzes: quizzes.length,
        assignments: assignments.length,
        offers: spec?.offer === null ? 0 : 1,
        credentialTemplates: spec?.credential ? 1 : 0,
        credentialAttachments: spec?.credential ? 1 : 0,
        themes: spec?.theme ? 1 : 0,
        enrollments: Array.isArray(spec?.enroll) ? spec.enroll.length : 0,
      },
      courseTitle: spec?.course?.title ?? null,
      chapterTitles: chapters.map((chapter) => chapter.title ?? null),
      lessonTitles: ordinaryLessons.map((lesson) => lesson.title ?? null),
      quizTitles: quizzes.map((lesson) => lesson.title ?? null),
      assignmentTitles: assignments.map((lesson) => lesson.title ?? null),
      offer: spec?.offer === null ? null : { type: 'free', publish: spec?.offer?.publish !== false },
      credential: spec?.credential
        ? { title: spec.credential.title ?? null, type: spec.credential.type ?? 'certificate' }
        : null,
      embeds: ordinaryLessons.filter((lesson) => lesson.embed).length,
      localMedia,
    },
    notes: [
      'Preview only: validation and counts perform no account calls.',
      'Paid offers are unsupported; only free offers are proven.',
      'Embeds are lesson.embed on a video post followed by PUT embedJson; embed is not a content_type.',
    ],
  };
}

export async function buildCourse({
  gw,
  spec,
  specDir = process.cwd(),
  log = () => {},
  requireAbsoluteMediaPaths = false,
}) {
  const preview = previewCourseSpec(spec, { requireAbsoluteMediaPaths });
  const built = { locationId: gw?.loc ?? null, chapters: [] };
  const verification = { problems: 0, checks: [] };
  if (!preview.valid) {
    return {
      ok: false,
      preview,
      built,
      verification,
      failurePhase: 'validation',
      writeOutcomeAmbiguous: false,
      error: null,
    };
  }

  const api = new GhlMembershipsApi({ gw });
  const assessments = new Assessments(api);
  const credentials = new Credentials(api);
  const members = new Members(api);
  let failurePhase = 'initialize';
  let currentOperationWasWrite = false;
  const phase = (name, write = true) => {
    failurePhase = name;
    currentOperationWasWrite = write;
  };

  try {
    let certificateTemplateId = null;
    if (spec.credential) {
      phase('credential_template_create');
      const template = await credentials.createTemplate({
        title: spec.credential.title,
        type: spec.credential.type || 'certificate',
      });
      certificateTemplateId = template._id;
      built.credentialTemplateId = template._id;
      log(`+ credential template "${spec.credential.title}" -> ${template._id}`);
    }

    phase('product_create');
    const product = await api.createProduct(spec.course);
    built.productId = product.id;
    log(`+ course "${spec.course.title}" -> ${product.id}`);

    for (const [chapterIndex, chapter] of spec.chapters.entries()) {
      phase('category_create');
      const category = await api.createCategory({
        title: chapter.title,
        productId: product.id,
        sequenceNo: chapterIndex,
        dripDays: chapter.dripDays ?? 0,
        description: chapter.description ?? '',
      });
      const chapterOutput = { id: category.id, title: chapter.title, lessons: [] };
      built.chapters.push(chapterOutput);
      log(`  + chapter "${chapter.title}" -> ${category.id}${chapter.dripDays ? ` (drip ${chapter.dripDays}d)` : ''}`);

      for (const [lessonIndex, lesson] of (chapter.lessons || []).entries()) {
        const type = lesson.type || 'lesson';
        if (type === 'quiz') {
          phase('quiz_post_create');
          const post = await api.createPost({
            title: lesson.title,
            description: lesson.text || '',
            categoryId: category.id,
            productId: product.id,
            sequenceNo: lessonIndex,
            contentType: 'quiz',
            visibility: lesson.visibility || 'published',
          });
          const output = { type, postId: post.id, quizId: null, title: lesson.title, questionCount: 0 };
          chapterOutput.lessons.push(output);
          phase('quiz_create');
          await api.req('POST', `${api.M}/assessments/quiz`, {
            title: lesson.title,
            postId: post.id,
            productId: product.id,
          });
          phase('quiz_read', false);
          const quiz = await assessments.getQuizByPost(post.id);
          output.quizId = quiz.id;
          if (lesson.questions?.length) {
            phase('quiz_questions_create');
            await assessments.addQuestions(quiz.id, lesson.questions);
            output.questionCount = lesson.questions.length;
          }
          log(`    + quiz "${lesson.title}" -> ${quiz.id} (${output.questionCount} question(s))`);
          continue;
        }

        if (type === 'assignment') {
          phase('assignment_post_create');
          const post = await api.createPost({
            title: lesson.title,
            description: lesson.text || '',
            categoryId: category.id,
            productId: product.id,
            sequenceNo: lessonIndex,
            contentType: 'assignment',
            visibility: lesson.visibility || 'published',
          });
          const output = { type, postId: post.id, assignmentId: null, title: lesson.title };
          chapterOutput.lessons.push(output);
          phase('assignment_create');
          await api.req('POST', `${api.M}/assessments/assignment`, {
            title: lesson.title,
            postId: post.id,
            productId: product.id,
          });
          phase('assignment_read', false);
          const assignment = await assessments.getAssignmentByPost(post.id);
          output.assignmentId = assignment.id;
          log(`    + assignment "${lesson.title}" -> ${assignment.id}`);
          continue;
        }

        const contentType = lesson.video ? 'video' : (lesson.audio ? 'audio' : undefined);
        const embed = lesson.embed
          ? (lesson.embed.iframe ? GhlMembershipsApi.parseIframe(lesson.embed.iframe) : lesson.embed)
          : null;
        phase('lesson_create');
        const post = await api.createPost({
          title: lesson.title,
          description: lesson.text || '',
          categoryId: category.id,
          productId: product.id,
          sequenceNo: lessonIndex,
          contentType,
          visibility: lesson.visibility || 'published',
          embed,
        });
        const output = { type, postId: post.id, title: lesson.title, embed: !!embed };
        chapterOutput.lessons.push(output);
        log(`    + lesson "${lesson.title}" -> ${post.id} (${embed ? 'embed' : (contentType || 'text')})`);

        if (embed) {
          phase('lesson_embed_put');
          const persisted = await api.setEmbed(post.id, embed);
          log(`        embed ${persisted.embedJson?.src ? 'OK' : 'FAILED'} (${embed.src})`);
        }

        const mediaPath = lesson.video || lesson.audio;
        if (mediaPath) {
          phase('media_upload');
          const { licenseId } = await api.uploadVideo({
            filePath: resolve(specDir, mediaPath),
            postId: post.id,
            title: lesson.title,
          });
          output.licenseId = licenseId;
          log(`        media ${mediaPath} uploaded (license ${licenseId})`);
        }
        for (const [fileIndex, filePath] of (lesson.files || []).entries()) {
          phase('material_upload');
          await api.uploadMaterial({
            filePath: resolve(specDir, filePath),
            postId: post.id,
            sequenceNo: fileIndex + 1,
          });
          log(`        file  ${filePath} attached`);
        }
      }
    }

    if (spec.offer !== null) {
      const offerSpec = spec.offer || {};
      phase('offer_create');
      const offer = await api.createOffer({
        title: offerSpec.title || spec.course.title,
        productIds: [product.id],
        type: 'free',
        amount: 0,
        currency: offerSpec.currency || 'EUR',
      });
      built.offerId = offer.id;
      if (offerSpec.publish !== false) {
        phase('offer_publish');
        await members.publishOffer(offer.id);
        log(`+ offer (free, published) -> ${offer.id}`);
      } else {
        log(`+ offer (free, draft) -> ${offer.id}`);
      }
    }

    if (spec.theme) {
      const { brandColor, heroTitleColor, instructor } = spec.theme;
      phase('theme_apply');
      const { themeId } = await api.applyTheme({
        productId: product.id,
        templateId: spec.theme.templateId || 'NeoClassic',
        name: spec.theme.name || `${spec.course.title} Theme`,
        mutate: (themeData) => {
          if (brandColor && themeData?.product?.layout?.colorTheme?.accentColor) {
            themeData.product.layout.colorTheme.accentColor.primaryAccent = brandColor;
          }
          if (heroTitleColor && themeData?.product?.hero?.courseInfo?.title) {
            themeData.product.hero.courseInfo.title.color = heroTitleColor;
          }
          if (instructor) {
            const block = (themeData?.product?.sidebar?.blocks || [])
              .find((candidate) => candidate.id === 'instructorBlock');
            if (block) {
              if (instructor.name) block.name.inputValue = instructor.name;
              if (instructor.title) block.title.inputValue = instructor.title;
              if (instructor.bio) block.bio.inputValue = instructor.bio;
            }
          }
        },
      });
      built.themeId = themeId;
      log(`+ theme applied -> ${themeId}`);
    }

    if (certificateTemplateId) {
      phase('credential_attachment_create');
      await credentials.attach({
        templateId: certificateTemplateId,
        productId: product.id,
        type: spec.credential.type || 'certificate',
        eventType: 'product_complete',
      });
      phase('credential_attachment_read', false);
      const attachments = await credentials.listAttachments(product.id);
      const count = (attachments.attachments || []).length;
      built.credentialAttached = count > 0;
      log(`+ credential auto-issue attached (event: product_complete) — ${count} attachment(s)`);
    }

    if (spec.enroll?.length && built.offerId) {
      built.enrolled = [];
      for (const contactId of spec.enroll) {
        phase('offer_grant');
        await members.grantOffer({ contactId, offerId: built.offerId });
        built.enrolled.push(contactId);
        log(`+ granted access to contact ${contactId}`);
      }
      phase('enrollment_read', false);
      try {
        const rows = await members.waitForEnrollment(product.id, { timeoutMs: 25000 });
        built.enrollmentConfirmed = rows.length;
        log(`  enrollment confirmed: ${rows.length} member(s) in user-progress`);
      } catch {
        built.enrollmentConfirmed = null;
        log('  enrollment not visible yet (grant is async — re-check user-progress)');
      }
    }

    for (const chapter of built.chapters) {
      for (const lesson of chapter.lessons) {
        if (lesson.type === 'quiz') {
          phase('quiz_questions_verify', false);
          const response = await assessments.getQuizQuestions(lesson.quizId);
          const count = Array.isArray(response) ? response.length : (response.questions || []).length;
          const passed = count === lesson.questionCount;
          verification.checks.push({ type: 'quiz', id: lesson.quizId, title: lesson.title, passed, expected: lesson.questionCount, observed: count });
          if (!passed) verification.problems++;
          continue;
        }
        if (lesson.type === 'assignment') {
          verification.checks.push({ type: 'assignment', id: lesson.assignmentId, title: lesson.title, passed: true });
          continue;
        }
        phase('lesson_verify', false);
        const full = await api.getPost(lesson.postId);
        const checks = {
          text: !!full.description,
          media: lesson.licenseId ? !!full.video?.id : true,
          playback: lesson.licenseId ? !!full.asset_urls?.url : true,
          embed: lesson.embed ? !!full.embedJson?.src : true,
        };
        const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
        verification.checks.push({ type: 'lesson', id: lesson.postId, title: lesson.title, passed: failed.length === 0, failed });
        if (failed.length) verification.problems++;
      }
    }

    return {
      ok: verification.problems === 0,
      preview,
      built,
      verification,
      failurePhase: verification.problems ? 'verification' : null,
      writeOutcomeAmbiguous: false,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      preview,
      built,
      verification,
      failurePhase,
      writeOutcomeAmbiguous: currentOperationWasWrite && !error?.gatewayResponse,
      error,
    };
  }
}
