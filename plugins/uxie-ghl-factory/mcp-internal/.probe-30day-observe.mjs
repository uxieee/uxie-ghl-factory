#!/usr/bin/env node
// PROBE 19 (2026-08-31) — learn the 30-day refresh contract by WATCHING the app do it.
//
// The app must exchange its long-lived refresh credential for a new access token whenever it
// boots with the access token dead. Probe 5 tried to force that and saw nothing, but probe 5
// RELOADED the same page, and sessionStorage (which mirrors the access token) survived a reload.
// This probe forces the real cold-start: delete only the short-lived access cookies, CLOSE the
// browser, boot a NEW process (empty sessionStorage), and record every call until a bearer is in
// use again. The exchange will be in that list, with its method, path, header NAMES and body KEYS.
//
// SAFETY: cookies snapshotted to DISK first (0600, gitignored .ghl/); restored if the session
// does not come back. refresh-token-v2 is never touched. No token or cookie value is printed.
import { existsSync, readdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROFILE_DIR = join(homedir(), '.uxie-ghl-internal-mcp', 'pw-profile');
const SNAP = '/Volumes/Xander SSD/Vibe Code/Misc/.ghl/.cookie-snapshot-probe19.json';
const KILL = new Set(['access-token-v1', 'access-token-v2']);
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
const { chromium } = await loadPlaywright();

// ---- 1. snapshot + inspect cookie lifetimes
const ctx0 = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });
const snapshot = await ctx0.cookies();
await ctx0.close();
writeFileSync(SNAP, JSON.stringify(snapshot), { mode: 0o600 }); chmodSync(SNAP, 0o600);
console.log(`snapshot: ${snapshot.length} cookies -> ${SNAP}`);
for (const c of snapshot.filter((c) => /token/i.test(c.name))) {
  const ttlH = c.expires > 0 ? ((c.expires * 1000 - Date.now()) / 3.6e6).toFixed(1) : 'session';
  const claims = looksJwt(c.value) ? dec(c.value) : null;
  console.log(`  cookie ${c.name.padEnd(22)} cookie-expires=${ttlH}h  jwt-exp=${claims?.exp ? ((claims.exp * 1000 - Date.now()) / 3.6e6).toFixed(1) + 'h' : 'n/a'}`);
}

// ---- 2. force the cold-start: drop the access cookies, keep refresh
const ctx1 = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });
await ctx1.clearCookies();
await ctx1.addCookies(snapshot.filter((c) => !KILL.has(c.name)));
await ctx1.close();
console.log(`\nremoved ${[...KILL].join(', ')}; browser CLOSED so sessionStorage is gone too`);

// ---- 3. fresh process, record everything until a bearer is in use
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1440, height: 900 } });
const log = [];
let firstBearerAt = null;
ctx.on('request', (req) => {
  let u; try { u = new URL(req.url()); } catch { return; }
  if (!/leadconnectorhq\.com|gohighlevel\.com|googleapis\.com/.test(u.host)) return;
  if (/\.(js|css|png|svg|woff2?|ico|jpg|gif)$/.test(u.pathname)) return;
  const h = req.headers();
  const hasBearer = /^Bearer\s+ey/i.test(h.authorization || '');
  const cookieNames = (h.cookie || '').split(';').map((s) => s.trim().split('=')[0]).filter((n) => /token/i.test(n));
  let bodyKeys = null;
  const pd = req.postData();
  if (pd) { try { bodyKeys = Object.keys(JSON.parse(pd)); } catch { bodyKeys = ['(non-json body)']; } }
  const entry = { i: log.length, method: req.method(), host: u.host, path: u.pathname, query: [...u.searchParams.keys()], hasBearer, cookieNames, hdrNames: Object.keys(h).filter((k) => /token|auth|channel|source|version/i.test(k)), bodyKeys, status: null, respJwtFields: null };
  log.push(entry);
  req.__entry = entry;
  if (hasBearer && firstBearerAt === null) firstBearerAt = entry.i;
});
ctx.on('response', async (res) => {
  const e = res.request().__entry; if (!e) return;
  e.status = res.status();
  try {
    const ct = res.headers()['content-type'] || '';
    if (/json/.test(ct)) {
      const j = await res.json();
      const fields = [];
      const walk = (o, pre = '') => { for (const [k, v] of Object.entries(o || {})) { const p = pre ? `${pre}.${k}` : k; if (looksJwt(v)) fields.push(p); else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p); } };
      walk(j);
      if (fields.length) e.respJwtFields = fields;
    }
  } catch { /* */ }
});
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://app.gohighlevel.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
const dl = Date.now() + 60000; while (firstBearerAt === null && Date.now() < dl) await new Promise((r) => setTimeout(r, 1000));
await new Promise((r) => setTimeout(r, 4000));
const url = page.url();
const after = (await ctx.cookies()).filter((c) => /token/i.test(c.name)).map((c) => c.name);
await ctx.close();

// ---- 4. report the sequence up to and including the first authenticated call
console.log(`\n=== calls from cold boot until the first Bearer (${firstBearerAt === null ? 'NEVER appeared' : `#${firstBearerAt}`}) ===`);
const cut = firstBearerAt === null ? log.length : firstBearerAt + 1;
for (const e of log.slice(0, cut)) {
  const q = e.query.length ? `?${e.query.join('&')}` : '';
  console.log(`  #${String(e.i).padStart(2)} ${e.method.padEnd(4)} ${String(e.status ?? '...').padEnd(3)} ${e.host}${e.path}${q}`);
  const notes = [];
  if (e.hasBearer) notes.push('sends Bearer');
  if (e.cookieNames.length) notes.push(`cookies: ${e.cookieNames.join(',')}`);
  if (e.hdrNames.length) notes.push(`hdrs: ${e.hdrNames.join(',')}`);
  if (e.bodyKeys) notes.push(`body keys: ${e.bodyKeys.join(',')}`);
  if (e.respJwtFields) notes.push(`RESPONSE JWTs: ${e.respJwtFields.join(',')}`);
  if (notes.length) console.log(`        ${notes.join(' | ')}`);
}
console.log(`\nfinal url: ${url}`);
console.log(`auth cookies after: ${after.join(', ') || '(none)'}`);
console.log(`access cookies re-issued by the app: ${after.filter((n) => KILL.has(n)).join(', ') || 'NO'}`);

// ---- 5. health + rollback
const loggedOut = /login|signin/i.test(url) || firstBearerAt === null;
if (loggedOut) {
  const ctxR = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });
  await ctxR.clearCookies(); await ctxR.addCookies(JSON.parse(readFileSync(SNAP, 'utf8'))); await ctxR.close();
  console.log('\nsession did NOT come back on its own -> RESTORED from the disk snapshot.');
} else {
  console.log('\nsession came back on its own: the app performed its refresh. The exchange is in the list above.');
}
console.log(`snapshot left at ${SNAP}`);
