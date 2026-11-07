import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripBlocks } from '../scripts/render-rail-ledger.mjs';

// W5b (2026-10-30): skills corrected from the live release-wave walks (knowledge/sniffs/*-wave-2026-10-*/).
// DENY lines are claims a walk disproved; REQUIRE terms are regression guards for what the walk proved.

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILLS = resolve(HERE, '../../skills');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.md') ? [p] : []; });
const skillText = (name) => walk(join(SKILLS, name)).map((p) => stripBlocks(readFileSync(p, 'utf8'))).join('\n');
const hits = (text, re) => text.split('\n').filter((l) => re.test(l));

test('ghl-ai-studio: the stack, the build statuses and the spend meter match the 2026-10-30 walk', () => {
  const t = skillText('ghl-ai-studio');
  assert.deepEqual(hits(t, /generates a \*\*Vite \+ React/), [], 'new projects are TanStack Start, not Vite + React');
  assert.deepEqual(hits(t, /`failed` build status — still never observed/), [], 'a failed build was observed (stored as superseded)');
  assert.deepEqual(hits(t, /The tell was in the data the tool already returns: `diffs\[\]\.action` said/), [],
    'Created vs Edited is not a reliable tell: a rewrite of an existing file logged Created');
  for (const term of ['tanstack_start_ts', 'superseded', 'agency_free_ai', 'spendMeter', 'policy.fup', 'vibepreview.app']) {
    assert.ok(t.includes(term), `ghl-ai-studio must name ${term}`);
  }
  assert.match(t, /Cloud/); assert.match(t, /Payments/); assert.match(t, /Chat Widgets?/); assert.match(t, /GitHub|Git sync/i);
});

