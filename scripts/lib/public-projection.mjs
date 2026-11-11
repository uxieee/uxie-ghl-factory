// The public projection of knowledge-derived catalogues (2026-11-11, QA push-scan).
//
// knowledge/ keeps the evidence behind every endpoint row: `sources` (capture paths under knowledge/sniffs/ and analysis/) and,
// per capture tree, `dir` (the knowledge/sniffs/ folder it was mined from). The plugin is a PUBLIC repo, so the copies it ships
// drop those fields. Nothing in the plugin reads them: scripts/, mcp-internal/scripts/, core/ and test/ were checked on
// 2026-11-11, and build-endpoint-catalog.mjs only passes row.sources through, so a missing field is simply not emitted.
//
// The same projection is applied by sync (before the copy is written) and by the freshness gate (before it compares), so a
// copy that matches knowledge after projection compares equal. Knowledge's own catalogue is never projected.

// The one serialization every knowledge-derived copy uses (matches merge-endpoint-catalogs.mjs: 2-space JSON, final newline).
export const serializeJson = (obj) => `${JSON.stringify(obj, null, 2)}\n`;

// internal-endpoints.source.json: drop each row's `sources` and each capture tree's `dir`.
export function projectSource(obj) {
  const out = { ...obj };
  if (Array.isArray(obj.trees)) out.trees = obj.trees.map(({ dir, ...t }) => t);
  if (Array.isArray(obj.endpoints)) out.endpoints = obj.endpoints.map(({ sources, ...row }) => row);
  return out;
}

// rail-ledger.json: drop each row's `sources`. NOT projected here: the rows' proof arrays, which still carry sniff: refs
// (knowledge's own validator reads them; the plugin's rail-ledger-proofs test resolves only proof: and receipt: refs). That
// residual is reported to QA as open, not hidden.
export function projectLedger(obj) {
  const out = { ...obj };
  if (Array.isArray(obj.rows)) out.rows = obj.rows.map(({ sources, ...row }) => row);
  return out;
}
