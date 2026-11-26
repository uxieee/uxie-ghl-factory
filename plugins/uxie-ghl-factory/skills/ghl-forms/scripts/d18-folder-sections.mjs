// Sections of d18-folder-proof.mjs, kept in a module that imports NOTHING from mcp-internal so spawn/unit tests can drive them with a fake `call`.
// Failure details are the error CODE plus safe KEY PATHS only (never server text, ids or values): see safeDetail.
export const safeDetail = (r) => {
  if (r?.ok === true) return '';
  const keys = (o, d = 0) => (o && typeof o === 'object' && !Array.isArray(o) && d < 2 ? Object.keys(o).sort().flatMap((k) => (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) && d < 1 ? [k, ...keys(o[k], d + 1).map((s) => `${k}.${s}`)] : [k])) : []);
  return `${String(r?.code ?? 'NO_CODE').slice(0, 40)} keys=${keys(r?.data).slice(0, 12).join(',') || '-'}`;
};

export const SWEEP_PREFIXES = ['TEST-CONF-D18F-', 'TEST-CONF-W9-FORMS-FOLDER'];
export class SweepAbort extends Error {}
const PAGE = 100, MAX_PAGES = 30;

// READ-ONLY residue sweep. Returns a summary or throws SweepAbort; it never writes (the folder list comes from the create tool's PREVIEW, no confirm).
// F2: the forms listing is paged to its end; a page that stays full after MAX_PAGES (or a reported total larger than what was read) ABORTS.
// F1: strays = objects whose name starts with SWEEP_PREFIXES and whose id is not recorded, plus ANY object carrying an incident stamp. Other recorded W9 forms objects are not strays.
// F3: the listing is the location's top-level forms listing; forms nested in folders are NOT claimed.
export const sweepResidue = async ({ call, locationId, stamp, expectedForms, expectedFolders, incidentStamps, log = () => {} }) => {
  // The stamps of earlier stray runs come in from the knowledge-side runner (D18_INCIDENT_STAMPS), like the recorded ids; none is written here. Fail closed without them.
  if (!Array.isArray(incidentStamps) || !incidentStamps.length || incidentStamps.some((x) => !/^\d{4,}$/.test(x))) throw new SweepAbort('no incident stamps were given (D18_INCIDENT_STAMPS, comma list of digit stamps)');
  const rows = [];
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) throw new SweepAbort(`the forms listing is still full after ${MAX_PAGES} pages; the end was not reached`);
    const r = await call('list_forms', { locationId, includeFolders: true, skip: page * PAGE, limit: PAGE });
    if (r.ok !== true) throw new SweepAbort(`the forms read failed (${safeDetail(r)})`);
    const got = Array.isArray(r.data?.forms) ? r.data.forms : null;
    if (!got) throw new SweepAbort('the forms read returned no forms array');
    rows.push(...got);
    if (got.length < PAGE) { if (typeof r.data?.total === 'number' && r.data.total > rows.length) throw new SweepAbort(`the listing reports total ${r.data.total} but ${rows.length} were read`); break; }
  }
  const probe = await call('create_custom_field_folder', { locationId, name: `TEST-CONF-W9-FORMS-SWEEP-${stamp}`, model: 'contact' });
  const fl = probe?.data?.preview?.existingFolders;
  if (!(probe.ok === false && probe.code === 'CONFIRM_REQUIRED' && Array.isArray(fl))) throw new SweepAbort(`the folder read did not answer as a preview (${safeDetail(probe)})`);
  if (fl.length >= 1000) throw new SweepAbort('the folder list is a full 1000-row page; the end was not reached');
  const all = [...rows.map((f) => ({ kind: 'form', id: f.id, name: String(f.name ?? '') })), ...fl.map((f) => ({ kind: 'folder', id: f.id, name: String(f.name ?? '') }))];
  const recorded = (o) => (o.kind === 'folder' ? expectedFolders : expectedForms).has(o.id);
  const prefixed = all.filter((o) => SWEEP_PREFIXES.some((p) => o.name.startsWith(p)));
  const unexpected = prefixed.filter((o) => !recorded(o)).map((o) => `${o.kind} ${o.id}`);
  const stampHits = incidentStamps.map((st) => [st, all.filter((o) => o.name.includes(st)).length]);
  const seen = new Set(all.map((o) => `${o.kind}:${o.id}`));
  const missing = [...expectedForms].filter((id) => !seen.has(`form:${id}`)).map((id) => `form ${id}`).concat([...expectedFolders].filter((id) => !seen.has(`folder:${id}`)).map((id) => `folder ${id}`));
  log(`SWEEP  this listing holds ${rows.length} form/folder row(s) at the top level and ${fl.length} contact custom-field folder(s); forms nested in folders are not claimed`);
  for (const [st, n] of stampHits) log(`SWEEP  incident stamp ${st}: ${n} object(s) found`);
  log(`SWEEP  matching ${SWEEP_PREFIXES.join(' / ')}*: ${prefixed.length}, recorded ${expectedForms.size + expectedFolders.size}, unexpected ${unexpected.length}, missing ${missing.length}`);
  if (!expectedForms.size && !expectedFolders.size) throw new SweepAbort('no recorded ids were given (D18_EXPECTED_FORM_IDS / D18_EXPECTED_FOLDER_IDS)');
  if (stampHits.some(([, n]) => n > 0)) throw new SweepAbort('an object carrying an incident stamp exists');
  if (unexpected.length || missing.length) throw new SweepAbort(`unexpected: ${unexpected.join('; ') || 'none'}; missing: ${missing.join('; ') || 'none'}`);
  return { forms: rows.length, folders: fl.length };
};

