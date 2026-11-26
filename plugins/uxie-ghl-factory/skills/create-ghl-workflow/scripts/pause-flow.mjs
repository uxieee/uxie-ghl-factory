// Pausing ONE named non-TEST workflow for the duration of a span (Xander 2026-11-22, relayed by the orchestrator: "u can pause if u want").
// Generic: the target id AND name come in from the runner (--pause-flow=<id>::<name>); this file holds no identifier.
// Rules: read id AND name back (and that it is published) before the pause; pause = unpublish and read back as draft; restore = publish and read back as
// published with its trigger list EQUAL to before, field by field, server-stamped fields excluded. Every step is returned as a record row; a failed restore is returned, never swallowed.
// The trigger list as the server returns it (an array), or null when it could not be read.
const triggersOf = async (gw, LOCATION, id) => {
  const r = await gw.call('GET', `/workflow/${encodeURIComponent(LOCATION)}/trigger?workflowId=${encodeURIComponent(id)}`);
  const list = r.json?.triggers ?? (Array.isArray(r.json) ? r.json : null);
  return r.ok && Array.isArray(list) ? list : null;
};

// SERVER-STAMPED trigger fields: the publish call itself rewrites them, so they can never be "restored". Measured 2026-11-22 on a six-trigger
// flow: every trigger's date_updated moved to the publish second and nothing else changed. They are excluded from the comparison and the exclusion is recorded.
export const SERVER_STAMPED_TRIGGER_FIELDS = Object.freeze(['date_updated']);
const stripStamped = (t) => { const c = { ...t }; for (const f of SERVER_STAMPED_TRIGGER_FIELDS) delete c[f]; return c; };
// DENY BY DEFAULT: no trigger value ever reaches a record. A string or number becomes its type plus a short salted sha256 (the salt is random per process, so a value
// compares equal to itself within ONE run and cannot be looked up across runs); booleans and null are kept; paths are kept. Only a key on the literal allow-list below
// keeps its value, and only when that value is a plain lowercase token (so an e-mail, number or URL in `type` is still hashed). Comparison itself uses the RAW values.
import { createHash, randomBytes } from 'node:crypto';
const SALT = randomBytes(12).toString('hex');
const KEEP_VALUE_KEYS = new Set(['type', 'operator']);
const hashOf = (v) => createHash('sha256').update(SALT).update(String(typeof v)).update('\0').update(String(v)).digest('hex').slice(0, 8);
const keyOf = (p) => (String(p).match(/([^.\[\]]+)(?:\[\d+\])*$/)?.[1] ?? '');
export const maskValue = (key, v) => {
  if (v === null || typeof v === 'boolean' || v === undefined) return v ?? null;
  if (typeof v === 'string' && KEEP_VALUE_KEYS.has(key) && /^[a-z][a-z0-9_]{0,39}$/.test(v)) return v;
  if (typeof v === 'string' || typeof v === 'number') return `<${typeof v}:${hashOf(v)}>`;
  return `<${typeof v}>`;
};
const maskKey = (k) => (/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(k) && !/\d{4,}/.test(k) ? k : `<key:${hashOf(k)}>`);
const maskDeep = (o, key = '') => (Array.isArray(o) ? o.map((x) => maskDeep(x, key)) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [maskKey(k), maskDeep(v, k)])) : maskValue(key, o));
export const maskTriggers = (list) => (Array.isArray(list) ? list.map((t) => maskDeep(stripStamped(t))) : null);
const flatten = (o, p = '', out = {}) => {
  if (Array.isArray(o)) { if (o.length === 0) out[p] = []; o.forEach((x, i) => flatten(x, `${p}[${i}]`, out)); }
  else if (o && typeof o === 'object') { const ks = Object.keys(o).sort(); if (ks.length === 0) out[p] = {}; for (const k of ks) flatten(o[k], p ? `${p}.${k}` : k, out); }
  else out[p] = o;
  return out;
};
// Per-field diff of two trigger lists, by position, server-stamped fields excluded, values masked. [] means equal. A count change is reported as a field of its own.
const maskPath = (k) => k.split('.').map((seg) => { const m = seg.match(/^([^\[]*)((?:\[\d+\])*)$/); return m ? `${m[1] === '' ? '' : maskKey(m[1])}${m[2]}` : maskKey(seg); }).join('.');
const maskLeaf = (k, v) => (Array.isArray(v) || (v && typeof v === 'object') ? `<${Array.isArray(v) ? 'array' : 'object'}:${(Array.isArray(v) ? v.length : Object.keys(v).length)}>` : maskValue(keyOf(k), v));
export const diffTriggers = (before, after) => {
  const diffs = [];
  if (!Array.isArray(before) || !Array.isArray(after)) return [{ path: '(list)', before: Array.isArray(before) ? `${before.length} triggers` : 'unreadable', after: Array.isArray(after) ? `${after.length} triggers` : 'unreadable' }];
  if (before.length !== after.length) diffs.push({ path: '(count)', before: before.length, after: after.length });
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    const a = before[i] ? flatten(stripStamped(before[i])) : {}, b = after[i] ? flatten(stripStamped(after[i])) : {};
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diffs.push({ path: `triggers[${i}].${maskPath(k)}`, before: maskLeaf(k, a[k]), after: maskLeaf(k, b[k]) });
    }
  }
  return diffs;
};

