// Reference SITES GHL's validate-assets does not read, checked by the engine (console bl-140, bl-144).
//
// validate-assets' coverage is per reference SITE, not per asset type, measured 2026-09-15 against controls:
//   - a ghost calendar on an appointment TRIGGER is reported; the same ghost as a STEP's
//     attributes.calendarId (appointment_booking) is not (bl-140);
//   - assign_user's user_list is checked; the same user ids in its siblings traffic_weightage (as map
//     KEYS) and traffic_index[].id are not — after a snapshot load a round robin keeps rotating to users
//     that do not exist here (bl-144).
// GHL treats an INACTIVE calendar as not found on the sites it does check, so this does the same, and
// says which.
const CALENDAR_STEPS = new Map([['appointment_booking', 'calendarId'], ['conversationai_book_appointment', 'calendarId']]);

export function needsReferenceSites(templates = []) {
  return {
    calendars: templates.some((t) => CALENDAR_STEPS.has(t?.type) && t.attributes?.[CALENDAR_STEPS.get(t.type)]),
    users: templates.some((t) => t?.type === 'assign_user'
      && (Object.keys(t.attributes?.traffic_weightage ?? {}).length || (t.attributes?.traffic_index ?? []).length)),
  };
}

const isMerge = (v) => typeof v === 'string' && v.includes('{{');

/**
 * @param templates
 * @param entities { calendars: [{id, isActive}] | null, users: [{id}] | null } — null = could not be read
 * @returns {errors:[{stepId, stepName, type, code, message}], notChecked:[{stepId, why}]}
 */
export function checkReferenceSites(templates = [], { calendars = null, users = null } = {}) {
  const errors = [], notChecked = [];
  const err = (t, code, message) => errors.push({ stepId: t.id ?? null, stepName: t.name ?? null, type: t.type, code, message });
  const calById = calendars ? new Map(calendars.map((c) => [c.id, c])) : null;
  const userIds = users ? new Set(users.map((u) => u.id)) : null;
  for (const t of templates) {
    const a = t?.attributes ?? {};
    if (CALENDAR_STEPS.has(t?.type)) {
      const id = a[CALENDAR_STEPS.get(t.type)];
      if (id && !isMerge(id)) {
        if (!calById) notChecked.push({ stepId: t.id ?? null, why: 'the calendar list could not be read' });
        else if (!calById.has(id)) err(t, 'STEP_CALENDAR_NOT_FOUND', `'${t.name ?? t.id}' books into calendar '${id}', which does not exist on this location. GHL's asset check reads calendars on TRIGGERS, not on this step.`);
        else if (calById.get(id).isActive === false) err(t, 'STEP_CALENDAR_INACTIVE', `'${t.name ?? t.id}' books into calendar '${id}', which is INACTIVE; GHL treats an inactive calendar as not found where it does check.`);
      }
    }
    if (t?.type === 'assign_user') {
      const ids = [...Object.keys(a.traffic_weightage ?? {}), ...(a.traffic_index ?? []).map((x) => x?.id).filter(Boolean)];
      if (ids.length && !userIds) notChecked.push({ stepId: t.id ?? null, why: 'the user list could not be read' });
      else {
        const ghosts = [...new Set(ids.filter((id) => !isMerge(id) && !userIds?.has(id)))];
        if (ghosts.length) err(t, 'ROUND_ROBIN_USER_NOT_FOUND', `'${t.name ?? t.id}' keeps round-robin state for user(s) ${ghosts.join(', ')} that do not exist on this location (traffic_weightage / traffic_index). GHL checks user_list only; after a snapshot load these keep the SOURCE account's ids.`);
      }
    }
  }
  return { errors, notChecked };
}

/** Read what checkReferenceSites needs: only the lists the document calls for; a failed read is null (not checked). */
export async function fetchReferenceEntities(call, loc, needs) {
  const q = `locationId=${encodeURIComponent(loc)}`;
  const out = { calendars: null, users: null };
  if (needs.calendars) {
    const r = await call('GET', `/calendars/?${q}`);
    if (r?.ok && Array.isArray(r.json?.calendars)) out.calendars = r.json.calendars.map((c) => ({ id: c.id, isActive: c.isActive }));
  }
  if (needs.users) {
    const r = await call('GET', `/users/?${q}`);
    if (r?.ok && Array.isArray(r.json?.users)) out.users = r.json.users.map((u) => ({ id: u.id ?? u._id }));
  }
  return out;
}
