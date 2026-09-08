// Snapshots: the agency-scoped capture surface, and the four calls that do something other than
// what their name suggests.
//
// This surface is different in kind from every other one the plugin touches. It is AGENCY-scoped,
// not sub-account scoped: a mistake is not confined to one location. And three of its traps are
// silent — they answer 200 and produce a snapshot that is wrong rather than an error you can see:
//
//   1. /snapshots/create captures a category you OMIT, whole. The appengine create excludes it.
//   2. A refresh with `extras: {}` re-captures the whole account, silently replacing a curated
//      snapshot with everything.
//   3. A bad id, a bad category or a mismatched location_id gives 200 and an EMPTY snapshot.
//      Nothing is validated and nothing is reported.
//   4. The conflicts endpoint refuses the key names the UI itself displays.
//
// Corpus: knowledge/corpus/platform/20-api/snapshots-authoring.md (the write half, proven-live
// 2026-09-07 from the snapshotsApp remote's public source maps) and snapshots.md (the read half).

/** Agency-scoped routes take ?companyId=. It is NOT in the JWT — resolve it from the location. */
export async function resolveCompanyId(gw, locationId) {
  if (typeof gw.companyId === 'string' && gw.companyId) return gw.companyId;
  const r = await gw.call('GET', `/locations/${encodeURIComponent(locationId)}`);
  if (!r.ok) return null;
  const id = (r.json?.location ?? r.json ?? {}).companyId;
  return typeof id === 'string' && id ? id : null;
}

/**
 * Flatten a preFetchAssets response into `{category: Set(id)}`.
 * The shape varies per category, so every plausible id key is accepted rather than assuming one —
 * an id this misses would be reported as unknown, which is a refusal on a valid asset.
 */
export function manifestIndex(prefetch) {
  const out = {};
  const idOf = (row) => (typeof row === 'string' ? row : (row?.id ?? row?._id ?? row?.value ?? null));
  const walk = (node, category) => {
    if (Array.isArray(node)) {
      for (const row of node) {
        const id = idOf(row);
        if (id) (out[category] ??= new Set()).add(String(id));
        // Workflow folders nest inside `workflow`; field folders inside `custom_fields`.
        if (row && typeof row === 'object') {
          for (const [k, v] of Object.entries(row)) if (Array.isArray(v)) walk(v, category);
        }
      }
      return;
    }
    if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, category ?? k);
  };
  const root = prefetch?.data ?? prefetch ?? {};
  for (const [category, node] of Object.entries(root)) walk(node, category);
  return out;
}

/**
 * Check a requested `selectedAssets` against the account's own manifest.
 * This is the ONLY thing that catches trap 3 before the write: an unknown id is accepted with a
 * 200 and silently produces an empty snapshot.
 */
export function checkSelection(selectedAssets, index, knownCategories) {
  const unknownCategories = [];
  const unknownIds = [];
  let requested = 0;
  for (const [category, ids] of Object.entries(selectedAssets ?? {})) {
    if (knownCategories && knownCategories.size && !knownCategories.has(category)) unknownCategories.push(category);
    const have = index[category];
    for (const id of (Array.isArray(ids) ? ids : [])) {
      requested += 1;
      // No manifest for the category means it could not be checked, not that the id is wrong.
      if (have && !have.has(String(id))) unknownIds.push(`${category}/${id}`);
    }
  }
  return { requested, unknownCategories, unknownIds };
}

/**
 * What the stored snapshot actually carries, against what was asked for. Trap 3's only detector
 * after the fact: the create returns 200 either way.
 */
export function diffStored(requested, storedIndex) {
  const missing = [];
  for (const [category, ids] of Object.entries(requested ?? {})) {
    const have = storedIndex[category];
    for (const id of (Array.isArray(ids) ? ids : [])) {
      if (!have || !have.has(String(id))) missing.push(`${category}/${id}`);
    }
  }
  return missing;
}

/** The conflicts endpoint's real key names. The ones the UI shows answer 400 ["Required","Required"]. */
export const CONFLICT_KEYS = { locations: 'selectedLocationIds', assets: 'selectedSnapshotAssets' };
export const CONFLICT_UI_KEYS = { locations: 'locationIds', assets: 'selectedAssets' };

// ---------------------------------------------------------------------------------------------
// Loading a snapshot into sub-accounts (the "push").
//
// This is the most dangerous call the plugin can make, and the danger is not the endpoint — it is
// the shape of the request. Two proven behaviours make the obvious implementation harmful:
//
//   1. Loaded workflows arrive PUBLISHED when the source workflow is published. On 2026-09-08 a
//      load put 26 workflows live on an account taking roughly 230 enrollments a week. Nothing in
//      the response says so: the push answers 201 "queued".
//   2. The wizard's Assets step renders NO Workflows row, while the push body it sends carries
//      every workflow id in the snapshot. A tool built by mirroring the UI ships workflows nobody
//      chose. So `assets` here is REQUIRED and explicit — never inferred, never defaulted to
//      "everything in the snapshot".
//
// Corpus: platform/20-api/snapshots-authoring.md, platform/40-rules/snapshot-carry-matrix.md.

/** Every category the push body carries. Absent categories are NOT loaded; empty arrays are sent. */
export const PUSH_CATEGORIES = Object.freeze([
  'agent_studio', 'teams', 'calendars', 'campaigns', 'chat_widget', 'custom_fields', 'custom_values',
  'folders', 'knowledge_bases', 'membership_offers', 'membership_products', 'pipelines',
  'sectionTemplates', 'social_planner', 'surveys', 'tags', 'text_templates', 'links', 'triggers',
  'workflow',
]);

/**
 * Build the push body.
 *
 * The target location id appears in THREE places — inside `selectedLocationsData.<tab>`, in the
 * top-level `selectedLocationIds`, and as the KEY of `skipData`. Getting one of them wrong is not
 * an error, it is a load that targets the wrong set, so they are derived from one argument here
 * rather than passed separately.
 *
 * Every category is present, empty arrays included, exactly as the wizard sends it.
 */
export function buildPushBody(targetLocationIds, selectedAssets, { overwriteConflicts = false } = {}) {
  const targets = [...targetLocationIds];
  const assets = {};
  for (const c of PUSH_CATEGORIES) assets[c] = [...(selectedAssets?.[c] ?? [])];
  // A category the caller named that is not in the wizard's list is still sent: the vocabulary is
  // GHL's, and silently dropping a category would be the same class of bug as inventing one.
  for (const [c, ids] of Object.entries(selectedAssets ?? {})) if (!(c in assets)) assets[c] = [...ids];
  const tab = (ids) => ({
    selectedLocationIds: ids,
    excludedLocationIds: [],
    isGlobalSelectChecked: false,
    selectedLocationsCount: ids.length,
  });
  return {
    selectedSnapshotAssets: assets,
    snapshotType: 'own',
    selectedLocationsData: { all: tab([]), available: tab(targets), linked: tab([]) },
    selectedLocationIds: targets,
    globalLocationConflictSelect: false,
    shouldOverwriteAllConflicts: overwriteConflicts,
    skipData: Object.fromEntries(targets.map((id) => [id, { assets: {}, skipAllConflicts: false }])),
  };
}

/** Categories the caller actually asked to load — the ones with at least one id. */
export function nonEmptyCategories(selectedAssets) {
  return Object.entries(selectedAssets ?? {})
    .filter(([, ids]) => Array.isArray(ids) && ids.length > 0)
    .map(([c]) => c);
}
