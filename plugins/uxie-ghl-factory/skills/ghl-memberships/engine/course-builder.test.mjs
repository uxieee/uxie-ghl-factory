import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { previewCourseSpec, validateCourseSpec } from './course-builder.mjs';

test('course preview reports every object class without performing account access', () => {
  const preview = previewCourseSpec({
    course: { title: 'Launchpad' },
    chapters: [{
      title: 'Start',
      lessons: [
        { title: 'Read' },
        { title: 'Watch', embed: { src: 'https://player.example/video' } },
        { type: 'quiz', title: 'Check', questions: [{ title: 'Q', options: [{ statement: 'A', isCorrect: true }, { statement: 'B' }] }] },
        { type: 'assignment', title: 'Upload' },
      ],
    }],
    offer: { type: 'free' },
    credential: { title: 'Certificate' },
    theme: { name: 'Theme' },
  });

  assert.deepEqual(preview.errors, []);
  assert.deepEqual(preview.wouldCreate.counts, {
    courses: 1,
    chapters: 1,
    lessons: 2,
    quizzes: 1,
    assignments: 1,
    offers: 1,
    credentialTemplates: 1,
    credentialAttachments: 1,
    themes: 1,
    enrollments: 0,
  });
  assert.equal(preview.wouldCreate.embeds, 1);
});

// CORRECTED 2026-08-24 (live, GROM UK with Stripe + GROM AU): this test used to assert
// that ANY paid offer was rejected because "paid offers return 500 without a payment
// provider". That premise was false. The 500 came from sending one_time/recurring, which
// are not the wire enum — models/Offer.ts says free|onetime|subscription|multiple. The
// differential: the wrong enum 500s on an account that HAS Stripe; the right enum creates
// an offer that reads back with its amount. Paid offers are now supported; what is
// rejected is a paid offer with no amount.
test('MCP preview rejects a paid offer with no amount, and non-absolute local media', () => {
  const preview = previewCourseSpec({
    course: { title: 'Launchpad' },
    chapters: [{ title: 'Start', lessons: [{ title: 'Watch', video: './intro.mp4' }] }],
    offer: { type: 'one_time' },
  }, { requireAbsoluteMediaPaths: true });

  assert.match(preview.errors.join('\n'), /requires offer\.amount > 0/);
  assert.match(preview.errors.join('\n'), /absolute local path/);
});

test('a paid offer WITH an amount validates, in both spellings', () => {
  for (const type of ['one_time', 'onetime', 'recurring', 'subscription']) {
    const spec = {
      course: { title: 'Launchpad' },
      chapters: [{ title: 'Start', lessons: [{ title: 'Intro', text: '<p>hi</p>' }] }],
      offer: { type, amount: 1000, currency: 'USD',
        ...(type === 'recurring' || type === 'subscription' ? { interval: 'month' } : {}) },
    };
    assert.deepEqual(validateCourseSpec(spec), [], `${type} should validate`);
  }
});

test('offer.interval is refused on a non-recurring offer', () => {
  const errs = validateCourseSpec({
    course: { title: 'x' },
    chapters: [{ title: 'c', lessons: [{ title: 'l', text: '<p>t</p>' }] }],
    offer: { type: 'one_time', amount: 500, interval: 'month' },
  });
  assert.match(errs.join('\n'), /interval only applies/);
});

// ─── Unknown spec keys must fail at PREVIEW, not after objects exist ──────────────────
// LIVE-CAUGHT 2026-07-21 (GROM AU): lessons authored with `body` instead of `text`
// previewed as valid:true/errors:[] and then built two lessons with EMPTY bodies; the
// problem only surfaced in post-build verification, after the course existed.
test('a lesson key typo is rejected at validation, with a hint', () => {
  const errs = validateCourseSpec({ course: { title: 'x' },
    chapters: [{ title: 'c', lessons: [{ title: 'l', body: '<p>x</p>' }] }] });
  assert.ok(errs.some((e) => /unknown key "body"/.test(e)), 'must reject the typo');
  assert.ok(errs.some((e) => /did you mean "text"/.test(e)), 'must hint the real key');
});

test('the shipped example spec still validates (guard does not over-reject)', () => {
  const example = JSON.parse(readFileSync(new URL('../references/example-spec.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateCourseSpec(example), []);
});

test('unknown keys are caught at every level', () => {
  const errs = validateCourseSpec({ course: { title: 'x', bogusCourse: 1 }, bogusTop: 1,
    chapters: [{ title: 'c', bogusChapter: 1, lessons: [{ title: 'l', text: 't' }] }] });
  for (const k of ['bogusTop', 'bogusCourse', 'bogusChapter']) {
    assert.ok(errs.some((e) => e.includes(k)), `${k} not caught`);
  }
});

test('MF2: unknown keys in offer/theme/credential/instructor sub-objects are rejected', () => {
  const errs = validateCourseSpec({
    course: { title: 'x' },
    chapters: [{ title: 'c', lessons: [{ title: 'l', text: 't' }] }],
    offer: { type: 'free', bogusOffer: 1 },
    theme: { name: 'T', brandColour: '#000', instructor: { name: 'A', bogusInstructor: 1 } },
    credential: { title: 'Cert', bogusCredential: 1 },
  });
  for (const [scope, key] of [['spec.offer', 'bogusOffer'], ['spec.credential', 'bogusCredential'],
    ['spec.theme.instructor', 'bogusInstructor']]) {
    assert.ok(errs.some((e) => e.includes(scope) && e.includes(key)), `${scope}.${key} not caught`);
  }
  // British-spelling near-miss for a theme key is caught AND hinted to the real key.
  assert.ok(errs.some((e) => /unknown key "brandColour"/.test(e) && /did you mean "brandColor"/.test(e)),
    'theme.brandColour typo must be caught and hinted');
});
