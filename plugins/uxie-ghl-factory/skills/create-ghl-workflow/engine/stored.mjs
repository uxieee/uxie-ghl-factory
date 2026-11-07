// W6 item 2: the stored layer of a lifted spec — `spec.stored = {pins, residual, frozen, detached, accepted, order}`.
// lift.mjs writes it; compile() reads it, so a spec read from a stored workflow goes back in through the same door
// as an authored one.
//
//   frozen    {headId: [stored templates]} — a node the IR cannot express (and its whole subtree when it is a
//             container). The graph holds `{kind:'stored', ref: headId}` in its place; compile emits the stored
//             templates verbatim, linked into the chain where the placeholder sits.
//   detached  [stored templates] — steps no chain reaches from the root. GHL holds them, so they are kept.
//   residual  {stepId: [{p, f?, t?}]} — per stored step, what compile(lift(W)) does not reproduce: at path `p` the
//             compiler wrote `f` (absent when the key was missing) and the document stored `t` (absent when the
//             key was missing). The overlay restores `t` only where the recompile still writes `f`, so an author's
//             edit to that path wins and an untouched path comes back exactly as stored. `any: true` marks an id the
//             compiler minted where the document had none; it is removed whatever the new mint is.
//   accepted  {gotoLoops: ['<gotoId>><targetId>'], oppUnassociated: [stepId]} — refusals that fired on a document
//             GHL already holds; they warn instead of refusing for those exact steps.
//   order     stored template order; the compiled document is emitted in it.

import { createHash } from 'node:crypto';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** A short fingerprint of a value, for the residual's array-element guards. */
export const fingerprint = (v) => createHash('sha1').update(JSON.stringify(v) ?? 'undefined').digest('hex').slice(0, 12);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Every string equal to a key of `map` (and every object key) becomes its mapped value. */
export function remapIds(value, map) {
  if (!map || map.size === 0) return value;
  if (typeof value === 'string') return map.has(value) ? map.get(value) : value;
  if (Array.isArray(value)) return value.map((v) => remapIds(v, map));
  if (isObj(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[map.has(k) ? map.get(k) : k] = remapIds(v, map);
    return out;
  }
  return value;
}

/** Path-level differences of `stored` against `compiled`; arrays of equal length are compared element-wise. */
export function diffPaths(compiled, stored, p = [], out = []) {
  if (same(compiled, stored)) return out;
  if (isObj(compiled) && isObj(stored)) {
    for (const k of new Set([...Object.keys(compiled), ...Object.keys(stored)])) {
      if (!(k in stored)) out.push({ p: [...p, k], f: compiled[k] });
      else if (!(k in compiled)) out.push({ p: [...p, k], t: stored[k] });
      else diffPaths(compiled[k], stored[k], [...p, k], out);
    }
    return out;
  }
  if (Array.isArray(compiled) && Array.isArray(stored) && compiled.length === stored.length
    && compiled.every((x, i) => isObj(x) && isObj(stored[i]))) {
    compiled.forEach((x, i) => diffPaths(x, stored[i], [...p, i], out));
    return out;
  }
  out.push({ p, f: compiled, t: stored });
  return out;
}

function getAt(obj, path) {
  let cur = obj;
  for (const k of path) {
    if (cur === null || typeof cur !== 'object' || !(k in cur)) return { found: false };
    cur = cur[k];
  }
  return { found: true, value: cur };
}

function setAt(obj, path, entry) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (cur[path[i]] === null || typeof cur[path[i]] !== 'object') return;
    cur = cur[path[i]];
  }
  const k = path.at(-1);
  if ('t' in entry) cur[k] = structuredClone(entry.t);
  else delete cur[k];
}

/**
 * The array-element guards of a residual entry: for each array index on its path, the fingerprint of the element the
 * lift-time compile wrote there. An insert, delete or edit in that array changes the element at the index, so a stored
 * value recorded for one row can never land on another (final review W6b).
 */
// An id the compiler mints afresh on every compile (the `any` entries) is left out of the fingerprint, or no recompile
// could ever match the element it sits in.
function elementPrint(root, prefix, mintedPaths) {
  const el = structuredClone(getAt(root, prefix).value);
  for (const mp of mintedPaths) {
    if (mp.length <= prefix.length || !prefix.every((k, i) => mp[i] === k)) continue;
    const rest = mp.slice(prefix.length);
    let cur = el;
    for (let i = 0; i < rest.length - 1 && cur && typeof cur === 'object'; i++) cur = cur[rest[i]];
    if (cur && typeof cur === 'object') delete cur[rest.at(-1)];
  }
  return fingerprint(el);
}
export function elementGuards(compiled, p, mintedPaths = []) {
  const g = [];
  for (let k = 0; k < p.length; k++) if (typeof p[k] === 'number') g.push([k, elementPrint(compiled, p.slice(0, k + 1), mintedPaths)]);
  return g;
}

