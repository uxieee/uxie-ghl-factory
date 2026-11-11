import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyBlocks, renderBlock, renderAll, stripBlocks } from '../scripts/render-rail-ledger.mjs';

// W4 (2026-10-29): the skills state each product's rail from the ledger, in generated blocks, and no longer carry the
// routing claims the ledger superseded. Each phrase below was in a skill before W4 and is wrong by the ledger's evidence.
const HERE = dirname(fileURLToPath(import.meta.url));
const MCP = resolve(HERE, '..');
const SKILLS = resolve(MCP, '../skills');
const ledger = JSON.parse(readFileSync(join(MCP, 'catalog/rail-ledger.json'), 'utf8'));

export const DENY = [
  'full lifecycle — the most API-mature',
  'Read or configure a Conversation AI agent | Public',
  'Conversation AI (**public rail**',
  'The public API reads pipelines; the internal rail writes them',
  'cannot see or set what the agent',
  'prefer public; internal only via',
  '**six have no public',
  'public sees how it sounds, not what it does',
  'no public equivalent beyond import',
  'is a 1-action list-only category',
  // review fix: the public Conversation AI search leaves out flow-builder bots, so 'reads on either rail' loses them
  'READS GO ON EITHER RAIL',
  'Conversation AI reads on either rail',
  'reads on either rail, configures on the internal one',
  '**Reading** — either rail.',
  'Read: either rail. Configure: internal',
  // W5a Task 9 (2026-10-30): each phrase below was in a skill before W5a and is wrong by the Conversation AI wave's
  // live evidence (knowledge/sniffs/convai-wave-2026-10-29/, recon W5 §B1 #1-#17; #11 lives in a generated block and
  // is fixed at the ledger generator, Task 10).
  'Treat it as unproven bundle evidence, not as tested behaviour.', // #1: the wave is live-proven now
  'The plugin does not author them yet', // #2: llm, opener, disclaimer, rich elements, outbound are authored
  'model roster (15 GPT ids', // #3: 22 models from three providers on 2026-10-29
  'omitted agent-level booleans RESET (merge unproven)', // #4: a partial PUT merged (live-partial-put-booleans.json)
  '**refuted for booleans**', // #5
  'replace-what-you-omit for booleans', // #6
  'The UI itself never sends a partial PUT', // #6: the V2 editor sends a two-key employee PUT
  'a partial body RESETS omitted agent-level booleans', // #6 (the compiler example comment)
  "(three, per the bundle's own enum", // #7: FLOW_BUILDER_BOT_V2 is a fourth
  "**The editor's Create Agent offers only Prompt Based and Flow Based**", // #8: Create with AI + templates
  "The panel's ↻ resets it", // #9: the panel is builder/test now; the trial is legacy
  'Conversation AI Test-panel chats are logged nowhere', // #10: proven for the legacy trial only
  'The one internal exception on Conversation AI is the **per-contact AI switch**', // #12
  'the two internal-only corners of Conversation AI', // #13
  'internal corners of `ghl-conversation-ai`', // #13
  'the two corners with no public equivalent', // #13
  '(the agent object is public; its internals are not)', // #14
  'is the unrelated Conversation AI flow bot', // #15: a V2 flow agent IS an Agent Studio graph
  'reads and most writes go through the public', // #16
  '(enabling a channel, activating a Voice AI number, turning on an Agent Studio trigger)', // #17: the list misses outbound
  // W5a Task 10: #11 — working hours and Custom API are proven on the internal rail. Here it guards hand-written prose; the
  // generated blocks are checked by the next test, since this one strips them.
  'Public only: working hours; customApi actions.',
];

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.md') ? [p] : []; });
const docs = walk(SKILLS).map((p) => ({ p, rel: relative(SKILLS, p), text: readFileSync(p, 'utf8') }));

test('no skill states a superseded routing claim outside a generated block (frontmatter included)', () => {
  const hits = [];
  for (const d of docs) for (const phrase of DENY) if (stripBlocks(d.text).includes(phrase)) hits.push(`${d.rel}: "${phrase}"`);
  assert.deepEqual(hits, []);
});

