#!/usr/bin/env node
// PROBE 20 (2026-08-31) — the NATURAL cold start, not the forced one.
// Probe 19 REMOVED the access cookies and the app treated that as logged-out (no refresh, wiped
// its cookies). After a real idle the cookie is still there; it just holds an EXPIRED token. That
// is the state probe 4 saw self-heal. Reproduce it exactly: keep every cookie, swap the two access
// cookies' VALUES for an expired bearer of the same identity, boot a fresh process, and record
// every call. Any request that carries the refresh-token value (in a cookie, header or body) is
// flagged — that is the exchange. Values compared in-process, never printed.
// SAFETY: fresh disk snapshot first; restore if the session does not come back.
import { existsSync, readdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROFILE_DIR = join(homedir(), '.uxie-ghl-internal-mcp', 'pw-profile');
const SNAP = '/Volumes/Xander SSD/Vibe Code/Misc/.ghl/.cookie-snapshot-probe20.json';
const EXPIRED_SRC = '/Volumes/Xander SSD/Vibe Code/Misc/.ghl/uxie-ghl-internal-mcp-tok.txt.bak-20260830-213153';
const asApi = (m) => (m?.chromium ? m : m?.default);
async function loadPlaywright() {
  const t = []; const n = join(homedir(), '.npm', '_npx');
  if (existsSync(n)) for (const d of readdirSync(n)) { const p = join(n, d, 'node_modules', 'playwright'); if (existsSync(join(p, 'package.json'))) t.push(p); }
  const c = []; try { c.push(asApi(await import('playwright'))); } catch { /* */ }
  for (const p of t) { try { c.push(asApi(await import(pathToFileURL(join(p, 'index.js')).href))); } catch { /* */ } }
  for (const a of c) { let e; try { e = a?.chromium?.executablePath(); } catch { continue; } if (e && existsSync(e)) return a; }
  throw new Error('no playwright');
}
const looksJwt = (v) => typeof v === 'string' && v.split('.').length === 3 && v.length > 80;
const dec = (j) => { try { return JSON.parse(Buffer.from(j.split('.')[1], 'base64url').toString()); } catch { return null; } };
const hrs = (exp) => ((exp * 1000 - Date.now()) / 3.6e6).toFixed(1);
const { chromium } = await loadPlaywright();

// ---- the expired bearer, same identity check
const EXPIRED = (readFileSync(EXPIRED_SRC, 'utf8').match(/Bearer\s+(ey[A-Za-z0-9._-]+)/i) || [])[1];
const ec = dec(EXPIRED);
console.log(`expired source bearer: exp=${hrs(ec.exp)}h (must be negative) authClassId-prefix=${String(ec.authClassId).slice(0, 4)}`);
if (ec.exp * 1000 > Date.now()) { console.log('not expired — aborting'); process.exit(0); }

// ---- snapshot + baseline health
const ctx0 = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });
const snapshot = await ctx0.cookies();
await ctx0.close();
writeFileSync(SNAP, JSON.stringify(snapshot), { mode: 0o600 }); chmodSync(SNAP, 0o600);
const cur = snapshot.find((c) => c.name === 'access-token-v2');
const rt = snapshot.find((c) => c.name === 'refresh-token-v2');
if (!cur || !rt) { console.log(`profile lacks access/refresh cookies (${snapshot.filter((c) => /token/i.test(c.name)).map((c) => c.name).join(',')}) — aborting, nothing changed`); process.exit(0); }
console.log(`profile: access-token-v2 exp=${hrs(dec(cur.value).exp)}h  refresh-token-v2 exp=${hrs(dec(rt.value).exp)}h  same identity as expired source: ${dec(cur.value).authClassId === ec.authClassId}`);
const REFRESH_VALUE = rt.value;

// ---- swap access cookie VALUES for the expired bearer; everything else untouched
const swapped = snapshot.map((c) => (c.name === 'access-token-v1' || c.name === 'access-token-v2') ? { ...c, value: EXPIRED } : c);
const ctx1 = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });
await ctx1.clearCookies(); await ctx1.addCookies(swapped); await ctx1.close();
console.log('\naccess-token-v1/v2 now hold an EXPIRED bearer; refresh-token-v2 untouched; browser closed');

