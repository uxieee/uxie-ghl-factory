#!/usr/bin/env node
// run-live-proofs.mjs — execute the live conformance suites against the designated test
// sub-account and write a dated receipt.
//
// WHY THIS EXISTS, and why the other detectors cannot replace it
// Every drift detector we have answers "did GHL's front-end code change?". None of them can see the
// failure that costs the most: an endpoint that starts ignoring a field, or a 200 that stops
// meaning what it meant. Nothing bumps, no chunk rotates, no build number moves, and every offline
// test in this repo stays green — they run against fixtures, so they would all pass on the day GHL
// changed an endpoint's behaviour.
//
// On 2026-09-07 exactly that class turned up: `attach-offer-user` answers
// `200 {ok:true, msg:"…successfully queued"}` for an EMPTY body. It was found by accident, while
// looking at something else. This is the thing that would have found it on purpose.
//
// WHY IT CAN RUN UNATTENDED
// It reads the token FILE rather than a GHL_TOKEN env var, and the credential chain renews itself:
// a live bearer refreshes hourly, and a dead one restarts from a 30-day refresh token with no
// browser. So a job that runs at least monthly never needs a human — the only thing that forces a
// browser login is leaving it longer than 30 days.
//
//   node scripts/run-live-proofs.mjs --confirm
//   node scripts/run-live-proofs.mjs --dry-run          # what would run, and against what
//   node scripts/run-live-proofs.mjs --confirm --only memberships
//
// 🔴 THIS WRITES TO A LIVE ACCOUNT. It creates real objects and the suites tear their own down.
// Two guards, and neither is optional:
//   * the location comes from GHL_LIVE_PROOF_LOCATION and there is NO default. A default is how a
//     scheduled job eventually runs against a client.
//   * --confirm is required. A dry run performs no account call at all.
//
// 🔴 THE SANDBOX ID IS NOT IN THIS FILE, and must never be. This repo is public. The location is
// supplied by the environment and the receipt records only its last four characters, enough to tell
// two accounts apart in a log and not enough to be one.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const PLUGIN = join(REPO, 'plugins/uxie-ghl-factory');
const RECEIPTS = join(REPO, 'audits/live-proofs');   // audits/ is gitignored

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };

/**
 * The registry. One row per suite that EXECUTES against a live account and asserts EFFECTS rather
 * than status codes. A script that only checks for a 200 does not belong here — it would report
 * green on precisely the failure this exists to catch.
 *
 * `surfaces` is what a pass actually covers, and it is deliberately short: 10 of the 14 corpus
 * surfaces have no live proof at all, and pretending otherwise is worse than the gap.
 */
/** Every surface the corpus covers. The denominator for both coverage lists on a receipt. */
export const ALL_SURFACES = [
  'ai-agents', 'ai-studio', 'ask-ai', 'calendars', 'conversations', 'events', 'forms', 'funnels',
  'marketplace-apps', 'memberships-courses', 'platform', 'pipelines-opportunities', 'workflows',
];

export const PROOFS = [
  {
    name: 'memberships',
    surfaces: ['memberships-courses'],
    script: join(PLUGIN, 'skills/ghl-memberships/scripts/conformance.mjs'),
    creates: true,
    tearsDown: true,
    note: 'build → quiz+questions → assignment → grant → assert THIS contact enrolled → revoke → '
      + 'assert un-enrolled → credential issue → assert registry record → community group. Also '
      + 're-checks the documented traps, including attach-offer-user acking an empty body.',
  },
  {
    name: 'workflows',
    surfaces: ['workflows'],
    script: join(PLUGIN, 'skills/create-ghl-workflow/scripts/conformance.mjs'),
    creates: true,
    // FALSE, like funnels and unlike memberships: probe artefacts stay named and in place for a
    // human. Every workflow it creates is an unpublished draft with zero triggers, so a leftover
    // costs nothing but clutter — and a suite that deleted its evidence could not be audited.
    tearsDown: false,
    note: 'build a draft with two custom_code + one custom_webhook -> read back on a SEPARATE '
      + 'request -> assert stepIndex is per-type and 1-based and that meta.stepIndexCounter '
      + 'records native producers (the counter the BUILDER reads to number the next step). Then '
      + 'the refusals: an unrecognised node kind, and a trigger-filter condition smuggled onto a '
      + 'container through modifyStep\'s attrPatch — each asserted to leave the document '
      + 'UNCHANGED, because a guard that refuses after writing is not a guard. Stops short of '
      + 'publish, trigger activation and enrollment, which are outward-facing and are reported as '
      + 'not covered rather than skipped.',
  },
  {
    name: 'funnels',
    surfaces: ['funnels'],
    script: join(PLUGIN, 'skills/ghl-funnels-pages/scripts/conformance.mjs'),
    creates: true,
    // Deliberately FALSE, and not an oversight: this project's rule is that probe artefacts stay
    // named and in place, and this rail has no step-delete endpoint at all, so a suite that
    // claimed to tear down would be lying about half of what it made.
    tearsDown: false,
    note: 'funnel → step with a CLIENT-MINTED id → author a page → assert every section reads back '
      + 'on a separate request → publish → assert THAT version reads back live → write again and '
      + 'assert the tool WARNS the write is now invisible (publishing pins the public page) → '
      + 'assert get-versions is a bare array keyed snake_case version_id, newest first → run the '
      + 'read-only auditor and assert it reports COVERAGE, so a check that could not run is never '
      + 'counted as clean. Public-URL assertions are reported SKIPPED: they need a domain on a '
      + 'fresh funnel, which is outward-facing and not for an unattended run.',
  },
];

