#!/usr/bin/env node
// PROBE 7 (2026-08-31) — the architecture question. 6D proved GET /oauth/2/login/current mints a
// fresh 60min token when called with a held Bearer THROUGH the browser's request context (which
// also sends cookies). If the Bearer ALONE suffices — no cookies, no browser — then renewal is a
// plain fetch inside the gateway: no Playwright, no profile, no subprocess, milliseconds not
// seconds. That would collapse most of the phase's design.
// Captures one token via the browser, closes it, then calls with plain node fetch and NO cookies.
// The token is held in a variable and never printed.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const PROFILE_DIR = join(homedir(), '.uxie-ghl-internal-mcp', 'pw-profile');
const ENDPOINT = 'https://backend.leadconnectorhq.com/oauth/2/login/current';
const asApi = (m) => (m?.chromium ? m : m?.default);
async function loadPlaywright() {
  const tryPaths = []; const npxRoot = join(homedir(), '.npm', '_npx');
  if (existsSync(npxRoot)) for (const d of readdirSync(npxRoot)) { const p = join(npxRoot, d, 'node_modules', 'playwright'); if (existsSync(join(p,'package.json'))) tryPaths.push(p); }
  const cands = []; try { cands.push(asApi(await import('playwright'))); } catch {}
  for (const p of tryPaths) { try { cands.push(asApi(await import(pathToFileURL(join(p,'index.js')).href))); } catch {} }
  for (const api of cands) { let e; try { e = api?.chromium?.executablePath(); } catch { continue; } if (e && existsSync(e)) return api; }
  throw new Error('no usable playwright');
}
const looksJwt = (v) => typeof v === 'string' && v.split('.').length === 3 && v.length > 80;
const decode = (j) => { try { return JSON.parse(Buffer.from(j.split('.')[1],'base64url').toString()); } catch { return null; } };
const stat = (jwt,label) => { const c = decode(jwt); if (!c) return null;
  return { label, ttlMin: Math.round((c.exp - Date.now()/1000)/60), lifetimeMin: c.iat ? Math.round((c.exp-c.iat)/60) : null, ageSec: c.iat ? Math.round(Date.now()/1000 - c.iat) : null }; };
const show = (s) => console.log(`  ${s.label}: ttl=${s.ttlMin}min  lifetime=${s.lifetimeMin}min  age=${s.ageSec}s`);

const { chromium } = await loadPlaywright();
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1440, height: 900 } });
let TOK = null;
ctx.on('request', (req) => { if (TOK) return; const raw=(req.headers().authorization||'').replace(/^Bearer\s+/i,''); if (looksJwt(raw)) TOK = raw; });
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://app.gohighlevel.com/', { waitUntil:'domcontentloaded', timeout:60000 }).catch(()=>{});
const dl = Date.now()+75000; while (!TOK && Date.now() < dl) await new Promise(r=>setTimeout(r,1000));
await ctx.close();
if (!TOK) { console.log('no token captured — aborting'); process.exit(0); }
console.log('captured one token via browser, browser now CLOSED');
show(stat(TOK,'held token'));

const H = { authorization: `Bearer ${TOK}`, channel:'APP', source:'WEB_USER', version:'2021-07-28', accept:'application/json, text/plain, */*' };
const tryCall = async (label, headers) => {
  try {
    const r = await fetch(ENDPOINT, { headers });
    if (r.status !== 200) { console.log(`  ${label}: HTTP ${r.status}`); return null; }
    const t = await r.text(); const m = t.match(/ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
    if (!m) { console.log(`  ${label}: 200 but no JWT in body`); return null; }
    const s = stat(m[0], label); show(s); return s;
  } catch (e) { console.log(`  ${label}: threw ${String(e).slice(0,90)}`); return null; }
};
console.log('\n=== plain node fetch, NO browser, NO cookies ===');
const a = await tryCall('bearer + std headers', H);
const b = await tryCall('bearer only (no channel/source/version)', { authorization: H.authorization, accept: H.accept });
console.log('\n=== VERDICT ===');
if (a && a.ageSec !== null && a.ageSec < 120 && a.ttlMin >= 45) {
  console.log('>>> NO BROWSER NEEDED. A held Bearer alone mints a fresh 60min token over plain HTTPS.');
  console.log('    Renewal becomes a fetch inside the gateway: no Playwright, no profile, no subprocess.');
  console.log(`    Standard headers required: ${b ? 'NO — bearer alone worked too' : 'YES — bearer-only failed'}`);
} else {
  console.log('>>> Cookies/browser ARE required — the Bearer alone does not mint. Keep the browser path.');
}
