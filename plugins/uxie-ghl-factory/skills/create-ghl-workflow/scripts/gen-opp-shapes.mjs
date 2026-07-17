// Dev tool. Regenerate catalog/opp-field-shapes.json from the research corpus.
// Usage: node scripts/gen-opp-shapes.mjs /path/to/ghl-internal-api-research/samples/by-location
// NEVER point this at an account the factory has built — see the spec's freeze-date constraint.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2];
if (!ROOT) { console.error('pass the samples/by-location path'); process.exit(1); }
const DIRTY_UPDATED = new Set(['clone_workflow', 'snapshot', 'copy_workflows']);
const DIRTY_ORIGIN = new Set(['duplicate-workflow', 'copy-workflow-subaccount', 'recipe']);
const THRESHOLD = { throw: 3, warn: 2 };

const walkFiles = (d) => readdirSync(d).flatMap((e) => {
  const p = join(d, e); return statSync(p).isDirectory() ? walkFiles(p) : (p.endsWith('.json') ? [p] : []);
});
const provenance = (o, got = {}, depth = 0) => {
  if (depth > 3 || !o || typeof o !== 'object') return got;
  for (const k of ['originType', 'updatedBy']) if (typeof o[k] === 'string' && !(k in got)) got[k] = o[k];
  for (const v of Array.isArray(o) ? o.slice(0, 20) : Object.values(o)) provenance(v, got, depth + 1);
  return got;
};
const fields = (o, out) => {
  if (Array.isArray(o)) o.forEach((v) => fields(v, out));
  else if (o && typeof o === 'object') {
    if ('filterField' in o) out.push([String(o.filterField), 'dataType' in o ? String(o.dataType) : null, o.valueFieldType]);
    Object.values(o).forEach((v) => fields(v, out));
  }
  return out;
};
// (filterField, key) -> value -> Set(account)
const agg = {};
for (const acctDir of readdirSync(ROOT)) {
  const acct = acctDir.split('_').pop();
  for (const p of walkFiles(join(ROOT, acctDir))) {
    let d; try { d = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
    const rows = fields(d, []);
    if (!rows.length) continue;
    const { originType, updatedBy } = provenance(d);
    if (DIRTY_UPDATED.has(updatedBy) || DIRTY_ORIGIN.has(originType)) continue;
    for (const [ff, dt, vft] of rows) {
      if (ff.startsWith('custom_fields.')) continue; // excluded — needs per-account join
      const add = (key, val) => {
        if (val == null) return;
        ((agg[ff] ??= {})[key] ??= {})[val] ??= new Set();
        agg[ff][key][val].add(acct);
      };
      add('dataType', dt); add('valueFieldType', vft);
    }
  }
}
const out = { _generated: `${ROOT} (regenerated)`, _method: 'provenance-filtered per (filterField,key)', _threshold: THRESHOLD, fields: {} };
for (const ff of Object.keys(agg).sort()) {
  out.fields[ff] = {};
  for (const key of ['valueFieldType', 'dataType']) {
    const vals = agg[ff][key]; if (!vals) continue;
    const accts = new Set(); let n = 0;
    for (const v of Object.values(vals)) { v.forEach((a) => accts.add(a)); n += v.size; }
    out.fields[ff][key] = { allowed: Object.keys(vals).sort(), n, accounts: accts.size };
  }
}
console.log(JSON.stringify(out, null, 2));
