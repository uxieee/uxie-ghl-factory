/**
 * Quizzes, quiz questions, assignments, submissions, grading.
 *
 * PROOF LEVELS (see ../../BUILD-API.md "Proof levels"):
 *   EXECUTED — addQuestions, getQuizByPost, getQuizQuestions, listSubmissions, getSubmission
 *   OBSERVED — grade() : the payload was transcribed from the admin UI and has NOT
 *              been re-issued from code. The grade was verified to persist, but a
 *              field the UI sends and we failed to record would only surface here.
 *              Marked so nobody mistakes it for the same confidence as the rest.
 */

const BACKEND = 'https://backend.leadconnectorhq.com';
const SERVICES = 'https://services.leadconnectorhq.com';

/**
 * Batch checks for new quiz questions, before anything is sent (w8-6). Throws with every problem listed, so a bad batch
 * never reaches the account. Returns the batch unchanged when it is clean.
 */
export function validateQuestions(add) {
  if (!Array.isArray(add) || add.length === 0) throw new Error('edit_quiz_questions refused: add needs at least one question');
  const problems = [];
  const seen = new Set();
  add.forEach((q, i) => {
    const label = `question ${i + 1}`;
    const title = String(q?.title ?? '').trim();
    if (!title) problems.push(`${label}: title is empty`);
    const key = title.toLowerCase();
    if (title && seen.has(key)) problems.push(`${label}: duplicate question text in this batch ("${title}")`);
    seen.add(key);
    const options = Array.isArray(q?.options) ? q.options : [];
    if (options.length < 2) problems.push(`${label}: needs at least two options`);
    const correct = options.filter((o) => o?.isCorrect).length;
    const type = q?.questionType || 'single';
    if (type === 'single' && correct !== 1) problems.push(`${label}: a single-choice question needs exactly one correct option`);
    if (type === 'multiple' && correct < 1) problems.push(`${label}: a multiple-choice question needs at least one correct option`);
  });
  if (problems.length) throw new Error(`edit_quiz_questions refused, nothing was sent: ${problems.join('; ')}`);
  return add;
}

/**
 * One stored question as the full content the batch write needs. The batch write REPLACES the whole set (measured on the
 * sandbox, 2026-11-07), so every stored question is re-posted, and a question whose content is not all in the read cannot
 * be re-posted without losing part of it. That is refused here, by name, before anything is sent.
 */
function storedQuestionForPost(q) {
  if (typeof q?.title !== 'string' || !q.title.trim()) {
    throw new Error('edit_quiz_questions refused, nothing was sent: a stored question has no readable title');
  }
  const label = `stored question "${q.title}"`;
  if (!('explanation' in q)) {
    throw new Error(`edit_quiz_questions refused, nothing was sent: ${label} has no explanation field in the read, so its full content cannot be re-posted`);
  }
  const options = Array.isArray(q.options) ? [...q.options].sort((a, b) => (a?.sequence ?? 0) - (b?.sequence ?? 0)) : [];
  const readable = options.length >= 2
    && options.every((o) => typeof o?.statement === 'string' && o.statement.trim() && typeof o?.isCorrect === 'boolean');
  if (!readable) {
    throw new Error(`edit_quiz_questions refused, nothing was sent: ${label}: option text cannot be read, so re-posting the set would lose it`);
  }
  return {
    id: q.id ?? null,
    title: q.title,
    questionType: q.questionType || 'single',
    explanation: q.explanation ?? null,
    options: options.map((o, j) => ({ sequence: j + 1, isCorrect: o.isCorrect, statement: o.statement })),
  };
}

/**
 * The quiz's full question set after a batch of additions, computed locally (w8-6): every stored question in full, in its
 * order, then the additions, numbered 1..n. The stored list is not changed. This is exactly what the tool posts, and the
 * real read-back is checked against it by content (compareQuizContent), not by id, because the replace issues new ids.
 */
export function mergeQuestions(stored, { add = [] } = {}) {
  const kept = (stored ?? []).map(storedQuestionForPost);
  const added = add.map((q) => ({
    id: null,
    title: q.title,
    questionType: q.questionType || 'single',
    explanation: q.explanation ?? null,
    options: (q.options || []).map((o, j) => ({ sequence: j + 1, isCorrect: !!o.isCorrect, statement: o.statement })),
  }));
  return [...kept, ...added].map((q, i) => ({ ...q, sequenceNumber: i + 1 }));
}

/** The content of one question, without ids or server fields: what a read-back must match. */
export function quizContentKey(q) {
  return JSON.stringify({
    title: String(q?.title ?? ''),
    questionType: q?.questionType || 'single',
    explanation: q?.explanation ?? null,
    options: [...(q?.options || [])].sort((a, b) => (a?.sequence ?? 0) - (b?.sequence ?? 0))
      .map((o) => [o?.statement ?? null, o?.isCorrect === true]),
  });
}

