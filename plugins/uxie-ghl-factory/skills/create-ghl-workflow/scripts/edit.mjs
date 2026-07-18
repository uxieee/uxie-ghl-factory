// Edit-mode entry for the create-ghl-workflow skill. Modifies an EXISTING workflow.
//   node scripts/edit.mjs <LOC> <WID> <edit-spec.json> [--assume-associated] [--dry-run]
//
// Reads the Bearer JWT (same as build.mjs), GETs the live workflow, applies the ops in
// the edit-spec to workflowData.templates, then COMMITS via the plain PUT
// /workflow/{loc}/{wid} path (NOT /auto-save — an auto-save on an existing workflow 422s
// "previous changes were not committed"). Round-trip GETs and reports.
//
// edit-spec.json: { "ops": [ { "op": "...", ...args } ] }, applied in order:
//   { "op":"appendStep",      "step": {type,name,attributes} }        # linear step OR container
//   { "op":"insertAfter",     "afterId":"<id>", "step": {...}, "attachTailTo":"<branch>" }
//   { "op":"appendToBranch",  "branchEntryId":"<id>", "step": {...} }
//
// The three add ops take EITHER a linear step or a CONTAINER (find_opportunity with
// onFound/onNotFound, if_else, workflow_split, the multipath waits…). A container
// compiles to a whole subgraph — entry + branch entries + their children — and the
// splice wires the lot in. This is what lets opportunity logic be added to an EXISTING
// workflow: any opportunity write needs a find_opportunity above it ("Please use
// Opportunity trigger/find opportunity action to get the opportunity" at runtime
// otherwise), and before this the only way to get one was to build a new workflow.
//
//   attachTailTo: REQUIRED on insertAfter when a container goes in mid-chain and the
//   container has >1 branch. A container is terminal in its scope, so the steps that
//   followed the anchor must be re-scoped onto ONE branch. Name it by display name
//   ('Opportunity Found'), stable branch key ('predefined_Opportunity Found' — survives
//   rename), or branch id. It is never guessed: on find_opportunity the tail belongs on
//   Found ~always, and "~always" silently reroutes live contacts in the exception case.
//   Not needed when nothing follows the anchor, or when the container has one branch.
//   { "op":"deleteStep",      "stepId":"<id>" }
//   { "op":"modifyStep",      "stepId":"<id>", "attrPatch": {...} }
//   { "op":"setStepDisabled", "stepId":"<id>", "disabled":true|false }
//   { "op":"disableStepsByType", "type":"internal_notification", "disabled":true|false }
//   { "op":"moveStep",        "stepId":"<id>", "afterId":"<id>" }
//   { "op":"addBranch",       "containerId":"<id>", "name":"...", "conditions":[...] }
//   { "op":"deleteContainer", "containerId":"<id>" }
//
// TRIGGER ops (triggers live in a SEPARATE document with their own CRUD endpoints — they
// are applied after the step commit, not through workflowData.templates):
//   { "op":"addTrigger",    "trigger": {type,name,filters:[...]} }
//   { "op":"deleteTrigger", "triggerId":"<id>" | "name":"..." | "type":"..." }
//   { "op":"modifyTrigger", "triggerId":"<id>"|"name":"...", "trigger": {filters:[...], ...} }
// A trigger added via the API lands active:false regardless of the POST body; if the
// workflow is PUBLISHED this runs the draft→published activation cycle so it actually
// fires. If it's a DRAFT, activation is skipped and reported — publishing is the user's
// call, never a side effect of a trigger edit.
//
// --assume-associated : skip the opportunity-association check when adding an
//   internal_update_opportunity (only if ALL the workflow's triggers are opp-based).
// --dry-run : compute + print the diff/commit body, send NO PUT (works offline).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { editCommitBody, shouldActivateTriggers, triggerActivationBody } from '../engine/edit.mjs';
import { applyOps, partitionOps, planTriggerOps } from '../engine/edit-driver.mjs';
import { loadCatalog } from '../engine/catalog.mjs';
import { makeUuidV4 } from '../engine/idgen.mjs';
import { collectOpTags, missingTags } from '../engine/tags.mjs';

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

