// The join between this catalogue and the public API, by opKey (W4, 2026-10-29). Pure: the build passes in the two copies
// knowledge ships through `npm run sync` — catalog/public-ops.json (the public catalogue, projected) and
// catalog/rail-ledger.json (what each rail does per product and job, and the decision).

/** One key per operation: :x, {x} and \{x\} are one slot; the query and a trailing / are dropped. Same as knowledge's. */
export function opKey(method, path) {
  const p = String(path).split('?')[0].replace(/\\([{}_*[\]()#])/g, '$1').replace(/\{[^}]*\}/g, '{}').replace(/:[A-Za-z0-9_]+/g, '{}').replace(/\/+$/, '') || '/';
  return `${String(method).toUpperCase()} ${p}`;
}

/** Public ids at this row's opKey: -v3__ ids first; deprecated ids dropped when a live one exists. null when none. */
export function publicEquivalentFor(row, publicOps) {
  const k = opKey(row.method, row.path);
  const hits = publicOps.filter((o) => o.opKey === k);
  const live = hits.filter((o) => !o.deprecated);
  const ids = (live.length ? live : hits).map((o) => o.id)
    .sort((a, b) => (/-v3__/.test(b) - /-v3__/.test(a)) || a.localeCompare(b));
  return ids.length ? ids : null;
}

const keyOf = (s) => { const [m, ...p] = String(s).trim().split(/\s+/); return opKey(m, p.join(' ')); };

/** The ledger row that claims this row's opKey in its sharedPaths, as {product, job, decision}; null when none does.
 *  A decided row's decision holds only for the paths its read proved (provenPaths); its other shared paths were never
 *  read, so they are stamped undecided, with the proven paths named. */
export function railDecisionFor(row, ledger) {
  const k = opKey(row.method, row.path);
  const hit = (ledger.rows ?? []).find((r) => (r.sharedPaths ?? []).some((s) => keyOf(s) === k));
  if (!hit) return null;
  const decided = !String(hit.decision).startsWith('undecided');
  if (decided && hit.provenPaths?.length && !hit.provenPaths.some((s) => keyOf(s) === k)) {
    return { product: hit.product, job: hit.job, decision: 'undecided', decidedOn: hit.provenPaths };
  }
  return { product: hit.product, job: hit.job, decision: hit.decision };
}
