/**
 * Member lifecycle: invite → portal user → enrollment → progress → revoke.
 *
 * Every call here is EXECUTED-proven (built from code, effect asserted) —
 * see ../../captures/23-independent-verification.json.
 *
 * Takes a GhlMembershipsApi instance and reuses its .req()/.M/.loc.
 */

const BACKEND = 'https://backend.leadconnectorhq.com';
const SERVICES = 'https://services.leadconnectorhq.com';

export class Members {
  constructor(api) {
    this.api = api;
    this.loc = api.loc;
    this.M = api.M;
  }
  req(...a) { return this.api.req(...a); }

  // ---------- portal state ----------
  /** totalUsers = real accounts; invitedUsers = pending invites (never decrements). */
  portalSettings() {
    return this.req('GET', `${BACKEND}/clientclub/portal-settings/${this.loc}`);
  }

  /**
   * Portal users. NOTE: `searchText` does NOT match email substrings —
   * page the unfiltered list instead of trusting a search miss.
   */
  listPortalUsers({ pageNo = 1, limit = 50, searchText = '' } = {}) {
    return this.req('GET',
      `${SERVICES}/clientclub/${this.loc}/users/search-users?searchText=${encodeURIComponent(searchText)}&pageNo=${pageNo}&limit=${limit}`);
  }

  // ---------- invite / login ----------
  /**
   * Bulk-capable: `email` is an array.
   * Sends an invite email ONLY — does not create a user and grants no access.
   */
  invite(emails) {
    const list = Array.isArray(emails) ? emails : [emails];
    return this.req('POST', `${SERVICES}/clientclub/${this.loc}/users/invite`,
      { locationId: this.loc, email: list });
  }

  /**
   * Returns a headless login URL (sendEmail:false) — no inbox needed.
   * REQUIRES an existing portal user: an invited-only address returns 400.
   * If the user never set a password the link lands on /set-password, not a session.
   */
  async magicLink(emails, { sendEmail = false } = {}) {
    const list = Array.isArray(emails) ? emails : [emails];
    const res = await this.req('POST', `${SERVICES}/clientclub/${this.loc}/tokens/send-magic-link`, {
      locationId: this.loc, email: list,
      sendEmail, showMagicLink: true, source: 'clientportal_builder_v1',
    });
    return Array.isArray(res) ? res.map(r => r.magicLink) : res;
  }

  // ---------- enrollment ----------
  /**
   * THE enrollment call. Note: no locationId in the path — it comes from the
   * sourceid header. ASYNC ("successfully queued") — poll productProgress().
   *
   * 🔴 ITS 200 CARRIES NO INFORMATION ABOUT THE PAYLOAD. Live-proven on the test sub-account
   * 2026-09-07: an EMPTY body `{}`, fabricated ids, and the wrong key names all return
   * `200 {ok:true, msg:"The request to attach the offer to the user has been successfully
   * queued"}` — the identical response a real grant returns. The control that makes that a
   * measurement rather than a guess: a nonexistent sibling path answers `404 {"msg":"Not found"}`,
   * so the 200 is this route replying, not a catch-all. Nothing is validated at the edge; the
   * message means the request was enqueued, not that a grant resolved.
   *
   * The key names are singular and are NOT `locationId`/`contactIds`: another operator sent
   * `{locationId, offerId, contactIds:[…]}` and `{locationId, offerId, userIds:[…]}`, got the
   * same cheerful 200 twice, and nothing was granted. Undeclared keys fall through and the
   * declared ones simply arrive absent.
   *
   * So NEVER treat this response as proof. `waitForEnrollment` with the contact ids you granted
   * is the only thing that knows.
   */
  grantOffer({ contactId, offerId }) {
    return this.req('POST', `${BACKEND}/membership/smart-list/attach-offer-user`,
      { contactId, offerId, source: 'admin' });
  }

  /** DELETE WITH A BODY — some HTTP clients silently drop it. Different path from grant. */
  revokeOffer({ contactId, offerId }) {
    return this.req('DELETE', `${BACKEND}/membership/smart-list/user-offer-management`,
      { contactId, offerId });
  }

  /** An offer must be published before it can be meaningfully granted. */
  async publishOffer(offerId) {
    const current = await this.req('GET', `${this.M}/offers/${offerId}`);
    const body = { ...current, visibility: 'published' };
    delete body.products;              // read-only join; sending it back is rejected
    return this.req('PUT', `${this.M}/offers/${offerId}`, body);
  }

  deleteOffer(offerId) {
    return this.req('DELETE', `${this.M}/offers/${offerId}`);
  }

  // ---------- progress / analytics ----------
  /**
   * THE progress read. completedPercentage is COURSE-level.
   * Empty array until someone is actually enrolled.
   */
  productProgress(productId, { pageLimit = 50, pageNumber = 1, email = '' } = {}) {
    return this.req('GET',
      `${SERVICES}/membership/locations/${this.loc}/products/user-progress/${productId}` +
      `?pageLimit=${pageLimit}&pageNumber=${pageNumber}&email=${encodeURIComponent(email)}`);
  }

  allMembers({ offset = 0, limit = 50, searchKey = '' } = {}) {
    return this.req('GET',
      `${this.M}/analytics/all-members?offset=${offset}&limit=${limit}&searchKey=${encodeURIComponent(searchKey)}`);
  }

  /**
   * ⚠️ DO NOT use to verify enrollment — it counts PURCHASES, not admin-attached
   * offers, and returns 0 for a genuinely enrolled member. Kept only for parity.
   */
  purchaseCount(productId) {
    return this.req('GET', `${SERVICES}/membership/locations/${this.loc}/user-purchase/no-of-users/${productId}?email=`);
  }

  /**
   * Poll until the async grant lands (or throw). This is the ONLY proof a grant worked —
   * `grantOffer` answers 200 "queued" for an empty body, so its response proves nothing.
   *
   * 🔴 PASS `expectContactIds`. Waiting for the list to be merely NON-EMPTY discriminates
   * nothing: a product that already has members satisfies it on the pre-existing rows, and
   * granting three contacts satisfies it the moment ONE lands. Both report a confirmed
   * enrollment that was never checked. With the ids, the wait resolves only when every one of
   * them is present — which is the question the caller is actually asking.
   *
   * Progress rows carry BOTH keys (`userId` is the memberships user, `contactId` the CRM
   * contact), so a contact id granted is a contact id matchable here. Without the argument the
   * old non-empty behaviour is kept, because a caller with no ids to hand has nothing better —
   * but it is the weaker check and everything in this repo passes the ids.
   */
  async waitForEnrollment(productId, { timeoutMs = 20000, intervalMs = 2000, expectContactIds = null } = {}) {
    const want = Array.isArray(expectContactIds) ? [...new Set(expectContactIds.map(String))] : null;
    const deadline = Date.now() + timeoutMs;
    let rows = [];
    while (Date.now() < deadline) {
      rows = await this.productProgress(productId);
      if (!Array.isArray(rows)) rows = [];
      if (want ? want.every(id => rows.some(r => String(r?.contactId) === id)) : rows.length > 0) return rows;
      await new Promise(r => setTimeout(r, intervalMs));
    }
    const missing = want ? want.filter(id => !rows.some(r => String(r?.contactId) === id)) : [];
    throw new Error(want
      ? `enrollment did not appear for product ${productId} within ${timeoutMs}ms — ${missing.length} of ${want.length} contact(s) still absent from user-progress: ${missing.join(', ')}`
      : `enrollment did not appear for product ${productId} within ${timeoutMs}ms`);
  }
}
