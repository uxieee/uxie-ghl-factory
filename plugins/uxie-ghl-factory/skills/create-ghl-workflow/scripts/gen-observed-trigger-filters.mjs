// Dev tool. Regenerate catalog/observed-trigger-filters.json from catalog/trigger-examples/.
// Usage: node scripts/gen-observed-trigger-filters.mjs
//
// WHY: the recovered drawer model (catalog.data.json filterRows) is incomplete — dependent rows
// the drawer adds only after a parent is chosen (pipeline stage, lesson, category) are not in it,
// yet UI-built triggers store them. This file is the second row source: what a UI-written trigger
// of each type was SEEN to store, shape only. expandFilter fills title/type/id from it when the
// model has no row, and warns only when NEITHER source knows the field.
//
// SHAPE ONLY, NEVER VALUES: a condition's `value` is account data and is not read. Per-account
// rows (custom fields) are skipped by name — their field/title carry an account's own ids and labels.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'catalog/trigger-examples');
const OUT = join(ROOT, 'catalog/observed-trigger-filters.json');
const PER_ACCOUNT = (c) => c.id === 'custom-field' || /customFields?/i.test(String(c.field ?? ''));

const out = {};
const skipped = [];
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json')).sort()) {
  const j = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  const trig = j.trigger ?? j;
  const type = trig.type ?? f.replace(/\.json$/, '');
  for (const c of trig.conditions ?? []) {
    if (!c?.field) { skipped.push(`${f}: condition with no field`); continue; }
    if (PER_ACCOUNT(c)) { skipped.push(`${f}: per-account row '${c.id ?? c.field}'`); continue; }
    if (typeof c.title !== 'string' || typeof c.type !== 'string') { skipped.push(`${f}: '${c.field}' stored without title/type`); continue; }
    const rows = (out[type] ??= []);
    let row = rows.find((r) => r.field === c.field && (r.id ?? null) === (c.id ?? null));
    if (!row) rows.push(row = { field: c.field, ...(c.id ? { id: c.id } : {}), title: c.title, type: c.type, operators: [] });
    if (typeof c.operator === 'string' && !row.operators.includes(c.operator)) row.operators.push(c.operator);
  }
}
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
for (const s of skipped) console.log('SKIPPED', s);
console.log(`written ${OUT}: ${Object.keys(out).length} trigger types, ${Object.values(out).flat().length} rows, ${skipped.length} skipped`);