export function selectProofs(only) {
  if (!only) return PROOFS;
  const wanted = new Set(String(only).split(',').map((s) => s.trim()).filter(Boolean));
  const picked = PROOFS.filter((p) => wanted.has(p.name));
  const unknown = [...wanted].filter((w) => !PROOFS.some((p) => p.name === w));
  return unknown.length ? { error: `unknown proof(s): ${unknown.join(', ')}. Known: ${PROOFS.map((p) => p.name).join(', ')}` } : picked;
}

/** Last four characters only. Enough to tell two accounts apart in a log; not enough to be one. */
export const tail4 = (id) => (typeof id === 'string' && id.length >= 4 ? `…${id.slice(-4)}` : null);

/**
 * Parse a suite's own summary line rather than trusting its exit code alone. `conformance.mjs`
 * prints `N passed, M failed, K skipped`, and the SKIPS matter: they are the member-session writes
 * that cannot run unattended, and a receipt that silently folded them into "passed" would overstate
 * coverage every single month.
 */
export function parseSummary(stdout) {
  const m = /(\d+)\s+passed,\s*(\d+)\s+failed(?:,\s*(\d+)\s+skipped)?/i.exec(String(stdout ?? ''));
  if (!m) return null;
  return { passed: Number(m[1]), failed: Number(m[2]), skipped: m[3] === undefined ? null : Number(m[3]) };
}

