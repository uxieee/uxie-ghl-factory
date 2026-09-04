#!/usr/bin/env node
// PROBE 5 (2026-08-31) — the decisive one. Probes 3+4 together showed:
//   - a mid-life cached token is REPLAYED (age 54min, 6min left) across boot and reload;
//   - once it expires, a headless boot MINTS a fresh 60min token by itself.
// So reactive renewal works. The open question is whether a mint can be forced EARLY, which is
// what the sketched "proactive refresh at T-5min" design assumed. sessionStorage.accessToken is
// only a mirror (clearing it minted nothing), so the source is the cookie pair.
//
// Test: delete the ACCESS token cookies while KEEPING refresh-token-v2, reload, and see whether
// the app exchanges the refresh cookie for a fresh access token.
//
// REVERSIBLE BY DESIGN: every cookie is snapshotted in memory first and restored if the session
// does not survive. This profile is the internal rail's credential — it must not be left broken.
// Cookie and token VALUES are never printed. Left in place deliberately; untracked, never staged.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROFILE_DIR = join(homedir(), '.uxie-ghl-internal-mcp', 'pw-profile');
const HOSTS = new Set(['backend.leadconnectorhq.com', 'services.leadconnectorhq.com']);
// Delete the ACCESS half only. refresh-token-v2 is the year-long credential and is never touched.
const KILL = new Set(['access-token-v1', 'access-token-v2']);

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

const { chromium } = await loadPlaywright();
const ctx = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true, viewport: { width: 1440, height: 900 } });

const seen = new Map();
ctx.on('request', (req) => {
  let h; try { h = new URL(req.url()).host; } catch { return; }
  if (!HOSTS.has(h)) return;
  const raw = (req.headers().authorization || '').replace(/^Bearer\s+/i, '');
  if (!looksJwt(raw)) return;
  const c = decode(raw); if (!c) return;
  const k = c.jti ?? `nojti:${c.iat}`;
  if (!seen.has(k)) seen.set(k, {
    ttlMin: Math.round((c.exp - Date.now() / 1000) / 60),
    lifetimeMin: c.iat ? Math.round((c.exp - c.iat) / 60) : null,
    ageMin: c.iat ? Math.round((Date.now() / 1000 - c.iat) / 60) : null,
  });
});

// SNAPSHOT — the rollback path.
const snapshot = await ctx.cookies();
console.log(`snapshot: ${snapshot.length} cookies saved in memory (values never printed)`);

const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto('https://app.gohighlevel.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 25000));
const baseline = [...seen.entries()];
console.log(`baseline: ${baseline.map(([, v]) => `ttl=${v.ttlMin}min age=${v.ageMin}min`).join(' | ') || 'none'}`);
if (!baseline.length) { console.log('no baseline token — aborting without touching cookies'); await ctx.close(); process.exit(0); }
if (baseline[0][1].ttlMin < 15) {
  console.log(`baseline token already has only ${baseline[0][1].ttlMin}min left — a mint here would be`);
  console.log('the ordinary expiry path, not a FORCED early refresh. Re-run mid-life for a clean result.');
}

// --- clear the access half, keep refresh
const killed = snapshot.filter((c) => KILL.has(c.name)).map((c) => c.name);
const keep = snapshot.filter((c) => !KILL.has(c.name));
await ctx.clearCookies();
await ctx.addCookies(keep);
console.log(`\ncleared access cookies: ${killed.join(', ') || '(none found)'} — kept ${keep.length} incl. refresh-token-v2`);

const before = new Set(seen.keys());
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await new Promise((r) => setTimeout(r, 40000));

const fresh = [...seen.entries()].filter(([k]) => !before.has(k));
const url = page.url();
const loggedOut = /login|signin/i.test(url);
const now = await ctx.cookies();
const restored = now.filter((c) => KILL.has(c.name)).map((c) => c.name);

console.log(`\nnew tokens after clearing access cookies: ${fresh.length}`);
for (const [k, v] of fresh) console.log(`  jti ${String(k).slice(0, 8)}…  ttl=${v.ttlMin}min  lifetime=${v.lifetimeMin}min  age=${v.ageMin}min`);
console.log(`access cookies re-issued by the app: ${restored.join(', ') || '(none)'}`);
console.log(`final url: ${url}   logged out: ${loggedOut}`);

// --- ROLLBACK if the session broke
if (loggedOut || (!fresh.length && !restored.length)) {
  await ctx.clearCookies();
  await ctx.addCookies(snapshot);
  console.log('\nROLLED BACK to the cookie snapshot — session restored to its pre-probe state.');
} else {
  console.log('\nno rollback needed: the app re-established the session itself.');
}

const best = fresh.length ? Math.max(...fresh.map(([, v]) => v.ttlMin)) : -1;
console.log('\n=== VERDICT ===');
if (best >= 45) console.log(`FORCED MINT WORKS — dropping the access cookie yields a fresh ${best}min token. Proactive refresh IS buildable.`);
else if (fresh.length) console.log(`partial: a new token appeared with ${best}min.`);
else console.log('NO forced mint — the app kept serving the existing token. Renewal must be REACTIVE (on/after expiry), not proactive at T-5min.');

await ctx.close();
