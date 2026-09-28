import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileDeploymentIntent, planDeployment, verifyDeployment, executeDeployment, DEPLOY_PATH } from './deployment.mjs';

const row = (o) => ({ id: o.id, locationId: 'L', channel: 'SMS', providerId: 'SMS', agentId: 'X', agentProductType: 'conversation_ai',
  enabled: false, allIdentifiers: true, specificIdentifiers: [], includeTags: [], includeTagsOperator: 'AND', excludeTags: [], excludeTagsOperator: 'AND',
  createdBy: 'u', updatedBy: 'u', updatedAt: 't0', deleted: false, ...o });
const TABLE = () => [
  row({ id: 'g1', channel: 'Live_Chat', providerId: 'Live_Chat', agentId: 'GROM', enabled: true, includeTags: ['rail-1'] }),
  row({ id: 's1', agentId: 'OTHER', enabled: true, includeTags: ['vip'] }),
  row({ id: 'w1', channel: 'WebChat', providerId: 'WebChat', agentId: 'ME', includeTags: ['probe'] }),
];

// A fake routing service with the measured semantics: POST creates (no conflict check), PATCH merges and runs the
// overlap check when the result is enabled, GET returns the whole table.
function fakeGw({ rows = TABLE(), tamper = null, conflict = true } = {}) {
  let table = rows; const calls = []; let n = 0;
  const clash = (r) => table.find((o) => o.id !== r.id && o.enabled && o.channel === r.channel && o.providerId === r.providerId && o.agentId !== r.agentId
    && !(o.includeTags.length && r.includeTags.length && !o.includeTags.some((t) => r.includeTags.includes(t))) && !o.includeTags.some((t) => r.excludeTags.includes(t)));
  return {
    calls, table: () => table,
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (method === 'GET') return { ok: true, status: 200, json: structuredClone(table) };
      if (method === 'POST') { const r = row({ id: `new${++n}`, ...body, updatedAt: 't1' }); table = [...table, r]; if (tamper) table = tamper(table); return { ok: true, status: 201, json: structuredClone(r) }; }
      if (method === 'PATCH') {
        const id = decodeURIComponent(path.split('/').pop()); const cur = table.find((r) => r.id === id);
        const next = { ...cur, ...body, updatedAt: 't1' };
        if (conflict && next.enabled && clash(next)) { const c = clash(next); return { ok: false, status: 409, json: { message: 'Update conflicts with config for agent', conflictingConfig: { id: c.id, agentId: c.agentId } } }; }
        table = table.map((r) => (r.id === id ? next : r)); if (tamper) table = tamper(table); return { ok: true, status: 200, json: structuredClone(next) };
      }
      return { ok: false, status: 405, json: {} };
    },
  };
}
const intent = (o = {}) => compileDeploymentIntent({ agentId: 'ME', channel: 'WebChat', enabled: false, includeTags: ['probe'], ...o });

test('intent: the whole row is always explicit, with the editor\'s defaults', () => {
  const i = compileDeploymentIntent({ agentId: 'ME', channel: 'SMS', enabled: true, specificIdentifiers: ['PHONE-1'] });
  assert.deepEqual(i.identity, { agentId: 'ME', channel: 'SMS', providerId: 'SMS', agentProductType: 'conversation_ai' });
  assert.deepEqual(i.row, { enabled: true, allIdentifiers: false, specificIdentifiers: ['PHONE-1'], includeTags: [], includeTagsOperator: 'AND', excludeTags: [], excludeTagsOperator: 'AND' });
  assert.equal(compileDeploymentIntent({ agentId: 'ME', channel: 'SMS', enabled: false }).row.allIdentifiers, true);
});

test('intent: refuses what the editor refuses, and what the channel cannot hold', () => {
  const bad = [
    [{ channel: 'Voice' }, /channel must be one of/],
    [{ enabled: undefined }, /enabled must be true or false/],
    [{ includeTags: ['a'], excludeTags: ['a'] }, /may not be in both lists/],
    [{ channel: 'Email', specificIdentifiers: ['x@y.z'] }, /always "all"/],
    [{ channel: 'SMS', providerId: 'prov1', specificIdentifiers: ['+1'] }, /always "all"/],
    [{ channel: 'FB', providerId: 'prov1' }, /only offered for SMS or Email/],
    [{ channel: 'SMS', allIdentifiers: false }, /needs at least one specificIdentifier/],
    [{ includeTagsOperator: 'XOR' }, /AND or OR/],
  ];
  for (const [o, re] of bad) assert.throws(() => compileDeploymentIntent({ agentId: 'ME', channel: 'WebChat', enabled: false, ...o }), re);
});

