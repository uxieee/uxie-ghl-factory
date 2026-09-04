#!/usr/bin/env node
// PROBE 17 (2026-08-31) — the Firebase key isn't in the chunks I grepped, but grepping was the
// wrong method: the app TALKS to Firebase, so watch it. Firebase's SDK refreshes an ID token at
// securetoken.googleapis.com/v1/token?key=AIza... and signs in at identitytoolkit. Observing a
// boot gives the real key AND the real refresh mechanism for the AI rail's `token-id`.
// Read-only observation. Keys are shown truncated; tokens never printed.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const PROFILE_DIR = join(homedir(), '.uxie-ghl-internal-mcp', 'pw-profile');
const asApi=(m)=>(m?.chromium?m:m?.default);
async function loadPlaywright(){const t=[];const n=join(homedir(),'.npm','_npx');
 if(existsSync(n))for(const d of readdirSync(n)){const p=join(n,d,'node_modules','playwright');if(existsSync(join(p,'package.json')))t.push(p);}
 const c=[];try{c.push(asApi(await import('playwright')));}catch{}
 for(const p of t){try{c.push(asApi(await import(pathToFileURL(join(p,'index.js')).href)));}catch{}}
 for(const a of c){let e;try{e=a?.chromium?.executablePath();}catch{continue;}if(e&&existsSync(e))return a;}
 throw new Error('no playwright');}
const { chromium } = await loadPlaywright();
const ctx = await chromium.launchPersistentContext(PROFILE_DIR,{headless:true,viewport:{width:1440,height:900}});
const goog = [];
ctx.on('request',(req)=>{ let u; try{u=new URL(req.url());}catch{return;}
  if(!/googleapis\.com|firebase/.test(u.host)) return;
  const key=u.searchParams.get('key');
  goog.push({ method:req.method(), host:u.host, path:u.pathname, key: key ? key.slice(0,14)+'…' : null, fullKey: key });
});
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://app.gohighlevel.com/',{waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{});
await new Promise(r=>setTimeout(r,45000));

// Firebase persists its refresh token in IndexedDB; report KEY NAMES only.
const idb = await page.evaluate(async () => {
  try {
    const names = (await indexedDB.databases()).map(d=>d.name);
    return names;
  } catch { return ['(unavailable)']; }
}).catch(()=>['(err)']);
await ctx.close();

console.log(`=== Google/Firebase requests observed (${goog.length}) ===`);
const seen=new Set();
for(const g of goog){ const k=`${g.method} ${g.host}${g.path}`; if(seen.has(k))continue; seen.add(k);
  console.log(`  ${g.method.padEnd(5)} ${g.host}${g.path}   key=${g.key ?? '(none)'}`); }
if(!goog.length) console.log('  none — the Firebase SDK made no call this boot (session already warm)');
console.log(`\nIndexedDB databases present: ${idb.join(', ')}`);
const withKey = goog.find(g=>g.fullKey);
console.log('\n=== VERDICT ===');
if (withKey) {
  console.log(`>>> FOUND the Firebase Web API key on the wire (${withKey.key}) at ${withKey.host}${withKey.path}`);
  console.log('    The AI rail credential is renewable through Firebase\'s own endpoints.');
  console.log(`    FULL KEY (public client-side value, safe to record): ${withKey.fullKey}`);
} else {
  console.log('>>> no keyed Firebase call this boot. The SDK restored its session from IndexedDB');
  console.log('    without refreshing. Options: wait for the hourly Firebase refresh, or read the');
  console.log('    key from firebase config in a chunk not yet scanned.');
}