// W5a Task 10 (2026-10-30): claims the Conversation AI wave disproved that lived INSIDE generated blocks (recon W5 §B3/§E4),
// so the deny test above cannot see them. Searched with the blocks kept, in the rendered block, and in the ledger copy.
const BLOCK_DENY = ['Public only: working hours; customApi actions.', 'with every 2026-10-27 setting'];

test('no generated block, the reference or the ledger copy carries a claim the Conversation AI wave disproved', () => {
  const hits = [];
  for (const d of docs) for (const phrase of BLOCK_DENY) if (d.text.includes(phrase)) hits.push(`${d.rel}: "${phrase}"`);
  for (const phrase of BLOCK_DENY) if (renderBlock(ledger, 'conversation-ai').includes(phrase)) hits.push(`render: "${phrase}"`);
  for (const r of ledger.rows) for (const phrase of BLOCK_DENY) if (r.internal.can.includes(phrase)) hits.push(`ledger ${r.product}/${r.job}: "${phrase}"`);
  assert.deepEqual(hits, []);
});

test('the conversation-ai block routes outbound to set_convai_outbound on the edit job', () => {
  assert.match(renderBlock(ledger, 'conversation-ai'), /\| edit \| undecided \| internal \| `update_convai_agent`, `set_convai_outbound` \|/);
});

const MARKERS = {
  'ghl-orientation/SKILL.md': ['summary'],
  'ghl-orientation/references/api-worlds.md': ['summary'],
  'ghl-conversation-ai/SKILL.md': ['conversation-ai'],
  'ghl-voice-ai/SKILL.md': ['voice-ai'],
  'ghl-knowledge-base/SKILL.md': ['knowledge-base'],
  'ghl-pipeline-specialist/SKILL.md': ['pipelines', 'opportunities'],
  'ghl-pipeline-specialist/references/reference-pipelines.md': ['pipelines'],
  'ghl-memberships/SKILL.md': ['courses'],
  'ghl-forms/SKILL.md': ['forms'],
  'ghl-funnels-pages/SKILL.md': ['funnel-redirects'],
  'ghl-snapshots/SKILL.md': ['snapshots'],
  'create-ghl-workflow/SKILL.md': ['workflows'],
};

test('every listed skill carries its rail-ledger markers', () => {
  const missing = [];
  for (const [rel, keys] of Object.entries(MARKERS)) {
    const text = readFileSync(join(SKILLS, rel), 'utf8');
    for (const k of keys) if (!text.includes(`<!-- rail-ledger:${k} -->`)) missing.push(`${rel}: ${k}`);
  }
  assert.deepEqual(missing, []);
});

test('every block and references/rail-ledger.md match a fresh render', () => {
  assert.deepEqual(renderAll({ skillsDir: SKILLS, ledger, write: false }).stale, []);
});

test('an unpaired or unknown marker fails the render', () => {
  assert.throws(() => applyBlocks('a\n<!-- rail-ledger:voice-ai -->\nb\n', ledger), /unpaired/);
  assert.throws(() => applyBlocks('<!-- /rail-ledger:voice-ai -->\n', ledger), /unpaired/);
  assert.throws(() => applyBlocks('<!-- rail-ledger:nope -->\n<!-- /rail-ledger:nope -->\n', ledger), /unknown/);
});

test('a block names each job with its decision and routing, and says it is generated', () => {
  const b = renderBlock(ledger, 'pipelines');
  assert.match(b, /generated from the rail ledger \(mcp-internal\/catalog\/rail-ledger\.json\) — do not edit/);
  assert.match(b, /\| read \| both \| split \|/);
  assert.match(b, /\| edit \| undecided \| internal \|/);
  const s = renderBlock(ledger, 'summary');
  for (const p of Object.keys(ledger.products)) assert.ok(s.includes(`| ${p} |`), p);
});

test('applyBlocks replaces only the block body and is idempotent', () => {
  const src = 'before\n<!-- rail-ledger:tags -->\nold\n<!-- /rail-ledger:tags -->\nafter\n';
  const once = applyBlocks(src, ledger);
  assert.match(once, /^before\n<!-- rail-ledger:tags -->\n/);
  assert.match(once, /<!-- \/rail-ledger:tags -->\nafter\n$/);
  assert.ok(!once.includes('\nold\n'));
  assert.equal(applyBlocks(once, ledger), once);
});
