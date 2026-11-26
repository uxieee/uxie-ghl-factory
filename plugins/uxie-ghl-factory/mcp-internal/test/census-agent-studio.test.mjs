// Shapes are the COMMITTED corpus (knowledge main): corpus/ai-agents/10-anatomy/managed-agent-shape.md "The record" (status, hasPublishedVersion, hasUnpublishedChanges, versionId, config),
// "Triggers" (config.triggers[] of {type,name,enabled:boolean,config,triggerMessage}), the unpublish read-back (status draft + hasPublishedVersion false), and the agents-with-folders envelope
// {items, folders, total, totalAgents, totalFolders} (same page, line 179). Voice: the committed detail shapes carry no top-level outbound off switch (audit-configuration.mjs tombstone rule: row.tombstone).
import test from 'node:test';
import assert from 'node:assert/strict';
import { convAiCensus as realConvAiCensus } from '../../skills/create-ghl-workflow/scripts/convai-census.mjs';
// Agent Studio is always cleared by the strict folders read: an empty listing unless a test passes its own reader.
const emptyStudioRead = async () => ({ ok: true, json: { items: [], folders: [], total: 0, totalAgents: 0, totalFolders: 0, page: 1, pageSize: 100, hasMore: false } });
const convAiCensus = (args) => realConvAiCensus({ read: emptyStudioRead, locationId: 'locAAAAAAAAAAAAAAAAA', ...args });
import { bundleComponentsCensus, bundleComponentsRecord, judgeStudioAgent, judgeVoiceAgent, RUN_EXEMPTIONS, exempt, VOICE_OFF_FIELD } from '../../skills/create-ghl-workflow/scripts/bundle-components-census.mjs';
import { convAiClean, censusClean, censusRecord } from '../../skills/create-ghl-workflow/scripts/published-trigger-census.mjs';
const conv = { complete: true, cursorWalk: { served: 0, totalCount: 0 }, items: [] };
const studio = (...items) => ({ complete: true, items, totalHistory: [items.length] }); // the real component has no totalFolders key
const voice = (...items) => ({ complete: true, items });
const rec = (cfgTriggers, over = {}) => ({ status: 'published', hasPublishedVersion: true, hasUnpublishedChanges: false, versionId: 'v-draft', config: { triggers: cfgTriggers }, ...over });
const agent = (cfgTriggers, over = {}) => ({ id: 'ag-1', detailRead: true, detail: rec(cfgTriggers, over) });
const trig = (type, over = {}) => ({ type, name: 'x', enabled: true, config: {}, triggerMessage: '', ...over });
const listing = (items) => async () => ({ ok: true, json: { items: items.map((i) => ({ id: i.id })), folders: [], total: items.length, totalAgents: items.length, totalFolders: 0, page: 1, pageSize: 100, hasMore: false } });
const run = (components, plannedTags = []) => convAiCensus({ call: async () => ({ ok: true, data: { components: { conversation_ai: conv, ...components } } }), plannedTags, read: listing(components.agent_studio?.items ?? []) });
test('clean: every component read, complete and empty', async () => {
  const c = await run({ voice_ai: voice(), agent_studio: studio() });
  assert.equal(c.ok, true); assert.equal(c.blocks, false); assert.ok(convAiClean(c));
});
test('1 shape: triggers live in config.triggers; a real published agent with every trigger off is readable and clean', () => {
  assert.equal(judgeStudioAgent(agent([trig('chat', { enabled: false }), trig('contact_created', { enabled: false })])).blocks, false);
  assert.equal(judgeStudioAgent(agent([trig('chat')])).blocks, true);
  assert.equal(judgeStudioAgent({ id: 'a', detailRead: true, detail: { status: 'published', hasPublishedVersion: true, hasUnpublishedChanges: false, triggers: [] } }).blocks, true, 'top-level triggers only: shape not the corpus one');
  assert.equal(judgeStudioAgent(agent([trig('chat', { enabled: false })], { triggers: [] })).blocks, true, 'a top-level triggers key as well = block');
  for (const enabled of [undefined, 'false', 1, null]) { const t = trig('chat'); if (enabled === undefined) delete t.enabled; else t.enabled = enabled; assert.equal(judgeStudioAgent(agent([t])).blocks, true, String(enabled)); }
  assert.equal(judgeStudioAgent(agent(null)).blocks, true);
});
test('2 published state: only status draft AND hasPublishedVersion false is not-published; everything else is judged', () => {
  const live = [trig('chat')];
  assert.equal(judgeStudioAgent(agent(live, { status: 'draft', hasPublishedVersion: false })).blocks, false);
  for (const over of [{ status: 'draft', hasPublishedVersion: true }, { status: 'published', hasPublishedVersion: false }, { status: 'live' }, { status: undefined }, { status: 'draft', hasPublishedVersion: undefined }, { published: false, status: 'published' }, { status: 'draft', hasPublishedVersion: 'false' }]) assert.equal(judgeStudioAgent(agent(live, over)).blocks, true, JSON.stringify(over));
  // a draft read with all triggers off but an unreadable published flag cannot pass either
  assert.equal(judgeStudioAgent(agent([trig('chat', { enabled: false })], { status: 'draft', hasPublishedVersion: true })).blocks, true);
});
test('3 an edited published agent blocks even when the draft triggers are all off (versionId is the draft)', () => {
  for (const hasUnpublishedChanges of [true, undefined, null, 'false']) assert.equal(judgeStudioAgent(agent([trig('chat', { enabled: false })], { hasUnpublishedChanges })).blocks, true, String(hasUnpublishedChanges));
  assert.equal(judgeStudioAgent(agent([trig('chat', { enabled: false })], { hasUnpublishedChanges: false })).blocks, false);
});
test('a published studio agent on contact_created, form, workflows or schedule BLOCKS both censuses', async () => {
  for (const type of ['contact_created', 'form', 'workflows', 'schedule', 'brand_new_type', 'tag']) {
    const c = await run({ voice_ai: voice(), agent_studio: studio(agent([trig(type)])) });
    assert.equal(c.blocks, true, type); assert.equal(convAiClean(c), false); assert.equal(censusClean({ ok: true, blockers: [], convAi: c }), false);
  }
});
test('exemptions: none exist today; a run S that is not in RUN_EXEMPTIONS exempts nothing', () => {
  assert.deepEqual(Object.keys(RUN_EXEMPTIONS), []);
  const S = 'a'.repeat(40);
  for (const kind of ['studio', 'convAi']) assert.equal(exempt(S, kind, 'chat'), false);
  assert.equal(judgeStudioAgent(agent([trig('chat')]), [], S).blocks, true);
  assert.equal(exempt('not-a-sha', 'studio', 'chat'), false);
});
test('unreadable studio agent: no detail or no config BLOCKS', () => {
  for (const item of [{ id: 'a' }, { id: 'a', detailRead: true, detail: null }, { id: 'a', detailRead: true, detail: { status: 'published', hasPublishedVersion: true, hasUnpublishedChanges: false } }]) assert.equal(judgeStudioAgent(item).blocks, true);
});
test('a component that is missing, incomplete, not a list, or unknown makes the census not ok', async () => {
  for (const components of [{ voice_ai: voice() }, { agent_studio: studio() }, { voice_ai: voice(), agent_studio: { complete: false, items: [] } }, { voice_ai: voice(), agent_studio: { complete: true } }, { voice_ai: voice(), agent_studio: studio(), superagents: studio() }]) {
    const c = await run(components);
    assert.equal(c.ok, false); assert.equal(c.blocks, true); assert.equal(convAiClean(c), false);
  }
});
test('4 voice: no committed off switch exists, so every non-tombstone agent blocks, whatever its outbound-looking keys say', () => {
  assert.equal(VOICE_OFF_FIELD, null);
  for (const detail of [{ outboundWelcome: null, settings: { outboundEnabled: true } }, { outboundNote: null, callDirection: 'OUTBOUND' }, { outboundEnabled: false }, { name: 'x' }, {}]) assert.equal(judgeVoiceAgent({ id: 'v', detailRead: true, detail }).blocks, true, JSON.stringify(detail));
  assert.equal(judgeVoiceAgent({ id: 'v' }).blocks, true);
  assert.equal(judgeVoiceAgent({ id: 'v', tombstone: true }).blocks, false);
});
test('5 list wholeness: studio needs a finite total equal to the rows AND the strict folders read as proof', () => {
  const comps = (agent_studio) => ({ components: { conversation_ai: conv, voice_ai: voice(), agent_studio } });
  const base = studio(), proof = { ok: true, blocks: false, totalAgents: 0, unionIds: 0, totalFolders: 0 };
  assert.equal(bundleComponentsCensus(comps(base), [], null, proof).ok, true);
  assert.equal(bundleComponentsCensus(comps(base)).ok, false, 'no proof (zero agents included) blocks');
  for (const bad of [{ complete: true, items: [] }, { ...base, totalHistory: [3] }, { ...base, totalHistory: [null] }, { ...base, totalHistory: ['0'] }, { ...base, totalFolders: 2 }]) {
    const c = bundleComponentsCensus(comps(bad), [], null, proof); assert.equal(c.ok, false, JSON.stringify(bad)); assert.equal(c.blocks, true);
  }
  for (const p of [{ ...proof, ok: false }, { ...proof, blocks: true }, { ...proof, totalAgents: 1 }, { ...proof, unionIds: 1 }, { ...proof, totalFolders: undefined }]) assert.equal(bundleComponentsCensus(comps(base), [], null, p).ok, false, JSON.stringify(p));
});
test('6 the record carries ids, types and reasons (never names or tags), through censusRecord too', async () => {
  const c = await run({ voice_ai: voice({ id: 'v-1', detailRead: true, detail: { name: 'Secret Voice' } }), agent_studio: studio({ ...agent([trig('tag', { name: 'secret-tag', config: { tagNames: ['secret-tag'] } })]), name: 'Secret Bot' }) });
  const own = JSON.stringify(bundleComponentsRecord(bundleComponentsCensus({ components: { conversation_ai: conv, voice_ai: voice(), agent_studio: studio({ ...agent([trig('tag', { name: 'secret-tag' })]), name: 'Secret Bot' }) } })));
  assert.ok(!/secret/i.test(own)); assert.match(own, /tag trigger is enabled/);
  const out = JSON.stringify(censusRecord({ ok: false, total: 0, blockers: [], convAi: c, pausable: [] }));
  assert.ok(!/secret/i.test(out)); assert.match(out, /otherComponents/); assert.match(out, /"type":"agent_studio"/); assert.match(out, /"type":"voice_ai"/); assert.match(out, /ag-1/); assert.match(out, /v-1/);
});

