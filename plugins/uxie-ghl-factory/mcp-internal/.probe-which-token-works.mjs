#!/usr/bin/env node
// PROBE 10 (2026-08-31) — correcting my own earlier probes. Probe 9 showed /oauth/2/login/current
// returns FIVE JWT-shaped fields (token, authToken, jwt, refreshToken, refreshJwt). Probes 6D/7
// regex-matched the FIRST one in the body ("token"), whose claims do NOT match the in-use bearer
// (authClass undefined, different authClassId). So "forced mint works" was measured against a
// field that may not be the API bearer at all.
//
// ACCEPTED IS NOT PROVEN: this does not compare shapes, it EXECUTES a real authenticated read with
// each candidate and reports the status. Only a 200 proves which field is the usable credential.
// Values never printed.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const PROFILE_DIR = join(homedir(), '.uxie-ghl-internal-mcp', 'pw-profile');
const REFRESH = 'https://backend.leadconnectorhq.com/oauth/2/login/current';
const asApi = (m) => (m?.chromium ? m : m?.default);
async function loadPlaywright() {
  const t=[]; const n=join(homedir(),'.npm','_npx');
  if (existsSync(n)) for (const d of readdirSync(n)) { const p=join(n,d,'node_modules','playwright'); if (existsSync(join(p,'package.json'))) t.push(p); }
  const c=[]; try { c.push(asApi(await import('playwright'))); } catch {}
  for (const p of t) { try { c.push(asApi(await import(pathToFileURL(join(p,'index.js')).href))); } catch {} }
  for (const a of c) { let e; try { e=a?.chromium?.executablePath(); } catch { continue; } if (e&&existsSync(e)) return a; }
  throw new Error('no playwright');
}
const looksJwt = (v) => typeof v==='string' && v.split('.').length===3 && v.length>80;
const dec = (j) => { try { return JSON.parse(Buffer.from(j.split('.')[1],'base64url').toString()); } catch { return null; } };
const HDR = (tok) => ({ authorization:`Bearer ${tok}`, channel:'APP', source:'WEB_USER', version:'2021-07-28', accept:'application/json, text/plain, */*' });

const { chromium } = await loadPlaywright();
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless:true, viewport:{width:1440,height:900} });
let TOK=null;
ctx.on('request',(r)=>{ if(TOK)return; const raw=(r.headers().authorization||'').replace(/^Bearer\s+/i,''); if(looksJwt(raw)) TOK=raw; });
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://app.gohighlevel.com/',{waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{});
const dl=Date.now()+75000; while(!TOK&&Date.now()<dl) await new Promise(r=>setTimeout(r,1000));
await ctx.close();
if(!TOK){console.log('no token captured');process.exit(0);}
const held = dec(TOK);
console.log(`HELD bearer (known-good): authClass=${held.authClass} authClassId=${String(held.authClassId).slice(0,6)}… ttl=${Math.round((held.exp-Date.now()/1000)/60)}min`);

const r = await fetch(REFRESH,{headers:HDR(TOK)});
const body = await r.json();
const COMPANY = body.companyId;
// The control: prove the read works with the KNOWN-GOOD held token first.
const PROBE_URL = `https://backend.leadconnectorhq.com/locations/search?companyId=${encodeURIComponent(COMPANY)}&limit=1&skip=0`;
const exec = async (label, tok) => {
  try {
    const res = await fetch(PROBE_URL, { headers: HDR(tok) });
    let rows = null;
    if (res.status===200) { const j = await res.json().catch(()=>null); rows = j?.locations?.length ?? null; }
    console.log(`  ${label.padEnd(14)} HTTP ${res.status}${rows!==null?`  (${rows} row)`:''}`);
    return res.status===200;
  } catch(e){ console.log(`  ${label.padEnd(14)} threw`); return false; }
};

console.log('\n=== CONTROL: the held browser token against a real read ===');
const controlOk = await exec('held bearer', TOK);

console.log('\n=== candidate fields from the refresh response ===');
const cands = Object.entries(body).filter(([,v])=>looksJwt(v));
for (const [k,v] of cands) {
  const c = dec(v);
  console.log(`  ${k}: authClass=${c?.authClass ?? '(none)'} authClassIdMatch=${c?.authClassId===held.authClassId} ttl=${c?.exp?Math.round((c.exp-Date.now()/1000)/60):'?'}min lifetime=${c?.iat?Math.round((c.exp-c.iat)/60):'?'}min`);
}

console.log('\n=== EXECUTED: which candidate actually authenticates a real API read? ===');
const working = [];
for (const [k,v] of cands) { if (await exec(k, v)) working.push(k); }

console.log('\n=== VERDICT ===');
console.log(`control (held token) worked: ${controlOk}`);
console.log(`refresh fields that AUTHENTICATE: ${working.length ? working.join(', ') : 'NONE'}`);
if (working.length) {
  const best = working.map(k=>({k,c:dec(body[k])})).sort((a,b)=>b.c.exp-a.c.exp)[0];
  console.log(`\n>>> USE FIELD: "${best.k}" — ttl=${Math.round((best.c.exp-Date.now()/1000)/60)}min, authClassId matches: ${best.c.authClassId===held.authClassId}`);
  console.log('    A blind regex for the first JWT in the body would pick "' + cands[0][0] + '" — ' + (working.includes(cands[0][0]) ? 'which happens to work.' : 'WHICH DOES NOT WORK.'));
} else {
  console.log('\n>>> NO field from the refresh response authenticates. The "renewal solved" claim is WRONG.');
}
console.log(`\nAI rail: response carries a firebase/token-id field? ${Object.keys(body).some(k=>/firebase|tokenId|idToken/i.test(k)) ? 'yes' : 'NO — host:"ai" still needs the browser'}`);
