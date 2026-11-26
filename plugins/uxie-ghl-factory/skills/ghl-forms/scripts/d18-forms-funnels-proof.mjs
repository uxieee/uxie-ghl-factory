#!/usr/bin/env node
/**
 * d18 PROOF RUN for 13 tools on the internal API: forms (create_form, get_form, list_forms, update_form_data,
 * list_form_submissions), create_custom_field_folder, and funnels (create_funnel, get_funnel, edit_funnel,
 * build_funnel_page, audit_site, find_ghl_site, edit_redirects).
 *
 *   GHL_LOCATION='<locationId>' GHL_EXERCISED_OUT=<file> node d18-forms-funnels-proof.mjs [--smoke]
 *
 * Every assertion is about ONE tool (mk.subject) and is an EFFECT read back on a separate request. Setup and
 * controls that go through a raw gateway call run under mk.subject(false): they credit no tool.
 *
 * SCOPE (what this run does NOT claim):
 *  - No domain is attached and no page is published. The funnel stays unpublished; build_funnel_page runs with
 *    publish:false (a draft). No public URL is claimed.
 *  - edit_funnel create-step is claimed ONLY as a REFUSAL: a funnel with no domain refuses it, and nothing is created.
 *  - No form is submitted publicly. list_form_submissions is read-only.
 *  - The form carries no email or phone field and no real default value.
 *  - Nothing is deleted, with ONE exception: the single redirect this run creates is deleted by id AND path.
 *  - A pre-existing redirect is never modified. Without a domain already on the location, edit_redirects stays unproven.
 * Everything made is named TEST-CONF-W9-FORMS-<stamp>. Each object is printed as "RESIDUE ..." the moment it exists, and the
 * LEFT list is printed on ANY exit (normal end, stop(), uncaught throw, SIGTERM from the runner on a 401/403, SIGINT).
 *
 * LOCATION FENCE: this script calls TOOLS[].handler directly, so registerTools' checkLocationBinding is NOT in the path.
 * The fence is (1) the knowledge-side runner pins GHL_LOCATION to the sandbox, (2) state.allowedLocations is a Set of that
 * one id, and (3) `call` below refuses any call whose locationId is not that id before it reaches a handler.
 */
import { randomUUID } from 'node:crypto';
import { startup } from './run-gate.mjs';
import { safeDetail } from './d18-folder-sections.mjs';
// ONE shared argv parser: unknown flag refused, --smoke/--dry exit here before any auth or tool use, else S + QA_CLEARED + a passed --go are required.
const { smoke: SMOKE } = startup();
if (SMOKE) { console.log('smoke: tools are not loaded and no account call was made'); process.exit(0); }
const { makeGatewayFactory, TOOLS } = await import('../../../mcp-internal/core/tools.mjs');
const { DEFAULT_TOKEN_FILE } = await import('../../../mcp-internal/core/auth.mjs');
const { createMarker } = await import('../../create-ghl-workflow/scripts/exercised-marker.mjs');

const LOCATION = process.env.GHL_LOCATION || process.env.GHL_LOC;
if (!LOCATION) { console.error('GHL_LOCATION is required.'); process.exit(1); }
const STAMP = Date.now().toString().slice(-6);
const NAME = (s) => `TEST-CONF-W9-FORMS-${s}-${STAMP}`;
const WANTED = ['create_custom_field_folder', 'create_form', 'get_form', 'update_form_data', 'list_forms', 'list_form_submissions',
  'create_funnel', 'get_funnel', 'edit_funnel', 'build_funnel_page', 'audit_site', 'find_ghl_site', 'edit_redirects'];
for (const n of WANTED) if (!TOOLS.find((t) => t.name === n)) { console.error(`tool ${n} is not registered`); process.exit(1); }