test('QA point 2: status published with hasPublishedVersion false (or absent) is contradictory and blocks even with every trigger off; live-but-all-off needs hasPublishedVersion exactly true', () => {
  const off = [trig('chat', { enabled: false })];
  for (const hasPublishedVersion of [false, undefined, null, 'true']) assert.equal(judgeStudioAgent(agent(off, { status: 'published', hasPublishedVersion })).blocks, true, String(hasPublishedVersion));
  assert.equal(judgeStudioAgent(agent(off, { status: 'published', hasPublishedVersion: true })).blocks, false);
});
test('QA point 1: a live contact_tag on an unrelated tag and a live contact_changed on any field BLOCK (default-block); a run-specific exemption does not exist', async () => {
  const { judgeTrigger, EVENT_SETS } = await import('../../skills/create-ghl-workflow/scripts/published-trigger-census.mjs');
  const tag = { type: 'contact_tag', active: true, conditions: [{ field: 'tagsAdded', operator: 'index-of-true', value: 'unrelated-tag' }] };
  const chg = { type: 'contact_changed', active: true, conditions: [{ field: 'contact.city', operator: 'has-changed', value: '' }] };
  for (const es of [EVENT_SETS.core, EVENT_SETS.conversation]) for (const t of [tag, chg]) assert.equal(judgeTrigger(t, es).decision, 'blocks', t.type);
  assert.equal(judgeTrigger({ ...tag, active: false }, EVENT_SETS.core).decision, 'inactive');
});
