import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = (n) => TOOLS.find((t) => t.name === n);
const deps = (routes) => ({
  state: { tokenFile: '/fixture/token.txt' },
  makeGw: () => ({
    loc: 'LOC',
    call: async (method, path) => {
      for (const [match, res] of routes) if (match(method, path)) return structuredClone(res);
      return { status: 404, ok: false, json: { message: `no fixture for ${method} ${path}` } };
    },
  }),
});
const at = (frag) => (method, path) => method === 'GET' && path.includes(frag);
const body = (json, status = 200) => ({ status, ok: status < 400, json });

// 🔴 THE WHOLE POINT OF THIS TOOL. Every route on this rail answers 200 whether or not a record
// exists, and three answer 200 with an empty body — {} for workflow-ai and
// workflow-location-setting, a bare null for error-notification (all measured live 2026-09-15).
// Reporting those as though the feature were off, or as though the read had failed, are both wrong.
const EMPTY_ROUTES = [
  [at('/auto-save/settings'), body({ _id: 'x', locationId: 'LOC', isActive: true })],
  [at('/workflow-ai/settings'), body({})],                 // empty OBJECT
  [at('/workflow-location-setting/settings'), body({})],    // empty OBJECT
  [at('/scheduled-pause/config'), body({ pauseConfigs: [] })],
  [at('/eliza-users'), body({ users: [] })],
  [at('/error-notification/'), body(null)],                 // bare NULL with a 200
];

test('an empty body is reported as NO RECORD — never as the feature being off, never as a failure', async () => {
  const r = await tool('get_workflow_settings').handler({ locationId: 'LOC', workflowId: 'WID' }, deps(EMPTY_ROUTES));
  assert.equal(r.ok, true);
  for (const k of ['workflowAi', 'locationSettings', 'errorNotification']) {
    assert.equal(r.data[k].present, false, `${k} must report present:false`);
    assert.match(r.data[k].note, /no record on this route/, `${k} must say WHICH kind of empty`);
    assert.match(r.data[k].note, /NOT the same as the feature being disabled/, `${k} must refuse the friendly misreading`);
    assert.equal(r.data[k].error, undefined, `${k} is empty, not failed — those are different`);
  }
});

test('a record that describes zero items is PRESENT — an empty collection is not an empty body', async () => {
  const r = await tool('get_workflow_settings').handler({ locationId: 'LOC' }, deps(EMPTY_ROUTES));
  assert.equal(r.data.scheduledPause.present, true, '{pauseConfigs: []} is a record, not an absent one');
  assert.deepEqual(r.data.scheduledPause.value, { pauseConfigs: [] }, 'and the caller gets the value to count off');
  assert.equal(r.data.elizaUsers.present, true);
});

test('one dead route does not make the others look absent, and the headline names all three populations', async () => {
  const routes = EMPTY_ROUTES.map(([m, res]) => (m(
    'GET', '/workflow/LOC/eliza-users') ? [m, body({ message: 'boom' }, 500)] : [m, res]));
  const r = await tool('get_workflow_settings').handler({ locationId: 'LOC' }, deps(routes));
  assert.equal(r.ok, true, 'a failed section is data, not a tool failure — the other reads are still worth having');
  assert.equal(r.data.elizaUsers.present, null, 'null is "unknown", distinct from false ("no record")');
  assert.ok(r.data.elizaUsers.error, 'and it carries the reason');
  assert.match(r.data.headline, /1 FAILED \(elizaUsers\)/);
  assert.match(r.data.headline, /with NO record/);
});

test('error-notification is SKIPPED, and said to be skipped, when no workflowId is given', async () => {
  const r = await tool('get_workflow_settings').handler({ locationId: 'LOC' }, deps(EMPTY_ROUTES));
  assert.equal('errorNotification' in r.data, false, 'never invent a section for a read that was not made');
  assert.match(r.data.readNote, /needs workflowId/);
});

test('list_workflow_templates reads a BARE ARRAY, and refuses to report a count from a shape it did not expect', async () => {
  const rows = [{ id: 't1', title: 'Recipe', description: 'd', categories: ['c'] }];
  const good = await tool('list_workflow_templates').handler({ locationId: 'LOC' },
    deps([[at('/workflow-templates'), body(rows)]]));
  assert.equal(good.data.count, 1);
  assert.deepEqual(good.data.templates[0], { id: 't1', title: 'Recipe', description: 'd', categories: ['c'] });

  // 🔴 Never report "0 templates" for a response shape that changed. A wrong zero reads as an
  // empty account and is indistinguishable from the truth at the call site.
  const drifted = await tool('list_workflow_templates').handler({ locationId: 'LOC' },
    deps([[at('/workflow-templates'), body({ unexpected: true })]]));
  assert.equal(drifted.ok, false);
  assert.match(drifted.detail, /not with an array/);
  assert.match(drifted.detail, /unexpected/, 'and it names the keys it DID get, so the fix is one read away');
});
