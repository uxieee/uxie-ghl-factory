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

// The wire enum for offer type is free|onetime|subscription|multiple (models/Offer.ts) —
// NOT one_time/recurring, which 500 even on an account that has Stripe configured. Paid
// offers are supported; what this test asserts is rejected is a paid offer with no amount.
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

// ── bl-796 (w8-3): build_course must not publish what the spec marks draft ──────────────────────────────────────────────
// A fake gateway records every write. The fake answers just enough for buildCourse to run to the end.
function fakeGateway() {
  const writes = [];
  let n = 0;
  const id = (p) => `${p}${++n}`;
  const ok = (json) => ({ ok: true, status: 200, json });
  const gw = {
    loc: 'LOC',
    uid: 'UID',
    writes,
    async call(method, path, body) {
      if (method !== 'GET') writes.push({ method, path, body });
      if (method === 'POST' && /\/products$/.test(path)) return ok({ id: id('P') });
      if (method === 'POST' && /\/categories$/.test(path)) return ok({ id: id('C') });
      if (method === 'POST' && /\/posts$/.test(path)) return ok({ id: id('L') });
      if (method === 'POST' && /\/assessments\/quiz$/.test(path)) return ok({ quiz: { id: id('QZ') } });
      if (method === 'POST' && /\/assessments\/assignment$/.test(path)) return ok({ assignment: { id: id('AS') } });
      if (method === 'GET' && /\/assessments\/quiz\/[^/]+$/.test(path)) return ok({ id: id('QZ') });
      if (method === 'GET' && /\/assessments\/assignment\/[^/]+$/.test(path)) return ok({ id: id('AS') });
      if (method === 'POST' && /\/assessments\/quiz\/questions$/.test(path)) return ok({});
      if (method === 'GET' && /\/assessments\/quiz\/questions\//.test(path)) return ok({ questions: [{}, {}] });
      if (method === 'GET' && /\/posts\//.test(path)) return ok({ description: 'x' });
      return ok({});
    },
  };
  return gw;
}
const visibilityOf = (gw, pathRe) => gw.writes.filter((w) => pathRe.test(w.path)).map((w) => w.body?.visibility);

test('bl-796: a chapter whose lessons are draft, and the undeclared quiz and assignment in it, are written draft', async () => {
  const { buildCourse } = await import('./course-builder.mjs');
  const gw = fakeGateway();
  await buildCourse({
    gw,
    spec: {
      course: { title: 'TEST-CONF-W8 unit' },
      offer: { type: 'free', publish: false },
      chapters: [
        { title: 'C1', lessons: [{ title: 'L1', visibility: 'draft' }, { type: 'assignment', title: 'A1' }, { type: 'quiz', title: 'Q1', questions: [{ title: 'q', options: [{ statement: 'a', isCorrect: true }, { statement: 'b' }] }] }] },
        { title: 'C2', lessons: [{ title: 'L2', visibility: 'published' }, { type: 'quiz', title: 'Q2', questions: [{ title: 'q', options: [{ statement: 'a', isCorrect: true }, { statement: 'b' }] }] }] },
      ],
    },
  });
  const categories = visibilityOf(gw, /\/categories$/);
  assert.deepEqual(categories, ['draft', 'published'], 'chapter 1 has only draft lessons: draft; chapter 2 has a published lesson: published');
  const posts = visibilityOf(gw, /\/posts$/);
  assert.deepEqual(posts, ['draft', 'draft', 'draft', 'published', 'draft'], 'in creation order: L1 draft; A1 and Q1 unmarked: draft; L2 published; Q2 unmarked: draft (w8-11: items are published only when the spec marks them)');
  const assignments = visibilityOf(gw, /\/assessments\/assignment$/);
  assert.equal(assignments.length, 1);
});

test('w8-11: default is DRAFT: a spec with no visibility anywhere writes every chapter and post as draft, and publishes nothing', async () => {
  const { buildCourse } = await import('./course-builder.mjs');
  const gw = fakeGateway();
  await buildCourse({
    gw,
    spec: {
      course: { title: 'TEST-CONF-W8 unit' },
      offer: null,
      chapters: [{ title: 'C1', lessons: [{ title: 'L1' }, { type: 'assignment', title: 'A1' }] }],
    },
  });
  assert.deepEqual(visibilityOf(gw, /\/categories$/), ['draft']);
  assert.deepEqual(visibilityOf(gw, /\/posts$/), ['draft', 'draft']);
  assert.ok(!gw.writes.some((w) => w.method === 'PUT'), 'nothing is PUT (no publish) on a default run');
});

test('w8-11: an offer is published only when the spec says publish: true', async () => {
  const { buildCourse } = await import('./course-builder.mjs');
  const base = { course: { title: 'TEST-CONF-W8 offer' }, chapters: [{ title: 'C1', lessons: [{ title: 'L1' }] }] };
  const gwDefault = fakeGateway();
  await buildCourse({ gw: gwDefault, spec: { ...base, offer: { type: 'free' } } });
  assert.ok(!gwDefault.writes.some((w) => w.method === 'PUT' && /\/offers\//.test(w.path)), 'no offer publish without publish: true');
  const gwAsked = fakeGateway();
  await buildCourse({ gw: gwAsked, spec: { ...base, offer: { type: 'free', publish: true } } });
  const puts = gwAsked.writes.filter((w) => w.method === 'PUT' && /\/offers\//.test(w.path));
  assert.equal(puts.length, 1, 'publish: true publishes the offer once');
  assert.equal(puts[0].body.visibility, 'published');
});

test('w8-11: a chapter is published only when the spec publishes it or one of its lessons; an unmarked lesson beside a published one is draft', async () => {
  const { buildCourse } = await import('./course-builder.mjs');
  const gw = fakeGateway();
  await buildCourse({
    gw,
    spec: {
      course: { title: 'TEST-CONF-W8 mixed' },
      offer: null,
      chapters: [
        { title: 'C1', lessons: [{ title: 'L1', visibility: 'published' }, { title: 'L2' }] },
        { title: 'C2', lessons: [{ title: 'L3' }] },
      ],
    },
  });
  assert.deepEqual(visibilityOf(gw, /\/categories$/), ['published', 'draft']);
  assert.deepEqual(visibilityOf(gw, /\/posts$/), ['published', 'draft', 'draft']);
});

// ── w8-7: the spec preview refuses a paid offer with no explicit currency; free needs neither ─────────────────────────
test('w8-7: a one-time spec offer with no currency is a preview error; a free one is not', () => {
  const base = { course: { title: 'Offer check' }, chapters: [{ title: 'C', lessons: [{ title: 'L' }] }] };
  const paid = previewCourseSpec({ ...base, offer: { type: 'one_time', amount: 25 } });
  assert.ok(paid.errors.some((e) => /currency/.test(e)), `expected a currency error, got ${JSON.stringify(paid.errors)}`);
  const free = previewCourseSpec({ ...base, offer: { type: 'free' } });
  assert.deepEqual(free.errors, []);
  const sub = previewCourseSpec({ ...base, offer: { type: 'subscription', amount: 25, currency: 'EUR', interval: 'month' } });
  assert.deepEqual(sub.errors, []);
});

// ── w8-7 follow-up: the preview shows the spec's own offer, not a hard-coded free one ─────────────────────────────────
test('w8-7: the preview names a paid offer as the spec wrote it (type, wire enum, publish), and free when no offer is given', () => {
  const base = { course: { title: 'Offer preview' }, chapters: [{ title: 'C', lessons: [{ title: 'L' }] }] };
  const paid = previewCourseSpec({ ...base, offer: { type: 'one_time', amount: 25, currency: 'EUR', publish: false } });
  assert.deepEqual(paid.wouldCreate.offer, { type: 'one_time', wire: 'onetime', publish: false });
  const sub = previewCourseSpec({ ...base, offer: { type: 'subscription', amount: 10, currency: 'EUR', interval: 'month' } });
  assert.equal(sub.wouldCreate.offer.wire, 'subscription');
  const none = previewCourseSpec({ ...base });
  assert.deepEqual(none.wouldCreate.offer, { type: 'free', wire: 'free', publish: false });
  const nullOffer = previewCourseSpec({ ...base, offer: null });
  assert.equal(nullOffer.wouldCreate.offer, null);
});
