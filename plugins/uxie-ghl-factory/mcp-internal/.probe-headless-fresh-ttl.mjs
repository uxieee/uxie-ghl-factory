#!/usr/bin/env node
// PROBE 3 (2026-08-31) — the question Probe 1 raised, and the one that decides the whole phase:
// does a HEADLESS boot MINT A FRESH JWT, or does it only replay a cached one that is already
// dying? Probe 1 observed ttl=8min. If ~8min is the ceiling, "renewal" buys 8 minutes and the
// proactive-refresh design is worthless; if the app mints ~60min on boot, the phase is viable.
//
// Method: watch every Bearer on the two API hosts across a cold boot, then a reload, and record
// each DISTINCT token by its `jti` with its TTL and issue time. Distinct jti = a genuinely new
// token, not a replay. Token VALUES are never printed or stored — only jti/ttl/iat.
//
// Also re-checks profile integrity after Probe 2 ran two contexts over the same directory.
// Left in place deliberately (never-delete rule); untracked, never staged.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROFILE_DIR = join(homedir(), '.uxie-ghl-internal-mcp', 'pw-profile');
const HOSTS = new Set(['backend.leadconnectorhq.com', 'services.leadconnectorhq.com']);

const asApi = (m) => (m?.chromium ? m : m?.default);
async function loadPlaywright() {
  const tryPaths = [];
  const npxRoot = join(homedir(), '.npm', '_npx');
  if (existsSync(npxRoot)) {
    for (const d of readdirSync(npxRoot)) {
      const p = join(npxRoot, d, 'node_modules', 'playwright');
      if (existsSync(join(p, 'package.json'))) tryPaths.push(p);
    }
  }
  const cands = [];
  try { cands.push(asApi(await import('playwright'))); } catch { /* not here */ }
  for (const p of tryPaths) {
    try { cands.push(asApi(await import(pathToFileURL(join(p, 'index.js')).href))); } catch { /* next */ }
  }
  for (const api of cands) {
    let e; try { e = api?.chromium?.executablePath(); } catch { continue; }
    if (e && existsSync(e)) return api;
  }
  throw new Error('no usable playwright');
}

const looksJwt = (v) => typeof v === 'string' && v.split('.').length === 3 && v.length > 80;
const decode = (jwt) => {
  try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()); } catch { return null; }
};

// Profile integrity after Probe 2's concurrent access.
const cookiesDb = join(PROFILE_DIR, 'Default', 'Cookies');
console.log(`profile Cookies db: ${existsSync(cookiesDb) ? `present, ${statSync(cookiesDb).size} bytes` : 'MISSING — probe 2 may have corrupted the profile'}`);

const { chromium } = await loadPlaywright();
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: true, viewport: { width: 1440, height: 900 },
});

// jti -> {ttlMin, iat, host, count}. Distinct jti is the signal: a NEW token, not a replay.
const seen = new Map();
ctx.on('request', (req) => {
  let h; try { h = new URL(req.url()).host; } catch { return; }
  if (!HOSTS.has(h)) return;
  const raw = (req.headers().authorization || '').replace(/^Bearer\s+/i, '');
  if (!looksJwt(raw)) return;
  const c = decode(raw);
  if (!c) return;
  const key = c.jti ?? `nojti:${c.iat}`;
  if (seen.has(key)) { seen.get(key).count++; return; }
  seen.set(key, {
    ttlMin: Math.round((c.exp - Date.now() / 1000) / 60),
    lifetimeMin: c.iat ? Math.round((c.exp - c.iat) / 60) : null,
    ageMin: c.iat ? Math.round((Date.now() / 1000 - c.iat) / 60) : null,
    host: h, count: 1,
  });
});

const report = (label) => {
  console.log(`\n--- ${label} — ${seen.size} distinct token(s) ---`);
  for (const [k, v] of seen) {
    console.log(`  jti ${String(k).slice(0, 8)}…  ttl_remaining=${v.ttlMin}min  full_lifetime=${v.lifetimeMin}min  age=${v.ageMin}min  seen=${v.count}x  (${v.host})`);
  }
};

const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://app.gohighlevel.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log(`nav: ${String(e).split('\n')[0]}`));
await new Promise((r) => setTimeout(r, 40000));
report('after cold boot + 40s');

await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await new Promise((r) => setTimeout(r, 40000));
report('after reload + 40s');

const lifetimes = [...seen.values()].map((v) => v.lifetimeMin).filter((n) => n !== null);
const maxRemaining = Math.max(...[...seen.values()].map((v) => v.ttlMin));
console.log('\n=== VERDICT ===');
console.log(`distinct tokens minted this session: ${seen.size}`);
console.log(`full lifetime of issued tokens: ${lifetimes.length ? `${Math.min(...lifetimes)}–${Math.max(...lifetimes)}min` : 'unknown (no iat)'}`);
console.log(`best remaining TTL captured: ${maxRemaining}min`);
console.log(maxRemaining >= 30
  ? 'VIABLE — headless obtains a token with real headroom; proactive refresh is worth building.'
  : 'PROBLEM — headless only replays a short-lived token; renewal would buy minutes, not an hour.');

await ctx.close();
