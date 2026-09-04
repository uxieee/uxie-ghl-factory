#!/usr/bin/env node
// PROBE 8 (2026-08-31) — the last open question from probe 7. Renewal works from a LIVE token.
// Can an EXPIRED one still be exchanged? That decides whether the chain survives the server
// idling past 60min, or whether the Playwright login stays the cold-start path.
//
// No waiting needed: token files written over an hour ago already hold expired tokens. Uses the
// token file in Xander's OWN scratch folder — deliberately NOT a client credential.
// Token values are never printed; only exp/age and the HTTP result.
import { readFileSync } from 'node:fs';
const FILE = '/Volumes/Xander SSD/Vibe Code/Misc/.ghl/uxie-ghl-internal-mcp-tok.txt';
const ENDPOINT = 'https://backend.leadconnectorhq.com/oauth/2/login/current';

const raw = readFileSync(FILE, 'utf8');
const m = raw.match(/Bearer\s+(ey[A-Za-z0-9._-]+)/i);
if (!m) { console.log('no Bearer in the token file — aborting'); process.exit(0); }
const TOK = m[1];
const decode = (j) => { try { return JSON.parse(Buffer.from(j.split('.')[1], 'base64url').toString()); } catch { return null; } };
const c = decode(TOK);
if (!c) { console.log('token undecodable — aborting'); process.exit(0); }
const ttlMin = Math.round((c.exp - Date.now() / 1000) / 60);
const ageMin = c.iat ? Math.round((Date.now() / 1000 - c.iat) / 60) : null;
console.log(`token from disk: ttl=${ttlMin}min  age=${ageMin}min  lifetime=${c.iat ? Math.round((c.exp - c.iat) / 60) : '?'}min`);
if (ttlMin > 0) {
  console.log(`\nthis token is STILL VALID (${ttlMin}min left) — it cannot answer the expired-token question.`);
  console.log('Re-run against a staler file, or wait for expiry.');
  process.exit(0);
}
console.log(`\n>>> token is EXPIRED by ${Math.abs(ttlMin)} minutes. This is the test case.`);

const H = { authorization: `Bearer ${TOK}`, channel: 'APP', source: 'WEB_USER', version: '2021-07-28', accept: 'application/json, text/plain, */*' };
console.log('\n=== calling GET /oauth/2/login/current with the EXPIRED token ===');
try {
  const r = await fetch(ENDPOINT, { headers: H });
  console.log(`  HTTP ${r.status}`);
  const t = await r.text();
  const j = t.match(/ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
  if (r.status === 200 && j) {
    const n = decode(j[0]);
    const nTtl = Math.round((n.exp - Date.now() / 1000) / 60);
    const nAge = n.iat ? Math.round(Date.now() / 1000 - n.iat) : null;
    console.log(`  RETURNED A TOKEN: ttl=${nTtl}min  age=${nAge}s  lifetime=${n.iat ? Math.round((n.exp - n.iat) / 60) : '?'}min`);
    console.log('\n=== VERDICT ===');
    console.log(nTtl >= 45 && nAge !== null && nAge < 120
      ? '>>> AN EXPIRED TOKEN STILL REFRESHES. The chain NEVER breaks — no browser needed even after\n    an arbitrarily long idle. Playwright would be required only for a first-ever login.'
      : `>>> Returned something, but not a fresh full-lifetime token (ttl=${nTtl}min).`);
  } else {
    console.log(`  body had no JWT (${t.length} bytes)${t.length < 200 ? `: ${t.slice(0, 200)}` : ''}`);
    console.log('\n=== VERDICT ===');
    console.log('>>> AN EXPIRED TOKEN CANNOT REFRESH. The refresh chain must be kept alive by');
    console.log('    refreshing BEFORE expiry (proactive at T-5min), and a cold start after a long');
    console.log('    idle still needs the Playwright login. Design must keep the browser fallback.');
  }
} catch (e) {
  console.log(`  threw: ${String(e).slice(0, 120)}`);
}
