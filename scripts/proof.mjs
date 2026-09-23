#!/usr/bin/env node
// The ONE writer of plugin/proofs/<tool>.json. Nobody hand-edits a record: hashes are computed here,
// labels are derived here, and the console computes freshness with the same libraries.
//
//   node scripts/proof.mjs record <tool> --result pass|fail --how suite|manual [--suite s] [--evidence ref]...
//                                        [--location …abcd] [--failure id]... [--class live-canary] [--at YYYY-MM-DD]
//   node scripts/proof.mjs rehash <tool>          builds only; refuses when code or an endpoint changed
//   node scripts/proof.mjs backfill               one record per live label in tool-descriptions.json
//   node scripts/proof.mjs from-receipt <stamp>   runs for every tool a suite EXERCISED (Part C)
//   node scripts/proof.mjs validate               schema check, exit 1 on any error
//   node scripts/proof.mjs sync-labels [--check]  write each record's label into tool-descriptions.json
//   node scripts/proof.mjs seed <tool> --summary S --risk R --row id…  the first entry for a NEW tool
//
// --offline uses knowledge/sniffs/app-build-pins.json for app builds instead of the live manifest.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogIndex, endpointHashes, primarySurfaces, buildDeps } from './lib/proof-deps.mjs';
import { codeDeps } from './lib/code-deps.mjs';
import { validateRecord, loadRecords, labelFor, LABEL_FROZEN_TOOLS } from './lib/proof-record.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MI = join(ROOT, 'plugins/uxie-ghl-factory/mcp-internal');
const PROOFS = join(ROOT, 'proofs');
const DESCRIPTIONS = join(MI, 'tool-descriptions.json');
const MANIFEST_URL = 'https://production.app-manifest.leadconnectorhq.com/latest/manifest.json';
const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));
const today = () => new Date().toISOString().slice(0, 10);

// ── pure ──────────────────────────────────────────────────────────────────────────────────────
export function computeDepends(tool, ctx, hashedAt) {
  const index = catalogIndex(ctx.catalog.endpoints);
  const surfaces = primarySurfaces(tool, ctx.manifest, index);
  return {
    surfaces,
    depends: {
      hashedAt,
      endpoints: endpointHashes(tool, ctx.manifest, index),
      builds: buildDeps(surfaces, ctx.map, { apps: ctx.apps, builderEntry: ctx.builderEntry }),
      code: codeDeps({ toolsFile: ctx.toolsFile, tool, root: ctx.root }),
    },
  };
}

