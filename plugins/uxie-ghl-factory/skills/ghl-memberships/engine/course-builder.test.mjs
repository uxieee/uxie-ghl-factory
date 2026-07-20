import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewCourseSpec } from './course-builder.mjs';

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

test('MCP preview rejects paid offers and non-absolute local media before writes', () => {
  const preview = previewCourseSpec({
    course: { title: 'Launchpad' },
    chapters: [{ title: 'Start', lessons: [{ title: 'Watch', video: './intro.mp4' }] }],
    offer: { type: 'one_time' },
  }, { requireAbsoluteMediaPaths: true });

  assert.match(preview.errors.join('\n'), /Only "free" is proven/);
  assert.match(preview.errors.join('\n'), /absolute local path/);
});
