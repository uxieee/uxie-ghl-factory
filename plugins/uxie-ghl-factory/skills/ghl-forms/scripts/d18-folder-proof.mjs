#!/usr/bin/env node
/**
 * d18 re-run of ONE section: create_custom_field_folder. The first run (d18-forms-funnels-proof.mjs) asserted the
 * duplicate refusal through data.existingId, but the pre-check refusal names the existing id in its message text, so
 * that assertion was wrong while the tool behaved correctly. This script asserts the real contract.
 *
 *   GHL_LOCATION='<locationId>' GHL_EXERCISED_OUT=<file> node d18-folder-proof.mjs [--smoke]
 *
 * It touches NOTHING from the first run and none of the other 11 tools. Its second section is a READ-ONLY list_form_submissions (counts only, no submit). It creates its own new contact custom-field
 * folder TEST-CONF-W9-FORMS-FOLDER2-<stamp> (no delete tool exists, so it is left in place and printed as RESIDUE).
 * Location fence: handlers are called directly (registerTools' binding is not in the path); the runner pins
 * GHL_LOCATION, state.allowedLocations is a Set of it, and `call` throws on any other locationId.
 */
import { startup } from './run-gate.mjs';
import { sweepResidue, submissionsSection, safeDetail, SweepAbort } from './d18-folder-sections.mjs';
// ONE shared argv parser: unknown flag refused, --smoke/--dry exit here before any auth or tool use, else S + QA_CLEARED + a passed --go are required.
const { smoke: SMOKE } = startup();
if (SMOKE) { console.log('smoke: tools are not loaded and no account call was made'); process.exit(0); }
const { makeGatewayFactory, TOOLS } = await import('../../../mcp-internal/core/tools.mjs');
const { DEFAULT_TOKEN_FILE } = await import('../../../mcp-internal/core/auth.mjs');
const { createMarker } = await import('../../create-ghl-workflow/scripts/exercised-marker.mjs');

const LOCATION = process.env.GHL_LOCATION || process.env.GHL_LOC;
if (!['create_custom_field_folder', 'list_form_submissions'].every((n) => TOOLS.find((t) => t.name === n))) { console.error('tool not registered'); process.exit(1); }
if (!LOCATION) { console.error('GHL_LOCATION is required.'); process.exit(1); }
const STAMP = Date.now().toString().slice(-6);
const FOLDER = `TEST-CONF-W9-FORMS-FOLDER2-${STAMP}`;
const state = { tokenFile: process.env.GHL_INTERNAL_TOK_FILE ?? DEFAULT_TOKEN_FILE, engineVersion: 'd18-folder-proof', allowedLocations: new Set([LOCATION]), renewer: null };
const deps = { state, makeGw: (o = {}) => makeGatewayFactory({ state })(o) };
const mk = createMarker();
const call = mk.wrapCall(async (name, args) => {
  if (args?.locationId !== LOCATION) throw new Error('location fence: locationId is not the pinned one');
  return TOOLS.find((t) => t.name === name).handler(args, deps);
});
let passed = 0, failed = 0; const left = []; let done = false;
const report = (c, m, x) => { if (c) { passed++; console.log(`  PASS  ${m}`); } else { failed++; console.log(`  FAIL  ${m}${x ? `  — ${x}` : ''}`); } };
const check = (c, m, x) => mk.check(Boolean(c), m, x, report);
const detail = safeDetail;
const finish = (why) => { if (done) return; done = true; console.log(`\nLEFT IN PLACE${why ? ` — exit reason: ${why}` : ''}:`); for (const l of left) console.log(`  ${l}`); try { mk.write(); } catch (e) { console.log(`marker NOT written: ${e.message}`); } console.log(`${passed} passed, ${failed} failed`); };
process.on('SIGTERM', () => { finish('SIGTERM'); process.exit(143); });
process.on('SIGINT', () => { finish('SIGINT'); process.exit(130); });
process.on('uncaughtException', (e) => { console.log(`UNCAUGHT: ${e?.stack ?? e}`); failed++; finish('uncaught'); process.exit(1); });
console.log(`d18 folder re-run — location …${LOCATION.slice(-4)} — stamp ${STAMP}\n`);

// 0. READ-ONLY RESIDUE SWEEP (sweepResidue in d18-folder-sections.mjs; it never writes). It compares the location with the ids the knowledge-side runner recorded
// (D18_EXPECTED_FORM_IDS / D18_EXPECTED_FOLDER_IDS / D18_INCIDENT_STAMPS; no id or stamp lives in this public script) and ABORTS before any write on a stray, a missing recorded id, an incident stamp, or an unfinished listing.
mk.subject(false);
const ids = (k) => new Set((process.env[k] ?? '').split(',').map((x) => x.trim()).filter(Boolean));
try { await sweepResidue({ call, locationId: LOCATION, stamp: STAMP, expectedForms: ids('D18_EXPECTED_FORM_IDS'), expectedFolders: ids('D18_EXPECTED_FOLDER_IDS'), incidentStamps: [...ids('D18_INCIDENT_STAMPS')], log: console.log }); console.log('SWEEP OK: nothing but the recorded objects matches; nothing was written\n'); }
catch (e) { if (!(e instanceof SweepAbort)) throw e; console.log(`\nABORT before any write: ${e.message}`); failed++; finish('residue sweep'); process.exit(1); }

mk.subject('create_custom_field_folder');
const prev = await call('create_custom_field_folder', { locationId: LOCATION, name: FOLDER, model: 'contact' });
check(prev.ok === false && prev.code === 'CONFIRM_REQUIRED', 'create_custom_field_folder previews and sends nothing without confirm', detail(prev));
const make = await call('create_custom_field_folder', { locationId: LOCATION, name: FOLDER, model: 'contact', confirm: true });
const folderId = make.data?.folderId;
check(make.ok === true && !!folderId && make.data?.verified === true, 'create_custom_field_folder creates the folder and finds it in the folder list on read-back', detail(make));
if (folderId) { left.push(`custom-field folder (model contact) ${folderId} (${FOLDER}); no delete tool`); console.log(`RESIDUE  ${left[0]}`); }
const again = await call('create_custom_field_folder', { locationId: LOCATION, name: FOLDER, model: 'contact', confirm: true });
const againText = `${again?.detail ?? ''} ${again?.message ?? ''}`; // matched in memory only, never printed
check(again.ok === false && again.code === 'VALIDATION_FAILED' && !!folderId && againText.includes(folderId) && again.data?.preview?.alreadyExists?.id === folderId, 'a second create of the same name refuses (VALIDATION_FAILED): the message names the existing folder id AND data.preview.alreadyExists.id equals it', detail(again));

mk.subject('list_form_submissions');
await submissionsSection({ call, check, locationId: LOCATION, stamp: STAMP });
finish('');
process.exit(failed > 0 ? 1 : 0);
