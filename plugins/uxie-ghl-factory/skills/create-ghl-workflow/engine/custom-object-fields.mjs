// Custom-object record steps, checked against the object's REAL schema before a write (console bl-167;
// operator: clients do use custom objects). GHL validates none of this server-side that we know of,
// and the builder's own checks live in its form (models/actions/custom-objects/base-custom-object-action.ts,
// recovered 2026-09-18). This mirrors those checks, one for one, and adds the one the form gets for free
// by construction: that every field the step names exists on the object.
//
// THE SHAPE, from that source (the corpus pages had it as speculation):
//   attributes: { type, key: '<object key>', fields: [{ fieldKey, value, dataType }], associations[],
//                 followers[], owner?, clearOwner, clearFollowers, makeAssociation, … }
// 🔴 `fields[].fieldKey` holds the schema field's ID, not its fieldKey: the builder loads the schema
//    with useId=true, so each option's value is `id` (utils/custom-object-helper.ts:112).
// Mandatory on CREATE = the object's primaryDisplayProperty plus its requiredProperties (:122-123).
// The builder never offers TEXTBOX_LIST, SIGNATURE or FILE_UPLOAD fields here (:220).

export const CUSTOM_OBJECT_STEP_TYPES = new Set(['create_custom_object', 'update_custom_object', 'clear_custom_object_fields']);
const CRM_KEYS = new Set(['contact', 'business', 'company', 'opportunity']);
const NOT_SETTABLE = new Set(['TEXTBOX_LIST', 'SIGNATURE', 'FILE_UPLOAD']);
const isMerge = (v) => typeof v === 'string' && v.includes('{{');
const isEmpty = (v) => v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0);

/** Object keys the document's custom-object steps reference (CRM objects excluded: the builder uses other field sources). */
export function referencedObjectKeys(templates = []) {
  return [...new Set(templates.filter((t) => CUSTOM_OBJECT_STEP_TYPES.has(t?.type))
    .map((t) => t.attributes?.key).filter((k) => typeof k === 'string' && k && !CRM_KEYS.has(k.toLowerCase())))];
}

/**
 * @param templates the document's steps
 * @param schemas   Map objectKey -> { object, fields } from GET /objects/{key}?fetchProperties=true, or null when unreadable
 * @returns {errors:[{stepId, stepName, type, code, message}], notChecked:[{stepId, why}]}
 */