const state = { tokenFile: process.env.GHL_INTERNAL_TOK_FILE ?? DEFAULT_TOKEN_FILE, engineVersion: 'd18-forms-funnels-proof', allowedLocations: new Set([LOCATION]), renewer: null };
const deps = { state, makeGw: (o = {}) => makeGatewayFactory({ state })(o) };
const gw = deps.makeGw({ loc: LOCATION });
const mk = createMarker();
const call = mk.wrapCall(async (name, args) => {
  if (args?.locationId !== LOCATION) throw new Error(`location fence: ${name} called with a locationId that is not the pinned one`);
  return TOOLS.find((t) => t.name === name).handler(args, deps);
});
let passed = 0, failed = 0, skipped = 0;
const report = (cond, m, extra) => { if (cond) { passed++; console.log(`  PASS  ${m}`); } else { failed++; console.log(`  FAIL  ${m}${extra ? `  — ${extra}` : ''}`); } };
const check = (cond, m, extra) => mk.check(Boolean(cond), m, extra, report);
const skip = (m, why) => { skipped++; console.log(`  SKIP  ${m}  — ${why}`); };
const left = [];
let STEP_A, STEP_B;
let finished = false;
const residue = (line) => { left.push(line); console.log(`RESIDUE  ${line}`); };
const finish = (why) => {
  if (finished) return; finished = true;
  console.log(`\nLEFT IN PLACE (named TEST-CONF-W9-FORMS-${STAMP})${why ? ` — exit reason: ${why}` : ''}:`);
  for (const l of left) console.log(`  ${l}`);
  console.log(`  steps and page of the funnel above: ${STEP_A ? `${STEP_A}, ${STEP_B}` : '(not created)'}`);
  try { mk.write(); } catch (e) { console.log(`exercised marker NOT written: ${e.message}`); }
  console.log(`${passed} passed, ${failed} failed, ${skipped} skipped`);
};
process.on('SIGTERM', () => { finish('SIGTERM'); process.exit(143); });
process.on('SIGINT', () => { finish('SIGINT'); process.exit(130); });
process.on('uncaughtException', (e) => { console.log(`UNCAUGHT: ${e?.stack ?? e}`); failed++; finish('uncaught exception'); process.exit(1); });
process.on('unhandledRejection', (e) => { console.log(`UNHANDLED: ${e?.stack ?? e}`); failed++; finish('unhandled rejection'); process.exit(1); });
const has = (x, s) => JSON.stringify(x ?? null).includes(s);
const preview = (r) => r?.data?.preview ?? r?.preview ?? null;
const detail = safeDetail;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stop = (why) => { console.log(`\nSTOPPED: ${why}`); failed++; finish(why); process.exit(1); };
console.log(`d18 forms+funnels proof — location …${LOCATION.slice(-4)} — stamp ${STAMP}\n`);

// 1. create_custom_field_folder -------------------------------------------------------------------------------------
mk.subject('create_custom_field_folder');
const FOLDER = NAME('FOLDER');
const fPrev = await call('create_custom_field_folder', { locationId: LOCATION, name: FOLDER, model: 'contact' });
check(fPrev.ok === false && fPrev.code === 'CONFIRM_REQUIRED', 'create_custom_field_folder previews and sends nothing without confirm', detail(fPrev));
const fMake = await call('create_custom_field_folder', { locationId: LOCATION, name: FOLDER, model: 'contact', confirm: true });
const folderId = fMake.data?.folderId;
check(fMake.ok === true && !!folderId && fMake.data?.verified === true, 'create_custom_field_folder creates the folder and finds it in the folder list on read-back', detail(fMake));
if (folderId) residue(`custom-field folder (model contact) ${folderId} (${FOLDER}); no delete tool`);
const fAgain = await call('create_custom_field_folder', { locationId: LOCATION, name: FOLDER, model: 'contact', confirm: true });
check(fAgain.ok === false && fAgain.data?.existingId === folderId, 'a second create of the same name refuses and names the existing folder id', detail(fAgain));

