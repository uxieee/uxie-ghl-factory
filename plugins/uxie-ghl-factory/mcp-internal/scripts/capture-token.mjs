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
// WHICH REFERER MAY A BEARER COME FROM? Both — see acceptsBearerFrom below.
//
//   node scripts/capture-token.mjs --account "GROM Digital AU"
//   node scripts/capture-token.mjs                 # no auto-drive; you navigate, it watches
//   node scripts/capture-token.mjs --timeout 300   # seconds to wait (default 240)
import { writeFileSync, chmodSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve as resolvePath, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { DEFAULT_TOKEN_FILE } from '../core/auth.mjs';

const HOME_DIR = join(homedir(), '.uxie-ghl-internal-mcp');
// 0.43.0 hard-renamed GHL_TOK_FILE -> GHL_INTERNAL_TOK_FILE. Only the NEW name is read as a
// value; the OLD name's PRESENCE alone (never its value) is refused loudly — same discipline
// and wording as core/auth.mjs readCredentials, so the server and this script say the same
// thing. Without this, a shell still exporting the old name would have this capture write the
// shared default file while the caller believes it wrote their configured path.
if (Boolean(process.env.GHL_TOK_FILE) && !process.env.GHL_INTERNAL_TOK_FILE) {
  console.error('ABORTED (LEGACY_TOKEN_FILE_ENV): GHL_TOK_FILE is set but GHL_INTERNAL_TOK_FILE '
    + 'is not. GHL_TOK_FILE no longer does anything (renamed in 0.43.0), so this run would '
    + 'silently fall back to the shared default token file and could authenticate as the wrong '
    + 'account.\nRename the env var, then retry — same value, new name: '
    + 'export GHL_INTERNAL_TOK_FILE="<same path you had in GHL_TOK_FILE>"');
  process.exit(2);
}
// DEFAULT_TOKEN_FILE is the server's own fallback (core/auth.mjs) — capture must write where
// the server (and the skill scripts) read when no env var is set.
const TOKEN_FILE = process.env.GHL_INTERNAL_TOK_FILE || DEFAULT_TOKEN_FILE;
// Test seam: print the resolved token-file path and exit, so the suite can assert resolution
// (and that capture/edit agree) without launching a browser. Checked AFTER the legacy guard.
if (process.argv.includes('--print-token-file')) { console.log(TOKEN_FILE); process.exit(0); }

// ONE BROWSER PROFILE PER TOKEN FILE (0.50.0). Until 0.50.0 every capture, from every folder,
// opened the SAME Chrome profile (`~/.uxie-ghl-internal-mcp/pw-profile`). A Chrome profile holds
// a GHL session, so whichever agency was logged in last was the agency the next capture landed
// in — and the capture writes that credential into the CALLING folder's token file. The guard
// against acting on the wrong account was per folder; the login the guard was handed was
// machine-wide.
//
// MEASURED 2026-09-03: a chat in a client folder drove a browser to that client's sub-account and
// was redirected to a DIFFERENT client's agency launchpad, because the shared profile still held
// that other agency's session. Nothing in the config was wrong; the profile was.
//
// So the profile is now derived from the token file the capture is about to write. Same token
// file, same profile (the session persists, so you log in once per client and not again).
// Different token file, different profile, with no way for one client's session to answer for
// another. GHL_INTERNAL_PW_PROFILE overrides it for a one-off.
//
// THERE IS DELIBERATELY NO FALLBACK TO THE OLD SHARED PROFILE. Reusing it would seed every
// client's slot with whatever agency that profile was left in — precisely the bug. The cost is
// one login per client, once; the old profile is left on disk, untouched, and simply unused.
export function resolveProfileDir({ tokenFile, env = process.env, homeDir = HOME_DIR }) {
  const override = env?.GHL_INTERNAL_PW_PROFILE;
  if (typeof override === 'string' && override.trim()) return resolvePath(override.trim());

  // Resolve symlinks so two registrations pointing at ONE real token file share one profile
  // (they are one login). realpathSync throws when the file does not exist yet — the first
  // capture into a fresh folder — so fall back to resolving the directory, then the raw path.
  const abs = resolvePath(tokenFile);
  let real = abs;
  try { real = realpathSync(abs); }
  catch { try { real = join(realpathSync(dirname(abs)), basename(abs)); } catch { /* keep abs */ } }

  // A readable name so `ls` says which client a profile belongs to, plus a hash so two clients
  // whose folders share a basename can never collide. The token file normally sits at
  // <project>/.ghl/<file>, so the project folder is the grandparent; anything else uses its own
  // parent (the shared default token file yields "uxie-ghl-internal-mcp").
  const parent = dirname(real);
  const named = basename(parent) === '.ghl' ? basename(dirname(parent)) : basename(parent);
  const slug = named.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'profile';
  const hash = createHash('sha256').update(real).digest('hex').slice(0, 8);
  return join(homeDir, 'profiles', `${slug}-${hash}`);
}

const PROFILE_DIR = resolveProfileDir({ tokenFile: TOKEN_FILE });
// Test seam, and the answer to "which profile will this capture use?" without launching Chrome.
if (process.argv.includes('--print-profile-dir')) { console.log(PROFILE_DIR); process.exit(0); }

const APP = 'https://app.gohighlevel.com';
// The builder iframe. A Bearer is only accepted when the request came from here.
const BUILDER_ORIGIN = 'https://client-app-automation-workflows.leadconnectorhq.com';
const APP_ORIGIN = 'https://app.gohighlevel.com';

// WHICH REFERER MAY A BEARER COME FROM? Both. Settled live 2026-08-29 and recorded here because
// the two procedures used to say opposite things: this script insisted on the workflow iframe
// ("an app.gohighlevel.com-scoped token 401s on every workflow endpoint"), while
// commands/internal-connect.md insisted the referer "MUST be app.gohighlevel.com, NOT the
// workflow iframe". One of them had to be wrong.
//
// EVIDENCE: a Bearer captured from a credentialed request with `referer: https://app.gohighlevel.com/`
// (the AI-agents page) then drove, on the designated test sub-account: GET /workflow/{loc}/list,
// a full build (POST /workflow, PUT auto-save, 7x POST trigger), an edit PUT and its read-back —
// every one a 200. So an app-scoped token does NOT 401 on workflow endpoints.
//
// The iframe is preferred only for capture-to-capture determinism when both referers appear in one
// session. It is NOT a narrower scope: a differential on 2026-08-30 across 13 surfaces and all
// three credential rails found 0 behavioural differences, and the two tokens' claim sets are
// identical but for exp/iat/jti. Do not rebuild an account-navigation drive to "get the better
// token" -- there is only one token. This function is exported so the rule can be
// regression-tested without launching a browser — the reason the contradiction survived so long is
// that neither procedure had a test.
export function acceptsBearerFrom(referer) {
  // Compare the PARSED ORIGIN, never a string prefix: `startsWith(APP_ORIGIN)` also accepts
  // https://app.gohighlevel.com.evil.test/ — a domain-suffix match. Caught by this rule's own
  // first test, which is the whole argument for giving it one.
  let origin;
  try { origin = new URL(String(referer ?? '')).origin; } catch { return null; }
  if (origin === BUILDER_ORIGIN) return 'builder-iframe';
  if (origin === APP_ORIGIN) return 'app';
  return null;
}
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

// THE FILE FORMAT IS A CONTRACT WITH core/auth.mjs:69,72, and it went unhonoured because the write
// had no test. This script used to emit bare lines (`${bearer}\n${tokenId}\n`); readCredentials
// matches /Bearer\s+(ey…)/i and /token-id:\s*(…)/i, so every file this script ever wrote failed to
// parse while the script reported success. Exported as a pure function so the round trip can be
// tested without launching a browser -- the same reason acceptsBearerFrom is exported.
//
// An absent token-id omits the LINE. Writing `token-id: ` with an empty value would match the
// reader's regex group as empty and hand the AI rail a blank credential.
// 0.45.0: the formatter moved to core/token-renewal.mjs, which is the SECOND writer of this file
// (auto-renewal). One definition, re-exported here, so the two writers cannot drift apart.
import { formatTokenFile, fetchLoginCurrent, writeAgencyJsonIfAbsent } from '../core/token-renewal.mjs';
export { formatTokenFile };

const claimNames = (jwt) => {
  const c = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
  return { keys: Object.keys(c).sort(), ttlMin: Math.round((c.exp - Date.now() / 1000) / 60),
           locations: Array.isArray(c.locations) ? c.locations.length : null,
           type: c.type ?? null, role: c.role ?? null };
};

const looksJwt = (v) => typeof v === 'string' && v.split('.').length === 3 && v.length > 80;

async function main() {
  const { chromium } = await loadPlaywright();
  // Read BEFORE the launch: launchPersistentContext creates the directory, so afterwards every
  // profile looks pre-existing and the operator loses the one hint that a login is coming.
  const profileIsNew = !existsSync(PROFILE_DIR);
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
  });

  // These are the ONLY variables the token values ever live in, and neither is ever printed.
  let bearer = null;
  let bearerScope = null;
  let tokenId = null;
  let bearerOrigin = null;
  let firebaseKey = null;

  ctx.on('request', (req) => {
    let host, url;
    try { url = new URL(req.url()); host = url.host; } catch { return; }
    // The app signs into Firebase with its PUBLIC web key on the `key=` query of its own
    // identitytoolkit calls. Auto-renewal needs that key to mint a fresh token-id, and it is
    // GHL's value, not ours to ship — so it is captured here and written to the 0600 token file
    // like the other two credentials (0.45.1).
    if (host === 'identitytoolkit.googleapis.com' || host === 'securetoken.googleapis.com') {
      const k = url.searchParams.get('key');
      if (!firebaseKey && k && /^AIza[0-9A-Za-z_-]{35}$/.test(k)) firebaseKey = k;
      return;
    }
    if (host !== BACKEND && host !== AI_HOST) return;
    const h = req.headers();
    const auth = h.authorization || h.Authorization || '';
    const raw = auth.replace(/^Bearer\s+/i, '');
    const from = h.referer || h.origin || '';

    // Bearer: either referer is accepted (see acceptsBearerFrom), with the iframe preferred when
    // both appear in one session — an app-scoped token is upgraded, never downgraded.
    const scope = looksJwt(raw) ? acceptsBearerFrom(from) : null;
    if (scope && (!bearer || (scope === 'builder-iframe' && bearerScope !== 'builder-iframe'))) {
      bearer = raw;
      bearerOrigin = new URL(from).origin;
      bearerScope = scope;
    }
    // token-id rides alongside the Bearer on the AI services. Take it from any request that
    // carries one; it is a separate credential with its own expiry.
    const tid = h['token-id'];
    if (!tokenId && looksJwt(tid)) tokenId = tid;
  });

  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.goto(APP, { waitUntil: 'domcontentloaded' });

  // Say which profile, because "why is it already logged in as someone else?" is answered here
  // and nowhere else. A fresh directory means the login page — that is correct, not a fault.
  console.log(`browser open on profile ${PROFILE_DIR}${profileIsNew ? ' (new — expect the login page)' : ''}.`);
  console.log('leave it open until this exits.');
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

  // 0.46.0: one call on the captured bearer records the 30-DAY refresh token (so the server can
  // restart the chain after an idle without a browser) and the agency's companyId (which the
  // audit needs and no JWT carries). Best effort — a failure here still writes a working file.
  let refreshToken = null;
  try {
    const body = await fetchLoginCurrent({ jwt: bearer });
    refreshToken = body.refreshToken ?? null;
    if (typeof body.companyId === 'string') writeAgencyJsonIfAbsent({ tokenFile: TOKEN_FILE, companyId: body.companyId, source: 'capture' });
  } catch { /* recorded below as not captured; the hourly renewal will fill it in later */ }
  writeFileSync(TOKEN_FILE, formatTokenFile({ bearer, tokenId, firebaseKey, refreshToken }), { mode: 0o600 });
  chmodSync(TOKEN_FILE, 0o600);

  const b = claimNames(bearer);
  console.log(`\nWROTE ${TOKEN_FILE} (0600)`);
  console.log(`  bearer   origin=${bearerOrigin} ttl=${b.ttlMin}min claims=${b.keys.join(',')}`);
  if (tokenId) {
    const t = claimNames(tokenId);
    console.log(`  token-id ttl=${t.ttlMin}min type=${t.type} role=${t.role} locations=${t.locations}`);
    console.log(`  firebase-key ${firebaseKey ? 'recorded (token-id will auto-renew)' : 'NOT observed — token-id will not auto-renew until a capture sees it'}`);
    console.log(`  refresh-token ${refreshToken ? 'recorded (30-day: idle restarts need no browser)' : 'NOT recorded — the first hourly renewal will add it'}`);
  } else {
    console.log('  token-id NOT captured — AI-surface calls will need a second run that opens an AI screen.');
  }
  console.log('\nNo token value was printed, logged, or returned by this script.');
  await ctx.close();
}

// RUN ONLY WHEN EXECUTED, never on import. Without this guard, importing the module to test
// acceptsBearerFrom launches a browser and performs a real capture — which is exactly what
// happened the first time the rule was given a test, and is why the rule had none before.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((e) => { console.error(String(e.message)); process.exit(1); });
}
