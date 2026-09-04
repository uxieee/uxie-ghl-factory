#!/usr/bin/env node
// PROBE 21 (2026-08-31) — the 30-day chain from plain node, no browser. Probe 20 caught the app's
// cold-start exchange: POST /oauth/2/login/token with the refresh token in a `refresh-token`
// header AND as body {refreshTokenV2}. Questions this settles, by EXECUTION:
//   Q1  does the JSON `refreshToken` that /oauth/2/login/current hands back equal the browser's
//       refresh-token-v2 cookie? (if yes, out-of-band use could affect the browser session)
//   Q2  does the exchange work from plain fetch, and does the authToken it returns AUTHENTICATE a
//       real read? (accepted is not proven)
//   Q3  is the refresh token single-use / rotated? call it twice with the SAME value, compare the
//       returned refreshToken to the one sent
//   Q4  did the browser session survive our out-of-band exchanges? (headless boot must get a bearer)
// Rate discipline: 1 login/current + 2 login/token + 1 read. Values compared in-process only.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROFILE_DIR = join(homedir(), '.uxie-ghl-internal-mcp', 'pw-profile');
const TOKFILE = '/Volumes/Xander SSD/Vibe Code/Misc/.ghl/uxie-ghl-internal-mcp-tok.txt';
const SNAP = '/Volumes/Xander SSD/Vibe Code/Misc/.ghl/.cookie-snapshot-probe20.json';
const B = 'https://backend.leadconnectorhq.com';
const STD = { channel: 'APP', source: 'WEB_USER', version: '2021-07-28', accept: 'application/json, text/plain, */*' };
const looksJwt = (v) => typeof v === 'string' && v.split('.').length === 3 && v.length > 80;
const dec = (j) => { try { return JSON.parse(Buffer.from(j.split('.')[1], 'base64url').toString()); } catch { return null; } };
const hrs = (exp) => ((exp * 1000 - Date.now()) / 3.6e6).toFixed(2);

const BEARER = (readFileSync(TOKFILE, 'utf8').match(/Bearer\s+(ey[A-Za-z0-9._-]+)/i) || [])[1];
console.log(`token-file bearer: exp=${hrs(dec(BEARER).exp)}h`);
if (dec(BEARER).exp * 1000 < Date.now()) { console.log('bearer expired; cannot fetch a refresh token this way — aborting'); process.exit(0); }

// --- get the 30-day token the documented way
const cur = await (await fetch(`${B}/oauth/2/login/current`, { headers: { ...STD, authorization: `Bearer ${BEARER}` } })).json();
const RT = cur.refreshToken; const COMPANY = cur.companyId;
console.log(`login/current -> refreshToken exp=${hrs(dec(RT).exp)}h (30 days ≈ 720h)`);

// --- Q1
const cookieRT = JSON.parse(readFileSync(SNAP, 'utf8')).find((c) => c.name === 'refresh-token-v2')?.value ?? null;
const rtClaims = dec(RT), ckClaims = cookieRT ? dec(cookieRT) : null;
console.log(`\nQ1 same string as the browser's refresh-token-v2 cookie: ${cookieRT ? RT === cookieRT : 'n/a'}`);
if (ckClaims) console.log(`   same identity: ${rtClaims.authClassId === ckClaims.authClassId}   same iat: ${rtClaims.iat === ckClaims.iat}   (distinct tokens per issuance if iat differs)`);

// --- Q2
const exchange = async (rt) => {
  const r = await fetch(`${B}/oauth/2/login/token`, {
    method: 'POST',
    headers: { ...STD, 'content-type': 'application/json', 'refresh-token': rt },
    body: JSON.stringify({ refreshTokenV2: rt }),
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, j };
};
console.log('\nQ2 POST /oauth/2/login/token from plain node (no browser, no cookies):');
const x1 = await exchange(RT);
console.log(`   HTTP ${x1.status}  fields: ${x1.j ? Object.keys(x1.j).join(',') : '(none)'}`);
let ok2 = false;
if (x1.status === 201 || x1.status === 200) {
  const at = x1.j?.authToken;
  console.log(`   authToken: ${looksJwt(at) ? `exp=${hrs(dec(at).exp)}h age=${Math.round(Date.now() / 1000 - dec(at).iat)}s` : 'MISSING'}`);
  if (looksJwt(at)) {
    const rd = await fetch(`${B}/locations/search?companyId=${encodeURIComponent(COMPANY)}&limit=1&skip=0`, { headers: { ...STD, authorization: `Bearer ${at}` } });
    console.log(`   EXECUTED a real read with it: HTTP ${rd.status}`);
    ok2 = rd.status === 200;
  }
  const newRT = x1.j?.refreshToken;
  console.log(`   returned refreshToken: ${looksJwt(newRT) ? (newRT === RT ? 'IDENTICAL to the one sent' : `DIFFERENT (exp=${hrs(dec(newRT).exp)}h) -> rotated`) : 'none'}`);
}

// --- Q3
await new Promise((r) => setTimeout(r, 15000));
console.log('\nQ3 same refresh token again, 15s later:');
const x2 = await exchange(RT);
console.log(`   HTTP ${x2.status}  ${x2.status >= 400 ? '-> SINGLE-USE: the old token died on first use' : '-> REUSABLE: the same token still exchanges'}`);

// --- Q4
console.log('\nQ4 browser session health after two out-of-band exchanges:');
const asApi = (m) => (m?.chromium ? m : m?.default);
const t = []; const n = join(homedir(), '.npm', '_npx');
if (existsSync(n)) for (const d of readdirSync(n)) { const p = join(n, d, 'node_modules', 'playwright'); if (existsSync(join(p, 'package.json'))) t.push(p); }
const c = []; try { c.push(asApi(await import('playwright'))); } catch { /* */ }
for (const p of t) { try { c.push(asApi(await import(pathToFileURL(join(p, 'index.js')).href))); } catch { /* */ } }
let api; for (const a of c) { let e; try { e = a?.chromium?.executablePath(); } catch { continue; } if (e && existsSync(e)) { api = a; break; } }
const ctx = await api.chromium.launchPersistentContext(PROFILE_DIR, { headless: true });
let seen = false;
ctx.on('request', (r) => { if (/^Bearer\s+ey/i.test(r.headers().authorization || '')) seen = true; });
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://app.gohighlevel.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
const dl = Date.now() + 60000; while (!seen && Date.now() < dl) await new Promise((r) => setTimeout(r, 1000));
const cookies = (await ctx.cookies()).filter((x) => /token/i.test(x.name)).length;
await ctx.close();
console.log(`   headless boot: bearer=${seen ? 'YES' : 'NO'}  auth cookies=${cookies}`);
if (!seen) {
  const rr = await api.chromium.launchPersistentContext(PROFILE_DIR, { headless: true });
  await rr.clearCookies(); await rr.addCookies(JSON.parse(readFileSync(SNAP, 'utf8'))); await rr.close();
  console.log('   session broke -> restored from disk snapshot.');
}

console.log('\n=== VERDICT ===');
console.log(ok2
  ? '>>> THE 30-DAY CHAIN WORKS FROM PLAIN NODE. A stored refreshToken restarts renewal after any idle\n    up to 30 days, no browser. Cold-start logins become monthly.'
  : '>>> exchange did not yield a working bearer from plain node.');
console.log(`    single-use: ${x2.status >= 400 ? 'YES — store the ROTATED token after every exchange or the chain breaks' : 'NO — reusable within its lifetime'}`);
console.log(`    browser session survived: ${seen}`);
