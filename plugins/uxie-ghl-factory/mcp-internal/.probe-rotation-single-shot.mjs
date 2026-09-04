#!/usr/bin/env node
// PROBE 15 (2026-08-31) — THE decisive test for the renewal phase, run safely.
//
// Question: does ONE refresh (what production would do) rotate GHL's session credential and break
// the browser profile? ~14 hammering calls did break it earlier; a single well-spaced call is a
// different case and is the only one that matters for the design.
//
// SAFETY — fixes probe 5's flaw. Probe 5 snapshotted cookies IN MEMORY, so when the process
// exited the rollback was gone and the session could not be restored. This one writes the
// snapshot to DISK (0600, inside gitignored .ghl/) BEFORE touching anything, so a broken session
// is recoverable without a human re-login.
//
// Sequence: snapshot -> verify session healthy -> ONE refresh -> re-boot browser -> verify again.
// Restores from disk if the session broke. Token/cookie values are never printed.
import { existsSync, readdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROFILE_DIR = join(homedir(), '.uxie-ghl-internal-mcp', 'pw-profile');
const SNAP = '/Volumes/Xander SSD/Vibe Code/Misc/.ghl/.cookie-snapshot-probe15.json';
const REFRESH = 'https://backend.leadconnectorhq.com/oauth/2/login/current';
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
const H = (t) => ({ authorization: `Bearer ${t}`, channel: 'APP', source: 'WEB_USER', version: '2021-07-28', accept: 'application/json, text/plain, */*' });
const { chromium } = await loadPlaywright();

// One boot = one health check. Returns {ok, bearerSeen, authCookies[]} and optionally the bearer.
async function boot(label, grabToken = false) {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1440, height: 900 } });
  let tok = null;
  ctx.on('request', (r) => { if (tok) return; const raw = (r.headers().authorization || '').replace(/^Bearer\s+/i, ''); if (looksJwt(raw)) tok = raw; });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.goto('https://app.gohighlevel.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const dl = Date.now() + 70000; while (!tok && Date.now() < dl) await new Promise((r) => setTimeout(r, 1000));
  const cookies = await ctx.cookies();
  const auth = cookies.filter((c) => /token/i.test(c.name)).map((c) => c.name);
  const url = page.url();
  await ctx.close();
  console.log(`  [${label}] bearer=${tok ? 'YES' : 'NO'}  authCookies=${auth.length}  url=${url.slice(0, 60)}`);
  return { ok: Boolean(tok), auth, cookies, tok: grabToken ? tok : null };
}

console.log('=== STEP 1: snapshot cookies to DISK (the rollback probe 5 lacked) ===');
const ctx0 = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });
const snapshot = await ctx0.cookies();
await ctx0.close();
writeFileSync(SNAP, JSON.stringify(snapshot), { mode: 0o600 });
chmodSync(SNAP, 0o600);
console.log(`  wrote ${snapshot.length} cookies -> ${SNAP} (0600, gitignored). Values not printed.`);

console.log('\n=== STEP 2: baseline health ===');
const before = await boot('before', true);
if (!before.ok) { console.log('\nsession already unhealthy — aborting WITHOUT any refresh. Nothing changed.'); process.exit(0); }

console.log('\n=== STEP 3: exactly ONE refresh (what production would do) ===');
const r = await fetch(REFRESH, { headers: H(before.tok) });
console.log(`  HTTP ${r.status}`);
const body = await r.json().catch(() => null);
if (body) {
  const at = body.authToken;
  const c = at ? JSON.parse(Buffer.from(at.split('.')[1], 'base64url').toString()) : null;
  console.log(`  minted authToken: ttl=${c ? Math.round((c.exp - Date.now() / 1000) / 60) : '?'}min  (companyId present: ${!!body.companyId})`);
}

console.log('\n=== STEP 4: did the browser session survive that ONE call? ===');
await new Promise((r) => setTimeout(r, 3000));
const after = await boot('after');

console.log('\n=== VERDICT ===');
if (after.ok && after.auth.length >= before.auth.length - 1) {
  console.log('>>> SURVIVED. One well-spaced refresh does NOT break the session.');
  console.log('    In-session proactive renewal is SAFE to build. The earlier logout came from');
  console.log('    hammering the endpoint ~14x, not from a single production-shaped refresh.');
  console.log(`    (auth cookies ${before.auth.length} -> ${after.auth.length})`);
} else {
  console.log('>>> BROKE. Even ONE refresh rotates the session credential.');
  console.log('    Auto-renewal as designed would trade a year-long login for a per-cycle one.');
  console.log('    Restoring from the disk snapshot now...');
  const ctx2 = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });
  await ctx2.clearCookies();
  await ctx2.addCookies(JSON.parse(readFileSync(SNAP, 'utf8')));
  await ctx2.close();
  const restored = await boot('after-restore');
  console.log(restored.ok ? '    RESTORED — no re-login needed.' : '    restore did NOT recover it; a re-login is required. Snapshot kept at the path above.');
}
console.log(`\nsnapshot left in place at ${SNAP} (never deleted).`);