export function appendRun(rec, run, computed) {
  return { ...(rec ?? {}), surfaces: computed.surfaces, runs: [...(rec?.runs ?? []), run], depends: computed.depends };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function rehash(rec, computed) {
  if (!same(rec.depends.code, computed.depends.code) || !same(rec.depends.endpoints, computed.depends.endpoints)) {
    throw new Error(`stale: ${rec.tool}'s code or endpoints changed since it was proven — re-prove it, do not rehash`);
  }
  return { ...rec, depends: { ...rec.depends, builds: computed.depends.builds } };
}

export function backfillFrom(descriptions, ctx, hashedAt) {
  const out = [];
  for (const [tool, entry] of Object.entries(descriptions)) {
    if (LABEL_FROZEN_TOOLS.includes(tool)) continue;
    const m = /^(live-runtime|live-canary) \((\d{4}-\d{2}-\d{2})\)/.exec(entry.proof ?? '');
    if (!m) continue;
    const computed = ctx.compute(tool, hashedAt);
    out.push({ tool, ...appendRun(null, {
      at: m[2], result: 'pass', how: 'manual', ...(m[1] === 'live-canary' ? { proofClass: 'live-canary' } : {}),
      evidence: (entry.proofRows ?? []).map((id) => `row:${id}`), backfilled: true,
    }, computed) });
  }
  return out;
}

// Replace the proof VALUE only. `[^;]+` used to swallow everything up to the semicolon, which ate
// any `, floor: …` clause sitting between the two — the floor is the weakest evidence behind the
// tool, so losing it makes the tool read stronger than it is. Stop at the first comma as well.
export function applyLabel(entry, label) {
  return { ...entry, proof: label, description: String(entry.description ?? '').replace(/proof:\s*[^,;]+/, `proof: ${label}`) };
}

export function syncLabels(descriptions, records) {
  const next = { ...descriptions }; const changed = [];
  for (const [tool, rec] of Object.entries(records).sort(([a], [b]) => a.localeCompare(b))) {
    if (LABEL_FROZEN_TOOLS.includes(tool) || !next[tool]) continue;
    const label = labelFor(rec);
    if (next[tool].proof === label) continue;
    next[tool] = applyLabel(next[tool], label); changed.push(tool);
  }
  return { next, changed };
}

// Writes each record with `write`, stopping (never skipping) on the first one that fails
// validation — a record that cannot validate is a signal, not something to swallow. On failure
// the thrown message names how many were written, which tool failed and why, and that a re-run
// is safe: already-written records are kept and backfill only ever writes tools with no record yet.
export function backfillWrite(recs, write) {
  let written = 0;
  for (const rec of recs) {
    try {
      write(rec);
      written += 1;
    } catch (e) {
      throw new Error(`backfill: wrote ${written} record(s), then ${rec.tool} failed validation:\n  ${e.message}\n`
        + `the ${written} record(s) already written are kept — fix the cause and re-run; backfill skips tools that already have a record.`);
    }
  }
  return written;
}

export function runsFromReceipt(receipt, stamp) {
  const out = [];
  for (const r of receipt.results ?? []) {
    // A suite that printed no parseable summary proved nothing; its tool list is not trusted either.
    if (!r.summary || !Array.isArray(r.exercised)) continue;
    for (const e of r.exercised) {
      // Skip on "no assertion attributed to this entry" — never on call count. A call with no
      // assertion (setup-only, or every assertion attributed elsewhere by subject()) proved nothing
      // and must not be recorded as a pass. But a real assertion FAILURE can be attributed to a tool
      // by log.subject(name) without that tool's own handler ever running (calls: 0, failed: 1) —
      // that is a genuine failure and must reach the record whatever the call count says.
      if (!e.passed && !e.failed) continue;
      out.push({ tool: e.tool, run: {
        at: stamp.slice(0, 10), result: e.failed ? 'fail' : 'pass', how: 'suite', suite: r.name,
        evidence: [`receipt:${stamp}`], ...(receipt.location ? { location: receipt.location } : {}),
        ...(e.failures?.length ? { failures: [...new Set(e.failures)] } : {}),
      } });
    }
  }
  return out;
}

// Builds the records `from-receipt` will write, IN ORDER, folding each write's own result into the
// base the next one appends onto. `have` is the on-disk snapshot taken once; everything after that
// comes from the accumulator here, never from `have` again — so a tool exercised twice in the same
// receipt gets both runs, the second appended onto the record the first just produced, rather than
// both computed from the same stale pre-loop snapshot (which is what silently dropped a run: two
// writes to the same tool, both built from `have[tool]`, the second overwriting the first's file).
export function applyReceiptRuns(runs, have, computeFor) {
  const acc = { ...have };
  const out = [];
  for (const { tool, run } of runs) {
    const rec = { tool, ...appendRun(acc[tool] ?? null, run, computeFor(tool)) };
    acc[tool] = rec;
    out.push(rec);
  }
  return out;
}

// Writes and reports each record AS it writes — never batching the report until the whole loop
// succeeds — so a validation failure partway through still leaves the pass/FAIL lines for every
// record already on disk, which is what the ghl-recheck skill's step 4 needs to record backlog
// rows even when the run stops early. `recs` and `runs` are the same length and index-aligned
// (both built by applyReceiptRuns / runsFromReceipt in the same order).
export function writeReceiptRuns(recs, runs, write, log) {
  let written = 0;
  for (let i = 0; i < recs.length; i += 1) {
    write(recs[i]);
    written += 1;
    const { tool, run } = runs[i];
    log(`${run.result === 'pass' ? 'pass' : 'FAIL'}  ${tool}${run.failures ? `  ${run.failures.join(', ')}` : ''}`);
  }
  return written;
}

// ── effects ───────────────────────────────────────────────────────────────────────────────────
async function loadContext({ offline }) {
  const knowledge = process.env.GHL_KNOWLEDGE_DIR ?? resolve(ROOT, '../knowledge');
  if (!existsSync(join(knowledge, 'sniffs/app-surface-map.json'))) {
    throw new Error(`knowledge/ not found at ${knowledge} — set GHL_KNOWLEDGE_DIR`);
  }
  const { parse } = await import(join(knowledge, 'sniffs/check-app-builds.mjs'));
  let apps = new Map();
  if (offline) {
    for (const [name, p] of Object.entries(readJSON(join(knowledge, 'sniffs/app-build-pins.json')).apps ?? {})) apps.set(name, { build: p.build });
  } else {
    const res = await fetch(MANIFEST_URL, { signal: AbortSignal.timeout(12000) });
    for (const [name, url] of Object.entries((await res.json()).federatedApps ?? {})) { const p = parse(url); if (p) apps.set(name, p); }
  }
  const builderPins = join(knowledge, 'sniffs/builder-chunk-pins.json');
  return {
    root: ROOT,
    toolsFile: join(MI, 'core/tools.mjs'),
    manifest: readJSON(join(MI, 'capability-manifest.json')),
    catalog: readJSON(join(MI, 'catalog/internal-endpoints.source.json')),
    map: readJSON(join(knowledge, 'sniffs/app-surface-map.json')),
    apps,
    builderEntry: existsSync(builderPins) ? readJSON(builderPins).entry ?? null : null,
  };
}

const write = (rec) => {
  const errs = validateRecord(rec);
  if (errs.length) throw new Error(`refusing to write ${rec.tool}:\n  ${errs.join('\n  ')}`);
  mkdirSync(PROOFS, { recursive: true });
  writeFileSync(join(PROOFS, `${rec.tool}.json`), `${JSON.stringify(rec, null, 2)}\n`);
};

async function main(argv) {
  const [cmd, arg] = argv;
  const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
  const all = (n) => argv.flatMap((a, i) => (a === `--${n}` && argv[i + 1] ? [argv[i + 1]] : []));
  const offline = argv.includes('--offline');

  if (cmd === 'validate') {
    let bad = 0;
    for (const rec of Object.values(loadRecords(PROOFS))) {
      const errs = validateRecord(rec);
      if (errs.length) { bad++; console.error(`${rec.tool}:\n  ${errs.join('\n  ')}`); }
    }
    console.log(bad ? `${bad} invalid record(s)` : 'proofs: every record valid');
    return bad ? 1 : 0;
  }
  // seed: the FIRST entry for a brand-new tool, so the single-writer rule holds — tool-descriptions.json
  // is written by this script and nothing else, new tools included. The label starts at
  // external-receipt-required (unproven) and only a recorded live run moves it (record/from-receipt,
  // then sync-labels). Refuses to overwrite an existing entry.
  //   node scripts/proof.mjs seed <tool> --summary "Rename workflows" --risk write --row <id>... [--risk-row <id>...]
  if (cmd === 'seed') {
    if (!arg) throw new Error('seed needs a tool name');
    const d = readJSON(DESCRIPTIONS);
    if (d[arg]) throw new Error(`${arg} already has an entry — seed is for new tools only`);
    const summary = flag('summary'), risk = flag('risk'), rows = all('row');
    if (!summary || !risk || !rows.length) throw new Error('seed needs --summary, --risk and at least one --row');
    const label = 'external-receipt-required';
    d[arg] = { description: `${summary} — proof: ${label}; risk: ${risk}`, risk, proof: label, proofFloor: label,
      proofRows: rows, proofFloorRows: rows, riskRows: all('risk-row').length ? all('risk-row') : rows, rows };
    writeFileSync(DESCRIPTIONS, `${JSON.stringify(d, null, 2)}\n`);
    console.log(`seeded ${arg}: ${label}`);
    return 0;
  }
  if (cmd === 'sync-labels') {
    const { next, changed } = syncLabels(readJSON(DESCRIPTIONS), loadRecords(PROOFS));
    if (argv.includes('--check')) {
      if (changed.length) { console.error(`labels out of date: ${changed.join(', ')}`); return 1; }
      console.log('labels match records'); return 0;
    }
    if (changed.length) writeFileSync(DESCRIPTIONS, `${JSON.stringify(next, null, 2)}\n`);
    console.log(changed.length ? `updated ${changed.length}: ${changed.join(', ')}` : 'labels already match records');
    return 0;
  }
  if (cmd === 'record') {
    if (!arg) throw new Error('record needs a tool name');
    const ctx = await loadContext({ offline });
    const existing = loadRecords(PROOFS)[arg] ?? null;
    const run = {
      at: flag('at') ?? today(), result: flag('result'), how: flag('how'),
      ...(flag('class') ? { proofClass: flag('class') } : {}),
      ...(flag('suite') ? { suite: flag('suite') } : {}),
      evidence: all('evidence'),
      ...(flag('location') ? { location: flag('location') } : {}),
      ...(all('failure').length ? { failures: all('failure') } : {}),
    };
    write({ tool: arg, ...appendRun(existing, run, computeDepends(arg, ctx, today())) });
    console.log(`recorded ${arg}: ${run.result}`);
    return 0;
  }
  if (cmd === 'rehash') {
    const rec = loadRecords(PROOFS)[arg];
    if (!rec) throw new Error(`no record for ${arg}`);
    const ctx = await loadContext({ offline });
    write(rehash(rec, computeDepends(arg, ctx, rec.depends.hashedAt)));
    console.log(`rehashed builds for ${arg}`);
    return 0;
  }
  if (cmd === 'backfill') {
    const ctx = await loadContext({ offline });
    const have = loadRecords(PROOFS);
    const recs = backfillFrom(readJSON(DESCRIPTIONS), { compute: (tool, at) => computeDepends(tool, ctx, at) }, today())
      .filter((r) => !have[r.tool]);
    const written = backfillWrite(recs, write);
    console.log(`backfilled ${written} record(s)`);
    return 0;
  }
  if (cmd === 'from-receipt') {
    if (!/^\d{4}-\d{2}-\d{2}-\d{4}$/.test(arg ?? '')) throw new Error('from-receipt needs a receipt stamp YYYY-MM-DD-HHMM');
    const file = join(ROOT, 'audits/live-proofs', `${arg}.json`);
    if (!existsSync(file)) throw new Error(`no receipt ${arg} on this machine`);
    const ctx = await loadContext({ offline });
    const runs = runsFromReceipt(readJSON(file), arg);
    const recs = applyReceiptRuns(runs, loadRecords(PROOFS), (tool) => computeDepends(tool, ctx, today()));
    // `written` counts writes that actually happened, not runs.length — it can never claim more
    // than what is on disk, even if a later write throws mid-loop (validation failure stops the
    // loop here, same as everywhere else `write` is called). Each pass/FAIL line prints as its
    // record lands on disk, so a mid-loop throw still leaves the lines for everything already
    // written — not swallowed along with the exception.
    const written = writeReceiptRuns(recs, runs, write, (line) => console.log(line));
    console.log(`recorded ${written} run(s) from receipt ${arg}`);
    return 0;
  }
  console.error('usage: proof.mjs record|rehash|backfill|from-receipt|validate|sync-labels — see the header');
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(`proof: ${e.message}`); process.exit(1); });
}
