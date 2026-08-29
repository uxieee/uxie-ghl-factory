// RC-A's escape hatch, made safe. When the ops could not express a change, the fallback was
// always "GET the workflow, edit the JSON, PUT it back" — which skips every guard the edit path
// has. Eight client workflows carried a dead pipeline-stage NAME through exactly that route
// while the build reported clean (F5-09). repair_workflow takes the same whole document and runs
// all of them: association, required fields, dangling refs and parentKeys, goto loops, dead
// branches, workflow rules and merge tags, then the plain PUT and a round-trip verify.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const repairTool = () => TOOLS.find((t) => t.name === 'repair_workflow');

const baseTemplates = () => [
  { id: 's1', type: 'add_contact_tag', name: 'Head', next: 's2', parentKey: null, order: 0, attributes: { tags: ['old'] } },
  { id: 's2', type: 'add_contact_tag', name: 'Tail', next: null, parentKey: 's1', order: 1, attributes: { tags: ['old'] } },
];

const workflow = ({ status = 'draft', version = 7, templates } = {}) => ({
  _id: 'WID', id: 'WID', name: 'Existing workflow', status, version, filePath: 'keep.json',
  workflowData: { templates: templates ?? baseTemplates() },
});

function gateway({ initial = workflow() } = {}) {
  const calls = [];
  let stored = structuredClone(initial);
  const gw = {
    loc: 'LOC', uid: 'USER',
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (method === 'GET' && path.includes('/customFields/search')) return { status: 200, ok: true, json: { customFields: [] } };
      if (method === 'GET' && path === '/locations/LOC/customValues') return { status: 200, ok: true, json: { customValues: [] } };
      if (method === 'GET' && path.includes('/trigger')) return { status: 200, ok: true, json: { triggers: [] } };
      if (method === 'GET' && path.startsWith('/workflow/LOC/WID')) return { status: 200, ok: true, json: structuredClone(stored) };
      if (method === 'PUT' && path.startsWith('/workflow/LOC/WID')) {
        stored = { ...stored, ...structuredClone(body), version: (stored.version ?? 0) + 1 };
        return { status: 200, ok: true, json: structuredClone(stored) };
      }
      return { status: 404, ok: false, json: {} };
    },
  };
  return { gw, calls, storedNow: () => stored };
}
const deps = (gw) => ({ state: { tokenFile: '/fixture/token.txt' }, makeGw: () => gw });

test('previews a full-document replacement as a diff and writes nothing', async () => {
  const { gw, calls } = gateway();
  const templates = baseTemplates();
  templates[1] = { ...templates[1], name: 'Tail renamed' };
  const preview = await repairTool().handler({ locationId: 'LOC', workflowId: 'WID', templates, expectedVersion: 7 }, deps(gw));
  assert.equal(preview.code, 'CONFIRM_REQUIRED');
  assert.deepEqual(preview.data.preview.diff, { createdSteps: [], modifiedSteps: ['s2'], deletedSteps: [] });
  assert.deepEqual(calls.filter(({ method }) => method === 'PUT'), [], 'a preview must not write');
});

test('a stale expectedVersion is refused as VERSION_CONFLICT before any write', async () => {
  const { gw, calls } = gateway();
  const stale = await repairTool().handler({ locationId: 'LOC', workflowId: 'WID', templates: baseTemplates(), expectedVersion: 6, confirm: true }, deps(gw));
  assert.equal(stale.code, 'VERSION_CONFLICT');
  assert.match(stale.detail, /version is 7/);
  assert.deepEqual(calls.filter(({ method }) => method === 'PUT'), []);
});

test('the commit guards run: a dangling step reference is refused, and its hatch lets it through', async () => {
  const withGhost = () => {
    const t = baseTemplates();
    t.push({ id: 's3', type: 'goto', name: 'Jump', next: null, parentKey: 's2', order: 2, attributes: { type: 'goto', targetNodeId: 'ghost' } });
    t[1] = { ...t[1], next: 's3' };
    return t;
  };
  const a = gateway();
  const refused = await repairTool().handler({ locationId: 'LOC', workflowId: 'WID', templates: withGhost(), confirm: true }, deps(a.gw));
  assert.equal(refused.ok, false);
  assert.match(JSON.stringify(refused), /dangling step reference/);
  assert.match(JSON.stringify(refused), /allowDanglingStepRefs:true/, 'the guard must name its own hatch');
  assert.deepEqual(a.calls.filter(({ method }) => method === 'PUT'), [], 'a refused repair writes nothing');

  const b = gateway();
  const hatched = await repairTool().handler({
    locationId: 'LOC', workflowId: 'WID', templates: withGhost(), confirm: true,
    allowDanglingStepRefs: true, allowGotoLoops: true, deadBranchAcknowledged: true,
  }, deps(b.gw));
  assert.equal(hatched.ok, true, JSON.stringify(hatched));
  assert.equal(b.calls.filter(({ method }) => method === 'PUT').length, 1);
});

test('a clean repair writes once and round-trips', async () => {
  const { gw, calls } = gateway();
  const templates = baseTemplates();
  templates[1] = { ...templates[1], attributes: { tags: ['new'] } };
  const result = await repairTool().handler({ locationId: 'LOC', workflowId: 'WID', templates, confirm: true }, deps(gw));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.verify.roundTrip, true);
  assert.deepEqual(result.data.diff, { createdSteps: [], modifiedSteps: ['s2'], deletedSteps: [] });
  assert.equal(calls.filter(({ method }) => method === 'PUT').length, 1);
});

test('a template set with no ids, or an empty one, is refused before the GET', async () => {
  const { gw } = gateway();
  const empty = await repairTool().handler({ locationId: 'LOC', workflowId: 'WID', templates: [], confirm: true }, deps(gw));
  assert.equal(empty.ok, false);
  assert.match(empty.detail, /non-empty array/);
  const noIds = await repairTool().handler({ locationId: 'LOC', workflowId: 'WID', templates: [{ type: 'add_contact_tag' }], confirm: true }, deps(gw));
  assert.equal(noIds.ok, false);
  assert.match(noIds.detail, /no string 'id'/);
});
