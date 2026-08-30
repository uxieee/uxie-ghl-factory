// SERVER:scripts/agency-binding.mjs — turns an agency's location list into a binding decision.
//
// Discovery MUST run under the folder's own credential: an internal JWT only enumerates its own
// agency's sub-accounts. Measured 2026-08-30 -- one login's /locations/search returned 18 rows and
// could not see any sub-account belonging to another agency. There is no central view.
//
// Membership is EXACT match against the discovered list. Never shape-match: every GHL object id is
// a 20-24 character alphanumeric string, so ids are indistinguishable by appearance.

export const discoveryRequest = (companyId) => ({
  method: 'GET',
  path: `/locations/search?companyId=${encodeURIComponent(companyId)}&limit=200&skip=0`,
});

// The rows are nested at data.json.locations with the agency total at data.json.hit[0].count.
// A malformed response yields an EMPTY list and a NULL total rather than throwing, so a caller can
// distinguish "the agency has no accounts" from "discovery did not run" -- see reconcile.
export function parseLocations(response) {
  const json = response?.data?.json ?? null;
  const rows = Array.isArray(json?.locations) ? json.locations : [];
  const total = Number.isFinite(json?.hit?.[0]?.count) ? json.hit[0].count : null;
  return {
    total,
    locations: rows
      .filter((r) => typeof r?._id === 'string' && r._id.length > 0)
      .map((r) => ({ id: r._id, name: typeof r.name === 'string' ? r.name : '(unnamed)' })),
  };
}

export function reconcile({ bound, available }) {
  const have = new Set((available ?? []).map((l) => l.id));
  const want = new Set(bound ?? []);
  // An empty agency list means discovery failed or was skipped. Reporting every bound id as
  // `unknown` there would tell the user their entire binding is wrong on the strength of a failed
  // read, so return nothing rather than a confident falsehood.
  if (have.size === 0) return { matched: [], missing: [], unknown: [] };
  return {
    matched: [...want].filter((id) => have.has(id)),
    missing: [...have].filter((id) => !want.has(id)),
    unknown: [...want].filter((id) => !have.has(id)),
  };
}
