#!/usr/bin/env node
// OUT-OF-BAND token capture for the internal rail.
//
// WHY THIS EXISTS
// ---------------
// The old /connect flow had the AGENT drive a browser, read the Authorization header out of a
// captured request, and write the token file. That works, but it drags a live JWT through the
// model's context and into the session transcript — the one place a credential should never go.
//
// It is also not merely a discipline problem. The workflow token is NEVER PERSISTED: the parent
// app obtains a token scoped to the builder's iframe origin and hands it over in memory via
// postMessage. There is nothing in localStorage, sessionStorage or cookies on that origin to
// read (verified 2026-08-25). The only place the token exists is on the wire — so the capture
// has to happen inside a process that can watch the wire, and that process should not be the
// agent.
//
// So: this script owns the whole capture. It watches requests, writes the file at mode 0600,
// and prints ONLY claim NAMES, a TTL and which origin the token came from. No value it handles
// is ever printed, logged, or returned. The agent runs it and reads the summary.
//
// THE SCOPING RULE (docs/auth-jwt-capture.md §2)
// ---------------------------------------------
// A Bearer captured from a request whose referer is https://app.gohighlevel.com/ is UNSCOPED and
// returns 401 on every workflow endpoint. Only a token sent by the builder iframe origin
// (client-app-automation-workflows.leadconnectorhq.com) is usable. This script therefore refuses
// to accept a Bearer from any other origin rather than writing one that will fail later, opaquely.
//
//   node scripts/capture-token.mjs --account "GROM Digital AU"
//   node scripts/capture-token.mjs                 # no auto-drive; you navigate, it watches
//   node scripts/capture-token.mjs --timeout 300   # seconds to wait (default 240)
import { writeFileSync, chmodSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const HOME_DIR = join(homedir(), '.uxie-ghl-internal-mcp');
const TOKEN_FILE = process.env.GHL_TOK_FILE || join(HOME_DIR, 'tok.txt');
const PROFILE_DIR = join(HOME_DIR, 'pw-profile');

const APP = 'https://app.gohighlevel.com';
// The builder iframe. A Bearer is only accepted when the request came from here.
const BUILDER_ORIGIN = 'https://client-app-automation-workflows.leadconnectorhq.com';
const BACKEND = 'backend.leadconnectorhq.com';
const AI_HOST = 'services.leadconnectorhq.com';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const account = flag('--account');
const timeoutMs = Number(flag('--timeout', '240')) * 1000;

// ── resolving playwright ────────────────────────────────────────────────────────────────
// Not a declared dependency: pulling it in would add browser downloads to every install of a
// plugin whose main job has nothing to do with browsers. It is almost always already present
// (the Playwright MCP, a global install, or an npx cache), so look in the usual places and
// give one exact remedy if it genuinely is not.
// Playwright's CJS entry reaches ESM importers with the API under `default`, not at the top
// level — `mod.chromium` is undefined while `mod.default.chromium` is the real object. Normalise
// once here so callers cannot trip over which shape they got.
const asApi = (mod) => (mod?.chromium ? mod : mod?.default);

// Resolution is NOT just "can I import it". Each playwright build pins one chromium revision,
// and a machine can easily hold several playwright copies (npx caches, a global install, an MCP
// server's own) while having browsers for only some of them. Importing the wrong one gets you all
// the way to launch before failing. So a candidate only counts if its browser is on disk.
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
  try { tryPaths.push(join(req.resolve('npm/package.json'), '..', '..', 'playwright')); } catch { /* ignore */ }

  const candidates = [];
  try { candidates.push(asApi(await import('playwright'))); } catch { /* not installed here */ }
  for (const p of tryPaths) {
    try { candidates.push(asApi(await import(pathToFileURL(join(p, 'index.js')).href))); } catch { /* next */ }
  }

  const missing = [];
  for (const api of candidates) {
    if (!api?.chromium) continue;
    let exe;
    try { exe = api.chromium.executablePath(); } catch { continue; }
    if (exe && existsSync(exe)) return api;
    if (exe) missing.push(exe.split('/ms-playwright/')[1]?.split('/')[0] ?? exe);
  }

  throw new Error(
    'no usable playwright found'
    + (missing.length ? ` — found ${missing.length} install(s), but their browsers are absent (${missing.join(', ')})` : '')
    + '.\nFix with:  npx -y playwright@1.62.1 install chromium'
    + '\nor point PLAYWRIGHT_PATH at a playwright package whose browser is installed.');
}

