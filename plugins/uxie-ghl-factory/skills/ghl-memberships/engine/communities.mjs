/**
 * Communities.
 *
 * TWO RAILS, and the split is the whole story:
 *   ADMIN  (services…/communities/*)                  — location settings, group list/create/update
 *   MEMBER (services…/clientportal-middleware/…)      — channels, posts, members, join
 *
 * Group INTERNALS are PORTAL_USER-scoped. An admin token gets
 * 403 "WEB_USER source is restricted by this endpoint" on /groups/{id}, /channels, /posts,
 * and you cannot spoof past it — the JWT encodes the source, so overriding the header 401s.
 *
 * Firestore is only the realtime listener layer for feeds; admin CRUD is plain REST.
 */

const SERVICES = 'https://services.leadconnectorhq.com';
const MW = `${SERVICES}/clientportal-middleware/communities`;

/** Appears to be a GHL-side constant, not account-specific (unverified across accounts). */
const MARKETPLACE_LOCATION_ID = 'VyoxA4YGXCZib071EFsR';

export class Communities {
  constructor(api) {
    this.api = api;
    this.loc = api.loc;
  }
  req(...a) { return this.api.req(...a); }

  // ---------- admin rail ----------
  /** Shares its _id with clientclub portal-settings — one document, two views. */
  locationSettings() {
    return this.req('GET', `${SERVICES}/communities/locations/${this.loc}`);
  }

  /** Returns a BARE ARRAY, not an envelope. */
  listGroups({ limit = 15, skip = 0, inactive = false } = {}) {
    return this.req('GET',
      `${SERVICES}/communities/${this.loc}/groups?limit=${limit}&skip=${skip}` +
      (inactive ? '&inactiveGroups=true' : ''));
  }

  /**
   * `createdBy` on the result is the acting user's CONTACT id (portal identity),
   * not the staff user id. Creating a group auto-creates an "Announcements" channel.
   */
  createGroup({ name, slug, description = '', branding = {} }) {
    return this.req('POST', `${SERVICES}/communities/${this.loc}/groups`, {
      name, slug, description, locationId: this.loc,
      marketplaceLocationId: MARKETPLACE_LOCATION_ID, branding,
    });
  }

  /** PUT merges (PATCH is 404). */
  updateGroup(groupId, patch) {
    return this.req('PUT', `${SERVICES}/communities/${this.loc}/groups/${groupId}`, patch);
  }

  /**
   * There is NO hard delete for an admin token (DELETE → 403). Deactivating
   * removes the group from BOTH the active and inactive lists.
   * ⚠️ Group list reads are EVENTUALLY CONSISTENT (~1.5s) — re-read after a delay
   * before concluding a write failed.
   */
  deactivateGroup(groupId) {
    return this.updateGroup(groupId, { status: 'Inactive' });
  }

  // ---------- member rail ----------
  /**
   * Build a member-scoped client. Requires a PORTAL token (authClass
   * ClientPortalUser, ~24h TTL) obtained from a magic link — NOT the admin token.
   */
  asMember({ portalToken, groupId }) {
    return new CommunitiesMember({ loc: this.loc, portalToken, groupId });
  }
}

export class CommunitiesMember {
  constructor({ loc, portalToken, groupId }) {
    if (!portalToken) throw new Error('portalToken required (admin token will 401 here)');
    this.loc = loc;
    this.token = portalToken;
    this.groupId = groupId;
  }

  /** The member header set. Using the ADMIN set here returns a misleading 401. */
  headers() {
    return {
      authorization: `Bearer ${this.token}`,
      channel: 'APP',
      source: 'PORTAL_USER',        // NOT WEB_USER
      version: '2023-02-21',        // NOT 2021-07-28
      'x-location-id': this.loc,
      ...(this.groupId ? { 'x-group-id': this.groupId } : {}),
      'x-platform-details': 'web',
      'x-app-version': 'web',
      accept: 'application/json',
      'content-type': 'application/json',
    };
  }

  async req(method, url, body) {
    const opts = { method, headers: this.headers() };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} on ${method} ${url}\n${text.slice(0, 300)}`);
    try { return JSON.parse(text); } catch { return text; }
  }

  channels(groupId = this.groupId) {
    return this.req('GET', `${MW}/${this.loc}/groups/${groupId}/channels`);
  }

  posts(channelId, { groupId = this.groupId, limit = 20 } = {}) {
    return this.req('GET', `${MW}/${this.loc}/groups/${groupId}/channels/${channelId}/posts?limit=${limit}`);
  }

  members(groupId = this.groupId, { limit = 10, pageNo = 1 } = {}) {
    return this.req('GET',
      `${MW}/${this.loc}/groups/${groupId}/users/details?memberStatus=Active&searchText=&limit=${limit}&pageNo=${pageNo}&showEmail=false`);
  }

  /** Roles: OWNER | ADMIN | CONTRIBUTOR | MEMBER. */
  join({ groupId = this.groupId, role = 'MEMBER' } = {}) {
    return this.req('POST', `${MW}/${this.loc}/groups/${groupId}/users`, { role });
  }

  /**
   * ⚠️ You MUST join first, else 403 "You are not part of this group" —
   * that 403 is semantic, not an auth failure.
   */
  createPost({ channelId, title, content, groupId = this.groupId, status = 'Published' }) {
    return this.req('POST', `${MW}/${this.loc}/groups/${groupId}/channels/${channelId}/posts`,
      { title, content, status });
  }
}