/* c8 ignore start -- CLI shell; the exported logic above is what the tests drive */
// pathToFileURL, and the argv[1] guard: this repo's path contains a space, so `file://${argv[1]}`
// silently never matches, and with no argv[1] at all pathToFileURL(undefined) throws.
const invokedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (invokedDirectly) {
  const die = (m, hint) => { console.error(`run-live-proofs: ${m}`); if (hint) console.error(`  ${hint}`); process.exit(1); };

  const selected = selectProofs(val('--only', null));
  if (selected.error) die(selected.error);

  const location = process.env.GHL_LIVE_PROOF_LOCATION;
  if (!location) {
    die('GHL_LIVE_PROOF_LOCATION is not set, and there is deliberately no default.',
      'Set it to the DESIGNATED TEST SUB-ACCOUNT. A default here is how a scheduled job eventually runs against a client.');
  }

  const tokenFile = process.env.GHL_INTERNAL_TOK_FILE
    ?? join(homedir(), '.uxie-ghl-internal-mcp', 'tok.txt');

  if (flag('--dry-run')) {
    console.log(`would run ${selected.length} live proof(s) against location ${tail4(location)}`);
    console.log(`  token file: ${tokenFile}${existsSync(tokenFile) ? '' : '   ← MISSING'}`);
    for (const p of selected) {
      console.log(`\n  ${p.name}  (${p.surfaces.join(', ')})`);
      console.log(`    ${p.script.replace(`${REPO}/`, '')}`);
      console.log(`    creates objects: ${p.creates ? 'YES' : 'no'} · tears down: ${p.tearsDown ? 'yes' : 'NO — leaves artifacts in place'}`);
    }
    console.log('\nNo account call was made. Add --confirm to run.');
    process.exit(0);
  }

  if (!flag('--confirm')) {
    die('refusing to write to a live account without --confirm.',
      'Run with --dry-run first to see what would execute.');
  }

  // ── credentials ────────────────────────────────────────────────────────────────────────────
  // Read, and renew if the chain says so, using the SAME code path the MCP server uses rather than
  // a second implementation that could drift from it.
  const { readCredentials } = await import(pathToFileURL(join(PLUGIN, 'mcp-internal/core/auth.mjs')).href);
  const { makeRenewer } = await import(pathToFileURL(join(PLUGIN, 'mcp-internal/core/token-renewal.mjs')).href);

  let creds;
  try { creds = readCredentials({ tokenFile, allowExpired: true }); }
  catch (e) { die(`${e.code ?? 'AUTH'}: ${e.message}`, e.remediation); }

  const renewer = makeRenewer({ getTokenFile: () => tokenFile });
  const renewal = await renewer.maybeRenew(creds);
  if (renewal.renewed) {
    creds = readCredentials({ tokenFile, allowExpired: false });
    console.log(`[auth] ${renewal.coldStart ? 'cold start from the 30-day token' : 'renewed'}; ${Math.round(creds.secondsRemaining / 60)} min on the bearer`);
  } else if (creds.secondsRemaining <= 0) {
    die(`the bearer is expired and could not be renewed (${renewal.reason}).`,
      'If the reason is no-refresh-token the file predates 0.46.0; invoke uxie-ghl-factory:internal-connect once.');
  } else {
    console.log(`[auth] ${Math.round(creds.secondsRemaining / 60)} min on the bearer, no renewal needed`);
  }

  // ── run ────────────────────────────────────────────────────────────────────────────────────
  const startedAt = new Date().toISOString();
  const results = [];
  for (const p of selected) {
    if (!existsSync(p.script)) { results.push({ name: p.name, ok: false, error: 'script missing' }); continue; }
    console.log(`\n── ${p.name} ${'─'.repeat(Math.max(0, 60 - p.name.length))}`);
    const t0 = Date.now();
    const r = spawnSync('node', [p.script], {
      cwd: dirname(p.script),
      env: { ...process.env, GHL_TOKEN: creds.jwt, GHL_LOCATION: location },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    process.stdout.write(out);
    const summary = parseSummary(out);
    results.push({
      name: p.name,
      surfaces: p.surfaces,
      ok: r.status === 0,
      exitCode: r.status,
      durationMs: Date.now() - t0,
      // The suite's own count beats the exit code: a run that exits 0 having skipped everything is
      // not a run that proved anything.
      ...(summary ? { summary } : { summary: null, note: 'the suite printed no parseable summary line — treat this pass as unverified' }),
    });
  }

  // ── receipt ────────────────────────────────────────────────────────────────────────────────
  // Into audits/, which is gitignored: this repo is public and a receipt naming a live account is
  // the kind of thing that leaks by being boring.
  mkdirSync(RECEIPTS, { recursive: true });
  const receipt = {
    startedAt,
    finishedAt: new Date().toISOString(),
    location: tail4(location),
    _location: 'last four characters only — this repo is public',
    credentialRenewed: Boolean(renewal.renewed),
    results,
    surfacesCovered: [...new Set(results.filter((r) => r.ok).flatMap((r) => r.surfaces ?? []))],
    // DERIVED, not hand-listed. It was a literal array until 2026-09-10, when the funnels suite
    // landed and the receipt printed `covered: funnels` while STILL naming funnels as unproven —
    // a report contradicting its own coverage, which is the exact defect these receipts exist to
    // prevent. Deriving it means it can never disagree with the registry again.
    surfacesWithNoSuite: ALL_SURFACES.filter((sf) => !PROOFS.some((p) => (p.surfaces ?? []).includes(sf))),
    // Different question, deliberately kept apart: a suite may exist and simply not have been
    // selected on this run. "No suite exists" and "not exercised today" are not the same claim.
    surfacesNotProvenThisRun: ALL_SURFACES.filter((sf) => !new Set(results.filter((r) => r.ok).flatMap((r) => r.surfaces ?? [])).has(sf)),
    _coverage: 'Both lists are recorded on EVERY receipt on purpose. A green run proves one surface, '
      + 'and a receipt that showed only the green would read as a clean bill of health for the whole '
      + 'product.',
  };
  const file = join(RECEIPTS, `${startedAt.slice(0, 10)}-${startedAt.slice(11, 16).replace(':', '')}.json`);
  writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);

  const failed = results.filter((r) => !r.ok);
  const skipped = results.reduce((n, r) => n + (r.summary?.skipped ?? 0), 0);
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`${results.length - failed.length}/${results.length} suite(s) passed${skipped ? `, ${skipped} assertion(s) SKIPPED` : ''}`);
  console.log(`receipt: ${file.replace(`${REPO}/`, '')}`);
  console.log(`covered: ${receipt.surfacesCovered.join(', ') || 'nothing'} — ${receipt.surfacesWithNoSuite.length} surface(s) have NO suite at all; ${receipt.surfacesNotProvenThisRun.length} not exercised in this run`);
  if (failed.length) for (const f of failed) console.log(`  FAILED  ${f.name} (exit ${f.exitCode})`);
  process.exit(failed.length ? 2 : 0);
}
/* c8 ignore stop */
