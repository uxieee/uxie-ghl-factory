#!/usr/bin/env node
// check-overlay-sources.mjs — does an overlay note still match the corpus page it came from?
//
// WHY
// search_endpoints reads catalog/endpoint-overlay.json, NOT the corpus. So a claim corrected in
// knowledge/ keeps being served here until somebody edits this file too, and nothing connects the
// two. That is not hypothetical: corpus/platform/20-api/snapshots.md retracted "there is NO
// Conversation AI category" on 2026-09-07 — flagging its own earlier revision as wrong — and the
// overlay was still serving the retracted wording a day later. An agent asked the MCP, was told
// the withdrawn claim, and filed a finding based on it.
//
// HOW
// A row may carry `source: { page, sha256 }`. The page is relative to knowledge/corpus/; the hash
// is of that file when the note was last checked against it. If the page has changed since, the
// note is STALE-SUSPECT: not necessarily wrong, but nobody has re-read it against the page it
// summarises. That is exactly the state the snapshots note was in.
//
//   node scripts/check-overlay-sources.mjs            report
//   node scripts/check-overlay-sources.mjs --restamp  accept current pages as checked
//
// Deliberately NOT retrofitted across all 120 notes. A hash stamped without anyone reading the
// page is a green light nobody earned. Rows gain a source when someone actually verifies one.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OVERLAY = resolve(HERE, '../catalog/endpoint-overlay.json');
// …/plugin/plugins/uxie-ghl-factory/mcp-internal/scripts -> …/gohighlevel
const CORPUS = resolve(HERE, '../../../../../knowledge/corpus');
const restamp = process.argv.includes('--restamp');

const overlay = JSON.parse(readFileSync(OVERLAY, 'utf8'));
const rows = overlay.rows ?? {};
const sha = (s) => createHash('sha256').update(s).digest('hex');

const noted = Object.entries(rows).filter(([, v]) => v?.note);
const sourced = noted.filter(([, v]) => v?.source?.page);
const stale = []; const missing = []; let restamped = 0;

for (const [key, row] of sourced) {
  const file = join(CORPUS, row.source.page);
  if (!existsSync(file)) { missing.push([key, row.source.page]); continue; }
  const now = sha(readFileSync(file, 'utf8'));
  if (now === row.source.sha256) continue;
  if (restamp) { row.source.sha256 = now; restamped++; continue; }
  stale.push([key, row.source.page]);
}

if (restamp) {
  writeFileSync(OVERLAY, `${JSON.stringify(overlay, null, 2)}\n`);
  console.log(`restamped ${restamped} source hash(es) — you are asserting you re-read those pages`);
  process.exit(0);
}

console.log(`overlay notes: ${noted.length} of ${Object.keys(rows).length} rows`);
console.log(`  citing a corpus page: ${sourced.length}`);
console.log(`  uncited:              ${noted.length - sourced.length}  (no link back; drift here is invisible)`);
if (missing.length) {
  console.log(`\n${missing.length} note(s) cite a page that no longer exists:`);
  for (const [k, p] of missing) console.log(`  ${k}\n    -> ${p}`);
}
if (stale.length) {
  console.log(`\n${stale.length} note(s) summarise a page that has CHANGED since the note was checked:`);
  for (const [k, p] of stale) console.log(`  ${k}\n    -> ${p}`);
  console.log('\nRe-read each page against its note. If the note still holds, run --restamp.');
}
if (!missing.length && !stale.length) console.log('\nevery cited page is unchanged since its note was last checked.');
process.exit(stale.length || missing.length ? 2 : 0);
