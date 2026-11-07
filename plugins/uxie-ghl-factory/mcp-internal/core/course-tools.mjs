// W8 (courses lane): the course tools. get_course is the internal read that returns a normalised course tree (w8-3, D3 scope).
// Edits are NOT here: course editing is public-only (D3, Xander, 2026-11-06), taught in the memberships skill as ghl-multi
// courses-v3__update/sequence/delete/create actions. The seam (p2) spreads makeCourseTools into TOOLS; handlers read
// deps.makeGw at call time.
import { z } from 'zod';
import { ok } from './errors.mjs';
import { GhlMembershipsApi } from '../../skills/ghl-memberships/engine/api.mjs';
import { Members, accessOutcome } from '../../skills/ghl-memberships/engine/members.mjs';
import { Assessments, mergeQuestions, validateQuestions, compareQuizContent } from '../../skills/ghl-memberships/engine/assessments.mjs';

// Ids that go into a URL path. GHL ids are alphanumeric with hyphens or underscores (uuid or 20-char). Anything else is refused
// before it reaches a path, so an id can never add a segment or a query.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export function isSafeId(value) {
  return typeof value === 'string' && SAFE_ID.test(value);
}
const PROGRESS_PAGE = 50;
const PROGRESS_MAX_PAGES = 40;
/** Every membership row for a product, page by page. complete:false when the walk could not finish. */
async function allProgressRows(members, productId) {
  const rows = [];
  for (let page = 1; page <= PROGRESS_MAX_PAGES; page += 1) {
    const got = await members.productProgress(productId, { pageLimit: PROGRESS_PAGE, pageNumber: page });
    if (!Array.isArray(got)) return { rows, complete: false };
    rows.push(...got);
    if (got.length < PROGRESS_PAGE) return { rows, complete: true };
  }
  return { rows, complete: false };
}

/** The tree the memberships API returns, as chapters and lessons in display order. Joins and signed URLs are dropped. */
export function normaliseTree(rawCategories, productId = null) {
  const categories = Array.isArray(rawCategories) ? rawCategories : [];
  const byOrder = (a, b) => (Number(a?.sequenceNo ?? 0) - Number(b?.sequenceNo ?? 0)) || String(a?.id).localeCompare(String(b?.id));
  return {
    productId,
    chapters: [...categories].sort(byOrder).map((category) => ({
      id: category.id,
      title: category.title,
      sequenceNo: category.sequenceNo ?? 0,
      visibility: category.visibility ?? null,
      lessons: [...(category.posts ?? [])].sort(byOrder).map((post) => ({
        id: post.id,
        title: post.title,
        contentType: post.contentType ?? null,
        sequenceNo: post.sequenceNo ?? 0,
        visibility: post.visibility ?? null,
      })),
    })),
  };
}

// Every save re-mints every question id (measured 2026-11-07: before 9354c71c and 25f96994, after new ids for all three).
const QUIZ_IDS_CHANGE = 'every question id is re-minted on every save (measured 2026-11-07); the ids in before are stale after a confirmed add; refer to questions by title and read them again';

