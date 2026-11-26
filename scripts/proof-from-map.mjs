#!/usr/bin/env node
// Writes proof runs for tools a QA-ACCEPTED, hand-checked map credits (d18, 2026-11-22). Cites ONLY `commit:<full sha of the knowledge commit that landed the record>`.
//
//   node scripts/proof-from-map.mjs --map <map.json> --citations <citations.json> [--knowledge <main checkout>] [--write]     (default is a dry run)
//
// map.json:        { rows: [{ tool, kshaFull, record, startedAt, pluginCommit, codeAtRecord: {<file#tool>: <sha256>} }] }   (from the knowledge side; may hold real refs)
// citations.json:  { "<40-hex sha>": "<record path>" }   the commit -> record mapping, kept on the knowledge side
// Per row it REFUSES unless: the sha is 40-hex and listed in citations with the same record path; the sha is an ancestor of the knowledge main branch; the record's blob at that
// sha equals main's; the tool's code hashes now (computeDepends) equal codeAtRecord. A run is {at: startedAt date, result pass, how manual, evidence [commit:<sha>]}.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCitationClean, commitEvidence } from './lib/proof-citation.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// W1: a location is only ever recorded in its masked form (ellipsis plus the last four characters), never a raw id.
export const MASKED_LOCATION = /^\u2026[A-Za-z0-9]{4}$/;
// W2: idempotence. A record that already holds a run citing this commit is skipped, so a second --write adds nothing.
export const alreadyRecorded = (rec, sha) => Boolean(rec?.runs?.some((r) => (r.evidence ?? []).includes(`commit:${sha}`)));

// Pure: decides one row. `git(...args)` and `codeNow(tool)` are injected so the refusals are testable without a repository.
export function runForRow(row, { citations, git, codeNow, location }) {
  const sha = row.kshaFull;
  if (location && !MASKED_LOCATION.test(location)) throw new Error(`${row.tool}: refused, the location must be in masked form (an ellipsis and 4 characters), never a raw id`);
  const evidence = commitEvidence(sha);
  if (citations?.[sha] !== row.record) throw new Error(`${row.tool}: the citations file does not map ${String(sha).slice(0, 9)} to this record`);
  if (!git.isAncestorOfMain(sha)) throw new Error(`${row.tool}: ${sha.slice(0, 9)} is not an ancestor of knowledge main`);
  const atSha = git.blob(sha, row.record), onMain = git.blob('main', row.record);
  if (!atSha || atSha !== onMain) throw new Error(`${row.tool}: the record blob at ${sha.slice(0, 9)} does not equal main's`);
  const now = codeNow(row.tool);
  if (!row.codeAtRecord || !same(now, row.codeAtRecord)) throw new Error(`${row.tool}: the tool's code changed since the record's plugin commit (or codeAtRecord is missing), re-prove it`);
  const at = String(row.startedAt ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(at)) throw new Error(`${row.tool}: startedAt is not a date`);
  const run = { at, result: 'pass', how: 'manual', evidence: [evidence], ...(location ? { location } : {}) };
  assertCitationClean(run, `${row.tool} run`);
  return run;
}

async function main(argv) {
  const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
  const write = argv.includes('--write');
  if (!flag('map') || !flag('citations')) throw new Error('needs --map and --citations');
  const K = flag('knowledge') ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../knowledge');
  const map = JSON.parse(readFileSync(flag('map'), 'utf8')); const citations = JSON.parse(readFileSync(flag('citations'), 'utf8'));
  const g = (...a) => execFileSync('git', ['-C', K, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const git = {
    isAncestorOfMain: (sha) => { try { execFileSync('git', ['-C', K, 'merge-base', '--is-ancestor', sha, 'main'], { stdio: 'ignore' }); return true; } catch { return false; } },
    blob: (rev, path) => { try { return g('rev-parse', `${rev}:${path}`); } catch { return null; } },
  };
  const P = await import('./proof.mjs'); const D = await import('./lib/proof-record.mjs');
  const ctx = await P.loadContext({ offline: argv.includes('--offline') });
  const codeNow = (tool) => P.computeDepends(tool, ctx, new Date().toISOString().slice(0, 10)).depends.code;
  const have = D.loadRecords(resolve(dirname(fileURLToPath(import.meta.url)), '../proofs'));
  let n = 0;
  for (const row of map.rows) {
    const run = runForRow(row, { citations, git, codeNow, location: flag('location') });
    if (alreadyRecorded(have[row.tool], row.kshaFull)) { console.log(`skip: ${row.tool} already has a run citing this commit`); continue; }
    const rec = { tool: row.tool, ...P.appendRun(have[row.tool] ?? null, run, P.computeDepends(row.tool, ctx, run.at)) };
    if (write) P.writeRecord(rec); else console.log(`dry run: ${row.tool} pass ${run.at} ${run.evidence[0].slice(0, 15)}…`);
    n++;
  }
  console.log(`${write ? 'wrote' : 'would write'} ${n} run(s)`);
  return 0;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(`proof-from-map: ${e.message}`); process.exit(1); });
