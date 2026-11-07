// bl-481: two trigger filter rows reached the catalogue with UNRESOLVED enum objects as option values —
// mailgun_email_event "Event" ({__dynamic__:'EmailEventType.*'}) and customer_reply "Reply channel"
// ({__dynamic__:'MessageType.*'}). expandFilter's label match returned THAT OBJECT, so "Unsubscribed" went to the wire as
// {__dynamic__:...}. Values from the recovered source (bundle 2026-09-29-2: utils/helper_types.ts EmailEventType strings,
// types/message-type.ts MessageType numbers) and stored client triggers: mailgun.event "complained", message.type 2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const ctxWith = (catalog = loadCatalog()) => ({ loc: 'L', cid: 'C', uid: 'U', companyAge: 27, idGen: makeSeededIdGen('d'), catalog, warn: () => {} });
const condsFor = (type, filters, catalog) => compile({ name: 'W', triggers: [{ ref: 't', type, name: 'T', filters }],
  graph: [{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['x'] } }] }, ctxWith(catalog)).triggerBodies[0].conditions;

test('mailgun_email_event "Unsubscribed" is stored as the string "unsubscribed"', () => {
  const [c] = condsFor('mailgun_email_event', [{ field: 'mailgun.event', value: 'Unsubscribed' }]);
  assert.equal(c.value, 'unsubscribed');
  assert.equal(condsFor('mailgun_email_event', [{ field: 'mailgun.event', value: 'complained' }])[0].value, 'complained');
});

test('customer_reply reply channel "SMS" is stored as the number 2 (the stored shape), and 2 stays 2', () => {
  assert.equal(condsFor('customer_reply', [{ field: 'message.type', value: 'SMS' }])[0].value, 2);
  assert.equal(condsFor('customer_reply', [{ field: 'message.type', value: 'Chat widget' }])[0].value, 5);
  assert.equal(condsFor('customer_reply', [{ field: 'message.type', value: 2 }])[0].value, 2);
});

test('no trigger filter option in the served catalogue carries an unresolved {__dynamic__} value', () => {
  const cat = loadCatalog();
  const left = [];
  for (const type of cat.allTriggers()) for (const row of cat.trigger(type)?.filterRows ?? []) {
    for (const o of row.options ?? []) if (o?.value && typeof o.value === 'object') left.push(`${type}.${row.value}: ${JSON.stringify(o.value)}`);
  }
  assert.deepEqual(left, []);
});

test('POST-CONDITION: an option whose value is still an object is refused, never written', () => {
  const real = loadCatalog();
  const fake = { ...real, trigger: (t) => (t !== 'mailgun_email_event' ? real.trigger(t) : { ...real.trigger(t),
    filterRows: real.trigger(t).filterRows.map((r) => (r.value !== 'mailgun.event' ? r
      : { ...r, options: r.options.map((o) => (o.label === 'Opened' ? { ...o, value: { __dynamic__: 'EmailEventType.OPENED' } } : o)) })) }) };
  assert.throws(() => condsFor('mailgun_email_event', [{ field: 'mailgun.event', value: 'Opened' }], fake),
    (e) => e.code === 'FILTER_VALUE_UNRESOLVED' && /EmailEventType\.OPENED/.test(e.message));
});
