#!/usr/bin/env node
// PROBE 14 (2026-08-31) — two things, both from the decompiled auth flow in chunk.BaQm359R.js:
//   signInWithCustomToken(e.token); auth/set { firebaseToken: e.token, apiKey, jwt, refreshJwt,
//                                              authToken, refreshToken }
// Q1 (corrects probe 9): `token` is the FIREBASE CUSTOM TOKEN, not a broken bearer. Exchange it at
//    Google's identitytoolkit with the response's own `apiKey` -> an ID token, which is what the
//    AI rail sends as `token-id`. If that works, BOTH rails renew with no browser.
// Q2: find where the app actually SENDS refreshToken/refreshJwt, to get the refresh endpoint.
// Executes, does not assume. Values never printed.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const PROFILE_DIR=join(homedir(),'.uxie-ghl-internal-mcp','pw-profile');
const REFRESH='https://backend.leadconnectorhq.com/oauth/2/login/current';
const asApi=(m)=>(m?.chromium?m:m?.default);
async function loadPlaywright(){const t=[];const n=join(homedir(),'.npm','_npx');
  if(existsSync(n))for(const d of readdirSync(n)){const p=join(n,d,'node_modules','playwright');if(existsSync(join(p,'package.json')))t.push(p);}
  const c=[];try{c.push(asApi(await import('playwright')));}catch{}
  for(const p of t){try{c.push(asApi(await import(pathToFileURL(join(p,'index.js')).href)));}catch{}}
  for(const a of c){let e;try{e=a?.chromium?.executablePath();}catch{continue;}if(e&&existsSync(e))return a;}
  throw new Error('no playwright');}
const looksJwt=(v)=>typeof v==='string'&&v.split('.').length===3&&v.length>80;
const H=(t)=>({authorization:`Bearer ${t}`,channel:'APP',source:'WEB_USER',version:'2021-07-28',accept:'application/json, text/plain, */*'});

const { chromium } = await loadPlaywright();
const ctx=await chromium.launchPersistentContext(PROFILE_DIR,{headless:true,viewport:{width:1440,height:900}});
let TOK=null, LIVE_TID=null;
ctx.on('request',(r)=>{const h=r.headers();
  if(!TOK){const raw=(h.authorization||'').replace(/^Bearer\s+/i,'');if(looksJwt(raw))TOK=raw;}
  if(!LIVE_TID&&h['token-id'])LIVE_TID=h['token-id'];});
const page=ctx.pages()[0]??await ctx.newPage();
await page.goto('https://app.gohighlevel.com/',{waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{});
const dl=Date.now()+90000;while(!TOK&&Date.now()<dl)await new Promise(r=>setTimeout(r,1000));
if(!TOK){await page.goto('https://app.gohighlevel.com/agency_launchpad',{waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{});const d2=Date.now()+60000;while(!TOK&&Date.now()<d2)await new Promise(r=>setTimeout(r,1000));}
await ctx.close();
if(!TOK){console.log('no token');process.exit(0);}
const body=await (await fetch(REFRESH,{headers:H(TOK)})).json();
console.log(`refresh response ok. apiKey present: ${!!body.apiKey}, token(custom) present: ${!!body.token}`);
console.log(`a live token-id was seen in browser traffic: ${!!LIVE_TID}`);

// ---------- Q1: Firebase custom-token -> ID token ----------
console.log('\n=== Q1: exchange `token` at Google identitytoolkit using the response apiKey ===');
let idToken=null;
try{
  const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(body.apiKey)}`,
    {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:body.token,returnSecureToken:true})});
  const j=await r.json().catch(()=>null);
  console.log(`  HTTP ${r.status}`);
  if(r.status===200&&j?.idToken){ idToken=j.idToken;
    console.log(`  GOT an idToken (expiresIn=${j.expiresIn}s, refreshToken field present: ${!!j.refreshToken})`);
  } else console.log(`  error: ${j?.error?.message ?? '(none)'}`);
}catch(e){console.log(`  threw ${String(e).slice(0,100)}`);}

// Does that idToken actually work as the AI rail's token-id?
if(idToken){
  console.log('\n  --- EXECUTED: use it as `token-id` on the AI rail ---');
  const AI='https://services.leadconnectorhq.com/locations/search?limit=1&skip=0';
  for (const [label,hdrs] of [
    ['bearer + fresh token-id', {...H(TOK), 'token-id': idToken}],
    ['bearer + live token-id (control)', LIVE_TID?{...H(TOK),'token-id':LIVE_TID}:null],
  ]) { if(!hdrs){console.log(`  ${label}: skipped (no live token-id captured)`);continue;}
    try{const r=await fetch(AI,{headers:hdrs});console.log(`  ${label.padEnd(34)} HTTP ${r.status}`);}catch{console.log(`  ${label} threw`);}
  }
}

// ---------- Q2: where does the app SEND refreshToken? ----------
console.log('\n=== Q2: hunting the refresh endpoint in the chunks that mention refreshToken ===');
const CH=['chunk.BaQm359R.js','chunk.UcsNyf1u.js','chunk.Bkf4nkQ_.js','chunk.DjBtxx3n.js'];
for(const c of CH){
  let t;try{const r=await fetch(`https://static.leadconnectorhq.com/1777/js/${c}`);if(!r.ok)continue;t=await r.text();}catch{continue;}
  // look for refreshToken/refreshJwt appearing near a url-ish literal or an http verb
  const re=/refreshJwt|refreshToken/g; let m; const shown=new Set();
  while((m=re.exec(t))!==null){
    const w=t.slice(Math.max(0,m.index-300),m.index+300);
    if(!/(get|post|put)\(|url:|\/oauth|\/users|\/login|axios|\$http/i.test(w)) continue;
    const k=Math.floor(m.index/400); if(shown.has(k))continue; shown.add(k);
    console.log(`\n  [${c} @${m.index}] ${w.replace(/\s+/g,' ')}`);
    if(shown.size>=3)break;
  }
}
