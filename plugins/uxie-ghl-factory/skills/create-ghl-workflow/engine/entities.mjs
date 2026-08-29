// THE ACCOUNT-OBJECT REGISTRY.
//
// fetchEntities was 21 hand-written GETs, 21 hand-written projections, and a tool description that
// had already drifted from both (it advertised six kinds while returning twenty). Adding an account
// object meant editing three files and remembering a fourth. Here it is one ROW: the path, how to
// pick the array out of whatever envelope the endpoint uses, how to project a row, and — where the
// object is nameable — the resolver kind it feeds.
//
// Every leg stays best-effort and independent: a 404 on one endpoint yields [] for that key and
// never fails the sweep, which is what lets an account without, say, Voice AI still build.
const arrayFrom = (...values) => values.find(Array.isArray) ?? [];
const recordsFrom = (...values) => arrayFrom(...values)
  .filter((v) => v && typeof v === 'object' && !Array.isArray(v));
const q = (loc, extra = {}) => new URLSearchParams({ locationId: String(loc), ...extra });
const p = (loc) => encodeURIComponent(String(loc));
const norm = (s) => String(s ?? '').trim().toLowerCase();

export const ENTITY_REGISTRY = [
  { key: 'pipelines', path: (loc) => `/opportunities/pipelines?${q(loc)}`,
    pick: (j) => recordsFrom(j?.pipelines, j),
    project: (x) => ({ id: x.id || x._id, name: x.name, stages: recordsFrom(x.stages).map((s) => ({ id: s.id, name: s.name })) }) },

  { key: 'calendars', path: (loc) => `/calendars/?${q(loc)}`,
    pick: (j) => recordsFrom(j?.calendars, j), project: (x) => ({ id: x.id || x._id, name: x.name }) },

  { key: 'users', path: (loc) => `/users/?${q(loc)}`,
    pick: (j) => recordsFrom(j?.users, j),
    project: (x) => ({ id: x.id || x._id, firstName: x.firstName, lastName: x.lastName, email: x.email, name: x.name }) },

  { key: 'forms', path: (loc) => `/forms/?${q(loc, { limit: '100' })}`,
    pick: (j) => recordsFrom(j?.forms, j), project: (x) => ({ id: x.id || x._id, name: x.name }) },

  // model=all: the plain /customFields endpoint returns CONTACT fields only, so an opportunity
  // field would resolve to nothing.
  { key: 'customFields',
    path: (loc) => `/locations/${p(loc)}/customFields/search?${new URLSearchParams({
      parentId: '', skip: '0', limit: '10000', documentType: 'field', model: 'all', query: '', includeStandards: 'false' })}`,
    pick: (j) => recordsFrom(j?.customFields, j),
    project: (x) => ({ id: x.id || x._id, name: x.name, fieldKey: x.fieldKey, dataType: x.dataType, model: x.model }) },

  { key: 'workflows',
    path: (loc) => `/workflow/${p(loc)}/list?${new URLSearchParams({ type: 'workflow', limit: '200', offset: '0', sortBy: 'name', sortOrder: 'asc' })}`,
    pick: (j) => recordsFrom(j?.rows, j).filter((w) => (w.type ?? 'workflow') === 'workflow'),
    project: (x) => ({ id: x._id || x.id, name: x.name, status: x.status }) },

  { key: 'customValues', path: (loc) => `/locations/${p(loc)}/customValues`,
    pick: (j) => recordsFrom(j?.customValues, j),
    project: (x) => ({ id: x.id || x._id, name: x.name, fieldKey: x.fieldKey }) },

  { key: 'triggerLinks', path: (loc) => `/links/?${q(loc)}`,
    pick: (j) => recordsFrom(j?.links, j),
    project: (x) => ({ id: x.id || x._id, name: x.name, redirectTo: x.redirectTo }) },

  { key: 'offers', path: (loc) => `/membership/locations/${p(loc)}/offers`,
    pick: (j) => recordsFrom(j), project: (x) => ({ id: x.id || x._id, name: x.title ?? x.name }) },

  { key: 'membershipProducts',
    path: (loc) => `/membership/locations/${p(loc)}/products?doNotIncludeOffers=true&sendCustomizations=true`,
    pick: (j) => recordsFrom(j?.products, j), project: (x) => ({ id: x.id || x._id, name: x.title ?? x.name }) },

  { key: 'smsTemplates', path: (loc) => `/locations/${p(loc)}/templates?limit=200`,
    pick: (j) => recordsFrom(j?.templates, j).filter((t) => (t.type ?? 'sms') !== 'email'),
    project: (x) => ({ id: x.id || x._id, name: x.name, type: x.type }) },

  { key: 'emailTemplates', path: (loc) => `/emails/builder?${q(loc, { limit: '100', offset: '0' })}`,
    pick: (j) => recordsFrom(j?.builders, j), project: (x) => ({ id: x.id || x._id, name: x.name }) },

  { key: 'products', path: (loc) => `/products/?${q(loc, { limit: '100' })}`,
    pick: (j) => recordsFrom(j?.products, j), project: (x) => ({ id: x._id || x.id, name: x.name }) },

  { key: 'coupons',
    path: (loc) => `/payments/coupon/list?${new URLSearchParams({ altId: String(loc), altType: 'location', limit: '100' })}`,
    pick: (j) => recordsFrom(j?.data, j), project: (x) => ({ id: x._id || x.id, name: x.name, code: x.code }) },

  { key: 'phoneNumbers', path: (loc) => `/phone-system/numbers?${q(loc)}`,
    pick: (j) => recordsFrom(j?.phoneNumbers, j),
    project: (x) => ({ number: x.value ?? x.phoneNumber, title: x.title ?? x.name }) },

  { key: 'funnels', path: (loc) => `/funnels/funnel/list?${q(loc, { type: 'funnel', offset: '0', limit: '200' })}`,
    pick: (j) => recordsFrom(j?.funnels, j), project: (x) => ({ id: x._id || x.id, name: x.name }) },

  { key: 'fbPages', path: (loc) => `/integrations/facebook/${p(loc)}/pages?getAll=true`,
    pick: (j) => recordsFrom(j?.pages, j),
    project: (x) => ({ id: x.facebookPageId || x.id, name: x.facebookPageName || x.name }) },

  { key: 'documentTemplates', path: (loc) => `/proposals/templates?${q(loc, { limit: '100' })}`,
    pick: (j) => recordsFrom(j?.data, j), project: (x) => ({ id: x._id || x.id, name: x.name }) },

  { key: 'objects', path: (loc) => `/objects/?${q(loc)}`,
    pick: (j) => recordsFrom(j?.objects, j),
    project: (x) => ({ key: x.key, id: x.id || x._id, singular: x.labels?.singular, plural: x.labels?.plural,
      standard: x.standard ?? (x.type === 'SYSTEM_DEFINED') }) },

  // ── Added by Phase 5. Both are NAMEABLE things a workflow step refers to, and neither was
  //    fetched, so neither could be authored by name.
  //
  // lostReasonId is required by an update_opportunity whose status is 'lost' — the builder
  // DELETES the entry when the status is anything else, so an id that matches nothing is a step
  // that saves and records no reason.
  { key: 'lostReasons', path: (loc) => `/opportunities/lost-reason?${q(loc)}`,
    pick: (j) => recordsFrom(j?.data, j?.lostReasons, j),
    project: (x) => ({ id: x.id || x._id, name: x.name ?? x.reason }),
    resolver: { name: 'lostReasonId', match: (r) => [r.name], value: (r) => r.id } },

  // Call dispositions are matched BY NAME at runtime, so a disposition that does not exist in
  // Settings means the trigger can never fire — the resolver returns the canonical NAME, not an id.
  { key: 'callDispositions', path: (loc) => `/phone-system/call-dispositions?${q(loc)}`,
    pick: (j) => recordsFrom(j?.data, j?.dispositions, j),
    project: (x) => ({ id: x.id || x._id, name: x.name ?? x.title }),
    resolver: { name: 'callDisposition', match: (r) => [r.name], value: (r) => r.name } },
];

export function entityCapabilities() {
  // The path with its query stripped — a capability row states the endpoint, not one call's args.
  return ENTITY_REGISTRY.map((e) => ({ method: 'GET', path: e.path('{loc}').split('?')[0] }));
}

// name -> id (or canonical name) lookups for every registry row that declares a resolver kind.
export function registryResolvers(raw = {}) {
  const out = {};
  for (const e of ENTITY_REGISTRY) {
    if (!e.resolver) continue;
    const rows = Array.isArray(raw[e.key]) ? raw[e.key] : [];
    out[e.resolver.name] = (query) => {
      const wanted = norm(query);
      if (!wanted) return undefined;
      const hit = rows.find((r) => e.resolver.match(r).some((m) => norm(m) === wanted));
      return hit ? (e.resolver.value ? e.resolver.value(hit) : hit.id) : undefined;
    };
  }
  return out;
}
