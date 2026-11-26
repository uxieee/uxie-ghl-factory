// Citation rules for proof runs written from a map (scripts/proof-from-map.mjs). plugin/proofs/*.json is in a PUBLIC repo: a run may cite a knowledge commit by its
// FULL 40-hex sha and nothing else. No sniff path, no knowledge path, no live- file name, no dated build folder, no account name or id.
export const FORBIDDEN = Object.freeze([
  [/sniffs\//i, 'a sniffs/ path'],
  [/knowledge\//i, 'a knowledge/ path'],
  [/\blive-/i, 'a live- file name'],
  [/-w9-\d{4}-\d{2}-\d{2}\//i, 'a dated -w9-YYYY-MM-DD/ folder'],
  [/drift-w9/i, 'a drift-w9 folder name'],
  [/GROM|Sandbox/i, 'an account name'],
]);
const SHA40 = /^[0-9a-f]{40}$/;

export function forbiddenIn(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return FORBIDDEN.filter(([re]) => re.test(s)).map(([, why]) => why);
}
export function assertCitationClean(values, where = 'run') {
  for (const v of [].concat(values)) {
    const hits = forbiddenIn(v);
    if (hits.length) throw new Error(`${where}: refused, it contains ${hits.join(', ')}`);
  }
}
export function commitEvidence(sha) {
  if (!SHA40.test(String(sha ?? ''))) throw new Error(`commit evidence needs the FULL 40-hex sha, got "${String(sha).slice(0, 12)}"`);
  return `commit:${sha}`;
}
