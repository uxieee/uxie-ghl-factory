#!/usr/bin/env node
// PROBE 16 (2026-08-31) — can the AI rail's credential be renewed without a browser?
// The token file holds TWO credentials: `Bearer` (workflow rail) and `token-id` (a Firebase token,
// used by host:"ai" -> services.leadconnectorhq.com). Renewal so far covers only the Bearer.
// chunk.BaQm359R.js showed the app does: signInWithCustomToken(e.token), and the refresh response
// carries `token` (Firebase CUSTOM token) + `apiKey` (Firebase Web API key). So the chain should be
//   refresh -> token + apiKey -> identitytoolkit:signInWithCustomToken -> idToken -> `token-id`
// A/B PROVEN, not assumed: the same AI-host call is made with the EXISTING token-id (control) and
// the NEWLY minted one. Only matching statuses prove renewal.
// RATE DISCIPLINE (probe 15): exactly ONE refresh call. No values printed.
import { readFileSync } from 'node:fs';
const TOKFILE = '/Volumes/Xander SSD/Vibe Code/Misc/.ghl/uxie-ghl-internal-mcp-tok.txt';
const REFRESH = 'https://backend.leadconnectorhq.com/oauth/2/login/current';

const raw = readFileSync(TOKFILE, 'utf8');
const BEARER = (raw.match(/Bearer\s+(ey[A-Za-z0-9._-]+)/i) || [])[1];
const OLD_TID = (raw.match(/token-id:\s*(\S+)/i) || [])[1];
if (!BEARER) { console.log('no bearer in token file'); process.exit(0); }
const dec = (j) => { try { return JSON.parse(Buffer.from(j.split('.')[1], 'base64url').toString()); } catch { return null; } };
const bc = dec(BEARER);
console.log(`bearer from file: ttl=${Math.round((bc.exp - Date.now()/1000)/60)}min`);
console.log(`existing token-id present: ${!!OLD_TID}${OLD_TID ? `, ttl=${Math.round((dec(OLD_TID).exp - Date.now()/1000)/60)}min` : ''}`);
if (bc.exp - Date.now()/1000 < 60) { console.log('bearer too close to expiry — re-run after a capture'); process.exit(0); }

const H = (t, tid) => { const h = { authorization:`Bearer ${t}`, channel:'APP', source:'WEB_USER', version:'2021-07-28', accept:'application/json, text/plain, */*' }; if (tid) h['token-id'] = tid; return h; };

console.log('\n=== STEP 1: ONE refresh (rate discipline) to obtain the Firebase custom token + apiKey ===');
const r = await fetch(REFRESH, { headers: H(BEARER) });
console.log(`  HTTP ${r.status}`);
const body = await r.json();
console.log(`  custom token present: ${!!body.token}   apiKey present: ${!!body.apiKey}   companyId: ${body.companyId ? 'present' : 'absent'}`);

console.log('\n=== STEP 2: exchange it at Google identitytoolkit (signInWithCustomToken) ===');
let NEW_TID = null;
const ex = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(body.apiKey)}`,
  { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ token: body.token, returnSecureToken: true }) });
const ej = await ex.json().catch(()=>null);
console.log(`  HTTP ${ex.status}`);
if (ex.status === 200 && ej?.idToken) {
  NEW_TID = ej.idToken;
  const nc = dec(NEW_TID);
  console.log(`  MINTED an idToken: expiresIn=${ej.expiresIn}s, issuer=${nc?.iss ?? '?'}`);
  console.log(`  claims: scope=${nc?.scope ?? nc?.claims?.scope ?? '?'} role=${nc?.role ?? nc?.claims?.role ?? '?'}`);
} else { console.log(`  error: ${ej?.error?.message ?? '(none)'}`); }

console.log('\n=== STEP 3: A/B the AI rail — same call, old token-id vs new ===');
const AI_CALLS = [
  ['GET services /locations/search', 'https://services.leadconnectorhq.com/locations/search?limit=1&skip=0'],
  ['GET services /users/me',         'https://services.leadconnectorhq.com/users/me'],
];
for (const [label, url] of AI_CALLS) {
  const hit = async (tid, who) => { try { const x = await fetch(url, { headers: H(BEARER, tid) }); return `${who}=${x.status}`; } catch { return `${who}=threw`; } };
  const ctrl = OLD_TID ? await hit(OLD_TID, 'existing') : 'existing=n/a';
  const neu  = NEW_TID ? await hit(NEW_TID, 'new')      : 'new=n/a';
  console.log(`  ${label.padEnd(32)} ${ctrl}   ${neu}`);
}

console.log('\n=== VERDICT ===');
if (!NEW_TID) {
  console.log('>>> the Firebase exchange FAILED — the AI rail is NOT renewable this way.');
  console.log('    host:"ai" work would still require the browser capture each hour.');
} else {
  console.log('>>> the Firebase exchange WORKS: `token` + `apiKey` from ONE refresh mint a fresh');
  console.log('    Firebase idToken, i.e. the `token-id` credential the AI rail uses.');
  console.log('    Compare the A/B statuses above: matching statuses = BOTH rails renew with no browser.');
}