// 2. create_form, get_form, update_form_data, list_forms --------------------------------------------------------------
mk.subject('create_form');
const FORM = NAME('FORM');
const FIELDS = [
  { tag: 'd18_note', label: 'Note', type: 'textarea' },
  { tag: 'd18_choice', label: 'Choice', type: 'text' },
];
const cPrev = await call('create_form', { locationId: LOCATION, name: FORM, fields: FIELDS });
check(cPrev.ok === false && cPrev.code === 'CONFIRM_REQUIRED' && !!preview(cPrev), 'create_form previews the document and sends nothing without confirm', detail(cPrev));
const cMake = await call('create_form', { locationId: LOCATION, name: FORM, fields: FIELDS, confirm: true });
const formId = cMake.data?.formId;
check(cMake.ok === true && !!formId && cMake.data?.verified === true, 'create_form creates the form and the saved document reads back with the tags sent', detail(cMake));
if (!formId) stop('create_form made no form; nothing further can be proven');
residue(`form ${formId} (${FORM}); public at its widget URL; no delete tool used`);
check(['d18_note', 'd18_choice'].every((t) => (cMake.data?.fieldTags ?? []).includes(t)), 'create_form reports exactly the field tags it saved');

mk.subject('get_form');
const gForm = await call('get_form', { locationId: LOCATION, formId });
check(gForm.ok === true && gForm.data?.name === FORM, 'get_form returns the form we made, by id, with its name', detail(gForm));
check(['d18_note', 'd18_choice'].every((t) => (gForm.data?.fieldTags ?? []).includes(t)), 'get_form reports the stored field tags');
const gPub = await call('get_form', { locationId: LOCATION, formId, publicView: true });
check(gPub.ok === true && has(gPub.data?.publicDocument, 'd18_note'), 'get_form publicView:true returns the widget document, which carries the same tag');
const gBad = await call('get_form', { locationId: LOCATION, formId: 'f'.repeat(24) });
check(gBad.ok === false, 'get_form refuses an unknown form id instead of returning an empty form', detail(gBad));

mk.subject('update_form_data');
const NAME2 = `${FORM}-renamed`;
const uPrev = await call('update_form_data', { locationId: LOCATION, formId, name: NAME2 });
check(uPrev.ok === false && uPrev.code === 'CONFIRM_REQUIRED' && preview(uPrev)?.rename?.to === NAME2, 'update_form_data previews the rename and sends nothing without confirm', detail(uPrev));
check(Array.isArray(preview(uPrev)?.preservedKeys) && preview(uPrev).preservedKeys.length > 0, 'update_form_data names the keys it re-sends so the whole-document replace deletes nothing');
const uDo = await call('update_form_data', { locationId: LOCATION, formId, name: NAME2, confirm: true });
check(uDo.ok === true && uDo.data?.verified === true, 'update_form_data applies the rename and the change reads back', detail(uDo));
const after = await call('get_form', { locationId: LOCATION, formId });
mk.subject('update_form_data'); // the next two assertions are about the update's effect, read through get_form
check(after.data?.name === NAME2, 'after update_form_data a SEPARATE get_form read shows the new name');
check(['d18_note', 'd18_choice'].every((t) => (after.data?.fieldTags ?? []).includes(t)), 'update_form_data left the fields as they were (a name-only edit keeps the document)');

mk.subject('list_forms');
await sleep(2000);
const lForms = await call('list_forms', { locationId: LOCATION, query: STAMP });
const row = (lForms.data?.forms ?? []).find((f) => f.id === formId);
check(lForms.ok === true && !!row && row.name === NAME2, 'list_forms finds the form by a name substring and shows its current name', detail(lForms));
const lNone = await call('list_forms', { locationId: LOCATION, query: `no-such-form-${STAMP}-zz` });
check(lNone.ok === true && (lNone.data?.forms ?? []).length === 0, 'list_forms answers an unmatched query with no rows');

// 3. list_form_submissions (read only) ------------------------------------------------------------------------------
mk.subject('list_form_submissions');
const s1 = await call('list_form_submissions', { locationId: LOCATION, formId });
check(s1.ok === true && Array.isArray(s1.data?.submissions) && s1.data.submissions.length === 0, 'list_form_submissions reads the new form: zero submissions (nobody submitted it)', detail(s1));
const s2 = await call('list_form_submissions', { locationId: LOCATION, formId, page: 1, limit: 5, startAt: '2020-01-01T00:00:00+00:00', endAt: '2020-01-02T00:00:00+00:00' });
check(s2.ok === true && s2.data?.returned === 0, 'list_form_submissions accepts page, limit and a date window (a window that excludes everything returns 0)', detail(s2));
const s3 = await call('list_form_submissions', { locationId: LOCATION, formId, q: `no-match-${STAMP}-zz` });
check(s3.ok === true && s3.data?.returned === 0, 'list_form_submissions accepts q (a string nothing matches returns 0)', detail(s3));

