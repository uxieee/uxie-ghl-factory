// Enforcement — evaluate GHL's own validator guards against every emitted node, and refuse the
// build when a required field is missing. This is the half the catalog work could not do: the
// catalog now KNOWS 635 GHL rules; this makes the compiler STOP on the 133 that are proven.
//
// Where the rules come from (ghl-internal-api-research, commits ea2396a/c7854c8): each rule is
// GHL's guard parsed into a data-only AST (guard-ast.mjs), scoped by its full enclosing chain
// (mode ifs, early returns as !(X), the switch discriminator behind case labels), and replayed
// over 187 published corpus workflows + the live captures with ZERO hits. The corpus is a VETO,
// never a prerequisite: GHL states the requirement in its own code; only our translation needed
// evidence, and it is mechanical. Review file: sniffs/bundle-2026-08-21-2/ENFORCEMENT.md.
//
// A rule FIRES on a node when every `ast.outer` condition evaluates truthy AND `ast.guard`
// evaluates truthy against the node's final attributes. JS-falsy semantics, exactly as GHL runs
// them (0, '', null, undefined are "missing"; the windowed-0-minute-wait and template-mode
// exemptions live in the ASTs, not here). An evaluation error is never a violation.
//
// Acceptance criterion (Xander, 2026-08-21): "every workflow that the engine makes is correct,
// and I will encounter no errors when they are in GHL already." So: a build that passes must
// open in the GHL builder clean; a build that would not, must never reach GHL.

import { IRError } from './ir.mjs';

// ── the AST evaluator (mirror of research guard-ast.mjs evaluate v2; keep in sync) ─────────
// v2 ops: it/coalesce/typeof/num/some/every/count/regexTest — the warn tier's value-checks
const get = (o, p) => p === '' ? o : p.split('.').reduce((a, k) => a == null ? undefined : a[k], o);
const RE_CACHE = new Map();
const cachedRe = (src, flags) => { const k = `${src} ${flags}`; let r = RE_CACHE.get(k); if (!r) { r = new RegExp(src, flags); RE_CACHE.set(k, r); } return r; };
export function evaluate(ast, attrs, item) {
  switch (ast.op) {
    case 'lit': return ast.v;
    case 'path': return get(attrs, ast.p);
    case 'not': return !evaluate(ast.a, attrs, item);
    case 'and': return evaluate(ast.a, attrs, item) && evaluate(ast.b, attrs, item);
    case 'or': return evaluate(ast.a, attrs, item) || evaluate(ast.b, attrs, item);
    case 'eq': return evaluate(ast.a, attrs, item) === evaluate(ast.b, attrs, item);
    case 'neq': return evaluate(ast.a, attrs, item) !== evaluate(ast.b, attrs, item);
    case 'gt': return evaluate(ast.a, attrs, item) > evaluate(ast.b, attrs, item);
    case 'lt': return evaluate(ast.a, attrs, item) < evaluate(ast.b, attrs, item);
    case 'gte': return evaluate(ast.a, attrs, item) >= evaluate(ast.b, attrs, item);
    case 'lte': return evaluate(ast.a, attrs, item) <= evaluate(ast.b, attrs, item);
    case 'len': { const v = evaluate(ast.a, attrs, item); return v == null ? undefined : (v.length ?? (typeof v === 'object' ? Object.keys(v).length : undefined)); }
    case 'trim': { const v = evaluate(ast.a, attrs, item); return typeof v === 'string' ? v.trim() : v; }
    case 'includes': { const v = evaluate(ast.a, attrs, item); const x = evaluate(ast.v, attrs, item); return Array.isArray(v) || typeof v === 'string' ? v.includes(x) : false; }
    case 'isArray': return Array.isArray(evaluate(ast.a, attrs, item));
    case 'has': { const o = evaluate(ast.a, attrs, item); const k = evaluate(ast.k, attrs, item); return o != null && typeof o === 'object' && k in o; }
    case 'empty': { const v = evaluate(ast.a, attrs, item); return v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Object.keys(v).length); }
    case 'it': return get(item, ast.p);
    case 'coalesce': { const v = evaluate(ast.a, attrs, item); return v == null ? evaluate(ast.b, attrs, item) : v; }
    case 'typeof': return typeof evaluate(ast.a, attrs, item);
    case 'num': return Number(evaluate(ast.a, attrs, item));
    case 'some': case 'every': { const v = evaluate(ast.a, attrs, item); if (!Array.isArray(v)) return ast.op === 'every'; return v[ast.op]((el) => !!evaluate(ast.it, attrs, el)); }
    case 'count': { const v = evaluate(ast.a, attrs, item); return Array.isArray(v) ? v.filter((el) => !!evaluate(ast.it, attrs, el)).length : 0; }
    case 'regexTest': { const v = evaluate(ast.a, attrs, item); return typeof v === 'string' ? cachedRe(ast.re, ast.flags).test(v) : false; }
    default: throw new Error(`unknown op ${ast.op}`);
  }
}

