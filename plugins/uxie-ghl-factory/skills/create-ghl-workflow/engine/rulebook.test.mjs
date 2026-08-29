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

test('no filter row served by the catalog carries a non-string type or operator (unresolved enum artefacts reach the wire and 500)', () => {
  const bad = [];
  for (const t of catalog.allTriggers()) {
    for (const r of (catalog.trigger(t)?.filterRows ?? [])) {
      // `null`/absent is fine — expandFilter's `?? row.type ?? 'select'` chain resolves nullish.
      // An OBJECT is the defect: an enum the extractor could not resolve, copied verbatim onto the
      // wire, which GHL answers with a 500 (F5-16).
      if (r.type != null && typeof r.type !== 'string') bad.push(`${t}.${r.value}.type=${JSON.stringify(r.type)}`);
      if (r.operator != null && typeof r.operator !== 'string') bad.push(`${t}.${r.value}.operator=${JSON.stringify(r.operator)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('call_status: the drawer shape — contains-any + array value + type multiselect (F5-16/F5-22)', () => {
  const body = buildTrigger({ ref: 't', type: 'call_status', name: 'Booked calls',
    filters: [{ field: 'custom_disposition', value: 'Booked' }, { field: 'message.direction', value: 'outbound' }] }, ctx(), 'WID', new Map());
  const disp = body.conditions.find((c) => c.field === 'custom_disposition');
  assert.deepEqual({ operator: disp.operator, value: disp.value, type: disp.type },
    { operator: 'contains-any', value: ['Booked'], type: 'multiselect' });
  const dir = body.conditions.find((c) => c.field === 'message.direction');
  assert.deepEqual({ operator: dir.operator, value: dir.value, type: dir.type }, { operator: '==', value: 'outbound', type: 'select' });
});

// F5-25: where the drawer offers a MENU and no default, it forces the author to pick. The engine
// used to invent one from the row's TYPE — producing an operator the menu never contained, which
// saves clean and never matches.
test('customer_reply message-body: no invented operator — authoring without one is refused naming the menu', () => {
  assert.throws(
    () => buildTrigger({ ref: 't', type: 'customer_reply', name: 'Reply', filters: [{ field: 'message.body', value: ['stop'] }] }, ctx(), 'WID', new Map()),
    (e) => e.code === 'FILTER_OPERATOR_REQUIRED' && /string-contains-any-of/.test(e.message) && /string-matches-any-of/.test(e.message));

  const body = buildTrigger({ ref: 't', type: 'customer_reply', name: 'Reply', filters: [{ field: 'message.body', operator: 'string-contains-any-of', value: ['stop'] }] }, ctx(), 'WID', new Map());
  const row = body.conditions.find((c) => c.field === 'message.body');
  assert.equal(row.operator, 'string-contains-any-of');
  assert.equal(row.id, 'message-body');

  assert.throws(
    () => buildTrigger({ ref: 't', type: 'customer_reply', name: 'R', filters: [{ field: 'message.body', operator: 'is-any-of', value: ['x'] }] }, ctx(), 'WID', new Map()),
    (e) => e.code === 'FILTER_OPERATOR' && /is-any-of/.test(e.message));
});

// F5-26: a contact_changed row on a CUSTOM field exists only once the field does, so it could not
// be expressed at all. The catalog now carries the drawer's row template and the account's own
// field list turns it into a wire row.
test('contact_changed on a CUSTOM field instantiates the drawer template through ctx.customFields', () => {
  const c = { ...ctx(), customFields: [{ id: 'x2f9dK1mQ84hL0pTzVbn', name: 'Next Callback On', fieldKey: 'contact.next_callback_on', dataType: 'DATE', model: 'contact' }] };
  const body = buildTrigger({ ref: 't', type: 'contact_changed', name: 'Callback set', filters: [{ field: 'Next Callback On', operator: 'has-changed' }] }, c, 'WID', new Map());
  const row = body.conditions[0];
  assert.deepEqual(row, { operator: 'has-changed', field: 'contact.x2f9dK1mQ84hL0pTzVbn', title: 'Next Callback On', type: 'date', id: 'x2f9dK1mQ84hL0pTzVbn' });
});

test('the same custom field resolves by id, by contact.<id>, and by fieldKey — and a PHONE field forces has-changed', () => {
  const fields = [
    { id: 'x2f9dK1mQ84hL0pTzVbn', name: 'Next Callback On', fieldKey: 'contact.next_callback_on', dataType: 'DATE', model: 'contact' },
    { id: 'p7h3aQ9zW21kR8mNvXcd', name: 'Mobile', fieldKey: 'contact.mobile', dataType: 'PHONE', model: 'contact' },
  ];
  const c = { ...ctx(), customFields: fields };
  for (const key of ['x2f9dK1mQ84hL0pTzVbn', 'contact.x2f9dK1mQ84hL0pTzVbn', 'contact.next_callback_on']) {
    const body = buildTrigger({ ref: 't', type: 'contact_changed', name: 'C', filters: [{ field: key, operator: 'has-changed' }] }, c, 'WID', new Map());
    assert.equal(body.conditions[0].field, 'contact.x2f9dK1mQ84hL0pTzVbn', key);
  }
  const phone = buildTrigger({ ref: 't', type: 'contact_changed', name: 'C', filters: [{ field: 'Mobile' }] }, c, 'WID', new Map());
  assert.equal(phone.conditions[0].operator, 'has-changed', 'a PHONE field has no value to compare');
  assert.throws(() => buildTrigger({ ref: 't', type: 'contact_changed', name: 'C', filters: [{ field: 'Mobile', operator: '==' }] }, c, 'WID', new Map()),
    (e) => e.code === 'FILTER_OPERATOR');
});

// call_status matches dispositions BY NAME, so a name that does not exist in Settings can never
// match — the trigger simply never fires and nothing reports it.
test('a call_status disposition this account does not have warns, naming what it does have', () => {
  const warns = [];
  const c = { ...ctx(), callDispositions: [{ id: 'D1', name: 'Booked' }, { id: 'D2', name: 'No Answer' }], warn: (m) => warns.push(m) };
  buildTrigger({ ref: 't', type: 'call_status', name: 'Dispo', filters: [{ field: 'custom_disposition', value: ['Booked', 'Ghosted'] }] }, c, 'WID', new Map());
  assert.equal(warns.length, 1, warns.join('\n'));
  assert.match(warns[0], /TRIGGER_DISPOSITION_UNKNOWN/);
  assert.match(warns[0], /'Ghosted'/);
  assert.match(warns[0], /Booked, No Answer/);
});

test('a disposition the account HAS is silent, and no list at all is silent too', () => {
  const withList = [];
  buildTrigger({ ref: 't', type: 'call_status', name: 'D', filters: [{ field: 'custom_disposition', value: ['booked'] }] },
    { ...ctx(), callDispositions: [{ id: 'D1', name: 'Booked' }], warn: (m) => withList.push(m) }, 'WID', new Map());
  assert.deepEqual(withList, [], 'matching is case-insensitive');

  const noList = [];
  buildTrigger({ ref: 't', type: 'call_status', name: 'D', filters: [{ field: 'custom_disposition', value: ['Anything'] }] },
    { ...ctx(), warn: (m) => noList.push(m) }, 'WID', new Map());
  assert.deepEqual(noList, [], 'without the account list there is nothing to check against');
});

// F5-08 (settled 2026-08-29 by picking the field in the drawer and reading it back): a
// custom_date_reminder needs the config block AND a conditions row. A write that sent only the
// config was silently DISCARDED by the server — "Custom Date Field is required" at publish was
// about the missing row, not the config.
test('custom_date_reminder emits the config block, the conditions row, and root match_year from one lean intent', () => {
  const c = { ...ctx(), customFields: [{ id: 'x2f9dK1mQ84hL0pTzVbn', name: 'Next Callback On', fieldKey: 'contact.next_callback_on', dataType: 'DATE', model: 'contact' }] };
  const b = buildTrigger({ ref: 't', type: 'custom_date_reminder', name: 'Callback due',
    config: { field: 'Next Callback On', runHour: 9, offsetDays: 0 }, filters: [] }, c, 'WID', new Map());
  assert.deepEqual(b.custom_date_reminder_config, {
    recordType: 'contact', customDateFieldId: 'x2f9dK1mQ84hL0pTzVbn', customDateFieldType: 'DATE',
    matchYear: true, offsetDays: 0, runHour: '9', timezone: '', last_run: '',
  });
  assert.equal(typeof b.custom_date_reminder_config.runHour, 'string', 'runHour is a STRING on the wire');
  assert.equal(b.match_year, true);
  assert.deepEqual(b.conditions.find((x) => x.id === 'custom-field'), {
    operator: 'custom-field-eq', field: 'contact.customFields', value: 'x2f9dK1mQ84hL0pTzVbn',
    title: 'Contact date field', type: 'select', id: 'custom-field',
  });
});

test('custom_date_reminder resolves the field by id, fieldKey or name, and refuses a ghost', () => {
  const c = { ...ctx(), customFields: [{ id: 'x2f9dK1mQ84hL0pTzVbn', name: 'Next Callback On', fieldKey: 'contact.next_callback_on', dataType: 'DATE', model: 'contact' }] };
  for (const field of ['x2f9dK1mQ84hL0pTzVbn', 'contact.next_callback_on', 'Next Callback On']) {
    const b = buildTrigger({ ref: 't', type: 'custom_date_reminder', name: 'D', config: { field }, filters: [] }, c, 'WID', new Map());
    assert.equal(b.custom_date_reminder_config.customDateFieldId, 'x2f9dK1mQ84hL0pTzVbn', field);
  }
  assert.throws(() => buildTrigger({ ref: 't', type: 'custom_date_reminder', name: 'D', config: { field: 'Nope' }, filters: [] }, c, 'WID', new Map()),
    (e) => e.code === 'UNRESOLVED_NAME' && /watches nothing/.test(e.message));
  assert.throws(() => buildTrigger({ ref: 't', type: 'custom_date_reminder', name: 'D', config: {}, filters: [] }, c, 'WID', new Map()),
    (e) => e.code === 'MISSING_FIELD' && /Custom Date Field is required/.test(e.message));
});
