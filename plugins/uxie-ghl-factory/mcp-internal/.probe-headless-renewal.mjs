#!/usr/bin/env node
// PROBE (2026-08-31) — headless-renewal prerequisites, phase before any spec.
// Left in place deliberately (never-delete rule); untracked, never staged.
//
// PROBE 1: does headless Chromium reach the logged-in GHL app from the existing
//          ~/.uxie-ghl-internal-mcp/pw-profile (year-long cookies, proven 2026-08-29), or does
//          Cloudflare/login block a headless fingerprint? Signal = a backend request carrying an
//          Authorization Bearer. The token VALUE lives only in local variables and is NEVER
//          printed — claims summary only (same discipline as scripts/capture-token.mjs).
// PROBE 2: profile locking — a second launchPersistentContext on the same dir while the first is
//          open: what error, how fast? Then open-after-close to confirm clean recovery.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const PROFILE_DIR = join(homedir(), '.uxie-ghl-internal-mcp', 'pw-profile');
const BACKEND = 'backend.leadconnectorhq.com';
const AI_HOST = 'services.leadconnectorhq.com';

// Same resolution rule as capture-token.mjs: a candidate only counts if its browser is on disk.
const asApi = (mod) => (mod?.chromium ? mod : mod?.default);
async function loadPlaywright() {
  const req = createRequire(import.meta.url);
  const tryPaths = [];
  if (process.env.PLAYWRIGHT_PATH) tryPaths.push(process.env.PLAYWRIGHT_PATH);
  const npxRoot = join(homedir(), '.npm', '_npx');
  if (existsSync(npxRoot)) {
    for (const d of readdirSync(npxRoot)) {
      const p = join(npxRoot, d, 'node_modules', 'playwright');
      if (existsSync(join(p, 'package.json'))) tryPaths.push(p);
    }
  }
  const candidates = [];
  try { candidates.push(asApi(await import('playwright'))); } catch { /* not here */ }
  for (const p of tryPaths) {
    try { candidates.push(asApi(await import(pathToFileURL(join(p, 'index.js')).href))); } catch { /* next */ }
  }
  for (const api of candidates) {
    if (!api?.chromium) continue;
    let exe; try { exe = api.chromium.executablePath(); } catch { continue; }
    if (exe && existsSync(exe)) return api;
  }
  throw new Error('no usable playwright found');
}

const claimSummary = (jwt) => {
  try {
    const c = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    return { keys: Object.keys(c).sort().join(','), ttlMin: Math.round((c.exp - Date.now() / 1000) / 60),
             type: c.type ?? null, role: c.role ?? null };
  } catch { return { keys: '(undecodable)', ttlMin: null }; }
};
const looksJwt = (v) => typeof v === 'string' && v.split('.').length === 3 && v.length > 80;

const { chromium } = await loadPlaywright();
console.log(`chromium: ${chromium.executablePath().split('/ms-playwright/')[1] ?? '(path elided)'}`);

// ---------- PROBE 1: headless boot ----------
console.log('\n=== PROBE 1: headless persistent-profile boot ===');
const t0 = Date.now();
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: true,
  viewport: { width: 1440, height: 900 },
});
console.log(`launched headless in ${Date.now() - t0}ms`);

let bearerSeen = null;   // claims summary only — the JWT itself is never stored beyond this scope
let tokenIdSeen = false;
let bearerHost = null;
ctx.on('request', (req) => {
  let host; try { host = new URL(req.url()).host; } catch { return; }
  if (host !== BACKEND && host !== AI_HOST) return;
  const h = req.headers();
  const raw = (h.authorization || '').replace(/^Bearer\s+/i, '');
  if (!bearerSeen && looksJwt(raw)) { bearerSeen = claimSummary(raw); bearerHost = host; }
  if (h['token-id']) tokenIdSeen = true;
});

const page = ctx.pages()[0] ?? await ctx.newPage();
let navErr = null;
try {
  await page.goto('https://app.gohighlevel.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
} catch (e) { navErr = String(e).split('\n')[0]; }

// Give the SPA time to boot and fire authed requests (or to bounce to login / a CF challenge).
const deadline = Date.now() + 45000;
while (!bearerSeen && Date.now() < deadline) await new Promise((r) => setTimeout(r, 1000));

const url = page.url();
const title = await page.title().catch(() => '(title unreadable)');
const body = await page.evaluate(() => document.body?.innerText?.slice(0, 400) ?? '').catch(() => '');
const cfMarkers = /challenge|just a moment|verify you are human|cf-chl/i.test(title + ' ' + body);

console.log(`nav error: ${navErr ?? 'none'}`);
console.log(`final url: ${url}`);
console.log(`title: ${title}`);
console.log(`cloudflare challenge markers: ${cfMarkers}`);
console.log(`login page: ${/login|signin|auth/i.test(url)}`);
console.log(`bearer observed: ${bearerSeen ? `YES on ${bearerHost} — claims [${bearerSeen.keys}] ttl=${bearerSeen.ttlMin}min type=${bearerSeen.type} role=${bearerSeen.role}` : 'NO'}`);
console.log(`token-id header observed: ${tokenIdSeen}`);

// ---------- PROBE 2: locking, contested ----------
console.log('\n=== PROBE 2: second launch on the SAME profile while first is open ===');
const t1 = Date.now();
try {
  const ctx2 = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, timeout: 20000 });
  console.log(`UNEXPECTED: second context launched cleanly in ${Date.now() - t1}ms (no singleton lock?)`);
  await ctx2.close();
} catch (e) {
  console.log(`second launch FAILED after ${Date.now() - t1}ms:`);
  console.log(`  ${String(e).split('\n').slice(0, 4).join('\n  ')}`);
}

await ctx.close();
console.log('\n=== PROBE 2b: open after clean close ===');
const t2 = Date.now();
try {
  const ctx3 = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, timeout: 30000 });
  console.log(`reopen after close: OK in ${Date.now() - t2}ms`);
  await ctx3.close();
} catch (e) {
  console.log(`reopen after close FAILED: ${String(e).split('\n')[0]}`);
}
console.log('\nprobe complete.');
