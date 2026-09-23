// LIVE: the reference sites GHL's validate-assets does not read are checked by the engine before any write
// (bl-140: a STEP's calendarId; bl-144: assign_user's round-robin state in traffic_weightage / traffic_index).
// DIFFERENTIAL on the same step, differing only in the id: the location's own calendar / user builds clean;
// a ghost id in the same place is refused, by code, naming the id. The ids come from the location's own
// lists at run time, so the controls prove the check reads the right list, not that a guessed id passed.
// Every workflow here is a DRAFT with no trigger and never runs.
export async function runReferenceSitesProof({ call, gw, LOCATION, NAME, check, left, log = null }) {
  const subject = (s) => log?.subject?.(s);
  const GHOST_CAL = 'TESTCONFghostCal0001x', GHOST_USER = 'TESTCONFghostUsr0001x';
  subject(false);
  const cals = await gw.call('GET', `/calendars/?locationId=${LOCATION}`);
  const cal = (cals.json?.calendars ?? []).find((c) => c.isActive !== false);
  const users = await gw.call('GET', `/users/?locationId=${LOCATION}`);
  const user = (users.json?.users ?? [])[0];
  const userId = user?.id ?? user?._id;
  const ids = [...(cals.json?.calendars ?? []).map((c) => c.id), ...(users.json?.users ?? []).map((u) => u.id ?? u._id)];
  check(Boolean(cal?.id) && Boolean(userId) && !ids.includes(GHOST_CAL) && !ids.includes(GHOST_USER),
    'PRECONDITION: the location has an active calendar and a user, and neither ghost id exists on it', `calendars=${cals.status} users=${users.status}`);
  if (!cal?.id || !userId) return;

  const build = (label, step) => call('build_workflow', { spec: { name: NAME(`rs-${label}`), triggers: [], graph: [step] } });
  const booking = (calendarId) => ({ ref: 'bk', kind: 'action', type: 'appointment_booking', name: 'Book TEST-CONF',
    attributes: { type: 'appointment_booking', calendarId, startDateTime: '2030-01-07T16:00:00.000Z', ignoreFreeSlots: false, __customInputs__: {} } });
  // The round-robin state shape is the STORED one, measured in harvested documents: traffic_index is
  // [{ id, indexes: [n] }] with n 1-based per user, total_index the count; GHL refuses an entry without indexes.
  const roundRobin = (stateIds) => ({ ref: 'au', kind: 'action', type: 'assign_user', name: 'Assign TEST-CONF',
    attributes: { type: 'assign_user', only_unassigned_contact: false, total_index: stateIds.length, traffic_split: 'equally', user_list: [userId],
      traffic_weightage: Object.fromEntries(stateIds.map((id) => [id, 1])), traffic_index: stateIds.map((id, i) => ({ id, indexes: [i + 1] })) } });
  const report = (r) => `${r.code ?? ''} ${String(r.detail ?? '').slice(0, 300)}`;
  const keep = (r, label, what) => { if (r.data?.wid) left.push(`workflow ${r.data.wid} (${NAME(`rs-${label}`)}, draft, no trigger${what ? `, ${what}` : ''})`); };

  subject('build_workflow');
  const c1 = await build('cal-ok', booking(cal.id));
  check(c1.ok === true && typeof c1.data?.wid === 'string', 'CONTROL: a booking step on the location\'s own active calendar builds clean', report(c1));
  keep(c1, 'cal-ok');
  const t1 = await build('cal-ghost', booking(GHOST_CAL));
  check(t1.ok === false && /STEP_CALENDAR_NOT_FOUND/.test(JSON.stringify(t1)) && JSON.stringify(t1).includes(GHOST_CAL),
    'TEST (bl-140): the same step on a ghost calendar is REFUSED as STEP_CALENDAR_NOT_FOUND, naming the id — GHL\'s asset check does not read this site', report(t1));
  keep(t1, 'cal-ghost', 'SHOULD NOT EXIST');

  const c2 = await build('rr-ok', roundRobin([userId]));
  check(c2.ok === true && typeof c2.data?.wid === 'string', 'CONTROL: round-robin state keyed by the location\'s own user builds clean', report(c2));
  keep(c2, 'rr-ok');
  const t2 = await build('rr-ghost', roundRobin([userId, GHOST_USER]));
  check(t2.ok === false && /ROUND_ROBIN_USER_NOT_FOUND/.test(JSON.stringify(t2)) && JSON.stringify(t2).includes(GHOST_USER),
    'TEST (bl-144): the same step carrying a ghost user in traffic_weightage / traffic_index is REFUSED as ROUND_ROBIN_USER_NOT_FOUND, naming the id', report(t2));
  keep(t2, 'rr-ghost', 'SHOULD NOT EXIST');
  subject(false);
}