test('plan: create when the agent has no row on that channel; update names only the changed keys; noop when equal', () => {
  const t = TABLE();
  const c = planDeployment(t, compileDeploymentIntent({ agentId: 'ME', channel: 'Email', enabled: false }), { locationId: 'L' });
  assert.equal(c.action, 'create'); assert.equal(c.method, 'POST'); assert.equal(c.path, DEPLOY_PATH);
  assert.deepEqual(c.body, { locationId: 'L', agentId: 'ME', channel: 'Email', providerId: 'Email', agentProductType: 'conversation_ai', enabled: false, allIdentifiers: true, specificIdentifiers: [], includeTags: [], includeTagsOperator: 'AND', excludeTags: [], excludeTagsOperator: 'AND' });
  const u = planDeployment(t, intent({ includeTags: ['probe', 'two'] }), { locationId: 'L' });
  assert.equal(u.action, 'update'); assert.equal(u.rowId, 'w1'); assert.deepEqual(u.changed, ['includeTags']); assert.equal(u.path, `${DEPLOY_PATH}/w1`);
  assert.equal(planDeployment(t, intent(), { locationId: 'L' }).action, 'noop');
});

test('plan: two rows for the same agent + channel + provider is ambiguous → refused', () => {
  const t = [...TABLE(), row({ id: 'w2', channel: 'WebChat', providerId: 'WebChat', agentId: 'ME' })];
  const p = planDeployment(t, intent(), { locationId: 'L' });
  assert.match(p.refuse, /2 rows .* ambiguous/); assert.deepEqual(p.rows, ['w1', 'w2']);
});

test('plan: enabling beside an overlapping enabled row of another agent names the likely 409; a disjoint scope does not', () => {
  const t = TABLE();
  const hit = planDeployment(t, compileDeploymentIntent({ agentId: 'ME', channel: 'SMS', enabled: true }), { locationId: 'L' });
  assert.deepEqual(hit.collisions.map((c) => c.rowId), ['s1']);
  const disjoint = planDeployment(t, compileDeploymentIntent({ agentId: 'ME', channel: 'SMS', enabled: true, excludeTags: ['vip'] }), { locationId: 'L' });
  assert.deepEqual(disjoint.collisions, []);
});

test('execute: preview makes only the read; confirm writes once and proves every other row identical', async () => {
  const gw = fakeGw();
  const pv = await executeDeployment({ gw, locationId: 'L', intent: intent({ includeTags: ['probe', 'two'] }), confirm: false });
  assert.equal(pv.confirmed, false); assert.deepEqual(gw.calls.map((c) => c.method), ['GET']);
  const r = await executeDeployment({ gw, locationId: 'L', intent: intent({ includeTags: ['probe', 'two'] }), confirm: true });
  assert.equal(r.ok, true); assert.equal(r.written, 'update');
  assert.deepEqual(gw.calls.slice(1).map((c) => c.method), ['GET', 'PATCH', 'GET']);
  assert.equal(r.verification.othersUnchanged, 2); assert.deepEqual(r.verification.changedOthers, []);
  assert.deepEqual(gw.table().find((x) => x.id === 'g1'), TABLE()[0]);
});

test('execute: create adds exactly one row and the rest are untouched', async () => {
  const gw = fakeGw();
  const r = await executeDeployment({ gw, locationId: 'L', intent: compileDeploymentIntent({ agentId: 'ME', channel: 'Email', enabled: false, includeTags: ['probe'] }), confirm: true });
  assert.equal(r.ok, true); assert.equal(r.written, 'create'); assert.equal(r.verification.rowId, 'new1'); assert.equal(r.verification.othersUnchanged, 3);
});

test('execute (control): a write that moves ANOTHER row fails verification and names that row', async () => {
  const gw = fakeGw({ tamper: (t) => t.map((x) => (x.id === 'g1' ? { ...x, enabled: false } : x)) });
  const r = await executeDeployment({ gw, locationId: 'L', intent: intent({ includeTags: ['probe', 'two'] }), confirm: true });
  assert.equal(r.ok, false); assert.equal(r.code, 'VERIFY_FAILED'); assert.deepEqual(r.verification.changedOthers, ['g1']);
});

test('execute: a 409 is returned with the colliding row, the table re-read, and nothing else attempted', async () => {
  const gw = fakeGw({ rows: [...TABLE(), row({ id: 'm1', agentId: 'ME' })] });
  const r = await executeDeployment({ gw, locationId: 'L', intent: compileDeploymentIntent({ agentId: 'ME', channel: 'SMS', enabled: true }), confirm: true });
  assert.equal(r.ok, false); assert.equal(r.http.status, 409); assert.equal(r.http.json.conflictingConfig.id, 's1');
  assert.deepEqual(gw.calls.map((c) => c.method), ['GET', 'PATCH', 'GET']); assert.deepEqual(r.verification.changedOthers, []);
});

test('verify: the target must equal the intent', () => {
  const t = TABLE(); const after = t.map((x) => (x.id === 'w1' ? { ...x, includeTags: ['other'] } : x));
  const v = verifyDeployment(t, after, intent(), 'w1');
  assert.equal(v.verified, false); assert.deepEqual(v.mismatches, ['includeTags']);
});