// ---- fresh process, record
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1440, height: 900 } });
const log = []; let freshBearerAt = null;
ctx.on('request', (req) => {
  let u; try { u = new URL(req.url()); } catch { return; }
  if (!/leadconnectorhq\.com|gohighlevel\.com|googleapis\.com/.test(u.host)) return;
  if (/\.(js|css|png|svg|woff2?|ico|jpg|gif)$/.test(u.pathname) || /cdn-cgi|_pm\//.test(u.pathname)) return;
  const h = req.headers();
  const raw = (h.authorization || '').replace(/^Bearer\s+/i, '');
  const bearerExp = looksJwt(raw) ? dec(raw)?.exp : null;
  const bearerState = bearerExp == null ? null : (bearerExp * 1000 > Date.now() ? 'FRESH' : 'expired');
  const pd = req.postData() || '';
  const carriesRefresh = Object.values(h).some((v) => typeof v === 'string' && v.includes(REFRESH_VALUE)) || pd.includes(REFRESH_VALUE);
  let bodyKeys = null; if (pd) { try { bodyKeys = Object.keys(JSON.parse(pd)); } catch { bodyKeys = ['(non-json)']; } }
  const cookieNames = (h.cookie || '').split(';').map((s) => s.trim().split('=')[0]).filter((n) => /token/i.test(n));
  const e = { i: log.length, method: req.method(), host: u.host, path: u.pathname, query: [...u.searchParams.keys()], bearerState, carriesRefresh, cookieNames, hdrNames: Object.keys(h).filter((k) => /token|auth|channel|source|version|refresh/i.test(k)), bodyKeys, status: null, respJwtFields: null };
  log.push(e); req.__e = e;
  if (bearerState === 'FRESH' && freshBearerAt === null) freshBearerAt = e.i;
});
ctx.on('response', async (res) => {
  const e = res.request().__e; if (!e) return; e.status = res.status();
  try { if (/json/.test(res.headers()['content-type'] || '')) { const j = await res.json(); const f = [];
    const walk = (o, p = '') => { for (const [k, v] of Object.entries(o || {})) { const q = p ? `${p}.${k}` : k; if (looksJwt(v)) f.push(q); else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, q); } };
    walk(j); if (f.length) e.respJwtFields = f; } } catch { /* */ }
});
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://app.gohighlevel.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
const dl = Date.now() + 75000; while (freshBearerAt === null && Date.now() < dl) await new Promise((r) => setTimeout(r, 1000));
await new Promise((r) => setTimeout(r, 4000));
const url = page.url();
const after = await ctx.cookies();
await ctx.close();

console.log(`\n=== calls from cold boot until the first FRESH bearer (${freshBearerAt === null ? 'NEVER' : `#${freshBearerAt}`}) ===`);
const cut = freshBearerAt === null ? log.length : freshBearerAt + 1;
for (const e of log.slice(0, cut)) {
  console.log(`  #${String(e.i).padStart(2)} ${e.method.padEnd(4)} ${String(e.status ?? '...').padEnd(3)} ${e.host}${e.path}${e.query.length ? '?' + e.query.join('&') : ''}`);
  const n = [];
  if (e.bearerState) n.push(`Bearer=${e.bearerState}`);
  if (e.carriesRefresh) n.push('*** CARRIES THE REFRESH TOKEN ***');
  if (e.cookieNames.length) n.push(`cookies: ${e.cookieNames.join(',')}`);
  if (e.hdrNames.length) n.push(`hdrs: ${e.hdrNames.join(',')}`);
  if (e.bodyKeys) n.push(`body: ${e.bodyKeys.join(',')}`);
  if (e.respJwtFields) n.push(`RESP JWTs: ${e.respJwtFields.join(',')}`);
  if (n.length) console.log(`        ${n.join(' | ')}`);
}
const acc = after.find((c) => c.name === 'access-token-v2');
console.log(`\nfinal url: ${url}`);
console.log(`access-token-v2 after boot: ${acc ? (dec(acc.value)?.exp * 1000 > Date.now() ? `FRESH (exp=${hrs(dec(acc.value).exp)}h) — the app re-issued it` : 'still the expired one') : 'GONE (app wiped it)'}`);
const ok = freshBearerAt !== null && !/login|signin/i.test(url);
if (!ok) {
  const r = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });
  await r.clearCookies(); await r.addCookies(JSON.parse(readFileSync(SNAP, 'utf8'))); await r.close();
  console.log('\nno self-heal -> RESTORED from disk snapshot.');
} else console.log('\nSELF-HEALED: the exchange is the call marked *** above.');
console.log(`snapshot left at ${SNAP}`);
