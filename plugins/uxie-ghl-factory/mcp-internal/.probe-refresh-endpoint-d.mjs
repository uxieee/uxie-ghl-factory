#!/usr/bin/env node
// PROBE 6D (2026-08-31) — 6C got 401 from cookies alone. The app's own call also carries the
// Bearer and GHL's standard headers, which is exactly the position a renewal daemon is in: it
// HOLDS the current (dying) token. So: can the current token be exchanged for a fresh one at
// GET /oauth/2/login/current, mid-life? That is the whole proactive-refresh question.
// The token is held in a local variable and NEVER printed.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const PROFILE_DIR = join(homedir(), '.uxie-ghl-internal-mcp', 'pw-profile');
const ENDPOINT = 'https://backend.leadconnectorhq.com/oauth/2/login/current';
const asApi = (m) => (m?.chromium ? m : m?.default);
async function loadPlaywright() {
  const tryPaths = []; const npxRoot = join(homedir(), '.npm', '_npx');
  if (existsSync(npxRoot)) for (const d of readdirSync(npxRoot)) { const p = join(npxRoot, d, 'node_modules', 'playwright'); if (existsSync(join(p, 'package.json'))) tryPaths.push(p); }
  const cands = []; try { cands.push(asApi(await import('playwright'))); } catch {}
  for (const p of tryPaths) { try { cands.push(asApi(await import(pathToFileURL(join(p, 'index.js')).href))); } catch {} }
  for (const api of cands) { let e; try { e = api?.chromium?.executablePath(); } catch { continue; } if (e && existsSync(e)) return api; }
  throw new Error('no usable playwright');
}
const looksJwt = (v) => typeof v === 'string' && v.split('.').length === 3 && v.length > 80;
const decode = (j) => { try { return JSON.parse(Buffer.from(j.split('.')[1], 'base64url').toString()); } catch { return null; } };
const stat = (jwt, label) => { const c = decode(jwt); if (!c) return { label, jti:'?', ttlMin:null, lifetimeMin:null, ageSec:null };
  return { label, jti: String(c.jti ?? '').slice(0,8), ttlMin: Math.round((c.exp - Date.now()/1000)/60),
           lifetimeMin: c.iat ? Math.round((c.exp - c.iat)/60) : null, ageSec: c.iat ? Math.round(Date.now()/1000 - c.iat) : null }; };
const show = (s) => console.log(`  ${s.label}: jti ${s.jti}…  ttl=${s.ttlMin}min  lifetime=${s.lifetimeMin}min  age=${s.ageSec}s`);
const { chromium } = await loadPlaywright();
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1440, height: 900 } });
let TOK = null; let inPlay = null;           // TOK never leaves this process
ctx.on('request', (req) => { if (TOK) return; const raw = (req.headers().authorization||'').replace(/^Bearer\s+/i,''); if (looksJwt(raw)) { TOK = raw; inPlay = stat(raw,'in-play bearer'); } });
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://app.gohighlevel.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
const deadline = Date.now() + 75000;
while (!TOK && Date.now() < deadline) { await new Promise(r => setTimeout(r, 1000)); }
if (!TOK) { await page.goto('https://app.gohighlevel.com/agency_launchpad', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
  const d2 = Date.now() + 45000; while (!TOK && Date.now() < d2) { await new Promise(r => setTimeout(r, 1000)); } }
console.log('=== token the app is using (the one a daemon would hold) ==='); if (inPlay) show(inPlay); else { console.log('  none captured — aborting'); await ctx.close(); process.exit(0); }
const H = { authorization: `Bearer ${TOK}`, channel: 'APP', source: 'WEB_USER', version: '2021-07-28', accept: 'application/json, text/plain, */*' };
const call = async (label, headers) => {
  const r = await ctx.request.get(ENDPOINT, { headers }).catch((e) => null);
  if (!r) { console.log(`  ${label}: request threw`); return null; }
  if (r.status() !== 200) { console.log(`  ${label}: HTTP ${r.status()}`); return null; }
  const t = await r.text(); const m = t.match(/ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
  if (!m) { console.log(`  ${label}: 200 but no JWT in body (${t.length} bytes)`); return null; }
  const s = stat(m[0], label); show(s); return s;
};
console.log('\n=== exchange the held token at GET /oauth/2/login/current ===');
const a = await call('call #1 (bearer + std headers)', H);
await new Promise(r=>setTimeout(r,15000));
const b = await call('call #2, 15s later', H);
console.log('\n=== VERDICT ===');
if (!a) console.log('no token returned — the endpoint does not serve a refresh for a held token.');
else {
  const isNew = a.jti !== inPlay.jti;
  const mintsEach = b && b.jti !== a.jti;
  console.log(`distinct from the held token: ${isNew ? 'YES' : 'NO — same jti echoed back'}`);
  console.log(`new token on every call: ${mintsEach ? 'YES' : 'NO'}`);
  console.log(`freshness: ttl=${a.ttlMin}min of ${a.lifetimeMin}min, age=${a.ageSec}s`);
  if (isNew && a.ageSec !== null && a.ageSec < 120 && a.ttlMin >= 45)
    console.log('\n>>> FORCED EARLY MINT WORKS — a held token buys a fresh ~60min one on demand.\n    Proactive refresh IS buildable; probe 5\'s "reactive only" conclusion is REVERSED.');
  else if (isNew) console.log('\n>>> Returns a different token, but not freshly issued — inspect age before relying on it.');
  else console.log('\n>>> Echoes the same token. No early mint. Reactive renewal stands.');
}
await ctx.close();
