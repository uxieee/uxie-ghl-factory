#!/usr/bin/env node
// CLI wrapper for engine/trigger-overlap.mjs (w6d-9). The engine stays import-only.
//
// Input (stdin, JSON): { "types": ["contact_tag"], "draftTriggers": [{type, conditions}] (optional), "found": <the find_workflows_using data>, "excludeId": "<the draft's own id, optional>" }
//   draftTriggers: the draft's trigger rows (conditions as the builder stores them); found.workflows[].triggers: each hit's trigger rows (one GET per hit).
//   types: the trigger types the draft listens for (as describe_step_type spells them).
//   found: the data of ONE find_workflows_using call (returns:"workflows", limit above count), with complete, count and workflows.
// Output (stdout, JSON): the overlap result. Every result carries the label "might also fire: trigger filters compared statically, no event simulated"; each hit has a verdict (WILL, MIGHT) cannotOverlap lists CANT and NONE; drafts that would overlap are in draftHits, not hits.
//
//   node scripts/trigger-overlap-cli.mjs < input.json
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { triggerOverlap } from '../engine/trigger-overlap.mjs';

export function run(text) {
  let input;
  try { input = JSON.parse(text); } catch (e) { return { error: `stdin is not valid JSON: ${e.message}` }; }
  return triggerOverlap({ types: input?.types ?? [], draftTriggers: input?.draftTriggers ?? null, found: input?.found ?? {}, excludeId: input?.excludeId ?? null });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { text += d; });
  process.stdin.on('end', () => {
    const out = run(text);
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    process.exitCode = out.error ? 2 : 0;
  });
}
