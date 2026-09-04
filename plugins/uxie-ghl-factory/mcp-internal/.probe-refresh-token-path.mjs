#!/usr/bin/env node
// PROBE 11 (2026-08-31) — chasing the best design. Probe 10 revealed the refresh response also
// carries `refreshToken`/`refreshJwt` with a 43200min = 30-DAY lifetime (they 401 as API bearers,
// so they exist to MINT). Probe 8 showed an EXPIRED ACCESS token cannot refresh — but we never
// tried the REFRESH token. If a 30-day refresh token can mint a new access token, the chain
// survives any idle up to 30 days and the browser cold-start all but disappears.
// Tries the documented-shaped candidates. Values never printed.
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
const looksJwt=(v)=>typeof v==='string'&&v.split('.').length===3&&v.length>80;
const dec=(j)=>{try{return JSON.parse(Buffer.from(j.split('.')[1],'base64url').toString());}catch{return null;}};
const H=(t)=>({authorization:`Bearer ${t}`,channel:'APP',source:'WEB_USER',version:'2021-07-28',accept:'application/json, text/plain, */*'});
const { chromium } = await loadPlaywright();
const ctx = await chromium.launchPersistentContext(PROFILE_DIR,{headless:true,viewport:{width:1440,height:900}});
let TOK=null;
ctx.on('request',(r)=>{if(TOK)return;const raw=(r.headers().authorization||'').replace(/^Bearer\s+/i,'');if(looksJwt(raw))TOK=raw;});
const page=ctx.pages()[0]??await ctx.newPage();
await page.goto('https://app.gohighlevel.com/',{waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{});
const dl=Date.now()+75000; while(!TOK&&Date.now()<dl) await new Promise(r=>setTimeout(r,1000));
await ctx.close();
if(!TOK){console.log('no token');process.exit(0);}
const body = await (await fetch(REFRESH,{headers:H(TOK)})).json();
const RT = body.refreshToken, COMPANY = body.companyId;
console.log(`got refreshToken: lifetime=${Math.round((dec(RT).exp-dec(RT).iat)/60/60/24)} days`);
const PROBE_URL=`https://backend.leadconnectorhq.com/locations/search?companyId=${encodeURIComponent(COMPANY)}&limit=1&skip=0`;
const usable = async (t) => { try { return (await fetch(PROBE_URL,{headers:H(t)})).status; } catch { return -1; } };

// Candidate refresh exchanges. All auth-shaped; worst case 404/401.
const cands = [
  ['GET  /oauth/2/login/current  (refreshToken as bearer)', async () => fetch(REFRESH,{headers:H(RT)})],
  ['POST /oauth/2/refresh',        async () => fetch('https://backend.leadconnectorhq.com/oauth/2/refresh',{method:'POST',headers:{...H(RT),'content-type':'application/json'},body:JSON.stringify({refreshToken:RT})})],
  ['POST /oauth/refresh',          async () => fetch('https://backend.leadconnectorhq.com/oauth/refresh',{method:'POST',headers:{...H(RT),'content-type':'application/json'},body:JSON.stringify({refreshToken:RT})})],
  ['POST /oauth/2/login/refresh',  async () => fetch('https://backend.leadconnectorhq.com/oauth/2/login/refresh',{method:'POST',headers:{...H(RT),'content-type':'application/json'},body:JSON.stringify({refreshToken:RT})})],
];
console.log('\n=== can the 30-day refreshToken mint a working access token? ===');
let win=null;
for (const [label,fn] of cands) {
  let res; try { res = await fn(); } catch { console.log(`  ${label.padEnd(48)} threw`); continue; }
  let note='';
  if (res.status===200) {
    const j = await res.json().catch(()=>null);
    const at = j?.authToken ?? j?.jwt ?? null;      // probe 10: these are the usable fields
    if (at && looksJwt(at)) { const st = await usable(at); note = `  -> authToken EXECUTES: HTTP ${st}`; if (st===200) win = label; }
    else note = '  -> 200 but no authToken/jwt field';
  }
  console.log(`  ${label.padEnd(48)} HTTP ${res.status}${note}`);
}
console.log('\n=== VERDICT ===');
console.log(win
  ? `>>> YES — "${win}" exchanges the 30-day refresh token for a WORKING access token.\n    The chain survives up to 30 days idle; the browser is needed only every 30 days.`
  : '>>> NO working refresh-token exchange found among these candidates. Keeping a LIVE access\n    token (proactive refresh before expiry) remains the only chain, with the browser as\n    cold-start after a >60min idle. The refreshToken may need an endpoint not guessed here.');
