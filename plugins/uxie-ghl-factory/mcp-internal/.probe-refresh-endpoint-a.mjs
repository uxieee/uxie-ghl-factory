#!/usr/bin/env node
// PROBE 6A (2026-08-31) — OBSERVE ONLY. Probe 5 showed cookie-clearing forces no mint. The
// remaining question: does the app have its own refresh/token endpoint that WOULD mint one?
//
// This step calls nothing. It boots headless and records every auth-shaped request the app makes
// itself — method, host, path, status, and whether the RESPONSE body contains a JWT. Query strings
// are redacted (they can carry credentials). Token values are never printed.
//
// Step B (a separate script) will replay only what this finds, and only endpoints whose shape is
// unambiguously a token/refresh call.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROFILE_DIR = join(homedir(), '.uxie-ghl-internal-mcp', 'pw-profile');
const AUTHISH = /auth|token|oauth|refresh|session|login|jwt|credential/i;

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
const jwtStats = (txt) => {
  // Report only STATS about any JWT found in a body — never the token itself.
  const m = txt.match(/ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
  if (!m) return null;
  const c = decode(m[0]);
  if (!c) return { ttlMin: null, lifetimeMin: null };
  return {
    ttlMin: Math.round((c.exp - Date.now() / 1000) / 60),
    lifetimeMin: c.iat ? Math.round((c.exp - c.iat) / 60) : null,
    jti: String(c.jti ?? '').slice(0, 8),
  };
};

const { chromium } = await loadPlaywright();
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1440, height: 900 } });

const hits = [];               // auth-shaped requests the app made
const bearerJtis = new Map();  // jti -> ttl, to know which token is in play

ctx.on('request', (req) => {
  const raw = (req.headers().authorization || '').replace(/^Bearer\s+/i, '');
  if (looksJwt(raw)) {
    const c = decode(raw);
    if (c) {
      const k = String(c.jti ?? c.iat).slice(0, 8);
      if (!bearerJtis.has(k)) bearerJtis.set(k, Math.round((c.exp - Date.now() / 1000) / 60));
    }
  }
});

ctx.on('response', async (res) => {
  let u; try { u = new URL(res.url()); } catch { return; }
  const pathOnly = u.pathname;
  if (!AUTHISH.test(pathOnly)) return;
  const req = res.request();
  let bodyStat = null;
  try {
    const ct = (res.headers()['content-type'] || '');
    if (/json|text/.test(ct)) {
      const txt = await res.text();
      bodyStat = jwtStats(txt);
      if (!bodyStat && txt.length < 300) bodyStat = { note: 'no jwt in body' };
    }
  } catch { /* body unavailable */ }
  hits.push({
    method: req.method(),
    host: u.host,
    path: pathOnly,
    hadQuery: u.search.length > 0,
    status: res.status(),
    jwtInBody: bodyStat,
  });
});

const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://app.gohighlevel.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 45000));

console.log('=== bearer tokens in play (jti -> ttl remaining) ===');
for (const [k, v] of bearerJtis) console.log(`  ${k}…  ttl=${v}min`);

console.log(`\n=== auth-shaped requests the app made itself (${hits.length}) ===`);
if (!hits.length) console.log('  none — the app made no auth-shaped call during this boot');
const seenKey = new Set();
for (const h of hits) {
  const key = `${h.method} ${h.host}${h.path}`;
  if (seenKey.has(key)) continue;
  seenKey.add(key);
  const jwt = h.jwtInBody?.ttlMin != null
    ? `RESPONSE CARRIES A JWT: jti ${h.jwtInBody.jti}… ttl=${h.jwtInBody.ttlMin}min lifetime=${h.jwtInBody.lifetimeMin}min`
    : (h.jwtInBody?.note ?? '(body not inspected)');
  console.log(`  ${h.method.padEnd(5)} ${h.status}  ${h.host}${h.path}${h.hadQuery ? ' [+query redacted]' : ''}`);
  console.log(`         ${jwt}`);
}

console.log('\n=== candidates worth replaying in step B ===');
const cands = [...seenKey].filter((k) => /token|refresh|oauth/i.test(k));
console.log(cands.length ? cands.map((c) => '  ' + c).join('\n') : '  none found');
await ctx.close();
