import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripBlocks } from '../scripts/render-rail-ledger.mjs';

// W5a Task 9 (2026-10-30): the Conversation AI skills were rewritten from the 2026-10-29 wave evidence
// (knowledge/sniffs/convai-wave-2026-10-29/). The REQUIRE list is a regression guard only: a term being present says
// nothing about the sentence around it. The tests after it check what the sentences must SAY — the confirm-before-live
// list, the ack-token rule, and the confidence marks on claims that are not proven. Generated rail-ledger blocks are
// stripped first: Task 10 regenerates them, and a block must not satisfy a hand-written requirement.

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS = resolve(HERE, '../../skills');
const CA_DIR = join(SKILLS, 'ghl-conversation-ai');

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.md') ? [p] : []; });
const read = (p) => stripBlocks(readFileSync(p, 'utf8'));
const caDocs = walk(CA_DIR).map((p) => ({ rel: relative(SKILLS, p), text: read(p) }));
const caAll = caDocs.map((d) => d.text).join('\n');
const caLines = caDocs.flatMap((d) => d.text.split('\n').map((line, i) => ({ where: `${d.rel}:${i + 1}`, line })));
const skillMd = read(join(CA_DIR, 'SKILL.md'));

const REQUIRE = [
  'outbound-configs', 'outbound-triggers', 'bulk-conversation-ai', 'richElementSettings', 'FLOW_BUILDER_BOT_V2',
  'builder/test', 'test_contact_unavailable', 'set_convai_outbound', 'acknowledge', 'ackToken', 'SEND_CLASS_ACK_REQUIRED',
  'outboundOpeningMessage', 'outboundDisclaimer', 'ai_generated', '2026-10-30T23:59:59', 'gpt-4.1-mini',
  '[outbound] trigger', '[outbound] bulk_action', 'mcp_app', 'builder/build', 'agent_saved',
];

test('the Conversation AI skill names every wave feature (regression guard)', () => {
  const missing = REQUIRE.filter((t) => !caAll.includes(t));
  assert.deepEqual(missing, []);
  assert.match(caAll, /\bclaude-[a-z]+-\d/, 'a Claude model id from the 2026-10-29 roster');
  assert.match(caAll, /\bgemini-\d/, 'a Gemini model id from the 2026-10-29 roster');
});

// Bullets of one `## ` section, continuation lines folded in.
function sectionBullets(md, heading) {
  const start = md.indexOf(`\n## ${heading}`);
  assert.ok(start >= 0, `SKILL.md has a "## ${heading}" section`);
  const rest = md.slice(start + 1);
  const end = rest.indexOf('\n## ', 4);
  const body = end < 0 ? rest : rest.slice(0, end);
  const bullets = [];
  for (const line of body.split('\n')) {
    if (/^- /.test(line)) bullets.push(line);
    else if (/^\s+\S/.test(line) && bullets.length) bullets[bullets.length - 1] += ` ${line.trim()}`;
  }
  return bullets;
}

test('the confirm-before-live list names every action that makes GHL text people or sign compliance', () => {
  const bullets = sectionBullets(skillMd, 'Confirm before anything goes live');
  const has = (label, ...res) => assert.ok(bullets.some((b) => res.every((r) => r.test(b))), `no bullet for ${label}`);
  has('outbound activation (it signs compliance in the caller\'s name)', /activat\w* (SMS )?outbound|outbound activation/i, /complian/i);
  has('enabling an outbound trigger', /enabl\w*/i, /outbound trigger/i);
  has('mode auto-pilot/suggestive while armed or campaign-eligible', /auto-pilot/, /suggestive/, /\barmed\b/i, /campaign-eligible/i);
  has('starting an AI Campaign', /start\w* an AI Campaign/i);
  // the older items stay on the list
  has('enabling a channel', /enabl\w* a channel|deployment row/i);
  has('activating a Voice AI number', /Voice AI number/i);
  has('turning on an Agent Studio trigger', /Agent Studio trigger/i);
});

test('the skill tells the agent to ask the human before it passes an ack token', () => {
  const paras = skillMd.split(/\n\s*\n/);
  const rule = paras.find((p) => /ackToken|acknowledge/.test(p) && /\bask\b/i.test(p) && /\b(human|operator)\b/i.test(p)
    && /\b(only after|before)\b/i.test(p) && /\bown message\b/i.test(p));
  assert.ok(rule, 'SKILL.md: a paragraph saying the ack token is passed only after the human says yes in their own message');
  assert.match(rule, /never\b/i, 'the rule is stated as a prohibition, not a suggestion');
});

