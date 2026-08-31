// The MINIMAL live-proof harness for a step rename, kept as a fixture.
//
// Normally you rename through the engine: `edit.mjs` with a `renameStep` (or `modifyStep` +
// `stepPatch`) op. This script exists for two other reasons:
//
//   1. It is the transport receipt. The whole-document PUT is all a rename needs — no
//      special endpoint, no auto-save session. Live-proven on the UK account 2026-07-31:
//      version 14 → 15, 8 steps intact, fileUrl preserved, attributes byte-identical, the
//      workflow stayed published. The VERIFY lines below re-read independently and assert
//      each of those, so re-running it re-earns the proof rather than citing it.
//   2. It reads the capture file DIRECTLY, so the JWT never becomes a tool argument. That
//      was the workaround while the MCP credential guard refused any body containing a
//      signed `fileUrl`/`previewUrl` (`?…&token=<uuid>` read as a credential). That guard
//      now exempts Google storage URLs — see mcp-internal/README.md — so raw_request can
//      round-trip a document again, but a local script remains the way to test the wire
//      shape with no MCP layer in between.
//
// usage: node rename-step-minimal.mjs <locationId> <workflowId> <stepId> "<new name>"
// token file: $GHL_INTERNAL_TOK_FILE — the ONE env name the whole plugin reads — else
//             ./.ghl/uxie-ghl-internal-mcp-tok.txt in the cwd (the project-scoped capture
//             path the connect skill writes).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// This script once read its own one-off name, GHL_TOKEN_FILE — a third env var beside the
// plugin-wide GHL_INTERNAL_TOK_FILE and the 0.43.0-retired GHL_TOK_FILE. Only
// GHL_INTERNAL_TOK_FILE is read as a value now; either old name's PRESENCE alone (never its
// value) is refused loudly — same discipline and wording as mcp-internal/core/auth.mjs
// readCredentials — instead of silently falling back to a file the capture never wrote.
const staleEnvName = ['GHL_TOKEN_FILE', 'GHL_TOK_FILE'].find((n) => Boolean(process.env[n]));
if (staleEnvName && !process.env.GHL_INTERNAL_TOK_FILE) {
  console.error(`ABORTED (LEGACY_TOKEN_FILE_ENV): ${staleEnvName} is set but GHL_INTERNAL_TOK_FILE `
    + `is not. ${staleEnvName} no longer does anything (GHL_INTERNAL_TOK_FILE has been the one `
    + 'plugin-wide name since 0.43.0), so this run would '
    + 'silently fall back to a token file the capture never wrote and could authenticate as the '
    + 'wrong account.\nRename the env var, then retry — same value, new name: '
    + `export GHL_INTERNAL_TOK_FILE="<same path you had in ${staleEnvName}>"`);
  process.exit(2);
}
const TOKFILE = process.env.GHL_INTERNAL_TOK_FILE
  ?? resolve(process.cwd(), '.ghl/uxie-ghl-internal-mcp-tok.txt');
// Test seam: print the resolved token-file path and exit — checked AFTER the legacy guard,
// BEFORE the usage check, so the suite can assert resolution without a live workflow.
if (process.argv.includes('--print-token-file')) { console.log(TOKFILE); process.exit(0); }

const [, , LOC, WID, SID, NEWNAME] = process.argv;
if (!NEWNAME) {
  console.error('usage: node rename-step-minimal.mjs <loc> <wid> <stepId> "<new name>"');
  process.exit(2);
}

const raw = readFileSync(TOKFILE, 'utf8');
const jwt = (raw.match(/^Bearer\s+(\S+)/m) || raw.match(/^Authorization:\s*Bearer\s+(\S+)/mi) || [])[1];
if (!jwt) { console.error(`no Bearer token in ${TOKFILE}`); process.exit(1); }

const claims = JSON.parse(Buffer.from(jwt.split('.')[1] + '==', 'base64url').toString());
const left = Math.round(claims.exp - Date.now() / 1000);
if (left <= 0) { console.error(`TOKEN_EXPIRED (${left}s) — re-run the capture`); process.exit(1); }
console.log(`token ok, ${left}s remaining`);

const BASE = 'https://backend.leadconnectorhq.com';
const IFRAME = 'https://client-app-automation-workflows.leadconnectorhq.com';
const H = {
  authorization: `Bearer ${jwt}`,
  'content-type': 'application/json',
  origin: IFRAME,
  referer: `${IFRAME}/`,
};
const wfPath = `/workflow/${encodeURIComponent(LOC)}/${encodeURIComponent(WID)}`;

// The GET is UNWRAPPED — the response is the workflow document itself, there is no
// {workflow: …} envelope. Everything it returns goes back on the PUT.
const getRes = await fetch(`${BASE}${wfPath}?includeScheduledPauseInfo=true`, { headers: H });
if (!getRes.ok) { console.error('GET failed', getRes.status, (await getRes.text()).slice(0, 300)); process.exit(1); }
const fresh = await getRes.json();

const templates = fresh.workflowData.templates;
const hit = templates.find((t) => t.id === SID);
if (!hit) { console.error(`step ${SID} not on this workflow`); process.exit(1); }
const oldName = hit.name;
if (oldName === NEWNAME) { console.log('already named that, nothing to do'); process.exit(0); }
// `name` is a SIBLING of `attributes`, which is the whole reason this op had to exist.
hit.name = NEWNAME;

const body = {
  ...fresh,
  updatedBy: claims.user_id ?? fresh.updatedBy,
  status: fresh.status ?? 'draft',
  version: fresh.version,          // the CURRENT version; version+1 422s "version is outdated"
  triggersChanged: false,
  workflowData: { templates },
  createdSteps: [],
  modifiedSteps: [SID],
  deletedSteps: [],
};

const putRes = await fetch(`${BASE}${wfPath}`, { method: 'PUT', headers: H, body: JSON.stringify(body) });
const putTxt = await putRes.text();
console.log('PUT status:', putRes.status);
if (!putRes.ok) { console.error(putTxt.replace(/ey[A-Za-z0-9._-]{20,}/g, '<JWT>').slice(0, 400)); process.exit(1); }

// Independent re-read. A 200 is not proof; this is.
const chk = await (await fetch(`${BASE}${wfPath}?includeScheduledPauseInfo=true`, { headers: H })).json();
const now = chk.workflowData.templates.find((t) => t.id === SID);
console.log(`rename: ${JSON.stringify(oldName)} -> ${JSON.stringify(now.name)}`);
console.log('VERIFY name        :', now.name === NEWNAME ? 'PASS' : 'FAIL');
console.log('VERIFY step count  :', chk.workflowData.templates.length === templates.length ? `PASS (${templates.length})` : 'FAIL');
console.log('VERIFY status      :', chk.status === fresh.status ? `PASS (${chk.status})` : `FAIL (${chk.status})`);
console.log('VERIFY version     :', chk.version > fresh.version ? `PASS (${fresh.version} -> ${chk.version})` : `FAIL (${chk.version})`);
console.log('VERIFY fileUrl kept:', chk.fileUrl ? 'PASS' : 'FAIL — fileUrl missing');
console.log('VERIFY attributes  :', JSON.stringify(now.attributes) === JSON.stringify(hit.attributes) ? 'PASS (unchanged)' : 'FAIL');
