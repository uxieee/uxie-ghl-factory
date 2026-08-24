#!/usr/bin/env node
/**
 * The shipped type catalog is GENERATED from knowledge/corpus/workflows/30-types. This asserts
 * the two have not drifted apart.
 *
 * Same reasoning as check-mcp-contract: the plugin does not import the corpus, it carries a
 * copy. Nothing would tell you the copy is stale, and a stale card is worse than a missing one
 * — it looks like knowledge while teaching the wrong field set.
 *
 * Skips when the corpus is not present (it lives in a sibling repo with no remote, so a clone
 * of this repo alone cannot run it).
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHIPPED = join(ROOT, 'plugins/uxie-ghl-factory/skills/create-ghl-workflow/catalog/type-cards.json');
const GEN = join(ROOT, '../knowledge/scripts/build-type-catalog.mjs');

if (!existsSync(GEN)) {
  console.log('type catalog: SKIPPED (knowledge/ not present — cannot regenerate to compare)');
  process.exit(0);
}
if (!existsSync(SHIPPED)) {
  console.error('type catalog: the shipped catalog is MISSING. Run knowledge/scripts/build-type-catalog.mjs');
  process.exit(1);
}

const tmp = '/tmp/type-cards-drift-check.json';
try {
  execFileSync('node', [GEN, tmp], { encoding: 'utf8', stdio: 'pipe' });
} catch (e) {
  console.error(`type catalog: the generator failed — ${String(e.stderr || e.message).split('\n')[0]}`);
  process.exit(1);
}

const shipped = JSON.parse(readFileSync(SHIPPED, 'utf8'));
const fresh = JSON.parse(readFileSync(tmp, 'utf8'));

const byType = (c) => Object.fromEntries(c.cards.map((x) => [x.type, JSON.stringify(x)]));
const a = byType(shipped), b = byType(fresh);
const added = Object.keys(b).filter((t) => !(t in a));
const removed = Object.keys(a).filter((t) => !(t in b));
const changed = Object.keys(b).filter((t) => t in a && a[t] !== b[t]);

if (added.length || removed.length || changed.length) {
  console.error('\ntype catalog: the shipped cards have drifted from the corpus.\n');
  if (added.length) console.error(`   ${added.length} new in the corpus : ${added.slice(0, 8).join(', ')}${added.length > 8 ? ' …' : ''}`);
  if (removed.length) console.error(`   ${removed.length} gone from corpus : ${removed.slice(0, 8).join(', ')}${removed.length > 8 ? ' …' : ''}`);
  if (changed.length) console.error(`   ${changed.length} changed          : ${changed.slice(0, 8).join(', ')}${changed.length > 8 ? ' …' : ''}`);
  console.error('\nRegenerate: node knowledge/scripts/build-type-catalog.mjs\n');
  process.exit(1);
}
console.log(`type catalog: ok (${shipped.count} cards in sync with the corpus)`);