// list_form_submissions: READ ONLY. Counts and key names only; nothing from a row is printed. F6: a formId is REQUIRED (taken from a row of the unfiltered
// read; no row carrying a string formId FAILS the precondition), every returned row's formId must equal it, and a ghost formId must return 0 rows.
export const submissionsSection = async ({ call, check, locationId, stamp }) => {
  const all = await call('list_form_submissions', { locationId, limit: 5 });
  const n = all.data?.returned;
  if (all.ok !== true) { check(false, 'list_form_submissions reads the location without a form filter', safeDetail(all)); return; }
  if (!(n >= 1)) { check(false, 'PRECONDITION: the location already has at least one form submission to read (this run never submits one; the row stays unproven if there is none)', `returned ${n}`); return; }
  check(Array.isArray(all.data.submissions) && all.data.submissions.length === n && n <= 5, `list_form_submissions returns ${n} row(s) for the location, within limit 5 (count only)`);
  const none = await call('list_form_submissions', { locationId, limit: 5, q: `no-match-${stamp}-zz` });
  check(none.ok === true && none.data?.returned === 0, 'CONTROL: a q nothing matches narrows the same read to 0 rows (the filter is applied, not ignored)', safeDetail(none));
  const win = await call('list_form_submissions', { locationId, limit: 5, startAt: '2020-01-01T00:00:00+00:00', endAt: '2020-01-02T00:00:00+00:00' });
  check(win.ok === true && win.data?.returned === 0, 'CONTROL: a date window before any submission narrows it to 0 rows', safeDetail(win));
  const rowForm = all.data.submissions.find((r) => typeof r?.formId === 'string' && r.formId !== '')?.formId;
  if (!rowForm) { check(false, 'PRECONDITION: a returned row carries a formId to filter by (key name formId)', 'no row with a string formId'); return; }
  const one = await call('list_form_submissions', { locationId, formId: rowForm, limit: 5 });
  const rows = one.data?.submissions;
  check(one.ok === true && one.data?.returned >= 1 && Array.isArray(rows) && rows.length === one.data.returned && rows.every((r) => r?.formId === rowForm), 'list_form_submissions with that row\'s formId returns >= 1 row and EVERY returned row carries exactly that formId (the form filter maps through)', safeDetail(one));
  const ghost = await call('list_form_submissions', { locationId, formId: 'f'.repeat(24), limit: 5 });
  check(ghost.ok === true && ghost.data?.returned === 0, 'CONTROL: a ghost formId returns 0 rows (the formId filter is applied, not ignored)', safeDetail(ghost));
};
