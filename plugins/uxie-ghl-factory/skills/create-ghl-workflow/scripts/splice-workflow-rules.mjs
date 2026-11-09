// Splice the workflowRules block of a REGENERATED engine catalogue into the shipped one (w9-w5, d2 FIX REQUEST, DECISION (a)
// 2026-11-09). A full regen from today's generator also moves 55 steps and 10 triggers that are not d2 (see the backlog row for the
// generator review), so the shipped file takes only the workflowRules block. Every other top-level key is left byte-for-byte.
//
// Usage: node splice-workflow-rules.mjs <regen catalog.data.json> <shipped engine catalog.data.json> [--write]
//   regen   the output of knowledge/scripts/gen-catalog.mjs (run it first, with bundle-2026-11-09/workflow-rules.json present)
//   shipped plugin engine/catalog.data.json
// Dry run by default. Refuses if the shipped file does not round-trip through JSON.stringify(_, null, 1), so the diff is the block alone.
import { readFileSync, writeFileSync } from 'node:fs';

const [regenP, shippedP, flag] = process.argv.slice(2);
if (!regenP || !shippedP) {
  console.error('usage: node splice-workflow-rules.mjs <regen catalog.data.json> <shipped engine catalog.data.json> [--write]');
  process.exit(2);
}
const shippedTxt = readFileSync(shippedP, 'utf8');
const shipped = JSON.parse(shippedTxt);
if (JSON.stringify(shipped, null, 1) !== shippedTxt) {
  console.error('refusing: the shipped catalogue does not round-trip through JSON.stringify(_, null, 1); the splice would reformat it');
  process.exit(1);
}
const regen = JSON.parse(readFileSync(regenP, 'utf8'));
if (!regen.workflowRules) {
  console.error('refusing: the regenerated catalogue has no workflowRules block');
  process.exit(1);
}
const subKeys = [...new Set([...Object.keys(shipped.workflowRules ?? {}), ...Object.keys(regen.workflowRules)])];
const changed = subKeys.filter((k) => JSON.stringify(shipped.workflowRules?.[k]) !== JSON.stringify(regen.workflowRules[k]));
console.log(`workflowRules sub-blocks that differ: ${changed.length ? changed.join(', ') : 'none (already spliced)'}`);
if (flag !== '--write') {
  console.log('dry run; pass --write to splice');
  process.exit(0);
}
shipped.workflowRules = regen.workflowRules;
writeFileSync(shippedP, JSON.stringify(shipped, null, 1));
console.log(`spliced workflowRules into ${shippedP}`);