const claimNames = (jwt) => {
  const c = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
  return { keys: Object.keys(c).sort(), ttlMin: Math.round((c.exp - Date.now() / 1000) / 60),
           locations: Array.isArray(c.locations) ? c.locations.length : null,
           type: c.type ?? null, role: c.role ?? null };
};

const looksJwt = (v) => typeof v === 'string' && v.split('.').length === 3 && v.length > 80;

async function main() {
  const { chromium } = await loadPlaywright();
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
  });

  // These are the ONLY variables the token values ever live in, and neither is ever printed.
  let bearer = null;
  let tokenId = null;
  let bearerOrigin = null;

  ctx.on('request', (req) => {
    let host;
    try { host = new URL(req.url()).host; } catch { return; }
    if (host !== BACKEND && host !== AI_HOST) return;
    const h = req.headers();
    const auth = h.authorization || h.Authorization || '';
    const raw = auth.replace(/^Bearer\s+/i, '');
    const from = h.referer || h.origin || '';

    // Bearer: iframe-scoped only. An app.gohighlevel.com-scoped token 401s on every workflow
    // endpoint, so accepting one here would just move the failure somewhere harder to read.
    if (!bearer && looksJwt(raw) && from.startsWith(BUILDER_ORIGIN)) {
      bearer = raw;
      bearerOrigin = new URL(from).origin;
    }
    // token-id rides alongside the Bearer on the AI services. Take it from any request that
    // carries one; it is a separate credential with its own expiry.
    const tid = h['token-id'];
    if (!tokenId && looksJwt(tid)) tokenId = tid;
  });

  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.goto(APP, { waitUntil: 'domcontentloaded' });

  console.log('browser open. leave it open until this exits.');
  if (!account) {
    console.log('no --account given: open any sub-account, then Automation → a workflow.');
  }

  // Auto-drive when we were told which account. Deep links 404 (only `/` is served), so the
  // only way in is clicking through the SPA — the same path a person takes.
  if (account) {
    try {
      await page.locator('#location-switcher-sidbar-v2').click({ timeout: 60_000 });
      const search = page.getByPlaceholder(/search for a sub-account/i);
      await search.fill(account, { timeout: 15_000 });
      await page.getByText(account, { exact: true }).first().click({ timeout: 15_000 });
      await page.locator('a[href$="/automation/workflows"]').first().click({ timeout: 60_000 });
      console.log(`navigated to ${account} → Automation.`);
    } catch (e) {
      console.log(`auto-drive stopped (${e.message.split('\n')[0]}). finish by hand in the window.`);
    }
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !bearer) await page.waitForTimeout(500);

  if (!bearer) {
    console.error('NO TOKEN CAPTURED. The builder iframe never issued a request in time.');
    console.error('Open a sub-account → Automation → click into a workflow, then re-run.');
    await ctx.close();
    process.exit(1);
  }

  writeFileSync(TOKEN_FILE, tokenId ? `${bearer}\n${tokenId}\n` : `${bearer}\n`, { mode: 0o600 });
  chmodSync(TOKEN_FILE, 0o600);

  const b = claimNames(bearer);
  console.log(`\nWROTE ${TOKEN_FILE} (0600)`);
  console.log(`  bearer   origin=${bearerOrigin} ttl=${b.ttlMin}min claims=${b.keys.join(',')}`);
  if (tokenId) {
    const t = claimNames(tokenId);
    console.log(`  token-id ttl=${t.ttlMin}min type=${t.type} role=${t.role} locations=${t.locations}`);
  } else {
    console.log('  token-id NOT captured — AI-surface calls will need a second run that opens an AI screen.');
  }
  console.log('\nNo token value was printed, logged, or returned by this script.');
  await ctx.close();
}

main().catch((e) => { console.error(String(e.message)); process.exit(1); });