export const parsePauseFlags = (argv) => argv.filter((a) => a.startsWith('--pause-flow=')).map((a) => {
  const [id, ...rest] = a.slice('--pause-flow='.length).split('::');
  return { id: id.trim(), name: rest.join('::').trim() };
}).filter((x) => x.id && x.name);

// Which census blockers may be paused: id AND name equal an entry, non-TEST, and EVERY blocking decision is a dnd_contact one.
export const pausableRows = (rows, allow) => (rows ?? []).filter((r) => r.blocking?.length > 0
  && allow.some((a) => a.id === r.id && a.name === r.name)
  && r.decisions.filter((d) => d.decision === 'blocks').every((d) => d.type === 'dnd_contact'));

export async function pauseFlow({ call, gw, LOCATION, id, name, unpublish, beforeUnpublish = null }) {
  const rec = { id, name, at: new Date().toISOString(), unpublishSent: false, paused: false, restored: null, triggersEqual: null };
  const g = await call('get_workflow', { workflowId: id });
  if (!(g.ok === true && g.data?.name === name && g.data?.status === 'published')) return { ...rec, refused: `id and name did not read back as a published workflow (name=${g.data?.name ?? null} status=${g.data?.status ?? null})` };
  rec.triggersBefore = await triggersOf(gw, LOCATION, id); // the parsed list: restoreFlow diffs it field by field
  if (rec.triggersBefore === null) return { ...rec, refused: 'the trigger list could not be read before the pause' };
  rec.triggersBeforeMasked = maskTriggers(rec.triggersBefore);
  if (beforeUnpublish) beforeUnpublish(rec);
  rec.unpublishSent = true; // set BEFORE the call: a throw or a failed read-back still leaves a record that says the call may have landed
  const fails = [];
  const un = await unpublish(call, (c, m, d) => { if (!c) fails.push(`${m}: ${d ?? ''}`); }, id, 'paused non-TEST flow');
  rec.paused = un.ok === true && fails.length === 0;
  return rec;
}

export async function restoreFlow({ call, gw, LOCATION, rec, publish }) {
  // Re-read first: after a failed pause the flow may be a draft OR still published. Publish only a draft; a published one is just compared.
  const now = await call('get_workflow', { workflowId: rec.id });
  rec.statusBeforeRestore = now.data?.status ?? null;
  const p = now.data?.status === 'published' ? { ok: true } : await publish(call, 'publish_workflow', { workflowId: rec.id });
  const g = await call('get_workflow', { workflowId: rec.id });
  const after = await triggersOf(gw, LOCATION, rec.id);
  rec.restored = p.ok === true && g.data?.status === 'published' && g.data?.name === rec.name;
  rec.triggersRawEqual = after !== null && JSON.stringify(after) === JSON.stringify(rec.triggersBefore); // the old byte-equal reading, kept for the record
  rec.triggerDiff = after === null ? [{ path: '(list)', before: `${rec.triggersBefore.length} triggers`, after: 'unreadable' }] : diffTriggers(rec.triggersBefore, after);
  rec.triggersEqual = after !== null && rec.triggerDiff.length === 0; // server-stamped fields excluded (SERVER_STAMPED_TRIGGER_FIELDS)
  rec.restoredAt = new Date().toISOString();
  rec.ok = rec.restored === true && rec.triggersEqual === true;
  return rec;
}
// The record carries the target's id and name, booleans, and trigger STRUCTURE only: every trigger string or number is a type plus a short salted hash (maskValue); no trigger body, value, e-mail, number, name, tag or URL.
export const pauseRecord = (r) => ({ id: r.id, name: r.name, unpublishSent: r.unpublishSent ?? false, paused: r.paused, restored: r.restored, triggersEqual: r.triggersEqual, triggersRawEqual: r.triggersRawEqual ?? null, excludedFields: SERVER_STAMPED_TRIGGER_FIELDS, triggersBeforeMasked: r.triggersBeforeMasked ?? null, triggerDiff: r.triggerDiff ?? null, at: r.at, restoredAt: r.restoredAt ?? null, ...(r.refused ? { refused: r.refused } : {}) });