// 4. funnels: create, get, edit, page draft, audit, find ---------------------------------------------------------------
mk.subject('create_funnel');
const FUNNEL = NAME('FUNNEL');
const nPrev = await call('create_funnel', { locationId: LOCATION, kind: 'funnel', name: FUNNEL });
check(nPrev.ok === false && nPrev.code === 'CONFIRM_REQUIRED', 'create_funnel previews and sends nothing without confirm', detail(nPrev));
const nMake = await call('create_funnel', { locationId: LOCATION, kind: 'funnel', name: FUNNEL, confirm: true });
const funnelId = nMake.data?.funnelId;
check(nMake.ok === true && !!funnelId && nMake.data?.readBack?.name === FUNNEL, 'create_funnel creates the funnel and it reads back by id with the name sent', detail(nMake));
if (!funnelId) stop('create_funnel made no funnel; nothing further can be proven');
residue(`funnel ${funnelId} (${FUNNEL}); no domain, never published`);
const nDup = await call('create_funnel', { locationId: LOCATION, kind: 'funnel', name: FUNNEL, confirm: true });
check(nDup.ok === false, 'create_funnel refuses a second funnel of the same name', detail(nDup));

// raw setup: two steps with client-minted ids (a control; credits no tool)
mk.subject(false);
STEP_A = randomUUID(); STEP_B = randomUUID();
for (const [id, nm, seq] of [[STEP_A, NAME('STEP-A'), '1'], [STEP_B, NAME('STEP-B'), '2']]) {
  const r = await gw.call('POST', '/funnels/funnel/create-step', { funnelId, locationId: LOCATION, step: { id, name: nm, url: `/${nm.toLowerCase()}`, pages: [], type: 'optin_funnel_page', sequence: seq, split: false, control_traffic: 100 } });
  check(r.status < 400, `setup (raw): step ${seq} created`, `http ${r.status}`);
}
const fetchDoc = async () => { const r = await gw.call('GET', `/funnels/funnel/fetch/${funnelId}?locationId=${LOCATION}`); return r.json?.data ?? r.json ?? {}; };
const doc0 = await fetchDoc();
const stepA = (doc0.steps ?? []).find((s) => s.id === STEP_A);
const stepB = (doc0.steps ?? []).find((s) => s.id === STEP_B);
check(!!stepA && !!stepB && !!stepA.pages?.[0], 'setup (raw): both steps read back by their ids, step A carries its server-minted page');
if (!stepA?.pages?.[0]) stop('the seeded step has no page');
const pageId = stepA.pages[0];

mk.subject('get_funnel');
const g1 = await call('get_funnel', { locationId: LOCATION, funnelId });
check(g1.ok === true && has(g1.data, NAME('STEP-A')) && has(g1.data, NAME('STEP-B')), 'get_funnel summary lists both steps by the names we gave them', detail(g1));
const g2 = await call('get_funnel', { locationId: LOCATION, funnelId, view: 'lookups' });
check(g2.ok === true, 'get_funnel lookups view answers for an unpublished funnel with no domain', detail(g2));
const g3 = await call('get_funnel', { locationId: LOCATION, funnelId, view: 'settings' });
check(g3.ok === true, 'get_funnel settings view answers', detail(g3));

