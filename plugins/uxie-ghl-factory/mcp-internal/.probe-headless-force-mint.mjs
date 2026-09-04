#!/usr/bin/env node
// PROBE 4 (2026-08-31) — Probe 3 showed the app REPLAYS a cached JWT (age 54min of a 60min
// lifetime) across boot and reload, so a headless re-capture at T-5min would re-capture the same
// dying token. This probe answers: WHERE is it cached, and what forces a fresh mint?
//
// Step A: enumerate storage on app.gohighlevel.com holding a JWT — KEY NAMES ONLY, never values.
// Step B: clear only those JWT-bearing keys, reload, and see whether the app mints a NEW jti with
//         a full ~60min TTL. That is the mechanism a renewal design would have to use.
// Step C: confirm the session cookies survived, i.e. clearing the token cache does NOT log us out.
//
// Token values are never printed or stored. Left in place deliberately; untracked, never staged.
import { existsSync, readdirSync } from 'node:fs';
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

const { chromium } = await loadPlaywright();
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: true, viewport: { width: 1440, height: 900 },
});

const seen = new Map();
const watch = (req) => {
  let h; try { h = new URL(req.url()).host; } catch { return; }
  if (!HOSTS.has(h)) return;
  const raw = (req.headers().authorization || '').replace(/^Bearer\s+/i, '');
  if (!looksJwt(raw)) return;
  const c = decode(raw); if (!c) return;
  const key = c.jti ?? `nojti:${c.iat}`;
  if (!seen.has(key)) {
    seen.set(key, {
      ttlMin: Math.round((c.exp - Date.now() / 1000) / 60),
      lifetimeMin: c.iat ? Math.round((c.exp - c.iat) / 60) : null,
      ageMin: c.iat ? Math.round((Date.now() / 1000 - c.iat) / 60) : null,
      phase: globalThis.__phase ?? '?',
    });
  }
};
ctx.on('request', watch);

const page = ctx.pages()[0] ?? await ctx.newPage();
globalThis.__phase = 'baseline';
await page.goto('https://app.gohighlevel.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 25000));
console.log(`baseline tokens: ${[...seen.values()].map((v) => `ttl=${v.ttlMin}min age=${v.ageMin}min`).join(' | ') || 'none'}`);

// --- Step A: where is it cached? NAMES ONLY.
const storage = await page.evaluate(() => {
  const isJwtish = (v) => typeof v === 'string' && v.split('.').length === 3 && v.length > 80;
  const scan = (store, label) => {
    const out = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      let v = null; try { v = store.getItem(k); } catch { /* skip */ }
      if (isJwtish(v)) out.push({ store: label, key: k, kind: 'bare-jwt' });
      else if (typeof v === 'string' && v.length < 20000 && /ey[A-Za-z0-9_-]{20,}\./.test(v)) {
        out.push({ store: label, key: k, kind: 'jwt-inside-json' });
      }
    }
    return out;
  };
  return {
    hits: [...scan(localStorage, 'localStorage'), ...scan(sessionStorage, 'sessionStorage')],
    localCount: localStorage.length, sessionCount: sessionStorage.length,
  };
});
console.log(`\n=== Step A: JWT-bearing storage keys (names only) ===`);
console.log(`localStorage keys: ${storage.localCount}, sessionStorage keys: ${storage.sessionCount}`);
for (const h of storage.hits) console.log(`  ${h.store}: "${h.key}"  (${h.kind})`);
if (!storage.hits.length) console.log('  none — the token is held in memory or a cookie, not web storage');

const cookiesBefore = (await ctx.cookies()).filter((c) => /token/i.test(c.name)).map((c) => c.name);
console.log(`  auth-ish cookies present: ${cookiesBefore.join(', ') || '(none)'}`);

// --- Step B: clear ONLY the JWT-bearing keys, then reload.
const cleared = await page.evaluate((hits) => {
  let n = 0;
  for (const h of hits) {
    try { (h.store === 'localStorage' ? localStorage : sessionStorage).removeItem(h.key); n++; } catch { /* skip */ }
  }
  return n;
}, storage.hits);
console.log(`\n=== Step B: cleared ${cleared} cached-token key(s), reloading ===`);

const before = new Set(seen.keys());
globalThis.__phase = 'after-clear';
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await new Promise((r) => setTimeout(r, 40000));

const fresh = [...seen.entries()].filter(([k]) => !before.has(k));
console.log(`new distinct tokens after clearing: ${fresh.length}`);
for (const [k, v] of fresh) {
  console.log(`  jti ${String(k).slice(0, 8)}…  ttl_remaining=${v.ttlMin}min  full_lifetime=${v.lifetimeMin}min  age=${v.ageMin}min`);
}

// --- Step C: are we still logged in?
const url = page.url();
const cookiesAfter = (await ctx.cookies()).filter((c) => /token/i.test(c.name)).map((c) => c.name);
console.log(`\n=== Step C: session survived the clear? ===`);
console.log(`final url: ${url}`);
console.log(`login page: ${/login|signin/i.test(url)}`);
console.log(`auth-ish cookies still present: ${cookiesAfter.join(', ') || '(none)'}`);

const bestFresh = fresh.length ? Math.max(...fresh.map(([, v]) => v.ttlMin)) : -1;
console.log('\n=== VERDICT ===');
if (bestFresh >= 30) {
  console.log(`VIABLE — clearing the cached token forces a fresh mint (${bestFresh}min remaining).`);
  console.log('Renewal design: clear the cached token key(s), reload, capture the new Bearer.');
} else if (fresh.length) {
  console.log(`PARTIAL — a new token appeared but only ${bestFresh}min remaining.`);
} else {
  console.log('NO MINT — clearing web storage did not force a refresh; the cache is elsewhere');
  console.log('(in-memory across reload via a service worker, or a cookie). Next probe: expire-and-observe.');
}
await ctx.close();
