// The rulebook merge, asserted from the SHIPPED catalog.
//
// gen-catalog.mjs and its input snapshot (`sniffs/assets/*.json`, the distilled marketplace
// assets schema) live in the ghl-workflow-api-docs repo; this repo ships only the generated
// catalog.data.json. So the docs-repo copy of this suite checks snapshot→catalog fidelity,
// and this one checks the invariants that must hold in whatever catalog was copied across.
// Both matter: a bad copy is exactly as harmful as a bad generation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from './catalog.mjs';
import { buildTrigger } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import CATALOG from './catalog.data.json' with { type: 'json' };

const catalog = loadCatalog();
const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('a'), catalog });
const steps = Object.values(CATALOG.steps);
const triggers = Object.values(CATALOG.triggers);
const fromRulebook = (list) => list.filter((e) => e.source === 'rulebook');

test('the shipped catalog carries the rulebook merge', () => {
  assert.ok(steps.length >= 383, `steps: ${steps.length} — catalog copied from a pre-rulebook build?`);
  assert.ok(triggers.length >= 204, `triggers: ${triggers.length}`);
  assert.ok(fromRulebook(steps).length >= 279, 'rulebook-sourced steps missing');
  assert.ok(fromRulebook(triggers).length >= 145, 'rulebook-sourced triggers missing');
  assert.ok(CATALOG._sources.includes('sniffs/assets/actions.json'));
});

test('rulebook-sourced entries never claim to be verified-live', () => {
  // Their attribute lists are schema-derived and incomplete wherever GHL hides keys behind a
  // DYNAMIC row. Promoting one switches on the compiler's ATTR_KEY guard, which would then
  // reject valid authoring — a worse failure than the gap it closes.
  const promoted = fromRulebook(steps).filter((e) => e.confidence !== 'live-schema');
  assert.deepEqual(promoted.map((e) => e.type), []);
});

test('rulebook filter schemas are never exposed as expandable filterRows', () => {
  // expandFilter reads the bundle-recovered {value,label,id,type} row shape; the assets rows
  // are {field,title,fieldType} and would be silently mis-expanded.
  for (const t of fromRulebook(triggers)) {
    assert.equal(t.filterRows, undefined, `${t.type} exposed schema filters as filterRows`);
  }
});

// SETTLED LIVE 2026-07-27: a Calendly trigger added through the builder UI showed the
// builder POSTing masterType "internal" for an INTEGRATION_AI trigger, alongside
// workflowsTriggerType. GHL persists both. The "app" value in older notes was never observed.
test('every rulebook trigger carries masterType "internal", both flavours', () => {
  for (const t of fromRulebook(triggers)) {
    assert.equal(t.masterType, 'internal', t.type);
    assert.equal(t.masterTypeUnknown, undefined, `${t.type} still marked unknown`);
    assert.ok(t.workflowsTriggerType, `${t.type} lost its schema flavour`);
  }
});

test('buildTrigger emits the captured marketplace envelope', () => {
  const built = buildTrigger(
    { type: 'lc_calendly_new_routing_form_submission', name: 'New Routing Form Submission', filters: [] },
    ctx(), 'WID');
  assert.equal(built.masterType, 'internal');
  assert.equal(built.workflowsTriggerType, 'INTEGRATION_AI');
  assert.deepEqual(built.conditions, []);
  assert.deepEqual(built.actions, [{ workflow_id: 'WID', type: 'add_to_workflow' }]);

  // OG triggers have no workflowsTriggerType recorded, and none is invented for them.
  const og = buildTrigger({ type: 'contact_tag', name: 'T', filters: [] }, ctx(), 'WID');
  assert.equal(og.masterType, 'highlevel');
  assert.equal('workflowsTriggerType' in og, false);
});

test('the rulebook did not overwrite an attested shape', () => {
  // Three places the marketplace schema is KNOWN to disagree with what GHL actually emits.
  // Each of these was a live-diagnosed defect; the merge must not reintroduce any of them.
  const goto = catalog.step('goto');
  assert.equal(goto.confidence, 'verified-live');
  assert.ok(!goto.attrKeys.includes('placement'), 'goto gained the phantom `placement` key');

  const transfer = catalog.step('conversationai_transfer_bot');
  assert.ok(!transfer.attrKeys.includes('prompt'), 'transfer_bot regained the non-persisting `prompt`');

  const end = catalog.step('conversationai_end');
  assert.equal(end.confidence, 'verified-live');
  assert.ok(end.attrKeys.includes('sleepDuration') && end.attrKeys.includes('sleepUnit'),
    'conversationai_end lost the DYNAMIC-hidden reactivation schedule');
  // The advisory block records the schema's narrower answer without displacing the real one.
  assert.equal(CATALOG.steps.conversationai_end.schema.fieldsIncomplete, true);
});

test('native actions the engine could not build before are now in the catalog', () => {
  const rcs = catalog.step('send_rcs');
  assert.ok(rcs, 'send_rcs missing');
  assert.deepEqual(rcs.requiredFields, ['rcs_sender_id', 'rcs_snippet_id']);
  for (const k of ['kb_search', 'workflow_ai_extract_data', 'rcs_interactive_message', 'bulk_email_verification']) {
    assert.ok(catalog.step(k), `${k} still missing`);
  }
  for (const k of ['quiz_submitted', 'reputation_review_received', 'funnel_website_pageview',
    'user_replied', 'service_booking', 'affiliate_sales', 'task_completed']) {
    assert.ok(catalog.trigger(k), `trigger ${k} still missing`);
  }
});

test('the OG primitives are untouched — the rulebook does not contain them', () => {
  // The rulebook is the MARKETPLACE surface. If any of these ever showed `source: rulebook`
  // it would mean a core action had been silently redefined from a schema that omits it.
  for (const k of ['add_contact_tag', 'send_email', 'sms', 'if_else', 'wait', 'goto',
    'custom_webhook', 'custom_code', 'find_contact', 'internal_notification', 'workflow_split']) {
    const e = catalog.step(k);
    if (!e) continue;    // send_email is `email` in the catalog; skip rather than assert a name
    assert.notEqual(e.source, 'rulebook', `${k} was redefined from the marketplace schema`);
  }
});
