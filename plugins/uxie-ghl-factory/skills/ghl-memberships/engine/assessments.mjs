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