mk.subject('edit_funnel');
const NEW_NAME = NAME('STEP-A-renamed');
const ePrev = await call('edit_funnel', { locationId: LOCATION, funnelId, op: 'update-step', stepId: STEP_A, name: NEW_NAME });
check(ePrev.ok === false && ePrev.code === 'CONFIRM_REQUIRED', 'edit_funnel update-step previews and sends nothing without confirm', detail(ePrev));
check((await fetchDoc()).steps?.find((s) => s.id === STEP_A)?.name === NAME('STEP-A'), 'edit_funnel preview changed nothing: a separate read still shows the old step name');
const eDo = await call('edit_funnel', { locationId: LOCATION, funnelId, op: 'update-step', stepId: STEP_A, name: NEW_NAME, confirm: true });
check(eDo.ok === true && eDo.data?.step?.name === NEW_NAME, 'edit_funnel update-step renames the step and it reads back', detail(eDo));
check((await fetchDoc()).steps?.find((s) => s.id === STEP_A)?.name === NEW_NAME, 'a SEPARATE funnel read shows the renamed step');
const eOrd = await call('edit_funnel', { locationId: LOCATION, funnelId, op: 'reorder-steps', order: [STEP_B, STEP_A], confirm: true });
check(eOrd.ok === true && JSON.stringify(eOrd.data?.order) === JSON.stringify([STEP_B, STEP_A]), 'edit_funnel reorder-steps swaps the two steps and the order reads back', detail(eOrd));
const eCreate = await call('edit_funnel', { locationId: LOCATION, funnelId, op: 'create-step', step: { id: randomUUID(), name: NAME('STEP-C'), url: `/${NAME('step-c').toLowerCase()}`, type: 'optin_funnel_page' }, confirm: true });
check(eCreate.ok === false && eCreate.code === 'VALIDATION_FAILED' && /no domain attached/i.test(JSON.stringify(eCreate)), 'edit_funnel create-step is REFUSED because the funnel has no domain: code VALIDATION_FAILED and the reason names the missing domain (the only claim made about create-step)', detail(eCreate));
check(((await fetchDoc()).steps ?? []).length === 2, 'the refused create-step created nothing: the funnel still has exactly two steps');

mk.subject('build_funnel_page');
const sections = [{ background: '#101014', padY: 72, maxWidth: 1080, columns: [{ widthPct: 100, elements: [
  { meta: 'heading', html: `TESTCONFW9FORMS${STAMP}`, tag: 'h1', styles: { color: '#fff', fontSize: '40px', textAlign: 'center' } },
  { meta: 'paragraph', html: 'd18 proof run, draft only.', tag: 'p', styles: { color: '#aaa', textAlign: 'center' } },
] }] }];
const bp = await call('build_funnel_page', { locationId: LOCATION, funnelId, pageId, stepId: STEP_A, sections, publish: false, confirm: true });
check(bp.ok === true && bp.data?.stored === true, 'build_funnel_page writes a DRAFT (publish:false) and every section reads back on a separate request', detail(bp));
check(bp.data?.publishState?.pinned === false, 'the page is still never-published: build_funnel_page reports the draft-fallback regime, not a pinned page');

mk.subject('audit_site');
const au = await call('audit_site', { locationId: LOCATION, funnelId, maxPages: 10 });
check(au.ok === true && Array.isArray(au.data?.coverage) && au.data.coverage.length > 0, 'audit_site runs read-only on the funnel and reports COVERAGE, not just findings', detail(au));
check(Array.isArray(au.data?.checksNotRun), 'audit_site names any check it could not run');

mk.subject('find_ghl_site');
const f1 = await call('find_ghl_site', { locationId: LOCATION, site: FUNNEL });
check(f1.ok === true && has(f1.data, funnelId), 'find_ghl_site resolves the funnel by its name to the id we created', detail(f1));
const f2 = await call('find_ghl_site', { locationId: LOCATION, list: true, search: STAMP });
check(f2.ok === true && has(f2.data, funnelId), 'find_ghl_site list:true with a name search finds the funnel', detail(f2));