export function checkCustomObjectSteps(templates = [], schemas = new Map()) {
  const errors = [], notChecked = [];
  const err = (t, code, message) => errors.push({ stepId: t.id ?? null, stepName: t.name ?? null, type: t.type, code, message });
  for (const t of templates) {
    if (!CUSTOM_OBJECT_STEP_TYPES.has(t?.type)) continue;
    const a = t.attributes ?? {};
    const key = a.key;
    if (typeof key !== 'string' || !key) { err(t, 'CUSTOM_OBJECT_KEY', `'${t.name ?? t.id}' names no object (attributes.key is empty)`); continue; }
    if (CRM_KEYS.has(key.toLowerCase())) continue;
    if (!schemas.has(key)) { notChecked.push({ stepId: t.id ?? null, why: `schema for '${key}' was not read` }); continue; }
    const schema = schemas.get(key);
    if (schema === null) { err(t, 'CUSTOM_OBJECT_NOT_FOUND', `'${t.name ?? t.id}' writes to object '${key}', which does not exist on this location`); continue; }
    const byId = new Map((schema.fields ?? []).map((f) => [f.id, f]));
    const byKey = new Map((schema.fields ?? []).map((f) => [f.fieldKey, f]));
    const fields = Array.isArray(a.fields) ? a.fields : [];
    for (const f of fields) {
      const def = byId.get(f?.fieldKey);
      if (!def) {
        const asKey = byKey.get(f?.fieldKey);
        err(t, 'CUSTOM_OBJECT_FIELD', asKey
          ? `'${t.name ?? t.id}' names field '${f?.fieldKey}' by its fieldKey; this step stores the field's ID ('${asKey.id}'), so the builder cannot bind it`
          : `'${t.name ?? t.id}' names field '${f?.fieldKey}', which is not a field of '${key}'`);
        continue;
      }
      if (NOT_SETTABLE.has(def.dataType)) err(t, 'CUSTOM_OBJECT_FIELD_TYPE', `field '${def.name ?? def.fieldKey}' is ${def.dataType}, which this step cannot set (the builder never offers it)`);
      if (t.type === 'clear_custom_object_fields' || isMerge(f.value) || isEmpty(f.value)) continue;
      const opts = (def.picklistOptions ?? def.options ?? []).map((o) => (typeof o === 'string' ? o : o?.value ?? o?.label)).filter((x) => x != null);
      if (['SINGLE_OPTIONS', 'RADIO'].includes(def.dataType) && opts.length && !opts.includes(f.value))
        err(t, 'CUSTOM_OBJECT_OPTION', `field '${def.name ?? def.fieldKey}' value ${JSON.stringify(f.value)} is not one of its options (${opts.map((o) => JSON.stringify(o)).join(', ')})`);
      if (['MULTIPLE_OPTIONS', 'CHECKBOX'].includes(def.dataType) && opts.length) {
        const bad = (Array.isArray(f.value) ? f.value : [f.value]).filter((v) => !isMerge(v) && !opts.includes(v));
        if (bad.length) err(t, 'CUSTOM_OBJECT_OPTION', `field '${def.name ?? def.fieldKey}' values ${JSON.stringify(bad)} are not among its options`);
      }
    }
    if (t.type === 'create_custom_object') {
      const mandatory = (schema.fields ?? []).filter((f) => f.fieldKey === schema.object?.primaryDisplayProperty
        || (schema.object?.requiredProperties ?? []).includes(f.fieldKey));
      for (const m of mandatory) {
        const given = fields.find((f) => f?.fieldKey === m.id);
        if (!given || isEmpty(given.value)) err(t, 'CUSTOM_OBJECT_REQUIRED', `creating a '${key}' record needs '${m.name ?? m.fieldKey}' (the object's ${m.fieldKey === schema.object?.primaryDisplayProperty ? 'primary display property' : 'required property'}), and the step does not set it`);
      }
    }
    if (!fields.length && !(a.followers ?? []).length && !a.owner && !a.clearOwner && !a.clearFollowers)
      err(t, 'CUSTOM_OBJECT_EMPTY', `'${t.name ?? t.id}' sets no field, owner or follower — the builder refuses it ("please select at least one field")`);
  }
  return { errors, notChecked };
}

/**
 * Read each referenced object's schema: Map key -> {object, fields} | null. EXISTENCE comes from the object
 * LIST (GET /objects/?locationId), never from a 4xx on the detail read — a 4xx is evidence about the
 * arguments, not proof of absence. A key the list lacks is null (does not exist); a detail read that fails
 * for a key the list has is left out (= not checked). An unreadable list leaves every key out.
 */
export async function fetchObjectSchemas(call, loc, keys) {
  const out = new Map();
  if (!keys.length) return out;
  const list = await call('GET', `/objects/?locationId=${encodeURIComponent(loc)}`);
  const objects = list?.ok && Array.isArray(list.json?.objects) ? list.json.objects : null;
  if (!objects) return out;
  const known = new Set(objects.map((o) => o.key));
  for (const key of keys) {
    if (!known.has(key)) { out.set(key, null); continue; }
    const r = await call('GET', `/objects/${encodeURIComponent(key)}?locationId=${encodeURIComponent(loc)}&fetchProperties=true`);
    if (r?.ok && r.json?.object) out.set(key, { object: r.json.object, fields: r.json.fields ?? [] });
  }
  return out;
}
