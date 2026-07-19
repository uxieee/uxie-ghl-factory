import OPP_SHAPES from '../catalog/opp-field-shapes.json' with { type: 'json' };
import { IRError } from './ir.mjs';

export { OPP_SHAPES };
export const STANDARD_OPP_FIELDS = new Set(Object.keys(OPP_SHAPES.fields));

// Validate ONE compiled oppField {filterField, value, valueFieldType, dataType?} against
// the live-attested table. Absence is always legal (dialect). A present value outside the
// attested set is reported by SUPPORT TIER, both thresholds read from the data file:
//   accounts >= _threshold.throw  -> throw  (strong support — a wrong shape is a real defect)
//   accounts >= _threshold.warn   -> warn   (thin support — surface it, don't block a build)
//   accounts <  _threshold.warn   -> silent (too little evidence to even warn — never gate on n=1)
// Unknown filterFields are left for the Task-3 classifier.
export function checkOppFieldShape(field, { ref, warn } = {}) {
  const spec = OPP_SHAPES.fields[field.filterField];
  if (!spec) return;
  const { throw: throwAt, warn: warnAt } = OPP_SHAPES._threshold;
  for (const key of ['valueFieldType', 'dataType']) {
    const rule = spec[key];
    if (!rule) continue;
    const val = field[key];
    if (val === undefined) continue;              // dialect: absence always legal
    if (rule.allowed.includes(val)) continue;
    const support = `set: [${rule.allowed.join(', ')}], n=${rule.n}, ${rule.accounts} accounts`;
    const msg = `OPP_SHAPE: ${field.filterField} ${key} '${val}' not attested (${support})`
      + `${ref ? ` on '${ref}'` : ''} — verify against a live step`;
    if (rule.accounts >= throwAt) throw new IRError('OPP_SHAPE', msg);
    if (rule.accounts >= warnAt) warn?.(msg);
  }
}