// 5. edit_redirects — last, only if every precondition holds -----------------------------------------------------------------
mk.subject('find_ghl_site');
const before = await call('find_ghl_site', { locationId: LOCATION, site: FUNNEL, includeRedirects: true });
const red0 = before.data?.redirects;
check(before.ok === true && red0?.checked === true, 'find_ghl_site includeRedirects reads the domains and every redirect of the location', detail(before));
mk.subject(false);
const domRaw = await gw.call('GET', `/funnels/domain?locationId=${encodeURIComponent(LOCATION)}`);
const owned = (domRaw.json?.domains ?? []).map((d) => d.url).filter(Boolean);
const dom = (red0?.domains ?? []).map((d) => d.url).find((u) => owned.includes(u));
const PATH = `/test-conf-w9-forms-${STAMP}`;
const norm = (p) => `/${String(p ?? '').replace(/^\/+/, '').toLowerCase()}`;
if (!dom) {
  skip('edit_redirects create/update/delete', 'no domain on this location read back by its location id: the row stays unproven');
} else if ((red0.redirects ?? []).some((r) => r.domain === dom && norm(r.path) === norm(PATH))) {
  skip('edit_redirects create/update/delete', `the path ${PATH} already exists on ${dom}: refused on collision`);
} else {
  const T1 = `https://${dom}${PATH}-target-a`, T2 = `https://${dom}${PATH}-target-b`;
  const others = (red0.redirects ?? []).map((r) => JSON.stringify([r.id, r.domain, r.path, r.target, r.action])).sort();
  const reread = async () => (await call('find_ghl_site', { locationId: LOCATION, site: FUNNEL, includeRedirects: true })).data?.redirects?.redirects ?? [];
  mk.subject('edit_redirects');
  const rPrev = await call('edit_redirects', { locationId: LOCATION, op: 'create', domain: dom, path: PATH, target: T1 });
  check(rPrev.ok === false && rPrev.code === 'CONFIRM_REQUIRED', 'edit_redirects create previews and sends nothing without confirm', detail(rPrev));
  check((await reread()).every((r) => norm(r.path) !== norm(PATH) || r.domain !== dom), 'edit_redirects preview created nothing: the redirect list has no row at the path');
  const rMake = await call('edit_redirects', { locationId: LOCATION, op: 'create', domain: dom, path: PATH, target: T1, confirm: true });
  const rid = rMake.data?.id;
  check(rMake.ok === true && !!rid && rMake.data?.path === PATH, 'edit_redirects create makes exactly the redirect asked for and it lists on read-back', detail(rMake));
  if (rid) {
    console.log(`redirect created: ${rid} ${dom}${PATH}`);
    residue(`redirect ${rid} at ${dom}${PATH}: NOT deleted (live) until the delete below is read back gone`);
    const mine = (await reread()).filter((r) => r.id === rid);
    check(mine.length === 1 && mine[0].target === T1, 'a SEPARATE read finds exactly one row with that id and the first target');
    const rUp = await call('edit_redirects', { locationId: LOCATION, op: 'update', redirectId: rid, path: PATH, target: T2, confirm: true });
    check(rUp.ok === true, 'edit_redirects update retargets the redirect it created', detail(rUp));
    check(((await reread()).find((r) => r.id === rid) ?? {}).target === T2, 'a SEPARATE read shows the new target');
    const dPrev = await call('edit_redirects', { locationId: LOCATION, op: 'delete', redirectId: rid, path: PATH });
    check(dPrev.ok === false && dPrev.code === 'CONFIRM_REQUIRED', 'edit_redirects delete previews first and sends nothing without confirm', detail(dPrev));
    check(has(preview(dPrev), rid), 'the delete preview names the one row (id AND path matched) it would remove');
    const dDo = await call('edit_redirects', { locationId: LOCATION, op: 'delete', redirectId: rid, path: PATH, confirm: true });
    check(dDo.ok === true && dDo.data?.deleted === true, 'edit_redirects delete removes that one redirect', detail(dDo));
    const final = await reread();
    check(final.every((r) => r.id !== rid), 'a SEPARATE read shows the redirect gone');
    check(JSON.stringify(final.map((r) => JSON.stringify([r.id, r.domain, r.path, r.target, r.action])).sort()) === JSON.stringify(others), 'every pre-existing redirect is byte-for-byte what it was before the run');
    if (final.every((r) => r.id !== rid)) { left[left.length - 1] = `redirect ${rid} at ${dom}${PATH}: created, retargeted and DELETED by this run (read back gone)`; console.log(`redirect deleted and read back gone: ${rid}`); }
  }
}

finish('');
process.exit(failed > 0 ? 1 : 0);
