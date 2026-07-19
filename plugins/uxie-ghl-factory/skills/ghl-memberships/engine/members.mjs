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

  /** Poll until the async grant lands (or throw). */
  async waitForEnrollment(productId, { timeoutMs = 20000, intervalMs = 2000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const rows = await this.productProgress(productId);
      if (Array.isArray(rows) && rows.length > 0) return rows;
      await new Promise(r => setTimeout(r, intervalMs));
    }
    throw new Error(`enrollment did not appear for product ${productId} within ${timeoutMs}ms`);
  }
}
