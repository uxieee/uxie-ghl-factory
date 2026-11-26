import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const OTHERS_EMPTY = { voice_ai: { complete: true, items: [] }, agent_studio: { complete: true, items: [], totalHistory: [0], totalFolders: 0 } }; // the two other bundle components, read and empty
import { join, dirname } from 'node:path';
const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '../../skills/create-ghl-workflow/scripts');
const src = readFileSync(join(SCRIPTS, 'conformance.mjs'), 'utf8');
const { publishedTriggerCensus, unpublishCandidates, censusRecord } = await import(join(SCRIPTS, 'published-trigger-census.mjs'));

const { censusClean } = await import(join(SCRIPTS, 'published-trigger-census.mjs'));
const { judgeTrigger, judgeConditions, EVENT_SETS } = await import(join(SCRIPTS, 'published-trigger-census.mjs'));
const CORE = EVENT_SETS.core, CONV = EVENT_SETS.conversation;
const fake = (rows, triggers, { complete = true, failFirst = [] } = {}) => {
  const reads = {};
  return { reads,
    call: async () => ({ ok: true, data: { complete, workflows: rows } }),
    gw: { call: async (_m, path) => { const id = decodeURIComponent(path.split('workflowId=')[1]); reads[id] = (reads[id] ?? 0) + 1;
      if (failFirst.includes(id) && reads[id] === 1) return { ok: false, json: null };
      const t = triggers[id]; return t === undefined ? { ok: false, json: null } : { ok: true, json: { triggers: t } }; } } };
};
const tagTrig = (value, over = {}) => ({ type: 'contact_tag', active: true, conditions: [{ field: 'tagsAdded', operator: 'index-of-true', value }], ...over });
const chgTrig = (field, op = 'has-changed') => ({ type: 'contact_changed', active: true, conditions: [{ field, operator: op, value: 'SECRET-VALUE' }] });

