#!/usr/bin/env node
// PROBE 6B (2026-08-31) — the decisive test. Probe 6A found the app itself calls
//   GET backend.leadconnectorhq.com/oauth/2/login/current
// and that its response carries a JWT with a FULL 60min lifetime, while the token in active use
// had only 54min left. If calling it MID-LIFE returns a token with a NEW jti and a fresh 60min,
// then an early mint IS forceable and Probe 5's "renewal must be reactive" conclusion is wrong.
//
// This replays a GET the app performs on every boot — read-only, no mutation. It is called twice,
// 20s apart, to distinguish "mints a new token each call" from "returns the same cached one".
// Token VALUES are never printed: only jti prefix, ttl, lifetime, age.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROFILE_DIR = join(homedir(), '.uxie-ghl-internal-mcp', 'pw-profile');
const ENDPOINT = 'https://backend.leadconnectorhq.com/oauth/2/login/current';

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
const decode = (j) => { try { return JSON.parse(Buffer.from(j.split('.')[1], 'base64url').toString()); } catch { return null; } };
const stat = (jwt, label) => {
  const c = decode(jwt);
  if (!c) return { label, err: 'undecodable' };
  return {
    label,
    jti: String(c.jti ?? '').slice(0, 8),
    ttlMin: Math.round((c.exp - Date.now() / 1000) / 60),
    lifetimeMin: c.iat ? Math.round((c.exp - c.iat) / 60) : null,
    ageSec: c.iat ? Math.round(Date.now() / 1000 - c.iat) : null,
  };
};
const show = (s) => console.log(`  ${s.label}: jti ${s.jti}…  ttl=${s.ttlMin}min  lifetime=${s.lifetimeMin}min  age=${s.ageSec}s`);

const { chromium } = await loadPlaywright();
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1440, height: 900 } });

let inPlay = null;
ctx.on('request', (req) => {
  if (inPlay) return;
  const raw = (req.headers().authorization || '').replace(/^Bearer\s+/i, '');
  if (looksJwt(raw)) inPlay = stat(raw, 'in-play bearer');
});

const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://app.gohighlevel.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 20000));

console.log('=== token the app is actively using ===');
if (inPlay) show(inPlay); else console.log('  none observed');

// Replay the endpoint from page context so cookies + origin are exactly the app's own.
const call = async (label) => {
  const raw = await page.evaluate(async (url) => {
    try {
      const r = await fetch(url, { credentials: 'include', headers: { accept: 'application/json' } });
      const t = await r.text();
      return { status: r.status, body: t };
    } catch (e) { return { status: -1, body: String(e) }; }
  }, ENDPOINT);
  if (raw.status !== 200) { console.log(`  ${label}: HTTP ${raw.status}`); return null; }
  const m = raw.body.match(/ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
  if (!m) { console.log(`  ${label}: 200 but no JWT in body`); return null; }
  const s = stat(m[0], label);
  show(s);
  return s;
};

console.log('\n=== calling GET /oauth/2/login/current (read-only; the app calls it every boot) ===');
const first = await call('call #1');
await new Promise((r) => setTimeout(r, 20000));
const second = await call('call #2, 20s later');

console.log('\n=== VERDICT ===');
if (!first) {
  console.log('endpoint did not return a token — no forced mint available here.');
} else {
  const newVsInPlay = inPlay && first.jti !== inPlay.jti;
  const mintsEachCall = second && second.jti !== first.jti;
  console.log(`returns a token distinct from the one in active use: ${newVsInPlay ? 'YES' : 'NO'}`);
  console.log(`mints a NEW token on every call: ${mintsEachCall ? 'YES' : 'NO (same jti returned twice)'}`);
  console.log(`freshness of returned token: ttl=${first.ttlMin}min of a ${first.lifetimeMin}min lifetime, age=${first.ageSec}s`);
  if (first.ttlMin >= 45 && first.ageSec !== null && first.ageSec < 120) {
    console.log('\n>>> FORCED EARLY MINT WORKS. Proactive refresh IS buildable:');
    console.log('    GET /oauth/2/login/current mid-life yields a freshly-issued ~60min token.');
    console.log('    This REVERSES probe 5\'s conclusion — renewal need not wait for expiry.');
  } else if (newVsInPlay && first.ttlMin >= 45) {
    console.log('\n>>> Returns a fresh-ish token but not newly issued — treat as cached; verify age.');
  } else {
    console.log('\n>>> No early mint: the endpoint echoes the existing token. Reactive renewal stands.');
  }
}
await ctx.close();
