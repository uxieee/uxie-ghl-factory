#!/usr/bin/env node
// PROBE 6C (2026-08-31) — 6B's in-page fetch returned -1 (threw). Cross-origin: the page is on
// app.gohighlevel.com, the endpoint on backend.leadconnectorhq.com, so a page fetch is CORS-bound
// while the app's own XHR is not (it is issued by the SPA with its allowed origin/headers).
// This retries via Playwright's APIRequestContext, which carries the profile's cookies but is not
// subject to CORS — the same position a renewal daemon would be in. Also prints the real fetch
// error for the record. Token values never printed.
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
const stat = (jwt, label) => { const c = decode(jwt); if (!c) return { label, err: 1 };
  return { label, jti: String(c.jti ?? '').slice(0,8), ttlMin: Math.round((c.exp - Date.now()/1000)/60),
           lifetimeMin: c.iat ? Math.round((c.exp - c.iat)/60) : null, ageSec: c.iat ? Math.round(Date.now()/1000 - c.iat) : null }; };
const show = (s) => console.log(`  ${s.label}: jti ${s.jti}…  ttl=${s.ttlMin}min  lifetime=${s.lifetimeMin}min  age=${s.ageSec}s`);
const { chromium } = await loadPlaywright();
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1440, height: 900 } });
let inPlay = null, appSaw = null;
ctx.on('request', (req) => { if (inPlay) return; const raw = (req.headers().authorization||'').replace(/^Bearer\s+/i,''); if (looksJwt(raw)) inPlay = stat(raw,'in-play bearer'); });
ctx.on('response', async (res) => { if (appSaw) return; try { if (new URL(res.url()).pathname !== '/oauth/2/login/current') return; const t = await res.text();
  const m = t.match(/ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/); if (m) appSaw = stat(m[0], "app's own call to the endpoint"); } catch {} });
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://app.gohighlevel.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(()=>{});
await new Promise(r => setTimeout(r, 20000));
console.log('=== tokens observed during boot ==='); if (inPlay) show(inPlay); if (appSaw) show(appSaw);
const err = await page.evaluate(async (u) => { try { const r = await fetch(u, { credentials:'include' }); return `status ${r.status}`; } catch (e) { return `THREW: ${String(e).slice(0,120)}`; } }, ENDPOINT);
console.log(`\nin-page fetch (for the record): ${err}`);
console.log('\n=== replay via APIRequestContext (cookies, no CORS) ===');
const call = async (label) => {
  const r = await ctx.request.get(ENDPOINT, { headers: { accept: 'application/json' } }).catch((e) => ({ status: () => -1, _e: String(e) }));
  const st = typeof r.status === 'function' ? r.status() : -1;
  if (st !== 200) { console.log(`  ${label}: HTTP ${st}${r._e ? ' — ' + r._e.slice(0,100) : ''}`); return null; }
  const t = await r.text(); const m = t.match(/ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
  if (!m) { console.log(`  ${label}: 200, no JWT in body (${t.length} bytes)`); return null; }
  const s = stat(m[0], label); show(s); return s;
};
const a = await call('call #1'); await new Promise(r=>setTimeout(r,15000)); const b = await call('call #2, 15s later');
console.log('\n=== VERDICT ===');
if (!a) { console.log('no token from the replay — an early mint is NOT reachable this way.'); }
else {
  const isNew = inPlay && a.jti !== inPlay.jti;
  const mintsEach = b && b.jti !== a.jti;
  console.log(`distinct from the token in active use: ${isNew ? 'YES' : 'NO'}`);
  console.log(`new token on every call: ${mintsEach ? 'YES' : 'NO (same jti twice)'}`);
  console.log(`freshness: ttl=${a.ttlMin}min of ${a.lifetimeMin}min, age=${a.ageSec}s`);
  if (a.ageSec !== null && a.ageSec < 120 && a.ttlMin >= 45)
    console.log('\n>>> FORCED EARLY MINT WORKS — proactive refresh IS buildable; probe 5 conclusion reversed.');
  else console.log('\n>>> Echoes the existing token (not newly issued). Reactive renewal stands.');
}
await ctx.close();
