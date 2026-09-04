#!/usr/bin/env node
// PROBE 12 (2026-08-31) — pull the REAL /oauth/refresh contract from GHL's public sourcemaps.
// The known recapture targets the WORKFLOW BUILDER SPA; /oauth/refresh belongs to the MAIN app
// (app.gohighlevel.com), a different bundle. Step 1: enumerate the main app's script chunks from a
// live boot. Step 2: fetch each (they are public/unauthenticated) and find which carries the
// refresh call. Step 3: pull that chunk's .map and print the SOURCE around the call site.
// No credential is used to fetch the assets. Nothing is written outside this probe's output file.
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
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
const scripts = new Set();
ctx.on('response',(res)=>{ const u=res.url();
  if(/\.js(\?|$)/.test(u) && /leadconnectorhq\.com|gohighlevel\.com/.test(u)) scripts.add(u.split('?')[0]); });
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://app.gohighlevel.com/',{waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{});
await new Promise(r=>setTimeout(r,35000));
await ctx.close();
console.log(`collected ${scripts.size} script chunks from the main app`);

const MARK = /oauth\/refresh|refreshToken|refreshJwt/;
const hits = [];
let scanned=0, bytes=0;
for (const u of scripts) {
  try {
    const r = await fetch(u); if (!r.ok) continue;
    const t = await r.text(); scanned++; bytes+=t.length;
    if (MARK.test(t)) {
      const which = [];
      if (/oauth\/refresh/.test(t)) which.push('oauth/refresh');
      if (/refreshToken/.test(t)) which.push('refreshToken');
      if (/refreshJwt/.test(t)) which.push('refreshJwt');
      hits.push({ url: u, which, len: t.length, text: t });
    }
  } catch {}
}
console.log(`scanned ${scanned} chunks (${(bytes/1e6).toFixed(1)} MB)`);
console.log(`\n=== chunks containing refresh markers (${hits.length}) ===`);
for (const h of hits) console.log(`  ${h.url.split('/').slice(-1)[0]}  [${h.which.join(', ')}]  ${(h.len/1e3).toFixed(0)}kb`);
if (!hits.length) { console.log('no chunk carried the marker — the call may be in a lazy chunk not loaded on this route'); process.exit(0); }

// Print the minified call site(s) first — that alone usually reveals method + path + body keys.
console.log('\n=== minified call sites around "oauth/refresh" ===');
for (const h of hits) {
  let i = -1; const t = h.text;
  while ((i = t.indexOf('oauth/refresh', i+1)) !== -1) {
    console.log(`\n--- ${h.url.split('/').slice(-1)[0]} @${i} ---`);
    console.log(t.slice(Math.max(0,i-500), i+500).replace(/\s+/g,' '));
  }
}

// Then the real source, if a map is published.
console.log('\n=== sourcemap lookup ===');
for (const h of hits) {
  const mapUrl = h.url + '.map';
  try {
    const r = await fetch(mapUrl);
    if (!r.ok) { console.log(`  ${mapUrl.split('/').slice(-1)[0]}: HTTP ${r.status} (no public map)`); continue; }
    const m = await r.json();
    const srcs = m.sources || []; const contents = m.sourcesContent || [];
    console.log(`  ${mapUrl.split('/').slice(-1)[0]}: 200, ${srcs.length} sources, contents ${contents.length}`);
    for (let k=0;k<contents.length;k++){
      const c = contents[k]; if (!c || !/oauth\/refresh/.test(c)) continue;
      console.log(`\n  >>> SOURCE FILE: ${srcs[k]}`);
      const lines = c.split('\n');
      lines.forEach((ln,idx)=>{ if(/oauth\/refresh/.test(ln)){
        console.log(lines.slice(Math.max(0,idx-25), idx+25).map((l,j)=>`    ${String(Math.max(1,idx-25)+j).padStart(4)}| ${l}`).join('\n'));
      }});
      writeFileSync('.probe-refresh-source.txt', `${srcs[k]}\n\n${c}`);
      console.log('\n  (full source file written to .probe-refresh-source.txt)');
    }
  } catch(e){ console.log(`  map fetch failed: ${String(e).slice(0,80)}`); }
}
