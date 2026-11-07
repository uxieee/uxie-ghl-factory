// W6 item 2: scrubbing a lifted spec's residual (export_workflow {format:'spec'}).
//
// The residual names a stored key by PATH (p: ['attributes', 'headers', 0, 'value']), so the key-name scrub that runs
// over every result never sees the key, and a pair's NAME (its sibling `key`) is not in the entry at all. Each value is
// therefore scrubbed where it sits: written into a copy of its stored step at its path and read back after
// scrubSecrets has run over the whole step — the pair rule, the header-map rule and the key-name rule all apply exactly
// as they do to the document itself.
import { scrubSecrets, isSecretKey, REDACTED } from './errors.mjs';

function placeAt(root, path, value) {
  let cur = root;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (cur[k] === null || typeof cur[k] !== 'object') cur[k] = typeof path[i + 1] === 'number' ? [] : {};
    cur = cur[k];
  }
  cur[path.at(-1)] = value;
}
function readAt(root, path) {
  let cur = root;
  for (const k of path) { if (cur === null || typeof cur !== 'object') return undefined; cur = cur[k]; }
  return cur;
}

export function scrubSpecResidual(spec, storedSteps = []) {
  const residual = spec?.stored?.residual;
  if (!residual) return spec;
  const byId = new Map((storedSteps ?? []).map((t) => [t?.id, t]));
  const out = {};
  for (const [id, entries] of Object.entries(residual)) {
    const step = byId.get(id) ?? {};
    out[id] = entries.map((e) => {
      const r = { ...e };
      const secretPath = e.p.some((k) => typeof k === 'string' && isSecretKey(k));
      for (const k of ['f', 't']) {
        if (!(k in r) || r[k] === '' || r[k] == null) continue;
        if (secretPath) { r[k] = REDACTED; continue; }
        const copy = structuredClone(step);
        placeAt(copy, e.p, structuredClone(r[k]));
        r[k] = readAt(scrubSecrets(copy), e.p);
      }
      return r;
    });
  }
  return { ...spec, stored: { ...spec.stored, residual: out } };
}