/**
 * Compares the expected full set with a read-back, as multisets of content (w8-6). match only when the two hold the same
 * questions with the same text and correctness, in any order. kept lists the first storedCount expected questions that
 * came back; missing lists the expected ones that did not; unexpected lists what came back that was not expected.
 */
export function compareQuizContent(expected, actual, { storedCount = 0 } = {}) {
  const list = Array.isArray(actual) ? actual : [];
  const expectedKeys = expected.map(quizContentKey);
  const remaining = list.map(quizContentKey);
  const match = expectedKeys.length === remaining.length
    && [...expectedKeys].sort().every((k, i) => k === [...remaining].sort()[i]);
  const kept = [];
  const missing = [];
  expected.forEach((q, i) => {
    const at = remaining.indexOf(expectedKeys[i]);
    if (at >= 0) {
      remaining.splice(at, 1);
      if (i < storedCount) kept.push(q.title);
    } else {
      missing.push(q.title);
    }
  });
  const unexpected = remaining.map((k) => JSON.parse(k).title);
  return { match, kept, missing, unexpected };
}

export class Assessments {
  constructor(api) {
    this.api = api;
    this.loc = api.loc;
    this.M = api.M;
  }
  req(...a) { return this.api.req(...a); }

  // ---------- quiz ----------
  /**
   * ⚠️ quizId !== postId. POST /assessments/quiz creates the quiz; this read
   * (keyed by POST id) returns the quiz object whose own `id` the questions
   * endpoint requires. Getting these confused is the #1 trap here.
   */
  getQuizByPost(postId) {
    return this.req('GET', `${this.M}/assessments/quiz/${postId}`);
  }

  getQuizQuestions(quizId) {
    return this.req('GET', `${this.M}/assessments/quiz/questions/${quizId}`);
  }

  /**
   * BATCH write — send every question in one array.
   * questionType: 'single' | 'multiple'.
   * Correctness lives on each OPTION as isCorrect — there is no separate answer key.
   * sequenceNumber and option.sequence are both 1-BASED.
   *
   * @param {string} quizId  the QUIZ id (not the post id)
   * @param {Array<{title,questionType,explanation?,options:Array<{statement,isCorrect}>}>} questions
   */
  addQuestions(quizId, questions) {
    const payload = questions.map((q, i) => ({
      quizId,
      title: q.title,
      questionType: q.questionType || 'single',
      sequenceNumber: q.sequenceNumber ?? i + 1,
      explanation: q.explanation ?? null,
      options: (q.options || []).map((o, j) => ({
        sequence: o.sequence ?? j + 1,
        isCorrect: !!o.isCorrect,
        statement: o.statement,
      })),
    }));
    return this.req('POST', `${this.M}/assessments/quiz/questions`, { questions: payload });
  }

  /** Quiz settings (name, passing grade, messages) save separately from questions. */
  updateQuiz(quizId, body) {
    return this.req('PUT', `${this.M}/assessments/quiz/${quizId}`, body);
  }

  // ---------- assignment ----------
  getAssignmentByPost(postId) {
    return this.req('GET', `${this.M}/assessments/assignment/${postId}`);
  }

  // ---------- submissions ----------
  /**
   * THE poll endpoint for collecting franchisee documents.
   * LOCATION-WIDE — no product filter; `searchText` + pagination only.
   * Despite the `quiz` path segment it returns ASSIGNMENT submissions too
   * (quizId null, submissionType 'assignment') — quiz and assignment share one API.
   */
  listSubmissions({ pageNumber = 1, pageSize = 20, searchText = '' } = {}) {
    return this.req('GET',
      `${SERVICES}/membership/locations/${this.loc}/assessments/quiz/assessmentStatus/location/submission` +
      `?pageNumber=${pageNumber}&pageSize=${pageSize}&searchText=${encodeURIComponent(searchText)}`);
  }

  getSubmission(submissionId) {
    return this.req('GET', `${this.M}/assessments/quiz/assessmentStatus/submission/${submissionId}`);
  }

  /**
   * ⚠️ OBSERVED-ONLY (see file header). Grade a submission.
   * Note the SERVICE: this write is on `courses/`, while the submission read is on
   * `membership/` — same feature, different services. That split is what made an
   * earlier session wrongly conclude "the Save fires no request".
   *
   * @param {string} submissionId
   * @param {{score:number, status:'passed'|'failed', feedback?:string|null}} verdict
   */
  grade(submissionId, { score, status, feedback = null }) {
    if (!['passed', 'failed'].includes(status)) {
      throw new Error(`grade status must be 'passed' or 'failed', got ${status}`);
    }
    return this.req('PUT',
      `${BACKEND}/courses/locations/${this.loc}/assessments/${submissionId}/review`,
      { score, status, feedback });
  }
}