export function makeCourseTools(deps) {
  const { describe, schema, guard } = deps;
  return [
    {
      name: 'get_course_progress',
      description: describe(
        'get_course_progress',
        'Progress for one course: every student\'s percent, completed lessons and last activity, and a per-course summary. '
          + 'Walks every page; complete:false (with the pages read) when the walk could not finish, never a silent partial list. '
          + 'An email narrows it to one student. lastActivity is the last LOGIN (lastLogin), not the last lesson; the internal route gives no lesson counts (completedLessons is null). Reads only.',
      ),
      inputSchema: schema({
        locationId: z.string(),
        courseId: z.string().regex(SAFE_ID),
        email: z.string().optional(),
      }),
      capabilities: [
        { method: 'GET', path: '/membership/locations/{loc}/products/user-progress/{productId}?pageLimit={pageLimit}&pageNumber={pageNumber}&email={email}' },
      ],
      handler: async (args, handlerDeps) => guard(async () => {
        if (!isSafeId(args.courseId)) throw new Error('get_course_progress: courseId must be a plain id');
        const gw = handlerDeps.makeGw({ loc: args.locationId, state: handlerDeps.state });
        const api = new GhlMembershipsApi({ gw });
        const members = new Members(api);
        const email = args.email ?? '';
        const rows = [];
        let pages = 0;
        let complete = false;
        let failure = null;
        for (let page = 1; page <= PROGRESS_MAX_PAGES; page += 1) {
          let got;
          try {
            got = await members.productProgress(args.courseId, { pageLimit: PROGRESS_PAGE, pageNumber: page, email });
          } catch (error) {
            failure = String(error?.message ?? error).slice(0, 200);
            break;
          }
          if (!Array.isArray(got)) { failure = `page ${page} did not return a list`; break; }
          pages += 1;
          rows.push(...got);
          if (got.length < PROGRESS_PAGE) { complete = true; break; }
        }
        // The user-progress row gives a course-level percent, the user's e-mail and the last login. It has no lesson counts:
        // completedLessons is null here (the lesson counts on the public bulk route are a different source; bl-834).
        const perStudent = rows.map((row) => ({
          contactId: row?.contactId ?? null,
          email: row?.userEmail ?? null,
          percent: typeof row?.completedPercentage === 'number' ? row.completedPercentage : null,
          completedLessons: null,
          lastActivity: row?.lastLogin ?? null,
        }));
        const percents = perStudent.map((s) => s.percent).filter((p) => typeof p === 'number');
        return ok({
          perStudent,
          perCourse: {
            students: perStudent.length,
            completed: percents.filter((p) => p >= 100).length,
            averagePercent: percents.length ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length) : null,
          },
          pages,
          complete,
          ...(complete ? {} : { failure: failure ?? 'the walk stopped before the last page' }),
        });
      }, args),
    },
    {
      name: 'set_course_access',
      description: describe(
        'set_course_access',
        'Grant or revoke one contact\'s access to one offer. Preview (confirm false) makes no account call and says whether a grant '
          + 'sends an e-mail (sends: unknown for a grant, not measured; false for a revoke). Confirmed: reads the course membership, '
          + 'sends the grant or revoke, reads it again, and reports the outcome from the membership, never from the 200 answer '
          + '(granted, already-had, revoked, already-absent, queued-unconfirmed, or unverified when the membership list could not be read in full).',
      ),
      inputSchema: schema({
        locationId: z.string(),
        contactId: z.string().regex(SAFE_ID),
        offerId: z.string().regex(SAFE_ID),
        action: z.enum(['grant', 'revoke']),
        confirm: z.boolean().default(false),
      }),
      capabilities: [
        { method: 'GET', path: '/membership/locations/{loc}/offers/{offerId}' },
        { method: 'GET', path: '/membership/locations/{loc}/products/user-progress/{productId}?pageLimit={pageLimit}&pageNumber={pageNumber}&email={email}' },
        { method: 'POST', path: '/membership/smart-list/attach-offer-user' },
        { method: 'DELETE', path: '/membership/smart-list/user-offer-management' },
      ],
      handler: async (args, handlerDeps) => guard(async () => {
        const gw = handlerDeps.makeGw({ loc: args.locationId, state: handlerDeps.state });
        const api = new GhlMembershipsApi({ gw });
        const members = new Members(api);
        const sends = args.action === 'grant' ? 'unknown' : false;
        if (!args.confirm) {
          return ok({ preview: true, action: args.action, contactId: args.contactId, offerId: args.offerId, sends,
            note: 'Preview only: no account call. Confirm to send the change and read it back.' });
        }
        if (!isSafeId(args.contactId) || !isSafeId(args.offerId)) throw new Error('set_course_access: contactId and offerId must be plain ids');
        const offer = await api.req('GET', `${api.M}/offers/${encodeURIComponent(args.offerId)}`);
        // The offer must belong to the location the call is bound to: a grant or revoke never crosses locations.
        if (offer?.locationId !== args.locationId) throw new Error('set_course_access: the offer does not belong to this location; nothing was sent');
        const productId = offer?.products?.[0]?.id ?? offer?.productIds?.[0] ?? null;
        if (!isSafeId(productId)) throw new Error('set_course_access: the offer names no usable product, so membership cannot be read; nothing was sent');
        const readMembers = async () => {
          const { rows, complete } = await allProgressRows(members, productId);
          return { member: rows.some((row) => String(row?.contactId) === String(args.contactId)), complete };
        };
        const start = await readMembers();
        if (!start.complete) return ok({ outcome: 'unverified', reason: 'the membership list could not be read in full before the change; nothing was sent' });
        const before = start.member;
        if (args.action === 'grant') await members.grantOffer({ contactId: args.contactId, offerId: args.offerId });
        else await members.revokeOffer({ contactId: args.contactId, offerId: args.offerId });
        const poll = handlerDeps.accessPoll ?? { attempts: 5, intervalMs: 2000 };
        let end = start;
        for (let i = 0; i < poll.attempts; i += 1) {
          end = await readMembers();
          if (!end.complete) break;
          if (end.member !== before) break;
          if (i < poll.attempts - 1) await new Promise((resolve) => setTimeout(resolve, poll.intervalMs));
        }
        if (!end.complete) return ok({ outcome: 'unverified', action: args.action, contactId: args.contactId, offerId: args.offerId, productId, before, after: null, sends,
          reason: 'the change was sent, but the membership list could not be read in full afterwards' });
        const after = end.member;
        const outcome = accessOutcome({ action: args.action, before, after, sent: sends });
        return ok({ outcome, action: args.action, contactId: args.contactId, offerId: args.offerId, productId, before, after, sends,
          readBack: 'membership list read on a separate request, after the change' });
      }, args),
    },
    {
      name: 'edit_quiz_questions',
      description: describe(
        'edit_quiz_questions',
        'Add questions to one quiz in one batch. quizId is the QUIZ id, not the lesson id. Preview (confirm false) reads the quiz and makes no write. '
          + 'The batch write REPLACES the whole set (measured), so a confirmed call re-posts every stored question in full, then the additions. It is refused, '
          + 'before any POST, when a stored question\'s option text cannot be read. It reads the quiz again on a separate request and reports added only when '
          + 'that read matches the expected set by content; otherwise unverified, with the full before list to restore from. A replace argument is refused. '
          + 'Question ids change on every save: every write re-mints every question id (measured 2026-11-07), so a question id kept from before an edit is stale; '
          + 'refer to questions by title and read them again after a save. It changes questions only, not a lesson\'s visibility.',
      ),
      inputSchema: schema({
        locationId: z.string(),
        quizId: z.string(),
        add: z.array(z.object({
          title: z.string(),
          questionType: z.enum(['single', 'multiple']).default('single'),
          explanation: z.string().nullable().optional(),
          options: z.array(z.object({ statement: z.string(), isCorrect: z.boolean().default(false) })).min(2),
        })).min(1),
        confirm: z.boolean().default(false),
      }),
      capabilities: [
        { method: 'GET', path: '/membership/locations/{loc}/assessments/quiz/questions/{quizId}' },
        { method: 'POST', path: '/membership/locations/{loc}/assessments/quiz/questions' },
      ],
      handler: async (args, handlerDeps) => guard(async () => {
        if ('replace' in args) throw new Error('edit_quiz_questions: replacing the whole question set is not offered; add only');
        if (!isSafeId(args.quizId)) throw new Error('edit_quiz_questions: quizId must be a plain id (the quiz id, not the lesson id)');
        validateQuestions(args.add);
        const gw = handlerDeps.makeGw({ loc: args.locationId, state: handlerDeps.state });
        const api = new GhlMembershipsApi({ gw });
        const assess = new Assessments(api);
        const before = await assess.getQuizQuestions(args.quizId);
        if (!Array.isArray(before)) throw new Error('edit_quiz_questions: the quiz could not be read as a question list; nothing was sent');
        // The batch write replaces the whole set, so the stored questions go back in full with the additions. A stored question
        // whose content is not all in the read is refused here, before any POST (mergeQuestions names it).
        const expected = mergeQuestions(before, { add: args.add });
        const summary = (list) => ({ count: list.length, ids: list.map((q) => q.id ?? null), titles: list.map((q) => q.title) });
        if (!args.confirm) {
          return ok({ preview: true, quizId: args.quizId, before: summary(before), adds: args.add.map((q) => q.title),
            willRepost: before.length, expectedAfter: expected.length, sends: false, idsChange: QUIZ_IDS_CHANGE,
            note: 'Preview only: reads the quiz and writes nothing. A confirmed call re-posts the stored questions in full, then the additions (the batch write replaces the whole set), and reads the quiz back.' });
        }
        // The route replaces the whole set, so a POST that fails may still have changed it: the quiz is read back either way.
        let postFailed = null;
        try {
          await assess.addQuestions(args.quizId, expected);
        } catch (error) {
          postFailed = String(error?.message ?? error).split('\n')[0].slice(0, 300);
        }
        let after = null;
        let readFailed = null;
        try {
          after = await assess.getQuizQuestions(args.quizId);
        } catch (error) {
          readFailed = String(error?.message ?? error).split('\n')[0].slice(0, 300);
        }
        const listed = Array.isArray(after);
        const check = compareQuizContent(expected, listed ? after : [], { storedCount: before.length });
        const verified = listed && check.match;
        const httpStatus = postFailed ? Number(/^(\d{3})/.exec(postFailed)?.[1] ?? 0) || null : null;
        return ok({
          outcome: verified ? 'added' : 'unverified',
          quizId: args.quizId,
          before: summary(before),
          after: listed ? summary(after) : null,
          added: args.add.map((q) => q.title),
          kept: check.kept,
          missing: check.missing,
          unexpected: check.unexpected,
          readBack: 'quiz questions read on a separate request, after the write, compared by content',
          idsChange: QUIZ_IDS_CHANGE,
          ...(postFailed ? { postFailed, httpStatus } : {}),
          ...(readFailed ? { readFailed } : {}),
          ...(verified ? {} : {
            reason: postFailed
              ? 'the batch POST failed and the quiz read after it does not match the stored questions plus the additions, by content (or could not be read); the full before list is returned to restore from'
              : 'the quiz read after the write does not match the stored questions plus the additions, by content; the full before list is returned to restore from',
            beforeQuestions: before,
          }),
        });
      }, args),
    },
    {
      name: 'get_course',
      description: describe(
        'get_course',
        'Read one course: its title, its offers and its normalised tree (chapters and lessons in order, with visibility and content type). '
          + 'Reads only. Edits go through the public courses-v3 actions (see the ghl-memberships skill), dry_run first, then read back here.',
      ),
      inputSchema: schema({ locationId: z.string(), courseId: z.string() }),
      capabilities: [
        { method: 'GET', path: '/membership/locations/{loc}/products/{courseId}' },
        { method: 'GET', path: '/membership/locations/{loc}/categories?product_id={courseId}&posts=true' },
      ],
      handler: async (args, handlerDeps) => guard(async () => {
        const gw = handlerDeps.makeGw({ loc: args.locationId, state: handlerDeps.state });
        const api = new GhlMembershipsApi({ gw });
        const product = await api.getProduct(args.courseId);
        const tree = await api.getTree(args.courseId);
        return ok({
          course: {
            id: product.id,
            title: product.title,
            description: product.description ?? null,
          },
          tree: normaliseTree(tree, args.courseId),
          offers: (product.offers ?? []).map((offer) => ({
            id: offer.id,
            title: offer.title,
            type: offer.type,
            visibility: offer.visibility ?? null,
            amount: offer.amount ?? null,
            currency: offer.currency ?? null,
          })),
        });
      }, args),
    },
  ];
}
