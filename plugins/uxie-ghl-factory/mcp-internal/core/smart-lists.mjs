// Smart lists: the envelope the contacts screen requires, and the classifier that recognises it.
//
// Hoisted out of tools.mjs so `create_smart_list` and `check_smart_lists` cannot drift apart. Two
// tools holding two copies of this rule is the specific way this surface goes wrong twice: the
// auditor would bless a shape the builder does not emit, or the builder would emit a shape the
// auditor calls broken, and neither disagreement shows up in any API response.
//
// Everything here is structural on purpose. `filterSpecs` reads back byte-identical whatever you
// send, and POST /contacts/search/2 returns the right rows for both the right and the wrong
// nesting, so no response and no read-back distinguishes them. The screen does, at load, silently.
// Corpus: knowledge/corpus/platform/20-api/smart-lists.md.

/** A group is a node with a `filters` array; anything else carrying a `field` is a leaf. */
export const isGroup = (n) => n && typeof n === 'object' && Array.isArray(n.filters);

/**
 * The canonical shape, verbatim from a list a human built in the interface and read straight back
 * through GET /contacts/smartlist/{id}:
 *
 *   filters: [ { group:'OR', filters:[ { group:'AND', filters:[ leaf, … ] }, … ] } ]
 *
 * An OUTER group whose children are GROUPS, leaves inside those. One level fewer is accepted with
 * a 201 and thrown away by the screen.
 */
export function buildFilterSpec({ groups, page = 1, limit = 20, outerMatch = 'OR' } = {}) {
  const inner = (groups ?? []).map((g) => ({
    group: (g.match ?? 'AND').toUpperCase(),
    filters: g.conditions ?? [],
  }));
  return {
    filters: [{ group: String(outerMatch).toUpperCase(), filters: inner }],
    page,
    limit,
  };
}

/** Every leaf condition under a node, depth-first. */
export function leaves(node, out = []) {
  if (!node) return out;
  if (isGroup(node)) { for (const c of node.filters) leaves(c, out); return out; }
  if (typeof node === 'object' && (node.field || node.uiMeta?.fieldAlias)) out.push(node);
  return out;
}

/**
 * Judge a stored `filterSpecs` the way the contacts screen will.
 * Returns {verdict: 'ok'|'renders-everything', cause, reason}.
 */
export function classifyFilterSpec(spec) {
  const filters = spec?.filters;
  if (!Array.isArray(filters) || filters.length === 0) {
    return {
      verdict: 'renders-everything',
      cause: 'empty-filter',
      reason: 'filterSpecs.filters is empty — this is what the screen\'s Copy/Save-as path produces, and it means "show every contact", not "not configured yet".',
    };
  }
  const outerGroups = filters.filter(isGroup);
  if (outerGroups.length !== filters.length) {
    return {
      verdict: 'renders-everything',
      cause: 'leaf-at-top',
      reason: 'a leaf condition sits at the top level of filterSpecs.filters; the screen expects groups there.',
    };
  }
  const oneLevel = outerGroups.filter((g) => g.filters.length && !g.filters.every(isGroup));
  if (oneLevel.length) {
    return {
      verdict: 'renders-everything',
      cause: 'one-level-nesting',
      reason: 'filterSpecs.filters is nested ONE level — a group holding leaf conditions directly. '
        + 'The store accepts it, it reads back byte-identical and /contacts/search/2 returns the right '
        + 'rows, but the contacts screen discards it at load and renders the whole account. It needs an '
        + 'outer group whose children are GROUPS, with the conditions inside those.',
    };
  }
  return { verdict: 'ok', reason: null, cause: null };
}

/**
 * The account-independent half of the filter-field catalogue, plus the two allowances the audit
 * makes on purpose. `custom_fields.<id>` keys are added by the caller from a live read.
 */
export function baseKnownFields(statics) {
  const known = new Set([
    ...(statics?.staticFieldKeys ?? []),
    ...(statics?.fieldAliases ?? []),
    ...(statics?.nestedJoinPaths ?? []),
  ]);
  // `score` resolves only when the account has a PUBLISHED score profile, which nothing here can
  // read. Allowed unconditionally: flagging it would break a working filter, and this check must
  // never produce a quiet false positive.
  known.add('score');
  return known;
}

/** dataTypes the contacts filter builder omits, so a filter naming one is dropped like an unknown field. */
export const EXCLUDED_FIELD_TYPES = new Set(['FILE_UPLOAD', 'SIGNATURE']);

/**
 * `columns[].key` is a CONTACTS-SCREEN field id, a different vocabulary from the filter DSL. The
 * app's own defaults; a create passing the DSL spelling is accepted, stored, and simply does not
 * render. Not an allow-list — custom columns exist — only the defaults plus the three
 * mistranslations worth naming.
 */
export const DEFAULT_COLUMN_KEYS = ['name', 'email', 'phone', 'tags', 'dateAdded', 'lastActivity', 'companyName'];

/** DSL spelling → the contacts-screen spelling, from the app's standardSortableFieldMap, inverted. */
export const DSL_COLUMN_MISTRANSLATIONS = {
  contact_name: 'name',
  date_added: 'dateAdded',
  last_activity: 'lastActivity',
};

/** `{key, value, order}` — key AND value are both the field name, not a human label. */
export function buildColumns(keys) {
  return keys.map((k, i) => ({ key: k, value: k, order: i }));
}
