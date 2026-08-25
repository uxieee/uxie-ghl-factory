#!/usr/bin/env node
// Every `example:` pointer in the SHIPPED catalogue must resolve from where the catalogue ships.
//
// WHY THIS CHECK AND NOT THE ONE THAT WAS PLANNED
// -----------------------------------------------
// The plan called for a checker asserting that engine/catalog.data.json and catalog/type-cards.json
// agree on each type's tier. Reading them showed they cannot: their vocabularies are disjoint and
// they measure different things.
//
//   catalog.data.json  `confidence`  verified-live | live-schema | bundle-derived | recon-fields
//                                    -- how the TYPE's schema was learned
//   type-cards.json    `status`      source-derived | proven-live
//                                    -- how the CORPUS PAGE describing it was authored
//
// conv_ai_trigger being `verified-live` in one and `source-derived` in the other is two facts about
// two artifacts, not a contradiction. Asserting equality would have failed on 283 rows and taught
// nothing.
//
// The invariant that IS real: gen-catalog.mjs DEFINES `verified-live` as "a persisted instance
// exists in catalog/{step,trigger}-examples/". So a verified-live entry whose example does not
// resolve is a tier claiming a file that is not there. 28 rows were in exactly that state --- the
// examples lived in knowledge/ and the paths are relative to the generator's root, so every
// trigger-examples pointer dangled the moment the catalogue shipped.
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = resolve(join(dirname(fileURLToPath(import.meta.url)),
  '../plugins/uxie-ghl-factory/skills/create-ghl-workflow'));
const data = JSON.parse(readFileSync(join(SKILL, 'engine/catalog.data.json'), 'utf8'));
const all = { ...data.steps, ...data.triggers };

const cited = Object.entries(all).filter(([, v]) => v?.example);
const dangling = cited.filter(([, v]) => !existsSync(join(SKILL, v.example)));

// The other half of the definition: verified-live without any example at all.
const unbacked = Object.entries(all)
  .filter(([, v]) => v?.confidence === 'verified-live' && !v.example);

console.log(`example pointers cited : ${cited.length}`);
console.log(`resolve from skill dir : ${cited.length - dangling.length}`);
console.log(`verified-live entries  : ${Object.values(all).filter((v) => v?.confidence === 'verified-live').length}`);

// Named, never counted -- a bare count is how two regressions hid.
if (unbacked.length) {
  console.log(`\nverified-live with NO example (hand-authored tiers, reported not gated):`);
  for (const [type, v] of unbacked) console.log(`  ${type}  (${v.kind})`);
}

if (dangling.length) {
  console.error(`\nDANGLING -- the shipped catalogue points at files that are not shipped:`);
  for (const [type, v] of dangling) console.error(`  ${type.padEnd(34)} ${v.example}`);
  console.error(`\nFix: node knowledge/scripts/scrub-examples.mjs  (never cp -- the raw captures`);
  console.error(`carry a real location_id, botId and workflow ids, and plugin/ is public).`);
  process.exit(1);
}
console.log(`\nall example pointers resolve.`);