// Best-effort custom-field fetch — mapped exactly like orchestrate()'s fetchEntities so the
// compiler can classify an update_opportunity's custom filterFields. Without this the edit
// path's ctx has NO customFields list, and a genuinely-mistyped field can't be caught (the
// compiler degrades to passthrough rather than throwing) while a warn sink also can't
// surface monetaryValue/shape notes. If the fetch fails, degrade gracefully (empty list) —
// never let a field fetch break an edit.
let customFields = [];
try {
  const cfr = await call('GET', `/locations/${LOC}/customFields`);
  const cf = cfr.ok ? cfr.json : {};
  customFields = (cf.customFields || cf || []).map((c) => ({ id: c.id || c._id, name: c.name, fieldKey: c.fieldKey, dataType: c.dataType }));
  if (!Array.isArray(customFields)) customFields = [];
} catch { customFields = []; }

// cid is left undefined on purpose (same as orchestrate()): the trigger envelope's
// company_id then drops out of the JSON rather than carrying a placeholder string.
// warn sink collects compiler notes (shape/classification warnings). flushWarnings() prints
// them, and MUST run on every exit path — including the early ones (dry-run, tag abort, PUT
// fail) — or a shape/classification warning captured during compile is silently swallowed.
const warnings = [];
const flushWarnings = () => { for (const w of warnings) console.warn('warn:', w); };
const ctx = { loc: LOC, cid: undefined, uid: UID, companyAge: 0, idGen: makeUuidV4, catalog: loadCatalog(),
  customFields, warn: (msg) => warnings.push(msg) };

const fresh = (await call('GET', `/workflow/${LOC}/${WID}?includeScheduledPauseInfo=true`)).json;
if (!fresh || !fresh.workflowData) { console.error('could not GET workflow', WID, '—', JSON.stringify(fresh).slice(0, 200)); process.exit(2); }

const { stepOps, triggerOps } = partitionOps(ops);
const listTriggers = async () => {
  const tr = (await call('GET', `/workflow/${LOC}/trigger?workflowId=${WID}`)).json;
  return Array.isArray(tr) ? tr : (tr?.triggers || tr?.data || []);
};

const { templates, diff } = applyOps(fresh.workflowData.templates ?? [], stepOps, { ctx, idGen: makeUuidV4 });
const body = editCommitBody(fresh, templates, diff, UID, { assumeAssociated });
const plan = triggerOps.length
  ? planTriggerOps(triggerOps, { ctx, wid: WID, uid: UID, existing: await listTriggers() })
  : [];

// Tag pre-creation — the edit-path analog of what orchestrate() does before a build.
// GHL references tags by NAME and rejects unknown ones, so every tag an op references
// must exist BEFORE the commit/POST lands. Without this, an edit silently points at a
// tag that doesn't exist (and a tag TRIGGER on a missing tag never fires).
const neededTags = collectOpTags(ops);
let tagsToCreate = [];
if (neededTags.length) {
  const tl = await call('GET', `/locations/${LOC}/tags`);
  const have = (Array.isArray(tl.json) ? tl.json : (tl.json?.tags ?? [])).map((t) => t.name);
  tagsToCreate = missingTags(neededTags, have);
}

if (dryRun) {
  console.log('=== DRY RUN (nothing sent) ===');
  console.log('ops:', ops.map((o) => o.op).join(', '));
  if (stepOps.length) {
    console.log('diff:', JSON.stringify(diff));
    console.log('templates:', templates.length, 'steps (was', (fresh.workflowData.templates ?? []).length + ')');
  }
  for (const r of plan) console.log(`trigger: ${r.method} ${r.path}`, r.body ? JSON.stringify(r.body).slice(0, 200) : '');
  if (plan.length) console.log('activation:', fresh.status === 'published'
    ? 'draft→published cycle WILL run (workflow is published)'
    : `SKIPPED — workflow is '${fresh.status}'; triggers activate when you publish`);
  if (neededTags.length) console.log('tags referenced:', neededTags.join(', '),
    tagsToCreate.length ? `| WOULD CREATE: ${tagsToCreate.join(', ')}` : '| all exist');
  flushWarnings();
  process.exit(0);
}

