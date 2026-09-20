import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = () => TOOLS.find((t) => t.name === 'set_workflow_error_alerts');
// A tiny stateful fake of the three routes + the user list, so read-back is REAL, not echoed.
function fake({ settings = { isActive: true, users: ['u1'] }, locationUsers = ['u1', 'u2', 'u3'], dropWrites = false } = {}) {
  let stored = settings === null ? null : structuredClone(settings);
  const calls = [];
  const gw = { loc: 'LOC', uid: 'me', call: async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET' && path.includes('/error-notification/settings')) return { status: 200, ok: true, json: stored === null ? null : structuredClone(stored) };
    if (method === 'GET' && path.startsWith('/users/')) return { status: 200, ok: true, json: { users: locationUsers.map((id) => ({ id, name: `User ${id}` })) } };
    if (method === 'PUT' && path.endsWith('/settings/users')) { if (!dropWrites) stored = { isActive: stored?.isActive ?? false, users: [...body.users] }; return { status: 200, ok: true, json: {} }; }
    if (method === 'PUT' && path.endsWith('/settings/is-active')) { if (!dropWrites) stored = { users: stored?.users ?? [], isActive: body.isActive }; return { status: 200, ok: true, json: {} }; }
    return { status: 404, ok: false, json: {} };
  } };
  return { calls, deps: { state: { tokenFile: '/fixture/token.txt' }, makeGw: () => gw }, stored: () => stored };
}
const puts = (f) => f.calls.filter((c) => c.method === 'PUT');

test('it exists, declares its three routes plus the user list, and is labelled a write', () => {
  assert.ok(tool());
  assert.deepEqual(tool().capabilities.map((c) => `${c.method} ${c.path}`), [
    'GET /workflow/{loc}/error-notification/settings', 'GET /users/',
    'PUT /workflow/{loc}/error-notification/settings/users', 'PUT /workflow/{loc}/error-notification/settings/is-active',
  ]);
});

test('MERGE, never replace: adding u2 to [u1] writes [u1,u2] — the existing recipient survives', async () => {
  const f = fake();
  const r = await tool().handler({ locationId: 'LOC', addUsers: ['u2'], confirm: true }, f.deps);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(puts(f).map((c) => c.body), [{ users: ['u1', 'u2'] }]);
  assert.deepEqual(r.data.after.users, ['u1', 'u2']);
  assert.equal(r.data.verified, true);
});

test('without confirm it previews before/after and writes NOTHING', async () => {
  const f = fake();
  const r = await tool().handler({ locationId: 'LOC', addUsers: ['u2'], removeUsers: ['u1'], isActive: false }, f.deps);
  assert.equal(r.code, 'CONFIRM_REQUIRED');
  assert.deepEqual(r.data.preview, { before: { isActive: true, users: ['u1'] }, after: { isActive: false, users: ['u2'] } });
  assert.equal(puts(f).length, 0);
});

test('a never-configured account (GET answers null) reads as inactive with no users, and can be configured', async () => {
  const f = fake({ settings: null });
  const r = await tool().handler({ locationId: 'LOC', addUsers: ['u2'], isActive: true, confirm: true }, f.deps);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.before, { isActive: false, users: [] });
  assert.deepEqual(r.data.after, { isActive: true, users: ['u2'] });
});

test('a user id that is not a user of this location is REFUSED before any write', async () => {
  const f = fake();
  const r = await tool().handler({ locationId: 'LOC', addUsers: ['ghost'], confirm: true }, f.deps);
  assert.equal(r.code, 'VALIDATION_FAILED');
  assert.match(r.detail ?? r.message ?? '', /ghost/);
  assert.equal(puts(f).length, 0);
});

test('no change requested, or a change that is already true, writes nothing and says so', async () => {
  const none = await tool().handler({ locationId: 'LOC', confirm: true }, fake().deps);
  assert.equal(none.code, 'VALIDATION_FAILED');
  const f = fake();
  const same = await tool().handler({ locationId: 'LOC', addUsers: ['u1'], isActive: true, confirm: true }, f.deps);
  assert.equal(same.ok, true);
  assert.equal(same.data.changed, false);
  assert.equal(puts(f).length, 0);
});

test('CONTROL for verified: when GHL acks the write but stores nothing, verified is FALSE', async () => {
  const f = fake({ dropWrites: true });
  const r = await tool().handler({ locationId: 'LOC', addUsers: ['u2'], confirm: true }, f.deps);
  assert.equal(r.ok, true);
  assert.equal(r.data.verified, false);
  assert.deepEqual(r.data.after.users, ['u1']);
});

test('only the routes that changed are written: isActive alone never touches the recipient list', async () => {
  const f = fake();
  await tool().handler({ locationId: 'LOC', isActive: false, confirm: true }, f.deps);
  assert.deepEqual(puts(f).map((c) => [c.path.split('/').pop(), c.body]), [['is-active', { isActive: false }]]);
});
