// LIVE: a create_custom_object step is checked against the object's REAL schema before any write (bl-167).
// Fixture: the TEST-CONF custom object `custom_objects.test_conf_pets` created on the sandbox 2026-09-23
// (public API, left in place). DIFFERENTIAL on the same step: the field named by its ID (what the builder
// stores) builds; the same field named by its fieldKey is refused, naming the id; a create that omits the
// object's required property is refused. Every workflow here is a DRAFT with no trigger.
export async function runCustomObjectProof({ call, gw, LOCATION, NAME, check, left, log = null }) {
  const subject = (s) => log?.subject?.(s);
  const KEY = 'custom_objects.test_conf_pets';
  subject(false);
  const sch = await gw.call('GET', `/objects/${KEY}?locationId=${LOCATION}&fetchProperties=true`);
  const field = (sch.json?.fields ?? []).find((f) => f.fieldKey === `${KEY}.pet_name`);
  check(sch.ok && Boolean(field?.id), 'PRECONDITION: the TEST-CONF custom object exists and its schema is readable', `${sch.status} ${JSON.stringify(Object.keys(sch.json ?? {}))}`);
  if (!field?.id) return;
  const stepWith = (fields) => ({ ref: 'co', kind: 'action', type: 'create_custom_object', name: 'Create TEST-CONF pet',
    attributes: { type: 'create_custom_object', key: KEY, fields, makeAssociation: false, associations: [], followers: [], clearOwner: false, clearFollowers: false } });
  const build = (label, fields) => call('build_workflow', { spec: { name: NAME(`co-${label}`), triggers: [], graph: [stepWith(fields)] } });

  subject('build_workflow');
  const ok1 = await build('ok', [{ fieldKey: field.id, value: '{{contact.first_name}}', dataType: 'TEXT' }]);
  check(ok1.ok === true && typeof ok1.data?.wid === 'string', 'CONTROL: the field named by its ID (the builder\'s own storage) builds clean',
    `${ok1.code ?? ''} ${String(ok1.detail ?? '').slice(0, 300)}`);
  if (ok1.data?.wid) left.push(`workflow ${ok1.data.wid} (${NAME('co-ok')}, draft, no trigger)`);

  const bad1 = await build('bykey', [{ fieldKey: field.fieldKey, value: 'Rex', dataType: 'TEXT' }]);
  check(bad1.ok === false && new RegExp(field.id).test(String(bad1.detail)), 'TEST: the same field named by its fieldKey is REFUSED before any write, and the refusal names the id to use',
    `${bad1.code ?? ''} ${String(bad1.detail ?? '').slice(0, 300)}`);
  if (bad1.data?.wid) left.push(`workflow ${bad1.data.wid} (${NAME('co-bykey')})`);

  const bad2 = await build('noreq', [{ fieldKey: 'GHOST_FIELD_ID', value: 'x', dataType: 'TEXT' }]);
  check(bad2.ok === false && /not a field of|required property|primary display/i.test(String(bad2.detail)),
    'TEST: a ghost field id, and a create that never sets the required property, are refused by name', `${bad2.code ?? ''} ${String(bad2.detail ?? '').slice(0, 300)}`);
  if (bad2.data?.wid) left.push(`workflow ${bad2.data.wid} (${NAME('co-noreq')})`);
  subject(false);
}
