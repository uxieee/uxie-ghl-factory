#!/usr/bin/env node
// Harvest a REAL, UI-created workflow step of a given type so you can mirror its
// EXACT field set. The builder won't open the editor for steps built from invented
// fields — copying a live step of the same type is the reliable fix.
//
// Env:  GHL_JWT (iframe Bearer JWT), GHL_LOC (location id)
// Usage: GHL_JWT=eyJ... GHL_LOC=xxxx node harvest-step.js <stepType>
//   e.g. custom_webhook | email | if_else | wait | add_contact_tag
//
// Scans up to 100 workflows in the location and prints the first matching step.
const BASE = 'https://backend.leadconnectorhq.com';
const T = process.env.GHL_JWT;
const LOC = process.env.GHL_LOC;
const TARGET = process.argv[2];

if (!T || !LOC || !TARGET) {
  console.error('Env GHL_JWT + GHL_LOC required; arg: <stepType>');
  process.exit(1);
}

const H = {
  Authorization: 'Bearer ' + T,
  channel: 'APP', source: 'WEB_USER', version: '2021-07-28',
  accept: 'application/json, text/plain, */*',
};

(async () => {
  const listRes = await fetch(`${BASE}/workflow/${LOC}/list?type=workflow&limit=100&offset=0`, { headers: H });
  if (!listRes.ok) { console.error(`[HTTP ${listRes.status}] list failed — check GHL_JWT/GHL_LOC`); process.exit(1); }
  const list = await listRes.json();
  const rows = list.rows || [];
  console.error(`scanning ${rows.length} workflows for a "${TARGET}" step...`);
  for (const r of rows) {
    const wid = r.id || r._id;
    const res = await fetch(`${BASE}/workflow/${LOC}/${wid}?includeScheduledPauseInfo=true`, { headers: H });
    // Abort loudly on auth/rate-limit — otherwise an expired JWT mid-scan would be
    // swallowed and reported as "no step found", masking the real cause.
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      console.error(`[HTTP ${res.status}] scan aborted at "${r.name}" (${wid}) — re-capture GHL_JWT and retry`);
      process.exit(1);
    }
    try {
      const wf = await res.json();
      const hit = ((wf.workflowData && wf.workflowData.templates) || []).find((s) => s.type === TARGET);
      if (hit) {
        console.error(`found in "${r.name}" (${wid}) — mirror this key set:`);
        console.log(JSON.stringify(hit, null, 2));
        return;
      }
    } catch { /* skip individual workflows that fail to parse */ }
  }
  console.error(`no "${TARGET}" step found in the first ${rows.length} workflows`);
  process.exit(1);
})();
