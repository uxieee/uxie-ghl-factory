#!/usr/bin/env node
// PROBE 9 (2026-08-31) — auditing my own design before recommending it. Two questions:
//  Q1 THE GAP: the token file holds TWO credentials — `Bearer <jwt>` AND `token-id: <firebase>`.
//     The AI rail (host:"ai", services.leadconnectorhq.com) uses token-id. If the refresh returns
//     only a Bearer, the AI rail still dies hourly and still needs the browser — which would make
//     "no browser needed" true for the workflow rail ONLY. Decisive for the design.
//  Q2 SAFETY: does the refreshed token carry the SAME identity? A refresh that silently returned a
//     different authClass/authClassId could point writes at another account.
// Prints response KEY NAMES and claim NAMES/identity only — never a credential value.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const PROFILE_DIR = join(homedir(), '.uxie-ghl-internal-mcp', 'pw-profile');
const ENDPOINT = 'https://backend.leadconnectorhq.com/oauth/2/login/current';
const asApi = (m) => (m?.chromium ? m : m?.default);
async function loadPlaywright() {
  const tryPaths = []; const npxRoot = join(homedir(), '.npm', '_npx');
  if (existsSync(npxRoot)) for (const d of readdirSync(npxRoot)) { const p = join(npxRoot,d,'node_modules','playwright'); if (existsSync(join(p,'package.json'))) tryPaths.push(p); }
  const c = []; try { c.push(asApi(await import('playwright'))); } catch {}
  for (const p of tryPaths) { try { c.push(asApi(await import(pathToFileURL(join(p,'index.js')).href))); } catch {} }
  for (const a of c) { let e; try { e = a?.chromium?.executablePath(); } catch { continue; } if (e && existsSync(e)) return a; }
  throw new Error('no playwright');
}
const looksJwt = (v) => typeof v === 'string' && v.split('.').length === 3 && v.length > 80;
const dec = (j) => { try { return JSON.parse(Buffer.from(j.split('.')[1],'base64url').toString()); } catch { return null; } };
const { chromium } = await loadPlaywright();
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport:{width:1440,height:900} });
let TOK = null, TID = null;
ctx.on('request', (r) => { const h = r.headers();
  if (!TOK) { const raw=(h.authorization||'').replace(/^Bearer\s+/i,''); if (looksJwt(raw)) TOK = raw; }
  if (!TID && h['token-id']) TID = h['token-id']; });
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://app.gohighlevel.com/', { waitUntil:'domcontentloaded', timeout:60000 }).catch(()=>{});
const dl = Date.now()+75000; while (!TOK && Date.now()<dl) await new Promise(r=>setTimeout(r,1000));
await ctx.close();
if (!TOK) { console.log('no token captured'); process.exit(0); }
const before = dec(TOK);
console.log(`held bearer: authClass=${before.authClass} authClassId=${String(before.authClassId).slice(0,6)}… ttl=${Math.round((before.exp-Date.now()/1000)/60)}min`);
console.log(`token-id (firebase) seen in browser traffic: ${TID ? 'yes' : 'no'}`);

const H = { authorization:`Bearer ${TOK}`, channel:'APP', source:'WEB_USER', version:'2021-07-28', accept:'application/json, text/plain, */*' };
const r = await fetch(ENDPOINT, { headers: H });
console.log(`\nrefresh call: HTTP ${r.status}`);
const body = await r.json().catch(()=>null);
if (!body) { console.log('body not JSON'); process.exit(0); }

const walk = (o, pre='') => { const out=[]; for (const [k,v] of Object.entries(o||{})) {
  const path = pre ? `${pre}.${k}` : k;
  if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...walk(v, path));
  else out.push({ path, type: Array.isArray(v)?'array':typeof v, jwtish: looksJwt(v), len: typeof v==='string'?v.length:null });
} return out; };
const fields = walk(body);
console.log('\n=== Q1: what the refresh response actually returns (KEY NAMES only) ===');
for (const f of fields) console.log(`  ${f.path}  [${f.type}${f.len!==null?`, len ${f.len}`:''}]${f.jwtish ? '   <-- A JWT' : ''}`);

const jwtFields = fields.filter(f=>f.jwtish);
const firebaseish = fields.filter(f=>/firebase|tokenId|token_id|idToken/i.test(f.path));
console.log(`\nJWT-shaped fields returned: ${jwtFields.length ? jwtFields.map(f=>f.path).join(', ') : 'none'}`);
console.log(`firebase / token-id shaped fields: ${firebaseish.length ? firebaseish.map(f=>f.path).join(', ') : 'NONE'}`);

console.log('\n=== Q2: identity of the refreshed token ===');
const newTok = jwtFields.length ? (function find(o){ for (const v of Object.values(o||{})) { if (looksJwt(v)) return v; if (v&&typeof v==='object'){ const f=find(v); if (f) return f; } } return null; })(body) : null;
if (newTok) { const a = dec(newTok);
  console.log(`  authClass:   ${before.authClass} -> ${a.authClass}   ${before.authClass===a.authClass?'SAME':'*** DIFFERENT ***'}`);
  console.log(`  authClassId: ${before.authClassId===a.authClassId?'SAME':'*** DIFFERENT ***'}`);
  console.log(`  ttl: ${Math.round((a.exp-Date.now()/1000)/60)}min`);
}
console.log('\n=== WHAT THIS MEANS FOR THE DESIGN ===');
console.log(firebaseish.length || jwtFields.length > 1
  ? '>>> the response may carry the AI-rail credential too — inspect the fields above.'
  : '>>> ONLY the Bearer is refreshed. The AI rail (token-id) is NOT covered by this call:\n    host:"ai" work would still expire hourly and still need the browser capture.');