export function fires(rule, attrs) {
  try { return rule.ast.outer.every((o) => !!evaluate(o, attrs)) && !!evaluate(rule.ast.guard, attrs); }
  catch { return false; }
}

const ruleKey = (type, r) => `${type}.${r.field}${r.variant ? '@' + r.variant : ''}`;
const skipped = (skip, key) => skip === true || (Array.isArray(skip) && skip.includes(key));

/**
 * Evaluate one node's final attributes against its type's enforcement block.
 * @param node    authored node (for ref/name in the error)
 * @param attrs   the attributes as they will be EMITTED (post-normalization)
 * @param meta    catalog entry (carries `enforcement`)
 * @param ctx     compile ctx; ctx.warn(msg) for warn-tier; ctx.skipEnforcement: true | [ruleKey]
 */
export function checkEnforcement(node, attrs, meta, ctx) {
  const e = meta?.enforcement;
  if (!e) return;
  const skip = ctx?.skipEnforcement;
  const fired = (e.throw ?? []).filter((r) => !skipped(skip, ruleKey(meta.type, r)) && fires(r, attrs));
  for (const r of (e.warn ?? [])) {
    if (skipped(skip, ruleKey(meta.type, r))) continue;
    if (fires(r, attrs)) ctx?.warn?.(`ENFORCEMENT_SOFT: '${node.ref ?? node.name ?? '?'}' (${meta.type}) trips GHL's rule on '${r.field}' — guard: ${r.guard} — ${r.support}`);
  }
  if (!fired.length) return;
  const lines = fired.map((r) => `  - '${r.field}'${r.variant ? ` (mode: ${r.variant})` : ''} — GHL's guard: ${r.guard} — ${r.support}`);
  throw new IRError('ENFORCEMENT',
    `ENFORCEMENT: step '${node.ref ?? node.name ?? '?'}' (${meta.type}) is missing required field(s) GHL will flag:\n${lines.join('\n')}\n` +
    `GHL would SAVE this step and flag it (or silently no-op at runtime) — this engine refuses instead. ` +
    `Fill the field(s), or pass skipEnforcement (true, or ['${ruleKey(meta.type, fired[0])}']) if you are certain.`);
}

/**
 * Template-level sweep: every emitted node, whatever construction path built it (linear steps,
 * wait containers, edit-inserted subgraphs). One chokepoint so no path can bypass it.
 * Transitions carry no user intent and are skipped.
 */
export function enforceTemplates(templates, catalog, ctx) {
  for (const t of templates ?? []) {
    if (!t?.type || t.type === 'transition' || !t.attributes) continue;
    const meta = catalog?.step?.(t.type);
    if (!meta?.enforcement) continue;
    checkEnforcement({ ref: t.name ?? t.id, name: t.name }, t.attributes, meta, ctx);
  }
}
