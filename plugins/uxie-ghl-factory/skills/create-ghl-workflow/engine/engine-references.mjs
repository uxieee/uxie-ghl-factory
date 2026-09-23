// The engine's OWN reference checks, run beside GHL's validate-assets on every write path and in
// check_workflow — one function so the paths cannot drift. Each reads its account data only when the
// document needs it; an unreadable list is reported as NOT CHECKED, never as clean.
//   custom-object record steps against the object's real schema (custom-object-fields.mjs, bl-167)
//   reference sites validate-assets skips: a step's calendarId, round-robin user state (reference-sites.mjs, bl-140/bl-144)
import { referencedObjectKeys, checkCustomObjectSteps, fetchObjectSchemas } from './custom-object-fields.mjs';
import { needsReferenceSites, checkReferenceSites, fetchReferenceEntities } from './reference-sites.mjs';

export async function engineReferenceFindings(call, loc, templates = []) {
  const errors = [], warnings = [];
  const notChecked = (list) => { for (const n of list) warnings.push({ stepId: n.stepId, code: 'REFERENCE_NOT_CHECKED', message: `NOT CHECKED: ${n.why}` }); };
  const keys = referencedObjectKeys(templates);
  if (keys.length) {
    let schemas = new Map();
    try { schemas = await fetchObjectSchemas(call, loc, keys); } catch { /* not checked */ }
    const r = checkCustomObjectSteps(templates, schemas);
    errors.push(...r.errors.map((e) => ({ ...e, source: 'custom-object-schema' })));
    notChecked(r.notChecked);
  }
  const needs = needsReferenceSites(templates);
  if (needs.calendars || needs.users) {
    let ents = { calendars: null, users: null };
    try { ents = await fetchReferenceEntities(call, loc, needs); } catch { /* not checked */ }
    const r = checkReferenceSites(templates, ents);
    errors.push(...r.errors.map((e) => ({ ...e, source: 'engine-reference-site' })));
    notChecked(r.notChecked);
  }
  return { errors, warnings };
}