test('census: contact_created always blocks', () => {
  assert.equal(judgeTrigger({ type: 'contact_created', active: true }, CORE).decision, 'blocks');
});
test('census: contact_tag — an exact tag the run never adds ALSO blocks (default-block, QA point 1); no conditions, a test-conf tag, or another operator block', () => {
  assert.equal(judgeTrigger(tagTrig('ai:handover'), CORE).decision, 'blocks');
  assert.deepEqual(judgeTrigger(tagTrig('ai:handover'), CORE).tags, ['ai:handover']);
  assert.equal(judgeTrigger({ type: 'contact_tag', active: true, conditions: [] }, CORE).decision, 'blocks');
  assert.equal(judgeTrigger(tagTrig('test-conf-123456-x'), CORE).decision, 'blocks');
  assert.equal(judgeTrigger({ type: 'contact_tag', active: true, conditions: [{ field: 'tagsAdded', operator: 'contains', value: 'a' }] }, CORE).decision, 'blocks');
  assert.equal(judgeTrigger({ type: 'contact_tag', active: true, conditions: [{ field: 'tagsAdded', operator: 'index-of-false', value: 'a' }] }, CORE).decision, 'blocks');
});
test('census: contact_changed — every field blocks (default-block); conditions only describe the row', () => {
  for (const f of ['contact.address1', 'contact.city', 'contact.state', 'contact.country', 'contact.postalCode', 'contact.website', 'contact.dateOfBirth', 'contact.companyName', 'contact.PlaceholderCfId00001'])
    assert.equal(judgeTrigger(chgTrig(f), CORE).decision, 'blocks', f);
  for (const f of ['contact.firstName', 'contact.email', 'contact.type', 'contact.assignedTo', 'contact.source', 'contact.dnd', 'contact.dnd_channel', 'contact.dnd_direction', 'contact.dndSettings', 'contact.somethingElse'])
    assert.equal(judgeTrigger(chgTrig(f), CORE).decision, 'blocks', f);
  assert.equal(judgeTrigger({ type: 'contact_changed', active: true, conditions: [] }, CORE).decision, 'blocks');
  assert.equal(judgeTrigger(chgTrig('contact.PlaceholderCfId00001', 'contains'), CORE).decision, 'blocks');
});
test('census: every row must be recognised AND unsatisfiable — a mixed two-row trigger blocks (contact_tag and contact_changed)', () => {
  const tagRow = (value, field = 'tagsAdded', operator = 'index-of-true') => ({ field, operator, value });
  assert.equal(judgeTrigger({ type: 'contact_tag', active: true, conditions: [tagRow('ai:handover'), tagRow('ai:handover2')] }, CORE).decision, 'blocks');
  assert.equal(judgeTrigger({ type: 'contact_tag', active: true, conditions: [tagRow('ai:handover'), tagRow('test-conf-123456-x')] }, CORE).decision, 'blocks');
  assert.equal(judgeTrigger({ type: 'contact_tag', active: true, conditions: [tagRow('ai:handover'), tagRow('x', 'tagsAdded', 'contains')] }, CORE).decision, 'blocks');
  assert.equal(judgeTrigger({ type: 'contact_tag', active: true, conditions: [tagRow('ai:handover'), tagRow('x', 'somethingNew')] }, CORE).decision, 'blocks');
  const ch = (field, operator = 'has-changed', value = 'v') => ({ field, operator, value });
  assert.equal(judgeTrigger({ type: 'contact_changed', active: true, conditions: [ch('contact.city'), ch('contact.PlaceholderCfId00001')] }, CORE).decision, 'blocks');
  assert.equal(judgeTrigger({ type: 'contact_changed', active: true, conditions: [ch('contact.city'), ch('contact.email')] }, CORE).decision, 'blocks');
  assert.equal(judgeTrigger({ type: 'contact_changed', active: true, conditions: [ch('contact.city'), ch('contact.dnd_channel')] }, CORE).decision, 'blocks');
  assert.equal(judgeTrigger({ type: 'contact_changed', active: true, conditions: [ch('contact.city'), ch('contact.city', 'is-any-of')] }, CORE).decision, 'blocks');
});
test('census: an array or non-string value blocks', () => {
  assert.equal(judgeTrigger({ type: 'contact_tag', active: true, conditions: [{ field: 'tagsAdded', operator: 'index-of-true', value: ['ai:handover'] }] }, CORE).decision, 'blocks');
  assert.equal(judgeTrigger({ type: 'contact_tag', active: true, conditions: [{ field: 'tagsAdded', operator: 'index-of-true', value: 5 }] }, CORE).decision, 'blocks');
  assert.equal(judgeTrigger({ type: 'contact_tag', active: true, conditions: [{ field: 'tagsAdded', operator: 'index-of-true', value: '' }] }, CORE).decision, 'blocks');
  assert.equal(judgeTrigger({ type: 'contact_changed', active: true, conditions: [{ field: 'contact.city', operator: 'has-changed', value: ['a'] }] }, CORE).decision, 'blocks');
  assert.equal(judgeTrigger({ type: 'contact_changed', active: true, conditions: [{ field: 'contact.city', operator: 'has-changed', value: { a: 1 } }] }, CORE).decision, 'blocks');
  assert.equal(judgeTrigger({ type: 'contact_tag', active: true, conditions: [null] }, CORE).decision, 'blocks');
});
test('census: conv_ai_* and customer_reply BLOCK in every event set (default-block, QA 2026-11-22 points 7-8)', () => {
  const CLEAN = { ok: true, blocks: false, agents: [] };
  for (const type of ['conv_ai_trigger', 'conv_ai_autonomous_trigger', 'customer_reply']) {
    const inb = { name: 'x', conversation: true, inboundMessage: true, customFieldWrite: false, formSubmission: false, dndWrite: false };
    const y = judgeTrigger({ type, active: true }, inb, CLEAN); assert.equal(y.decision, 'blocks', type); assert.equal(y.flag, 'inboundMessage');
    for (const es of [CORE, CONV]) { const n = judgeTrigger({ type, active: true }, es, CLEAN); assert.equal(n.decision, 'blocks', type); }
  }
  assert.equal(CORE.inboundMessage, false); assert.equal(CONV.inboundMessage, false);
});
test('conformance: no step or call anywhere in the suite creates an inbound, sms, email, call or chat-widget contact message', () => {
  const code = src.replace(/\/\/.*$/gm, '');
  assert.ok(!/\/conversations\/messages/.test(code), 'no POST of a conversation message');
  assert.ok(!/direction:\s*['"]inbound/i.test(code) && !/type:\s*['"](SMS|Email|WhatsApp|Live_Chat|FB|IG|Call|GMB|Custom)['"]/.test(code), 'no message-creation body');
  assert.match(code, /RECORD contact-d \$\{ids\[3\]\}/); assert.match(code, /RECORD member-contact \$\{mid\}/);
});
test('census: every live trigger type BLOCKS by default (no NOT_IN_SET, no allow-list); only active:false is ignored', () => {
  for (const type of ['appointment', 'customer_appointment', 'call_status', 'payment_received', 'refund', 'event_registration', 'event_check_in', 'facebook_lead_gen', 'opportunity_decay', 'pipeline_stage_updated', 'message_failed_prod', 'whatsapp_disconnected_prod', 'coupon_code_redeemed', 'note_add', 'inbound_webhook', 'scheduler'])
    assert.equal(judgeTrigger({ type, active: true }, CONV).decision, 'blocks', type);
  assert.equal(judgeTrigger({ type: 'brand_new_type', active: true }, CORE).decision, 'blocks');
  assert.equal(judgeTrigger({ active: true }, CORE).decision, 'blocks');
  assert.equal(judgeTrigger({ type: 'contact_created', active: false }, CORE).decision, 'inactive');
});
test('census: workflows are classified; TEST-CONF blockers are candidates; an incomplete list is not ok', async () => {
  const f = fake([{ id: 'a', name: 'TEST-CONF-x-1' }, { id: 'b', name: 'Client flow' }, { id: 'c', name: 'Fine' }],
    { a: [{ type: 'contact_created', active: true }], b: [{ type: 'dnd_contact', active: true }], c: [tagTrig('zz-other'), { type: 'appointment', active: true }] });
  const c = await publishedTriggerCensus({ ...f, LOCATION: 'L', eventSet: CONV });
  assert.deepEqual(c.candidates.map((x) => x.id), ['a']); assert.deepEqual(c.nonTest.map((x) => x.id), ['b', 'c']); assert.equal(c.blockers.length, 3, 'the appointment trigger blocks by default too');
  const core = await publishedTriggerCensus({ ...f, LOCATION: 'L', eventSet: CORE });
  assert.deepEqual(core.nonTest.map((x) => x.id), ['b', 'c'], 'default-block: dnd_contact blocks in the core event set too');
  assert.equal((await publishedTriggerCensus({ ...fake([], {}, { complete: false }), LOCATION: 'L' })).ok, false);
});
test('census: an unreadable trigger list is retried once, and still blocks if it stays unreadable', async () => {
  const f = fake([{ id: 'a', name: 'Flaky' }, { id: 'b', name: 'Gone' }], { a: [{ type: 'scheduler', active: true }] }, { failFirst: ['a'] });
  const c = await publishedTriggerCensus({ ...f, LOCATION: 'L', eventSet: CORE });
  assert.equal(f.reads.a, 2); assert.equal(f.reads.b, 2);
  assert.deepEqual(c.blockers.map((x) => x.id), ['a', 'b'], 'the scheduler trigger blocks by default, and the unreadable list blocks'); assert.deepEqual(c.rows.find((r) => r.id === 'b').blocking, ['UNREADABLE']);
});
test('census record: id, name, type, decision, reason, tag names and field names only — no other condition value', async () => {
  const f = fake([{ id: 'a', name: 'n' }, { id: 'b', name: 'm' }], { a: [chgTrig('contact.CF1')], b: [tagTrig('ai:handover')] });
  const rec = JSON.stringify(censusRecord(await publishedTriggerCensus({ ...f, LOCATION: 'L', eventSet: CORE })));
  assert.ok(!/SECRET-VALUE/.test(rec)); assert.ok(rec.includes('ai:handover') && rec.includes('contact.CF1'));
});
test('conformance: an event set that does not match the stop point exits 2 before any call; a bad name exits 2', async () => {
  const { spawnSync } = await import('node:child_process');
  const run = (...a) => spawnSync('node', [join(SCRIPTS, 'conformance.mjs'), ...a], { env: { PATH: process.env.PATH, HOME: '/nonexistent/home', GHL_LOCATION: 'x', GHL_INTERNAL_TOK_FILE: '/nonexistent/tok.txt' }, encoding: 'utf8' });
  assert.equal(run('--through=runtime-core', '--event-set=conversation').status, 2);
  assert.equal(run('--through=pre-copy', '--event-set=core').status, 2);
  assert.equal(run('--through=pre-copy').status, 2);
  assert.equal(run('--through=custom-code', '--event-set=bogus').status, 2);
});
test('unpublishCandidates: id AND name proven, listed first, read back as draft; refuses on a mismatch or a non-TEST-CONF target', async () => {
  const state = { a: { name: 'TEST-CONF-x-1', status: 'published' } };
  const calls = [];
  const call = async (t, a) => { calls.push(t);
    if (t === 'get_workflow') return { ok: true, data: { name: state[a.workflowId]?.name ?? null, status: state[a.workflowId]?.status ?? null } };
    if (t === 'unpublish_workflows') { for (const id of a.workflowIds) state[id].status = 'draft'; return { ok: true }; } };
  const lines = [];
  const ok = await unpublishCandidates({ call, candidates: [{ id: 'a', name: 'TEST-CONF-x-1', blocking: ['contact_tag'] }], print: (l) => lines.push(l) });
  assert.equal(ok.ok, true); assert.equal(state.a.status, 'draft'); assert.ok(lines[0].includes('UNPUBLISHED') && lines[1].includes('TEST-CONF-x-1'));
  const bad = await unpublishCandidates({ call, candidates: [{ id: 'a', name: 'TEST-CONF-other', blocking: ['x'] }], print: () => {} });
  assert.equal(bad.ok, false);
  const non = await unpublishCandidates({ call, candidates: [{ id: 'z', name: 'Client flow', blocking: ['x'] }], print: () => {} });
  assert.equal(non.ok, false); assert.ok(!calls.includes('delete'));
});
test('conformance: the runtime probe is unpublished in a finally, and no contact is created with the generic test-conf tag', () => {
  const pub = src.indexOf("const pub = await confirmedCall(call, 'publish_workflow', { workflowId: rwid })");
  const un = src.indexOf("un = await unpublishAndAssertDraft(call, check, rwid, 'probe')");
  const fin = src.lastIndexOf('} finally {', un);
  assert.ok(pub > 0 && src.lastIndexOf('try {', pub) > 0 && fin > pub && un - fin < 80, 'publish sits inside a try whose OUTER finally unpublishes rwid');
  assert.ok(!/'\/contacts\/', \{[^\n]*tags: \['test-conf'[,\]]/.test(src), 'no contact is created with the generic tag');
  for (const f of ['multipath-insert-proof.mjs', 'delete-branch-proof.mjs']) assert.ok(!/tags: \['test-conf'[,\]]/.test(readFileSync(join(SCRIPTS, f), 'utf8')), f);
});
test('conformance: the census gate runs before the runtime contacts, before the member contact and before the multipath proofs', () => {
  const g = (label) => src.indexOf(`censusGate('${label}`);
  assert.ok(g('before the runtime contacts') > 0 && g('before the runtime contacts') < src.indexOf("const mk = async (n) => (await gwr.call('POST', '/contacts/'"));
  assert.ok(g('before the member contact') > 0 && g('before the member contact') < src.indexOf("lastName: `member-${STAMP}`"));
  assert.ok(g('before the multipath') > 0 && g('before the multipath') < src.indexOf('await runMultipathInsertProof('));
  assert.match(src, /ABORT = `the published-trigger census refused/);
});

const { makeStamp, STAMP_TAG_RE } = await import(join(SCRIPTS, 'published-trigger-census.mjs'));
const flags = (f) => ({ name: 'x', conversation: false, inboundMessage: false, customFieldWrite: false, formSubmission: false, dndWrite: false, ...f });
test('census (ruling a, superseded by default-block): custom_date_reminder blocks with or without a custom-field write; the record says which flag decided', () => {
  const t = { type: 'custom_date_reminder', active: true };
  const no = judgeTrigger(t, flags({})), yes = judgeTrigger(t, flags({ customFieldWrite: true }));
  assert.equal(no.decision, 'blocks'); assert.equal(no.flag, 'customFieldWrite');
  assert.equal(yes.decision, 'blocks'); assert.equal(yes.flag, 'customFieldWrite');
});
test('census (ruling b, superseded by default-block): form_submission blocks with or without a form submission', () => {
  const t = { type: 'form_submission', active: true };
  assert.equal(judgeTrigger(t, flags({})).decision, 'blocks');
  const y = judgeTrigger(t, flags({ formSubmission: true })); assert.equal(y.decision, 'blocks'); assert.equal(y.flag, 'formSubmission');
});
test('census (ruling c, superseded by default-block): dnd_contact blocks in every event set', () => {
  const t = { type: 'dnd_contact', active: true };
  assert.equal(judgeTrigger(t, CORE).decision, 'blocks');
  const y = judgeTrigger(t, CONV); assert.equal(y.decision, 'blocks'); assert.equal(y.flag, 'dndWrite');
  assert.equal(CORE.dndWrite, false); assert.equal(CONV.dndWrite, true);
  assert.equal(CORE.customFieldWrite || CORE.formSubmission || CONV.customFieldWrite || CONV.formSubmission, false);
});
test('census (ruling d): contact_tag blocks on the generic test-conf tag or the run-stamp pattern; a fixed tag that never matches blocks too (default-block)', () => {
  assert.equal(judgeTrigger(tagTrig('test-conf'), CORE).decision, 'blocks');
  assert.equal(judgeTrigger(tagTrig('test-conf-123456'), CORE).decision, 'blocks');
  assert.equal(judgeTrigger(tagTrig('test-conf-123456-past-drip'), CORE).decision, 'blocks');
  assert.equal(judgeTrigger(tagTrig('TEST-CONF-123456-X'), CORE).decision, 'blocks');
  for (const v of ['test-conf-ab-enter', 'test-conf-mathzero', 'test-conf-12345', 'test-conf-1234567-x']) assert.equal(judgeTrigger(tagTrig(v), CORE).decision, 'blocks', v);
});
test('census (ruling d): the stamp pattern comes from the same module that builds STAMP, and conformance.mjs uses it', () => {
  assert.match(src, /const STAMP = makeStamp\(\);/);
  assert.ok(!/Date\.now\(\)\.toString\(\)\.slice\(-6\)/.test(src.replace(/\/\/.*$/gm, '')), 'no second STAMP definition in the suite');
  for (let i = 0; i < 5; i++) { const st = makeStamp(); assert.ok(STAMP_TAG_RE.test(`test-conf-${st}`) && STAMP_TAG_RE.test(`test-conf-${st}-split-a`), st); }
});
test('census record: each decision carries the event-set flag that decided it', async () => {
  const f = fake([{ id: 'a', name: 'n' }], { a: [{ type: 'form_submission', active: true }] });
  const rec = censusRecord(await publishedTriggerCensus({ ...f, LOCATION: 'L', eventSet: flags({}) }));
  assert.equal(rec.rows[0].decisions[0].flag, 'formSubmission');
});
test('batch 7: the agent rename measure touches only this run\'s own flowentry by exact name', () => {
  const r = readFileSync(join(SCRIPTS, 'rename-workflow-proof.mjs'), 'utf8');
  assert.match(r, /w\.name === NAME\('flowentry'\)/);
  assert.ok(!/\^TEST-CONF-\/\.test\(w\.name/.test(r), 'no prefix match on other TEST-CONF workflows');
});

test('batch 7: the agent rename is keyed on the id this run created, with name and type asserted, and no id means no rename', () => {
  const r = readFileSync(join(SCRIPTS, 'rename-workflow-proof.mjs'), 'utf8');
  assert.match(r, /agentWid = null/);
  assert.match(r, /\(w\.id \?\? w\._id\) === agentWid && w\.workflowType === 'agent' && w\.name === NAME\('flowentry'\)/);
  assert.match(r, /agentWid \? \(lw\.data/);
  assert.match(src, /runRenameWorkflowProof\(\{[^}]*agentWid: fwid \?\? null/);
  assert.ok(src.indexOf('const fwid = flow.data?.wid') < src.indexOf('runRenameWorkflowProof({'), 'the id is captured when the flow is built, before the proof');
});

// w9-d18 batch 7 FIX (QA): every publish span that can leave a workflow published ends in a finally that unpublishes it and reads it back.
test('batch 7: every publish span has a matching finally with unpublishAndAssertDraft on the same workflow id', () => {
  const mods = { conformance: src, multipath: readFileSync(join(SCRIPTS, 'multipath-insert-proof.mjs'), 'utf8'), deleteBranch: readFileSync(join(SCRIPTS, 'delete-branch-proof.mjs'), 'utf8') };
  const sites = [
    ['conformance', "confirmedCall(call, 'publish_workflow', { workflowId: rwid })", "unpublishAndAssertDraft(call, check, rwid, 'probe')"],
    ['conformance', "confirmedCall(call, 'publish_workflow', { workflowId: frwid })", "unpublishAndAssertDraft(call, check, frwid, 'probe')"],
    ['conformance', "confirmedCall(call, 'publish_workflow', { workflowId: id })", "unpublishAndAssertDraft(call, check, id, 'probe')"], // firstparty-badge-grant (g) and firstparty-revoke (r) both run through runOne
    ['conformance', "twoStep(call, 'publish_workflow', { workflowId: wid })", "unpublishAndAssertDraft(call, check, wid, 'probe')"],
    ['conformance', "confirmedCall(call, 'publish_workflow', { workflowId: swid })", "unpublishAndAssertDraft(call, check, swid, 'probe')"],
    ['multipath', "confirmedCall(call, 'publish_workflow', { workflowId: wid })", "unpublishAndAssertDraft(call, check, wid, 'probe')"],
    ['deleteBranch', "confirmedCall(call, 'publish_workflow', { workflowId: wid })", "unpublishAndAssertDraft(call, check, wid, 'probe')"],
  ];
  for (const [m, pub, un] of sites) {
    const text = mods[m], at = text.indexOf(pub);
    assert.ok(at > 0, `${m}: publish site ${pub}`);
    const tryAt = text.lastIndexOf('try {', at);
    // the unpublish that reads the id back must come right after a finally that follows the publish (the OUTERMOST one for rwid is checked in its own test)
    const unAt = text.indexOf(un, at), fin = text.lastIndexOf('} finally {', unAt);
    assert.ok(tryAt > 0 && tryAt < at && fin > at && unAt - fin < 400, `${m}: ${pub} sits inside a try whose finally unpublishes that id and reads it back`);
  }
  assert.equal((src.match(/confirmedCall\(call, 'publish_workflow'/g) ?? []).length, 4, 'no publish site in conformance.mjs is missing from this list');
});
test('batch 7: the outer finally sweeps this run\'s own published TEST-CONF drafts', () => {
  const at = src.indexOf("un = await unpublishAndAssertDraft(call, check, rwid, 'probe');");
  assert.match(src.slice(at, at + 520), /sweepPublishedTestConf\(\{ call, check, sinceIso: [^}]*ownStamp: STAMP \}\)/);
});
test('batch 7: the rename folder control targets this run\'s own folder (id read back, stamp in the name) or a ghost id, never folders[0]', () => {
  const r = readFileSync(join(SCRIPTS, 'rename-workflow-proof.mjs'), 'utf8');
  const code = r.replace(/\/\/.*$/gm, '');
  assert.ok(!/folders\[0\]/.test(code) && !/\)\[0\]\?\.id/.test(code), 'no folders[0]');
  assert.match(r, /f\.id === ownFolderId && STAMP && String\(f\.name \?\? ''\)\.startsWith\('TEST-CONF-'\) && String\(f\.name\)\.includes\(String\(STAMP\)\)/);
  assert.match(r, /'zzNotAFolderId000000000'/);
  assert.match(src, /runRenameWorkflowProof\(\{[^}]*folderId: fid \?\? null, STAMP \}/);
});
test('batch 7: the inventory product (id and label, stock before and after) is recorded, and an unrevoked grant is listed as residue', () => {
  assert.match(src, /RECORD inventory \$\{JSON\.stringify\(stockReport\)\}/);
  assert.match(src, /inventoryProductId: stockItem\.value, inventoryProductLabel: stockItem\.label, stockBefore, stockAfter/);
  assert.match(src, /GRANT ENROLLED, NOT REVOKED unless read back: contact \$\{mid\}/);
  const push = src.indexOf('left.push(grantResidue)'), grantRun = src.indexOf("'firstparty-revoke'"), clear = src.indexOf('if (revokedOut?.revoked === true) { const i = left.indexOf(grantResidue); if (i >= 0) left.splice(i, 1); }') + 'if (revokedOut?.revoked === true) { const i = left.indexOf(grantResidue); if (i >= 0) '.length;
  assert.ok(push > 0 && push < grantRun && clear > grantRun, 'the residue is recorded when the enrol call is accepted and cleared only after the revoke runs');
  assert.match(src.slice(clear - 120, clear), /revokedOut\?\.revoked === true/);
});

// ── batch 7: pausing ONE named non-TEST flow for the member span ──
const { parsePauseFlags, pausableRows, pauseFlow, restoreFlow, pauseRecord, diffTriggers, maskTriggers, SERVER_STAMPED_TRIGGER_FIELDS } = await import(join(SCRIPTS, 'pause-flow.mjs'));
const PF = { id: 'placeholder-flow-id', name: 'Placeholder chase flow' };
const dndTrig = { type: 'dnd_contact', active: true };
test('pause: --pause-flow parses id::name, and refuses an entry with no name', () => {
  assert.deepEqual(parsePauseFlags(['x', `--pause-flow=${PF.id}::${PF.name}`, '--pause-flow=onlyid']), [PF]);
});
test('pause: the census lists a named dnd-only non-TEST blocker as pausable, never a TEST-CONF flow, another blocker type, or a name mismatch', async () => {
  const f = fake([{ id: PF.id, name: PF.name }, { id: 'p2', name: 'TEST-CONF-x-1' }, { id: 'p3', name: 'Other' }, { id: 'p4', name: 'Mixed' }],
    { [PF.id]: [dndTrig], p2: [dndTrig], p3: [dndTrig], p4: [dndTrig, { type: 'contact_created', active: true }] });
  const allow = [PF, { id: 'p2', name: 'TEST-CONF-x-1' }, { id: 'p4', name: 'Mixed' }, { id: 'p3', name: 'Wrong name' }];
  const c = await publishedTriggerCensus({ ...f, LOCATION: 'L', eventSet: CONV, pausable: allow, convAi: { ok: true, blocks: false, agents: [] } });
  assert.deepEqual(c.pausable.map((x) => x.id), [PF.id]);
  assert.deepEqual(c.blockers.map((x) => x.id).sort(), ['p2', 'p3', 'p4']);
  assert.deepEqual(censusRecord(c).pausable.map((x) => x.id), [PF.id]);
  const without = await publishedTriggerCensus({ ...f, LOCATION: 'L', eventSet: CONV, convAi: { ok: true, blocks: false, agents: [] } });
  assert.ok(without.blockers.some((x) => x.id === PF.id) && without.pausable.length === 0, 'no allowance, no pause');
  assert.deepEqual(pausableRows(without.rows, [PF]).map((x) => x.id), [PF.id]);
});
const wfFake = (state) => ({
  call: async (tool, a) => {
    if (tool === 'get_workflow') return { ok: true, data: { name: state.name, status: state.status } };
    if (tool === 'publish_workflow') { state.status = 'published'; state.log.push('publish'); return { ok: true }; }
    return { ok: false };
  },
  gw: { call: async () => ({ ok: true, json: { triggers: state.triggers } }) },
});
const unpub = async (call, check, id) => { state0.status = 'draft'; state0.log.push('unpublish'); return { ok: true }; };
let state0;
test('pause: id AND name are read back before the pause; a mismatch refuses and pauses nothing', async () => {
  state0 = { name: 'Some other name', status: 'published', triggers: [dndTrig], log: [] };
  const r = await pauseFlow({ ...wfFake(state0), LOCATION: 'L', id: PF.id, name: PF.name, unpublish: unpub });
  assert.equal(r.paused, false); assert.match(r.refused, /did not read back/); assert.deepEqual(state0.log, []);
});
test('pause then restore: draft, then published again with an equal trigger list; a changed field fails the restore and is recorded by path', async () => {
  state0 = { name: PF.name, status: 'published', triggers: [dndTrig], log: [] };
  const w = wfFake(state0);
  const rec = await pauseFlow({ ...w, LOCATION: 'L', id: PF.id, name: PF.name, unpublish: unpub });
  assert.equal(rec.paused, true); assert.equal(state0.status, 'draft');
  const done = await restoreFlow({ ...w, LOCATION: 'L', rec, publish: async (call, tool, a) => call(tool, a) });
  assert.equal(done.ok, true); assert.equal(done.restored, true); assert.equal(done.triggersEqual, true); assert.deepEqual(done.triggerDiff, []);
  const rec2 = await pauseFlow({ ...w, LOCATION: 'L', id: PF.id, name: PF.name, unpublish: unpub });
  state0.triggers = [{ ...dndTrig, extra: 1 }];
  const bad = await restoreFlow({ ...w, LOCATION: 'L', rec: rec2, publish: async (call, tool, a) => call(tool, a) });
  assert.equal(bad.ok, false); assert.equal(bad.triggersEqual, false);
  assert.equal(bad.triggerDiff.length, 1); assert.equal(bad.triggerDiff[0].path, 'triggers[0].extra'); assert.equal(bad.triggerDiff[0].before, null); assert.match(bad.triggerDiff[0].after, /^<number:[0-9a-f]{8}>$/, 'a number is a type plus a hash, never in clear');
  assert.deepEqual(pauseRecord(bad).triggerDiff, bad.triggerDiff);
});
test('pause comparator: server-stamped date_updated is excluded (a publish re-stamps it), every other field still counts, and the pre-pause list is kept masked', async () => {
  const ID = 'QQfakeFAKE0000QQfakeFAKE0000QQ';
  const before = [{ id: ID, type: 'contact_tag', active: true, date_updated: '2026-10-12T05:00:00Z', location_id: ID, conditions: [{ field: 'tagsAdded', value: 'zz-fake-tag' }], actions: [{ workflow_id: 'WFfake-0000-0000-0000-WFfake000000' }] }];
  const stamped = [{ ...before[0], date_updated: '2026-11-22T06:48:12.373Z' }];
  assert.deepEqual(diffTriggers(before, stamped), []);
  assert.deepEqual(diffTriggers(before, [{ ...stamped[0], active: false }]), [{ path: 'triggers[0].active', before: true, after: false }]);
  const cd = diffTriggers(before, [{ ...stamped[0], conditions: [{ field: 'tagsAdded', value: 'x' }] }]);
  assert.equal(cd.length, 1); assert.equal(cd[0].path, 'triggers[0].conditions[0].value');
  assert.match(cd[0].before, /^<string:[0-9a-f]{8}>$/); assert.match(cd[0].after, /^<string:[0-9a-f]{8}>$/); assert.notEqual(cd[0].before, cd[0].after);
  assert.ok(!JSON.stringify(cd).includes('zz-fake-tag'), 'a changed value is reported as a hash, never in clear');
  assert.deepEqual(diffTriggers(before, [...stamped, { id: 'z', type: 'dnd_contact' }]).map((d) => d.path)[0], '(count)');
  assert.equal(diffTriggers(before, null)[0].path, '(list)');
  const masked = JSON.stringify(maskTriggers(before));
  assert.ok(!masked.includes(ID) && !masked.includes('WFfake-0000-0000-0000-WFfake000000') && !masked.includes('date_updated'), 'ids masked (the real fixture ids), stamped field dropped');
  assert.ok(!masked.includes('zz-fake-tag'), 'values are hashed, not kept');
  assert.match(masked, /"type":"contact_tag"/);
  assert.deepEqual([...SERVER_STAMPED_TRIGGER_FIELDS], ['date_updated']);
  // the restore keeps the masked pre-pause list and the raw reading
  state0 = { name: PF.name, status: 'published', triggers: before, log: [] };
  const w = wfFake(state0);
  const rec = await pauseFlow({ ...w, LOCATION: 'L', id: PF.id, name: PF.name, unpublish: unpub });
  state0.triggers = stamped;
  const done = await restoreFlow({ ...w, LOCATION: 'L', rec, publish: async (call, tool, a) => call(tool, a) });
  assert.equal(done.ok, true); assert.equal(done.triggersRawEqual, false, 'the raw JSON differs (date_updated) and that is recorded');
  const pr = pauseRecord(done);
  assert.equal(pr.triggersEqual, true); assert.deepEqual(pr.excludedFields, ['date_updated']);
  assert.ok(Array.isArray(pr.triggersBeforeMasked) && !JSON.stringify(pr).includes(ID));
  for (const v of ['zz-fake-tag', 'WFfake-0000-0000-0000-WFfake000000']) assert.ok(!JSON.stringify(pr).includes(v), 'the record carries no trigger body');
});
test('pause record masks e-mail, both phone formats, a person name, a hyphenated token and a URL with a key, inside before AND after (deny by default)', async () => {
  const bad = [['dana', 'example.test'].join('@'), '+1 (555) 010-2030', '5550102030', 'Dana Example', 'zz-fake-tag-0042', ['https://example.test/x', '?key=abc123'].join('')];
  const mk = (extra) => [{ type: 'contact_tag', active: true, name: bad[3], conditions: [{ field: 'tagsAdded', value: bad.slice(0, 3) }, { field: 'x', value: bad.slice(3) }], ...extra }];
  const before = mk({}), after = mk({ conditions: [{ field: 'tagsAdded', value: bad.map((x) => `${x}-changed`) }] });
  const out = JSON.stringify([maskTriggers(before), maskTriggers(after), diffTriggers(before, after)]);
  for (const v of bad) assert.ok(!out.includes(v), `value not in the output: ${v.slice(0, 4)}…`);
  assert.ok(!out.includes('Dana') && !out.includes('555'));
  state0 = { name: PF.name, status: 'published', triggers: before, log: [] };
  const w = wfFake(state0);
  const rec = await pauseFlow({ ...w, LOCATION: 'L', id: PF.id, name: PF.name, unpublish: unpub });
  state0.triggers = after;
  const done = await restoreFlow({ ...w, LOCATION: 'L', rec, publish: async (call, tool, a) => call(tool, a) });
  const pr = JSON.stringify(pauseRecord(done));
  for (const v of bad) assert.ok(!pr.includes(v));
  assert.equal(done.triggersEqual, false);
  assert.deepEqual(maskTriggers(before), maskTriggers(before), 'the same value hashes the same within one run');
});
test('conformance (batch 7): the pause is in the member span, restored in its finally and by finish(); gates outside the span judge no-DND', () => {
  assert.match(src, /const PAUSE_FLOWS = parsePauseFlags\(process\.argv\)/);
  assert.ok(src.indexOf('pausable: PAUSE_FLOWS') < src.indexOf("lastName: `member-${STAMP}`"), 'the pause comes before the member contact create');
  assert.match(src, /const finish = async[^\n]*\n\s*await restorePaused\(\)/);
  const fin = src.slice(src.indexOf('backToStart && (await backToStart())'));
  assert.ok(fin.indexOf('await restorePaused()') > 0 && fin.indexOf('await restorePaused()') < fin.indexOf('const st = (await call'), 'restore right after the member span');
  assert.match(src, /PAUSED, NOT RESTORED: workflow \$\{rec\.id\}/);
  assert.match(src, /OUTSIDE_DND = Object\.freeze\(\{ \.\.\.EVENT_SET, name: `\$\{EVENT_SET\.name\}-outside-member-span`, dndWrite: false \}\)/);
  assert.match(src, /censusGate\('before the member contact \(the only one with an email\)', \{ dnd: true \}\)/);
});
test('conformance (batch 7): grant residue is pushed when the enrol call is accepted, cleared only on revoked===true or the final members()===members0 read; other residue lines', () => {
  assert.match(src, /GRANT ENROLLED, NOT REVOKED unless read back/);
  assert.match(src, /if \(enrol\?\.ok && onEnrolled\) onEnrolled\(\)/);
  assert.match(src, /\{ onEnrolled: \(\) => left\.push\(grantResidue\) \}/);
  assert.match(src, /if \(revokedOut\?\.revoked === true\) \{ const i = left\.indexOf\(grantResidue\)/);
  assert.match(src, /backToStart && \(await backToStart\(\)\)/);
  for (const re of [/left\.push\(`badge issued to member contact \$\{mid\}/, /left\.push\(`conversation \$\{convId\} on contact \$\{ids\[3\]\}/, /left\.push\(`TEST product \$\{stockItem\.value\} \(\$\{stockItem\.label\}\) stock was \$\{stockBefore\}/])
    assert.match(src, re);
});

// ── batch 7 QA FIX (pause/restore) ──
test('QA fix 1: a signal restores the paused flow inside the same 20 s race, and prints RECORD pause and the PAUSED line before exit', () => {
  const a = src.indexOf('const exitAfterRestore = async'), b = src.indexOf("process.on('SIGTERM'");
  const body = src.slice(a, b);
  assert.match(body, /await Promise\.race\(\[pausedRestore\(\), new Promise\(\(r\) => setTimeout\(r, 20000\)\)\]\)/);
  assert.ok(body.indexOf('pausedRestore') < body.indexOf('process.exit(exitCode)'));
  assert.match(src, /pausedRestore = async \(\) => \{\n  await restorePaused\(\);\n  if \(PAUSED\.length\) console\.log\(`RECORD pause/);
  assert.match(src, /startsWith\('PAUSED, NOT RESTORED'\)\)\) console\.log/);
});
test('QA fix 2: the gate hands back a pausable list only when the census read completely and nothing else blocks', () => {
  assert.match(src, /if \(c\.pausable\?\.length && c\.ok === true && c\.blockers\.length === 0\) return c;/);
});
test('QA fix 3: unpublishSent is set before the call, the residue line is pushed before it, and a failed pause is still restored from a re-read', async () => {
  const log = [];
  const st = { name: PF.name, status: 'published', triggers: [dndTrig] };
  const w = { call: async (t) => { if (t === 'get_workflow') return { ok: true, data: { name: st.name, status: st.status } }; if (t === 'publish_workflow') { st.status = 'published'; log.push('publish'); return { ok: true }; } return { ok: false }; },
    gw: { call: async () => ({ ok: true, json: { triggers: st.triggers } }) } };
  let sawBefore = null, seen = null;
  const rec = await pauseFlow({ ...w, LOCATION: 'L', id: PF.id, name: PF.name,
    beforeUnpublish: (r) => { seen = r; sawBefore = r.unpublishSent; log.push('residue'); },
    unpublish: async () => { log.push(`unpublish(sent=${seen.unpublishSent})`); st.status = 'draft'; return { ok: false }; } });
  assert.equal(log[1], 'unpublish(sent=true)');
  assert.equal(sawBefore, false); assert.equal(rec.unpublishSent, true); assert.equal(rec.paused, false);
  assert.equal(log[0], 'residue');
  const done = await restoreFlow({ ...w, LOCATION: 'L', rec, publish: async (c, t, a) => c(t, a) });
  assert.equal(done.statusBeforeRestore, 'draft'); assert.ok(log.includes('publish')); assert.equal(done.ok, true);
  assert.equal(pauseRecord(done).unpublishSent, true);
  // still published after a failed pause: nothing to publish, just compared
  st.status = 'published'; log.length = 0;
  const again = await restoreFlow({ ...w, LOCATION: 'L', rec: { ...rec, restored: null }, publish: async (c, t, a) => c(t, a) });
  assert.ok(!log.includes('publish')); assert.equal(again.ok, true);
  assert.match(src, /if \(rec\.restored !== null \|\| !rec\.unpublishSent\) continue;/);
  assert.match(src, /beforeUnpublish: \(r\) => \{ PAUSED\.push\(r\); left\.push\(`PAUSED, NOT RESTORED/);
});
test('pause: a flow whose only blocker is dnd_contact is pausable; one that also has customer_reply is not; a live conv_ai flow blocks (default-block)', async () => {
  const f = fake([{ id: PF.id, name: PF.name }, { id: 'ai1', name: 'AI Flow placeholder' }],
    { [PF.id]: [dndTrig], ai1: [{ type: 'conv_ai_trigger', active: true }] });
  const c = await publishedTriggerCensus({ ...f, LOCATION: 'L', eventSet: CONV, pausable: [PF], convAi: { ok: true, blocks: false, agents: [] } });
  assert.deepEqual(c.pausable.map((x) => x.id), [PF.id]); assert.deepEqual(c.blockers.map((x) => x.id), ['ai1']);
  const g = fake([{ id: PF.id, name: PF.name }], { [PF.id]: [{ type: 'customer_reply', active: true }, dndTrig] });
  const d = await publishedTriggerCensus({ ...g, LOCATION: 'L', eventSet: CONV, pausable: [PF], convAi: { ok: true, blocks: false, agents: [] } });
  assert.deepEqual(d.pausable, []); assert.deepEqual(d.blockers.map((x) => x.id), [PF.id]);
});

// ── batch 7: the read-only Conversation AI census ──
const { judgeAgent, convAiCensus: realConvAiCensus, convAiRecord } = await import(join(SCRIPTS, 'convai-census.mjs'));
// Agent Studio is always cleared by the strict folders read now: these tests give it an empty listing (no agents, no folders) unless a test passes its own reader.
const emptyStudioRead = async () => ({ ok: true, json: { items: [], folders: [], total: 0, totalAgents: 0, totalFolders: 0, page: 1, pageSize: 100, hasMore: false } });
const convAiCensus = (args) => realConvAiCensus({ read: emptyStudioRead, locationId: 'locAAAAAAAAAAAAAAAAA', ...args });
const agent = (mode, triggers, over = {}) => ({ id: 'ag1', detailRead: true, detail: { mode }, outboundRead: true, outbound: { configs: [], triggers }, ...over });
const trig = (type, over = {}) => ({ type, enabled: true, ...over });
test('convai census: mode off never blocks; an enabled contact_created, or a generic/stamp contact_tag, blocks; a fixed other tag does not', () => {
  assert.equal(judgeAgent(agent('off', [trig('contact_created')])).blocks, false);
  assert.equal(judgeAgent(agent('auto-pilot', [trig('contact_created')])).blocks, true);
  assert.equal(judgeAgent(agent('suggestive', [trig('contact_created', { enabled: false })])).blocks, false);
  assert.equal(judgeAgent(agent('auto-pilot', [trig('contact_tag', { config: { tag: 'test-conf' } })])).blocks, true);
  assert.equal(judgeAgent(agent('auto-pilot', [trig('contact_tag', { config: { tagName: 'TEST-CONF-123456-x' } })])).blocks, true);
  assert.equal(judgeAgent(agent('auto-pilot', [trig('contact_tag', { config: { tag: 'ai:handover' } })])).blocks, true, 'a contact_tag trigger blocks whatever the tag (default block)');
  for (const t of ['form_submitted', 'appointment_status_updated', 'opportunity_status_updated', 'missed_call']) assert.equal(judgeAgent(agent('auto-pilot', [trig(t)])).blocks, true, `${t}: every enabled outbound trigger blocks by default`);
});
test('convai census: unknown type, an enabled flag that is not a boolean, a tag trigger with no readable tag, an unread mode or unread outbound rows all block', () => {
  assert.equal(judgeAgent(agent('auto-pilot', [trig('something_new')])).blocks, true);
  assert.equal(judgeAgent(agent('auto-pilot', [trig('missed_call', { enabled: 'yes' })])).blocks, true);
  assert.equal(judgeAgent(agent('auto-pilot', [trig('contact_tag')])).blocks, true);
  assert.equal(judgeAgent(agent('auto-pilot', [], { detailRead: false })).blocks, true);
  assert.equal(judgeAgent(agent('auto-pilot', [], { outboundRead: false })).blocks, true);
  assert.equal(judgeAgent(agent('auto-pilot', [])).blocks, false);
});
test('convai census: an unreadable or incomplete agent list is not ok, and conv_ai_* then blocks; the record has ids, modes and trigger types only', async () => {
  const bad = await convAiCensus({ call: async () => ({ ok: false }) });
  assert.equal(bad.ok, false);
  assert.equal(judgeTrigger({ type: 'conv_ai_trigger', active: true }, CONV, bad).decision, 'blocks');
  assert.equal(judgeTrigger({ type: 'conv_ai_trigger', active: true }, CONV, null).decision, 'blocks');
  const partial = await convAiCensus({ call: async () => ({ ok: true, data: { components: { conversation_ai: { complete: false, items: [] } } } }) });
  assert.equal(partial.ok, false);
  const good = await convAiCensus({ call: async () => ({ ok: true, data: { components: { ...OTHERS_EMPTY, conversation_ai: { complete: true, cursorWalk: { served: 2, totalCount: 2 }, items: [agent('off', []), agent('auto-pilot', [trig('contact_created')], { id: 'ag2' })] } } } }) });
  assert.equal(good.ok, true); assert.equal(good.blocks, true);
  assert.equal(judgeTrigger({ type: 'conv_ai_trigger', active: true }, CONV, good).decision, 'blocks');
  const rec = JSON.stringify(convAiRecord(good)); assert.ok(rec.includes('ag2') && rec.includes('contact_created') && !rec.includes('config'));
  const clean = await convAiCensus({ call: async () => ({ ok: true, data: { components: { ...OTHERS_EMPTY, conversation_ai: { complete: true, cursorWalk: { served: 1, totalCount: 1 }, items: [agent('off', [])] } } } }) });
  assert.equal(judgeTrigger({ type: 'conv_ai_autonomous_trigger', active: true }, CONV, clean).decision, 'blocks', 'default-block: a clean agent census no longer passes a live conv_ai_* trigger');
});
test('conformance: every census gate reads the Conversation AI census and hands it to the census; the record carries it', () => {
  assert.match(src, /const convAi = await convAiCensus\(\{ call, companyId: process\.env\.GHL_COMPANY_ID, runS: RUN_S, read: censusRead, locationId: LOCATION \}\)/);
  assert.match(src, /pausable, convAi, runS: RUN_S \}\)/);
  assert.match(src, /import \{ convAiCensus \} from '\.\/convai-census\.mjs'/);
  assert.match(readFileSync(join(SCRIPTS, 'published-trigger-census.mjs'), 'utf8'), /convAi: c\.convAi \?/);
});

test('QA batch 7 item 4 (superseded by default-block): a contact_tag trigger blocks whatever it stores, by id or by name', () => {
  const blocks = (cfg, extra = {}) => judgeAgent(agent('auto-pilot', [trig('contact_tag', { config: cfg, ...extra })])).blocks;
  for (const cfg of [{ tag: 'AbCdEfGhIjKlMnOpQrSt' }, { tagId: 'x' }, { tag_ids: ['a'] }, { tag: { id: 'a', name: 'ai:handover' } }, { tag: 'ai:handover' }, { tag: 'customer-handover-queue-long-name' }]) assert.equal(blocks(cfg), true, JSON.stringify(cfg));
  assert.match(judgeAgent(agent('auto-pilot', [trig('contact_tag', { config: { tagId: 'x' } })])).why, /outbound trigger is enabled/);
});
test('QA batch 7 item 3: EVERY POST /contacts/ under scripts/ (conformance and the proof modules) is followed by a RECORD contact line', () => {
  const files = readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs') && !/\.test\./.test(f));
  const sites = [];
  for (const f of files) {
    const lines = readFileSync(join(SCRIPTS, f), 'utf8').split('\n');
    lines.forEach((l, i) => { if (/\.call\('POST', '\/contacts\/'/.test(l)) sites.push({ f, i, near: lines.slice(i, i + 7).join('\n') }); });
  }
  assert.equal(sites.length, 5, `the five contact-create sites: ${sites.map((x) => `${x.f}:${x.i + 1}`).join(', ')}`);
  assert.deepEqual([...new Set(sites.map((x) => x.f))].sort(), ['conformance.mjs', 'delete-branch-proof.mjs', 'multipath-insert-proof.mjs']);
  for (const x of sites) assert.match(x.near, /RECORD contact \$\{/, `${x.f}:${x.i + 1} has a RECORD contact line within 6 lines`);
});

test('convai census (a): an unreadable bundle records the tool error code and detail, masks id-shaped strings, and never carries the companyId passed in', async () => {
  const CID = 'Zq9XkLm2PwRtYu3VbN8c';
  const call = async () => ({ ok: false, code: 'COMPANY_ID_REQUIRED', detail: `bundle needs agency ${CID} to read Agent Studio` });
  const c = await convAiCensus({ call, companyId: CID });
  assert.equal(c.ok, false); assert.equal(c.blocks, true);
  assert.equal(c.error.code, 'COMPANY_ID_REQUIRED'); assert.equal(c.error.companyIdPassed, true);
  assert.match(c.reason, /COMPANY_ID_REQUIRED/);
  const rec = JSON.stringify(convAiRecord(c));
  assert.ok(!rec.includes(CID), 'the id value is masked in the record'); assert.match(rec, /<id>/);
  const none = await convAiCensus({ call: async () => ({ ok: true, data: { components: { conversation_ai: { complete: false, items: [] } } } }), companyId: undefined });
  assert.equal(none.error.companyIdPassed, false); assert.equal(none.error.complete, false);
});

test('convai census diagnostics: an incomplete component records warning/error codes, rate-limit state and per-phase counts, with no item content and no companyId', async () => {
  const CID = 'Zq9XkLm2PwRtYu3VbN8c', SECRET = 'Zelda Front Desk Bot', SECRET_TAG = 'vip-customer-secret-tag';
  const data = {
    components: { conversation_ai: { complete: false, applicable: true, detailDenominator: 2, errors: [{ code: 'AI_DETAIL_READ_FAILED', capabilityId: 'cap.detail', phase: 'detail', occurrences: 1, detailSamples: [`agent ${CID} detail 500`] }],
      items: [
        { id: 'a1', name: SECRET, tag: SECRET_TAG, detailRead: true, routingRead: true, outboundRead: true, detail: { mode: 'off' } },
        { id: 'a2', name: SECRET, detailRead: false, routingRead: true, outboundRead: false } ] } },
    warnings: [{ code: 'AI_DETAIL_READ_FAILED', component: 'conversation_ai', occurrences: 1, detailSamples: [`agent ${CID} detail 500`] }, { code: 'OTHER', component: 'agent_studio', detailSamples: ['not ours'] }],
    rateLimit: { limited: true, retryAfterMs: 1500 },
  };
  const c = await convAiCensus({ call: async () => ({ ok: true, data }), companyId: CID });
  assert.equal(c.ok, false);
  const d = c.diagnostics;
  assert.deepEqual(d.warnings.map((w) => w.code), ['AI_DETAIL_READ_FAILED']); assert.equal(d.errors[0].phase, 'detail');
  assert.deepEqual(d.rateLimit, { limited: true, retryAfterMs: 1500 });
  assert.deepEqual(d.discovery, { count: 2, detailDenominator: 2 });
  assert.deepEqual(d.phases, { detail: { ok: 1, failed: 1 }, routing: { ok: 2, failed: 0 }, outbound: { ok: 1, failed: 1 } });
  const rec = JSON.stringify(convAiRecord(c));
  for (const bad of [CID, SECRET, SECRET_TAG, 'not ours']) assert.ok(!rec.includes(bad), `the record never carries: ${bad.slice(0, 8)}`);
  assert.match(c.reason, /AI_DETAIL_READ_FAILED/); assert.match(c.reason, /rate limited: true/);
});

test('convai census: the cursor walk record (per page counts, served and total) rides in the census record, with no ids or names', async () => {
  const data = { components: { ...OTHERS_EMPTY, conversation_ai: { complete: true, items: Array.from({ length: 30 }, (_, i) => ({ id: `a${i}`, name: 'Secret Bot', detailRead: true, detail: { mode: 'off' }, outboundRead: true, outbound: { triggers: [] } })),
    cursorWalk: { requestedLimit: 20, pages: [{ requestedLimit: 20, rows: 20, newUnique: 20, cursorPresent: false, totalReported: 30, firstId: 'LEAK1' }, { requestedLimit: 20, rows: 10, newUnique: 10, cursorPresent: true, totalReported: 30 }], served: 30, totalCount: 30 } } } };
  const c = await convAiCensus({ call: async () => ({ ok: true, data }) });
  assert.equal(c.ok, true);
  const rec = convAiRecord(c);
  assert.deepEqual(rec.cursorWalk, { pages: [
    { requestedLimit: 20, rows: 20, newUnique: 20, cursorPresent: false, totalReported: 30 },
    { requestedLimit: 20, rows: 10, newUnique: 10, cursorPresent: true, totalReported: 30 }], served: 30, totalCount: 30 });
  const text = JSON.stringify(rec);
  assert.ok(!text.includes('LEAK1') && !text.includes('Secret Bot'));
  const bad = await convAiCensus({ call: async () => ({ ok: true, data: { components: { conversation_ai: { complete: false, items: [], cursorWalk: data.components.conversation_ai.cursorWalk } } } }) });
  assert.equal(bad.diagnostics.cursorWalk.served, 30);
});

test('convai census: ok only when the reported total is finite and served === totalCount; a missing or short total blocks', async () => {
  const mk = (cursorWalk, n = 2) => ({ ok: true, data: { components: { ...OTHERS_EMPTY, conversation_ai: { complete: true, cursorWalk, items: Array.from({ length: n }, (_, i) => agent('off', [], { id: `ag${i}` })) } } } });
  const whole = await convAiCensus({ call: async () => mk({ served: 2, totalCount: 2 }) });
  assert.equal(whole.ok, true); assert.equal(whole.blocks, false);
  for (const cw of [undefined, null, { served: 2 }, { served: 2, totalCount: null }, { served: 2, totalCount: NaN }, { served: 2, totalCount: 3 }, { served: 1, totalCount: 2 }]) {
    const c = await convAiCensus({ call: async () => mk(cw) });
    assert.equal(c.ok, false, JSON.stringify(cw)); assert.equal(c.blocks, true); assert.match(c.reason, /not proven whole/);
  }
  const mismatch = await convAiCensus({ call: async () => mk({ served: 3, totalCount: 3 }, 2) });
  assert.equal(mismatch.ok, false, 'rows differing from the total block even when served matches it');
});

test('QA batch 7 condition 2: the member contact EMAIL DND is read back before the first step and again after the last, both inside the span', () => {
  const src = readFileSync(join(SCRIPTS, 'conformance.mjs'), 'utf8');
  const pre = src.indexOf("EMAIL DND is on (dnd true and dndSettings.Email active), read back before the first step");
  const first = src.indexOf("const grantOut = await runOne(");
  const post = src.indexOf("EMAIL DND is STILL on after the last step");
  const restore = src.indexOf('await restorePaused(); // right after the member span');
  assert.ok(pre > 0 && first > pre, 'pre-read comes before the first step');
  assert.ok(post > first && post < restore, 'post-read comes after the last step and before the flows are restored');
  assert.match(src, /dndSettings\?\.Email\?\.status/);
});

test('QA batch 7 send-class: a failed member fence aborts (finish, exit 4) before any member enrol call is reachable', () => {
  const src = readFileSync(join(SCRIPTS, 'conformance.mjs'), 'utf8');
  const gate = src.indexOf('if (!memberFenceOk) {');
  assert.ok(gate > 0, 'the abort gate exists');
  assert.match(src.slice(gate, gate + 260), /await finish\(ABORT, 4\)/);
  assert.ok(src.indexOf('const memberFenceOk') < gate);
  // every member enrol (the runOne helper's enrol POST, and its callers) sits after the gate
  const enrol = [...src.matchAll(/gwr\.call\('POST', `\/contacts\/\$\{mid\}\/workflow\//g)].map((m) => m.index);
  assert.ok(enrol.length >= 1);
  for (const i of enrol) assert.ok(i > gate, 'no member enrol before the fence gate');
  assert.ok(src.indexOf('const runOne = async') > gate && src.indexOf('await runOne(') > gate, 'runOne is defined and called only after the gate');
  // no member enrol outside runOne
  const runOneStart = src.indexOf('const runOne = async');
  const runOneEnd = src.indexOf('const grantOut = await runOne(');
  for (const i of enrol) assert.ok(i > runOneStart && i < runOneEnd, 'the only member enrol is inside runOne');
  // the after-step DND check stays a reporting check
  assert.match(src, /if \(mid\) check\(await emailDndOn\(\), 'FENCE: the member contact\\'s EMAIL DND is STILL on/);
});

const { runPauseRestoreProof } = await import(join(SCRIPTS, 'pause-restore-proof.mjs'));
const proofWorld = ({ restamp = true, flip = false } = {}) => {
  const w = { status: 'none', name: null, log: [], triggers: [] };
  const mk = (stamp) => [0, 1].map((i) => ({ id: `0123456789abcdef0123${i}`, type: 'contact_tag', active: true, name: `pause-restore never ${i}`, date_updated: stamp, conditions: [{ field: 'tagsAdded', value: `t${i}` }] }));
  const call = async (tool, a) => {
    w.log.push(tool);
    if (tool === 'build_workflow') { w.name = a.spec.name; w.spec = a.spec; w.status = 'draft'; w.triggers = mk('2026-01-01T00:00:00Z'); return { ok: true, data: { wid: 'wf-test-1' } }; }
    if (tool === 'publish_workflow') { w.status = 'published'; w.publishes = (w.publishes ?? 0) + 1; if (restamp) w.triggers = w.triggers.map((t) => ({ ...t, date_updated: `2026-11-22T06:48:1${w.publishes}.373Z` })); if (flip && w.publishes === 2) w.triggers[1] = { ...w.triggers[1], active: false }; return { ok: true }; }
    if (tool === 'unpublish_workflows') { w.status = 'draft'; return { ok: true }; }
    if (tool === 'get_workflow') return { ok: true, data: { name: w.name, status: w.status } };
    return { ok: false };
  };
  const gw = { call: async () => ({ ok: true, json: w.triggers }) }; // the live endpoint answers a BARE array (2026-11-22 run: the control read {triggers} and got nothing)
  return { w, call, gw };
};
const runProof = async (opts) => {
  const { w, call, gw } = proofWorld(opts); const results = []; const left = [];
  const check = (c, m) => results.push([Boolean(c), m]);
  const out = await runPauseRestoreProof({ call, gw, LOCATION: 'L', NAME: (s) => `TEST-CONF-${s}-1`, STAMP: '1', check, left });
  return { w, results, left, out };
};
test('pause-restore proof: a publish that only re-stamps date_updated passes; the flow ends as a draft; no contact, no enrolment, no non-TEST name', async () => {
  const r = await runProof({ restamp: true });
  assert.equal(r.out.ok, true); assert.deepEqual(r.results.filter(([c]) => !c), []);
  assert.equal(r.w.status, 'draft'); assert.match(r.w.name, /^TEST-CONF-pause-restore-1$/);
  assert.equal(r.w.spec.triggers.length, 2);
  assert.ok(r.out.record.triggersEqual === true && r.out.record.triggersRawEqual === false && Array.isArray(r.out.record.triggersBeforeMasked));
  assert.ok(!r.w.log.some((t) => /contact|enrol|workflow_enrol/i.test(t)), `tools called: ${r.w.log.join(',')}`);
  assert.equal(r.left.some((l) => l.startsWith('PAUSED, NOT RESTORED')), false, 'the paused residue line is cleared on a read-back restore');
});
test('pause-restore proof: a restore that changes a real field FAILS, is reported by path, and the flow is still taken down', async () => {
  const r = await runProof({ restamp: true, flip: true });
  assert.equal(r.out.ok, false);
  assert.ok(r.results.some(([c, m]) => !c && /equal to before, field by field/.test(m)));
  assert.deepEqual(r.out.record.triggerDiff, [{ path: 'triggers[1].active', before: true, after: false }]);
  assert.equal(r.w.status, 'draft');
});
test('pause-restore proof: the script creates no contact and enrols nobody (static)', () => {
  const t = readFileSync(join(SCRIPTS, 'pause-restore-proof.mjs'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\/contacts\b/.test(t) && !/\/workflow\/\$\{[^}]+\}\/contact|workflow\/\$\{wid\}`, \{ eventStartTime/.test(t) && !/POST', `\/contacts/.test(t));
  assert.ok(!/\bDELETE\b/.test(t), 'no delete');
});

// QA 2026-11-22 points 7-8: the 3 non-TEST runs in record 7ccf1ca5 are ONE published non-TEST flow on note_add (steps if_else x3 + update_contact_field). Fixture with invented ids.
test('census: a published non-TEST note_add flow BLOCKS under both event sets (replay of the explainer finding, invented ids)', async () => {
  const f = fake([{ id: 'wf-note-add-1', name: 'Client note flow' }], { 'wf-note-add-1': [{ type: 'note_add', active: true }] });
  for (const eventSet of [CORE, CONV]) {
    const c = await publishedTriggerCensus({ ...f, LOCATION: 'L', eventSet, convAi: { ok: true, blocks: false, agents: [] } });
    assert.deepEqual(c.blockers.map((x) => x.id), ['wf-note-add-1'], eventSet.name); assert.deepEqual(c.nonTest.map((x) => x.id), ['wf-note-add-1']);
    assert.equal(c.rows[0].decisions[0].decision, 'blocks'); assert.equal(censusClean(c), false);
  }
});
test('census: no type pattern, flag default or allow-list passes a live trigger; inbound_webhook, scheduler, trigger_link, form_submission, dnd_contact, custom_date_reminder, customer_reply all block', () => {
  for (const type of ['note_add', 'inbound_webhook', 'scheduler', 'trigger_link', 'form_submission', 'dnd_contact', 'custom_date_reminder', 'customer_reply', 'appointment', 'payment_received', 'opportunity_decay', 'conv_ai_trigger']) for (const es of [CORE, CONV, flags({})]) assert.equal(judgeTrigger({ type, active: true }, es, { ok: true, blocks: false, agents: [] }).decision, 'blocks', type);
  assert.equal(judgeTrigger({ type: 'note_add', active: false }, CORE).decision, 'inactive');
});
test('census: workflow exemptions exist only per named run S; none today; each future entry needs its own test', async () => {
  const { WORKFLOW_RUN_EXEMPTIONS, workflowExempt } = await import(join(SCRIPTS, 'published-trigger-census.mjs'));
  assert.deepEqual(Object.keys(WORKFLOW_RUN_EXEMPTIONS), []);
  const S = 'a'.repeat(40);
  assert.equal(workflowExempt(S, 'note_add'), false); assert.equal(workflowExempt('not-a-sha', 'note_add'), false); assert.equal(workflowExempt(null, 'note_add'), false);
  assert.equal(judgeTrigger({ type: 'note_add', active: true }, CORE, null, S).decision, 'blocks');
});
