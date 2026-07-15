// Edit-mode entry for the create-ghl-workflow skill. Modifies an EXISTING workflow.
//   node scripts/edit.mjs <LOC> <WID> <edit-spec.json> [--assume-associated] [--dry-run]
//
// Reads the Bearer JWT (same as build.mjs), GETs the live workflow, applies the ops in
// the edit-spec to workflowData.templates, then COMMITS via the plain PUT
// /workflow/{loc}/{wid} path (NOT /auto-save — an auto-save on an existing workflow 422s
// "previous changes were not committed"). Round-trip GETs and reports.
//
// edit-spec.json: { "ops": [ { "op": "...", ...args } ] }, applied in order:
//   { "op":"appendStep",      "step": {type,name,attributes} }        # linear step, compiled from IR
//   { "op":"insertAfter",     "afterId":"<id>", "step": {...} }
//   { "op":"appendToBranch",  "branchEntryId":"<id>", "step": {...} }
//   { "op":"deleteStep",      "stepId":"<id>" }
//   { "op":"modifyStep",      "stepId":"<id>", "attrPatch": {...} }
//   { "op":"setStepDisabled", "stepId":"<id>", "disabled":true|false }
//   { "op":"disableStepsByType", "type":"internal_notification", "disabled":true|false }
//   { "op":"moveStep",        "stepId":"<id>", "afterId":"<id>" }
//   { "op":"addBranch",       "containerId":"<id>", "name":"...", "conditions":[...] }
//   { "op":"deleteContainer", "containerId":"<id>" }
//
// --assume-associated : skip the opportunity-association check when adding an
//   internal_update_opportunity (only if ALL the workflow's triggers are opp-based).
// --dry-run : compute + print the diff/commit body, send NO PUT (works offline).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { editCommitBody } from '../engine/edit.mjs';
import { applyOps } from '../engine/edit-driver.mjs';
import { loadCatalog } from '../engine/catalog.mjs';
import { makeUuidV4 } from '../engine/idgen.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const [LOC, WID, specPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const assumeAssociated = process.argv.includes('--assume-associated');
const dryRun = process.argv.includes('--dry-run');
if (!LOC || !WID || !specPath) {
  console.error('usage: node edit.mjs <LOC> <WID> <edit-spec.json> [--assume-associated] [--dry-run]');
  process.exit(1);
}

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const ops = spec.ops ?? [];
if (!ops.length) { console.error('edit-spec has no ops[]'); process.exit(1); }

const tokFile = process.env.GHL_TOK_FILE || resolve(HERE, '../../../../.playwright-mcp/tok.txt');
const T = (readFileSync(tokFile, 'utf8').match(/Bearer (ey[A-Za-z0-9._-]+)/) || [])[1];
if (!T) { console.error('no Bearer token in', tokFile); process.exit(1); }
const decoded = JSON.parse(Buffer.from(T.split('.')[1], 'base64url').toString());
if (decoded.exp < Math.floor(Date.now() / 1000)) { console.error('token EXPIRED — recapture per auth-jwt-capture.md'); process.exit(1); }
const UID = decoded.authClassId;

const BASE = 'https://backend.leadconnectorhq.com';
const IFRAME = 'https://client-app-automation-workflows.leadconnectorhq.com';
const H = (w) => ({ authorization: 'Bearer ' + T, channel: 'APP', source: 'WEB_USER', version: '2021-07-28',
  accept: 'application/json, text/plain, */*', ...(w ? { 'content-type': 'application/json', origin: IFRAME, referer: IFRAME + '/' } : {}) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (m, p, b) => { await sleep(300); const r = await fetch(BASE + p, { method: m, headers: H(m !== 'GET'), body: b ? JSON.stringify(b) : undefined });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = txt; } return { status: r.status, ok: r.ok, json: j }; };

const ctx = { loc: LOC, cid: '_edit', uid: UID, companyAge: 0, idGen: makeUuidV4, catalog: loadCatalog() };

const fresh = (await call('GET', `/workflow/${LOC}/${WID}?includeScheduledPauseInfo=true`)).json;
if (!fresh || !fresh.workflowData) { console.error('could not GET workflow', WID, '—', JSON.stringify(fresh).slice(0, 200)); process.exit(2); }

const { templates, diff } = applyOps(fresh.workflowData.templates ?? [], ops, { ctx, idGen: makeUuidV4 });
const body = editCommitBody(fresh, templates, diff, UID, { assumeAssociated });

if (dryRun) {
  console.log('=== DRY RUN (no PUT sent) ===');
  console.log('ops:', ops.map((o) => o.op).join(', '));
  console.log('diff:', JSON.stringify(diff));
  console.log('templates:', templates.length, 'steps (was', (fresh.workflowData.templates ?? []).length + ')');
  process.exit(0);
}

const put = await call('PUT', `/workflow/${LOC}/${WID}`, body);
console.log('\n=== EDIT REPORT ===');
console.log('PUT status:', put.status, put.ok ? 'OK' : 'FAIL');
console.log('diff:', JSON.stringify(diff));
if (!put.ok) { console.log('body:', JSON.stringify(put.json).slice(0, 240)); process.exit(2); }
const back = (await call('GET', `/workflow/${LOC}/${WID}?includeScheduledPauseInfo=true`)).json;
console.log('steps now:', back?.workflowData?.templates?.length ?? '?');
console.log('URL:', `https://app.gohighlevel.com/v2/location/${LOC}/automation/workflow/${WID}`);
