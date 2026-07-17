import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IRError } from './ir.mjs';

export const OPP_SHAPES = JSON.parse(
  readFileSync(fileURLToPath(new URL('../catalog/opp-field-shapes.json', import.meta.url)), 'utf8'),
);
export const STANDARD_OPP_FIELDS = new Set(Object.keys(OPP_SHAPES.fields));

// Validate ONE compiled oppField {filterField, value, valueFieldType, dataType?} against
// the live-attested table. Absence is always legal (dialect). A present value outside the
// attested set is reported: throw when the rule has strong support (>= _threshold.throw
// accounts), warn when thin. Unknown filterFields are left for the Task-3 classifier.
export function checkOppFieldShape(field, { ref, warn } = {}) {
  const spec = OPP_SHAPES.fields[field.filterField];
  if (!spec) return;
  for (const key of ['valueFieldType', 'dataType']) {
    const rule = spec[key];
    if (!rule) continue;
    const val = field[key];
    if (val === undefined) continue;              // dialect: absence always legal
    if (rule.allowed.includes(val)) continue;
    const support = `set: [${rule.allowed.join(', ')}], n=${rule.n}, ${rule.accounts} accounts`;
    const msg = `OPP_SHAPE: ${field.filterField} ${key} '${val}' not attested (${support})`
      + `${ref ? ` on '${ref}'` : ''} — verify against a live step`;
    if (rule.accounts >= OPP_SHAPES._threshold.throw) throw new IRError('OPP_SHAPE', msg);
    warn?.(msg);
  }
}