console.log('\n=== EDIT REPORT ===');

// Create missing tags FIRST — before the commit and before any trigger POST.
for (const name of tagsToCreate) {
  const r = await call('POST', `/locations/${LOC}/tags`, { name });
  if (!r.ok) { console.error(`ABORT: could not create tag '${name}' (${r.status}) — the edit would reference a tag that doesn't exist.`); flushWarnings(); process.exit(2); }
}
if (tagsToCreate.length) console.log('created tags:', tagsToCreate.join(', '));
if (stepOps.length) {
  const put = await call('PUT', `/workflow/${LOC}/${WID}`, body);
  console.log('PUT status:', put.status, put.ok ? 'OK' : 'FAIL');
  console.log('diff:', JSON.stringify(diff));
  if (!put.ok) { console.log('body:', JSON.stringify(put.json).slice(0, 240)); flushWarnings(); process.exit(2); }
}

let triggerFailed = false;
for (const r of plan) {
  const res = await call(r.method, r.path, r.body);
  console.log(`${r.op}: ${r.method} ${r.path.split('?')[0]} → ${res.status} ${res.ok ? 'OK' : 'FAIL'}`);
  if (!res.ok) { triggerFailed = true; console.log('  body:', JSON.stringify(res.json).slice(0, 240)); }
}

// Activation. API-added triggers land active:false server-side no matter what the POST
// said — only a status draft→published round trip subscribes them. Two PUTs, re-GETting
// between them because each PUT bumps `version` (a stale version 422s).
//
// The decision to run the cycle is made ONCE, here, from the pre-cycle status. Do NOT
// re-check "is it published?" before the second leg — the first leg just made it a
// draft, so that check would always fail and leave the workflow downgraded to draft
// with its triggers switched off.
if (plan.length && !triggerFailed) {
  const after = (await call('GET', `/workflow/${LOC}/${WID}?includeScheduledPauseInfo=true`)).json;
  if (!shouldActivateTriggers(after)) {
    console.log(`activation: SKIPPED — workflow is '${after?.status}', not published.`);
    console.log('  The trigger is saved but will not fire until you publish (publish is opt-in).');
  } else {
    const d = await call('PUT', `/workflow/${LOC}/${WID}`,
      triggerActivationBody(after, await listTriggers(), 'draft'));
    const mid = (await call('GET', `/workflow/${LOC}/${WID}?includeScheduledPauseInfo=true`)).json;
    const p = await call('PUT', `/workflow/${LOC}/${WID}`,
      triggerActivationBody(mid, await listTriggers(), 'published'));
    const check = (await call('GET', `/workflow/${LOC}/${WID}?includeScheduledPauseInfo=true`)).json;
    const live = await listTriggers();
    const inactive = live.filter((t) => !t.active).map((t) => t.name ?? t.id);
    console.log(`activation: draft ${d.status} → published ${p.status} | status now: ${check?.status}`);
    console.log('triggers active:', live.filter((t) => t.active).length, '/', live.length,
      inactive.length ? `— STILL INACTIVE: ${inactive.join(', ')}` : '');
    // Never leave a workflow that WAS published sitting in draft — that silently
    // switches off a live automation.
    if (check?.status !== 'published') {
      console.log('  ⚠️ WORKFLOW LEFT UNPUBLISHED after a trigger edit — it was published before. Re-publish before relying on it.');
      process.exitCode = 2;
    }
    if (inactive.length) process.exitCode = 2;
  }
}

flushWarnings();
const back = (await call('GET', `/workflow/${LOC}/${WID}?includeScheduledPauseInfo=true`)).json;
console.log('steps now:', back?.workflowData?.templates?.length ?? '?', '| status:', back?.status);
console.log('URL:', `https://app.gohighlevel.com/v2/location/${LOC}/automation/workflow/${WID}`);
if (triggerFailed) process.exit(2);
