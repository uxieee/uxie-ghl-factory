// The public projection of knowledge-derived artefacts (2026-11-11, QA push-scan).
//
// knowledge/ keeps the evidence behind everything it generates: row `sources`, per-tree capture `dir`, `proof` refs and
// path tokens in notes (knowledge/sniffs/, knowledge/corpus/, analysis/). The plugin is a PUBLIC repo, so every artefact the
// sync generates is projected before it is written, and the freshness gate applies the SAME projection before it compares.
// Nothing in the plugin reads the removed fields (scripts/, core/, test/ checked 2026-11-11). The projection keeps every
// structure and replaces only the knowledge path tokens, so a future sync cannot add a knowledge path to a shipped copy.
//
// Knowledge's own files are never projected.

// The one serialization every generated JSON copy uses (2-space JSON, final newline; matches merge-endpoint-catalogs.mjs).
export const serializeJson = (obj) => `${JSON.stringify(obj, null, 2)}\n`;

// A path token ends at whitespace or a quote/bracket/punctuation that closes it in prose or JSON.
const END = '\\s"\'`)\\]\\},;<>|';
const PATH_RULES = [
  [new RegExp(`(?<![\\w-])sniffs\\/[^${END}]*`, 'g'), '[private capture]'],
  [new RegExp(`(?<![\\w-])live-[^${END}]*?\\.json`, 'g'), '[private capture]'],
  [new RegExp(`(?<![\\w-])analysis\\/[^${END}]*`, 'g'), '[private analysis]'],
  [new RegExp(`(?<![\\w-])knowledge\\/[^${END}]*`, 'g'), '[private corpus]'],
  // capture bundle folder names cited without their sniffs/ prefix (bundle-YYYY-MM-DD-N)
  [new RegExp(`(?<![\\w-])bundle-20\\d\\d-\\d\\d-\\d\\d-\\d+`, 'g'), '[private capture]'],
  // corpus-relative paths (the corpus layers, with or without the knowledge/ prefix) and dated folders or dated files
  [new RegExp(`(?<![\\w/-])(?:00-overview|10-anatomy|20-api|30-types|40-rules|50-runtime|60-recipes|70-research|_shared)\\/[^${END}]*`, 'g'), '[private corpus]'],
  [new RegExp(`(?<![\\w-])20\\d\\d-\\d\\d-\\d\\d-[a-z][\\w.-]*(?:\\/|\\.(?:md|json|mjs|tsv))`, 'g'), '[private dated path]'],
];

// Replace knowledge path tokens in a string. Idempotent: the replacements contain no path tokens.
export function scrubText(s) {
  let t = s;
  for (const [re, rep] of PATH_RULES) t = t.replace(re, rep);
  return t;
}

// Replace knowledge path tokens in every string of a JSON value, keeping every key and structure.
export function scrubDeep(v) {
  if (typeof v === 'string') return scrubText(v);
  if (Array.isArray(v)) return v.map(scrubDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x)]));
  return v;
}

// internal-endpoints.source.json: drop each row's `sources` and each capture tree's `dir`, then scrub what is left.
export function projectSource(obj) {
  const out = { ...obj };
  if (Array.isArray(obj.trees)) out.trees = obj.trees.map(({ dir, ...t }) => t);
  if (Array.isArray(obj.endpoints)) out.endpoints = obj.endpoints.map(({ sources, ...row }) => row);
  return scrubDeep(out);
}

// rail-ledger.json: drop each row's `sources`, then scrub the rows' proof refs and every other string.
export function projectLedger(obj) {
  const out = { ...obj };
  if (Array.isArray(obj.rows)) out.rows = obj.rows.map(({ sources, ...row }) => row);
  return scrubDeep(out);
}

// Every other generated JSON copy (type cards, catalogue, validators, element list): scrub only.
export const projectCopy = (obj) => scrubDeep(obj);
