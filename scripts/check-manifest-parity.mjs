#!/usr/bin/env node
// Manifest parity gate.
//
// This plugin ships TWO manifests for the same skills tree:
//   .claude-plugin/plugin.json   (Claude Code)
//   .codex-plugin/plugin.json    (Codex)
//
// Both harnesses decide "is there an update?" by comparing VERSION NUMBERS, not content.
// So a release that bumps only one manifest is invisible to the other harness — it reports
// "already at latest" forever and silently never ships the change.
//
// That is not hypothetical: the Codex manifest sat at 0.5.1 while Claude reached 0.7.2,
// missing six releases including BOTH privacy scrubs, so Codex installs still carried
// client data that had been removed months earlier. Caught 2026-07-19.
//
//   node scripts/check-manifest-parity.mjs
import { readFileSync } from 'node:fs';

const read = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

const BASE = 'plugins/uxie-ghl-factory';
const claude = read(`${BASE}/.claude-plugin/plugin.json`);
const codex = read(`${BASE}/.codex-plugin/plugin.json`);

if (!claude || !codex) {
  console.error(`manifest parity: could not read both manifests under ${BASE}/`);
  process.exit(1);
}

const problems = [];
if (claude.version !== codex.version)
  problems.push(`version mismatch — claude=${claude.version} codex=${codex.version}`);
if (claude.name !== codex.name)
  problems.push(`name mismatch — claude=${claude.name} codex=${codex.name}`);

if (problems.length) {
  console.error('\nmanifest parity FAILED:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error(`\nBump BOTH manifests on every release. Whichever harness is left behind will
report "already at latest" and never deliver the change — including security and privacy
fixes. (The descriptions may legitimately differ; only name and version must match.)\n`);
  process.exit(1);
}
console.log(`manifest parity: ok (both at ${claude.version})`);