test('"one config per agent per channel" carries [source-derived] wherever it is stated', () => {
  const hits = caLines.filter(({ line }) => /one config per agent per channel/i.test(line));
  assert.ok(hits.length >= 1, 'the outbound reference states the config cardinality');
  const unmarked = hits.filter(({ line }) => !line.includes('[source-derived')).map((h) => h.where);
  assert.deepEqual(unmarked, []);
});

test('the three lead-form trigger types are named as not executable, and the six executable ones are listed', () => {
  const leadForm = caLines.filter(({ line }) => ['facebook_lead_form', 'google_lead_form', 'tiktok_lead_form'].every((t) => line.includes(t)));
  assert.ok(leadForm.some(({ line }) => /not executable|refuse/i.test(line)), 'a line names all three and says they are refused / not executable');
  const six = ['contact_tag', 'contact_created', 'form_submitted', 'appointment_status_updated', 'opportunity_status_updated', 'missed_call'];
  assert.ok(caLines.some(({ line }) => six.every((t) => line.includes(t))), 'a line lists the six executable types');
});

test('only contact_tag is marked as fired; the other five executable types are create-proven and fire-unmeasured', () => {
  const ref = read(join(CA_DIR, 'references/outbound-and-campaigns.md'));
  const rows = ref.split('\n').filter((l) => /^\| `(contact_created|form_submitted|appointment_status_updated|opportunity_status_updated|missed_call)` \|/.test(l));
  assert.equal(rows.length, 5, 'the type table has a row for each of the five non-contact_tag types');
  for (const r of rows) {
    assert.match(r, /created.*read back.*\[proven-live 2026-10-29\]/i, `create proven live: ${r}`);
    assert.match(r, /never fired|fire unmeasured/i, `firing stated as unmeasured: ${r}`);
    assert.doesNotMatch(r, /write blocked|never stored|\[source-derived/i, `stale claim gone: ${r}`);
  }
  const tag = ref.split('\n').find((l) => /^\| `contact_tag` \|/.test(l)) ?? '';
  assert.match(tag, /\[proven-live/);
  assert.match(tag, /fired/);
  for (const [name, text] of [['SKILL.md', skillMd], ['patterns.md', read(join(CA_DIR, '../ghl-workflow-specialist/references/patterns.md'))]]) {
    assert.doesNotMatch(text, /UI-built and never stored|UI-built and has never\s+been stored/, `${name}: no stale never-stored claim`);
  }
});

test('an armed agent outside its working hours may not fire is recorded as [inferred], with the operator instruction', () => {
  const ref = read(join(CA_DIR, 'references/outbound-and-campaigns.md'));
  const line = ref.split('\n').find((l) => /working hours/i.test(l) && /\[inferred/.test(l) && /may (not fire|hold)|not fire/i.test(l)) ?? '';
  assert.ok(line, 'outbound reference: working hours may hold trigger fires [inferred]');
  assert.match(ref, /check (the agent's )?working hours/i);
  assert.match(ref, /released/i);
});

test('the partial-PUT wording follows the 2026-10-30 measurement and keeps read-merge-write', () => {
  assert.ok(skillMd.split('\n').some((l) => /partial/i.test(l) && /merge/i.test(l) && l.includes('2026-10-30')), 'SKILL.md: partial PUT merged on 2026-10-30');
  assert.match(skillMd, /read-merge-write/);
});

test('the workflow specialist knows the native outbound options and their failure modes', () => {
  const ws = (f) => read(join(SKILLS, 'ghl-workflow-specialist/references', f));
  const pat = ws('patterns.md'), anti = ws('anti-patterns.md'), tac = ws('trigger-action-catalog.md');
  for (const t of ['missed_call', 'AI Campaign', 'outbound trigger', 'form_submitted']) assert.ok(pat.includes(t), `patterns.md: ${t}`);
  for (const t of ['ai_generated', 'outbound trigger', 'AI Campaign', 'de-dup']) assert.ok(anti.includes(t), `anti-patterns.md: ${t}`);
  assert.ok(tac.includes('form_submitted') && tac.includes('form_submission'), 'trigger-action-catalog.md: the two form slugs are told apart');
});

test('orientation no longer calls the per-contact switch the only internal-only Conversation AI corner', () => {
  const or = read(join(SKILLS, 'ghl-orientation/SKILL.md'));
  const aw = read(join(SKILLS, 'ghl-orientation/references/api-worlds.md'));
  for (const [name, text] of [['SKILL.md', or], ['api-worlds.md', aw]]) {
    assert.match(text, /outbound/i, `${name}: outbound`);
    assert.match(text, /AI Campaign/i, `${name}: AI Campaigns`);
  }
});