test('agent-studio.md: model, memory, triggers, save semantics and the 2026-10 config keys match the walk', () => {
  const t = stripBlocks(readFileSync(join(SKILLS, 'ghl-conversation-ai/references/agent-studio.md'), 'utf8'));
  assert.deepEqual(hits(t, /Underlying model:\s*$|^`anthropic\/claude-sonnet-4-6`\. Not the public/), [], 'the default is sonnet-5-5 now');
  assert.deepEqual(hits(t, /Memory\*\* tab marked "SOON"/), [], 'Memory is live');
  assert.deepEqual(hits(t, /All 13 types the editor offers/), [], '16 types in the server vocabulary');
  assert.deepEqual(hits(t, /^## PUT is whole-object replace/), [], 'the server keeps keys a PUT omits');
  assert.deepEqual(hits(t, /not yet used by this plugin\)/), [], 'the direct save is the n8n import and new-UI save');
  for (const term of ['claude-sonnet-5-5', 'subagents', 'memoryEnabled', 'wait_until', 'importOrigin', 'sandbox_browser',
    'customer_reply', 'inbound_webhook', 'subagent_failed', 'approvalRevision']) {
    assert.ok(t.includes(term), `agent-studio.md must name ${term}`);
  }
});

test('ghl-forms: CRM-object forms, server-side submit validation, side-effect writes and the Integrate tab match the walk', () => {
  const t = skillText('ghl-forms');
  assert.deepEqual(hits(t, /The only guard is the widget/), [], 'the submit endpoint validates server-side');
  assert.deepEqual(hits(t, /A submission through the widget creates a contact and fires/), [], 'a company-only form creates no contact');
  assert.deepEqual(hits(t, /Quiz and survey \*\*saves\*\* were/), [], 'a quiz save was executed live');
  assert.deepEqual(hits(t, /That is the same URL\s*$|^the Integrate panel embeds\.$|That is the same URL the Integrate panel embeds/), [], 'Integrate embeds the white-label domain');
  for (const term of ['standard_field', 'contactId: null', 'opportunitySettings', 'opportunities.decoupling', 'QR', 'wallet pass',
    'billing-address', 'showRecommendationsBeforeSaving', 'Opportunity Name is required']) {
    assert.ok(t.includes(term), `ghl-forms must name ${term}`);
  }
});

test('ghl-calendars exists, triggers on the calendar asks, and carries the traps the 2026-10 walk found', () => {
  const p = join(SKILLS, 'ghl-calendars/SKILL.md');
  assert.ok(existsSync(p), 'skills/ghl-calendars/SKILL.md');
  const raw = readFileSync(p, 'utf8');
  const desc = raw.match(/^description:\s*(.+)$/m)?.[1] ?? '';
  for (const ask of ['appointment', 'service', 'rental', 'status', 'slot']) assert.match(desc, new RegExp(ask, 'i'), `description names ${ask}`);
  const t = skillText('ghl-calendars');
  for (const term of ['subAccountConfig.modules', 'serviceId', 'calendarId', 'toNotify', 'openHours', 'statusId', 'state',
    'service_booking', 'isMigrationCompleted', 'bookings/create', 'recurringEventUpdateType', 'calendars-v3__']) {
    assert.ok(t.includes(term), `ghl-calendars must name ${term}`);
  }
});

test('ghl-orientation routes calendars, services and rentals to ghl-calendars', () => {
  const t = skillText('ghl-orientation');
  assert.match(t, /ghl-calendars/);
  assert.match(t.split('\n').find((l) => l.includes('ghl-calendars')) ?? '', /[Ss]ervices|[Rr]entals/);
});

test('ghl-workflow-specialist warns that calendar-filtered appointment triggers miss service bookings', () => {
  const t = skillText('ghl-workflow-specialist');
  assert.match(t, /calendarId[^\n]*service|service[^\n]*calendarId/i);
});

test('Task 9: communities, blog comments and brand boards are taught from the 2026-10-30 walk', () => {
  const m = skillText('ghl-memberships');
  for (const term of ['discovery', 'blockedKeywords', 'never held', 'newsletter']) assert.ok(m.includes(term), `ghl-memberships must name ${term}`);
  const f = skillText('ghl-funnels-pages');
  for (const term of ['c-blog-comments', '/blogs/comments/settings', 'fontId', 're-minted', 'default board']) assert.ok(f.includes(term), `ghl-funnels-pages must name ${term}`);
  assert.match(skillText('ghl-orientation'), /blog comment/i);
});

// W5b Task 7 eval finding: in the skill suite the agent never reached references/agent-studio.md (0/5 on the subagent-model
// and Computer cases) — Managed Agents were not named where routing happens. The traps must be on the routed path.
test('Managed Agents are reachable: named in the ghl-conversation-ai description, traps in SKILL.md, routed from orientation', () => {
  const raw = readFileSync(join(SKILLS, 'ghl-conversation-ai/SKILL.md'), 'utf8');
  const desc = raw.match(/^description:\s*(.+)$/m)?.[1] ?? '';
  assert.match(desc, /Managed Agent/);
  assert.match(desc, /subagent/i);
  assert.match(desc, /Computer/);
  const body = stripBlocks(raw);
  assert.ok(body.includes('gemini-3.8-flash'), 'SKILL.md names the subagent model that fails at run time');
  assert.match(body, /no stop/i, 'SKILL.md warns that Computer has no stop route');
  const o = skillText('ghl-orientation');
  assert.ok(o.split('\n').some((l) => /Managed Agents/.test(l) && /agent-studio\.md/.test(l)), 'orientation routes Managed Agents to agent-studio.md');
});

test('final review: no stale replace wording, no claim stronger than the walk', () => {
  const as = stripBlocks(readFileSync(join(SKILLS, 'ghl-conversation-ai/references/agent-studio.md'), 'utf8'));
  assert.deepEqual(hits(as, /as a full-replace|full-replace PUT/), [], 'the server keeps keys a PUT omits');
  const forms = skillText('ghl-forms');
  assert.deepEqual(hits(forms, /that creates the billing-address contact fields if missing/), [], 'that effect is inferred');
  const cal = skillText('ghl-calendars');
  assert.deepEqual(hits(cal, /without `altId`\/`altType` it answers \*\*500\*\*/), [], 'the 500 had two variables');
  const fp = skillText('ghl-funnels-pages');
  assert.deepEqual(hits(fp, /Every builder that offers board colours/), [], 'only QR codes were shown');
  const mem = skillText('ghl-memberships');
  assert.deepEqual(hits(mem, /listed on the public marketplace unless `discovery: false`/), [], 'only the body difference is proven');
});