/** Re-apply a residual to one compiled template (mutates `template`); returns how many entries applied. */
export function applyResidual(template, entries) {
  let applied = 0;
  const pristine = structuredClone(template);
  const minted = (entries ?? []).filter((e) => e.any).map((e) => e.p);
  for (const e of entries ?? []) {
    if ((e.g ?? []).some(([k, h]) => elementPrint(pristine, e.p.slice(0, k + 1), minted) !== h)) continue;
    const cur = getAt(template, e.p);
    // `any`: the compiler minted a fresh id here that the stored document never had — remove whatever it minted now.
    const matches = e.any ? cur.found : 'f' in e ? cur.found && same(cur.value, e.f) : !cur.found;
    if (!matches) continue;               // the recompile writes something else here now: the author changed it
    setAt(template, e.p, e);
    applied++;
  }
  return applied;
}

/**
 * `compiled` with its keys in `stored`'s order, recursively (keys `stored` lacks go last). A document is compared
 * key-order-sensitively by the repair diff, so a recompiled step that equals its stored self must also read the same.
 */
export function alignKeyOrder(compiled, stored) {
  if (Array.isArray(compiled) && Array.isArray(stored)) return compiled.map((x, i) => alignKeyOrder(x, stored[i]));
  if (!isObj(compiled) || !isObj(stored)) return compiled;
  const out = {};
  for (const k of Object.keys(stored)) if (k in compiled) out[k] = alignKeyOrder(compiled[k], stored[k]);
  for (const k of Object.keys(compiled)) if (!(k in out)) out[k] = compiled[k];
  return out;
}

/** Every stored id the stored layer carries outside the IR graph: frozen subtrees and detached steps. */
export function storedLayerIds(stored) {
  const ids = [];
  for (const list of Object.values(stored?.frozen ?? {})) for (const t of list) if (t?.id) ids.push(t.id);
  for (const t of stored?.detached ?? []) if (t?.id) ids.push(t.id);
  return ids;
}

/**
 * Materialise the frozen subtrees: each head is linked where its placeholder sat (next / parentKey / parent from
 * the flattener), the rest is copied; with `idMap` (a new workflow) every stored id is renamed.
 */
export function frozenTemplates(stored, links, idMap) {
  const out = [];
  for (const link of links) {
    const list = stored?.frozen?.[link.storedId];
    if (!Array.isArray(list) || !list.length) continue;
    list.forEach((t, i) => {
      const c = remapIds(structuredClone(t), idMap);
      if (i === 0) {
        if (!Array.isArray(c.next)) { if (link.next == null) delete c.next; else c.next = link.next; }
        if (link.parentKey == null) delete c.parentKey; else c.parentKey = link.parentKey;
        if (link.parent == null) delete c.parent; else c.parent = link.parent;
      }
      out.push(c);
    });
  }
  return out;
}

/** The final document: frozen and detached steps added, the residual overlaid, stored order kept. */
export function overlayStored(templates, stored, { frozen = [], idMap } = {}) {
  const detached = (stored?.detached ?? []).map((t) => remapIds(structuredClone(t), idMap));
  const all = [...templates, ...frozen, ...detached];
  const residual = stored?.residual ?? {};
  for (const [storedId, entries] of Object.entries(residual)) {
    const id = idMap?.get(storedId) ?? storedId;
    const t = all.find((x) => x.id === id);
    // A step retyped in the spec keeps none of its old type's stored keys.
    if (t && (stored?.types?.[storedId] === undefined || stored.types[storedId] === t.type)) applyResidual(t, remapIds(entries, idMap));
  }
  const order = (stored?.order ?? []).map((x) => idMap?.get(x) ?? x);
  if (!order.length) return all;
  const rank = new Map(order.map((id, i) => [id, i]));
  return all.map((t, i) => ({ t, i })).sort((a, b) => (rank.get(a.t.id) ?? order.length + a.i) - (rank.get(b.t.id) ?? order.length + b.i)).map((x) => x.t);
}
