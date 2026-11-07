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

// ---- W6a Task 2 (item 1, bl-398). Live 2026-10-30 (knowledge sniffs/workflows-w6a-2026-10-30/live-step-ids.json): the internal
// PUT KEEPS a non-UUID step id verbatim. The builder's copy/paste re-mints only UUID-shaped ids (corpus EDIT-RAIL.md), so a
// readable id is a duplicate waiting to happen: warned, not refused. And a round trip in which GHL did re-mint ids says so.
const UUID_A = '00000000-0000-4000-8000-0000000000f2';
test('a NEW step with a non-UUID id is written but warned about (READABLE_STEP_ID); a new UUID step is not', async () => {
  const { gw } = gateway();
  const t = baseTemplates();
  t[1] = { ...t[1], next: UUID_A };
  t.push({ id: UUID_A, type: 'add_contact_tag', name: 'U', next: 'welcome-sms', parentKey: 's2', order: 2, attributes: { tags: ['x'] } });
  t.push({ id: 'welcome-sms', type: 'add_contact_tag', name: 'R', next: null, parentKey: UUID_A, order: 3, attributes: { tags: ['y'] } });
  const r = await repairTool().handler({ locationId: 'LOC', workflowId: 'WID', templates: t }, deps(gw));
  const w = (r.data?.preview?.warnings ?? []).filter((x) => /READABLE_STEP_ID/.test(x));
  assert.equal(w.length, 1, JSON.stringify(r.data?.preview?.warnings));
  assert.match(w[0], /welcome-sms/);
  assert.doesNotMatch(w[0], new RegExp(UUID_A));
});

test('a round trip where GHL re-minted ids reports IDS_REMINTED with from→to, not a generic abort', async () => {
  const { gw } = gateway();
  const real = gw.call;
  let reminted = false;
  gw.call = async (method, path, body) => {
    const res = await real(method, path, body);
    if (method === 'PUT') reminted = true;
    if (reminted && method === 'GET' && path.startsWith('/workflow/LOC/WID')) {
      const j = structuredClone(res.json);
      j.workflowData.templates = j.workflowData.templates.map((s) => (s.id === 's3' ? { ...s, id: 'aaaaaaaa-0000-4000-8000-000000000003' } : s));
      return { ...res, json: j };
    }
    return res;
  };
  const t = baseTemplates();
  t[1] = { ...t[1], next: 's3' };
  t.push({ id: 's3', type: 'add_contact_tag', name: 'New', next: null, parentKey: 's2', order: 2, attributes: { tags: ['z'] } });
  const r = await repairTool().handler({ locationId: 'LOC', workflowId: 'WID', templates: t, confirm: true }, deps(gw));
  assert.equal(r.ok, false);
  assert.match(r.detail, /IDS_REMINTED/);
  assert.deepEqual(r.data?.verify?.reminted, [{ from: 's3', to: 'aaaaaaaa-0000-4000-8000-000000000003' }]);
});

// Final review W6a (Important #2, bl-398): a repair that changed a STORED step's id went through with no warning — the
// diff read as one delete plus one create, and go-tos, sticky notes and notes keyed on the old id pointed at nothing.
test('a repair that re-keys a stored step (same type and name, new id) is refused STEP_IDS_NOT_STORED naming from→to', async () => {
  const { gw, calls } = gateway();
  const t = baseTemplates();
  t[1] = { ...t[1], id: UUID_A };
  t[0] = { ...t[0], next: UUID_A };
  const r = await repairTool().handler({ locationId: 'LOC', workflowId: 'WID', templates: t, confirm: true }, deps(gw));
  assert.equal(r.ok, false);
  assert.match(JSON.stringify(r), /STEP_IDS_NOT_STORED/);
  assert.match(JSON.stringify(r), new RegExp(`s2 → ${UUID_A}`));
  assert.equal(calls.some((c) => c.method === 'PUT'), false, 'nothing written');
});

test('allowStepIdChange:true writes a deliberate re-key; a genuinely new step (different name) is never refused', async () => {
  const { gw } = gateway();
  const t = baseTemplates();
  t[1] = { ...t[1], id: UUID_A };
  t[0] = { ...t[0], next: UUID_A };
  const r = await repairTool().handler({ locationId: 'LOC', workflowId: 'WID', templates: t, allowStepIdChange: true }, deps(gw));
  assert.doesNotMatch(JSON.stringify(r), /STEP_IDS_NOT_STORED/);
  const { gw: gw2 } = gateway();
  const t2 = baseTemplates();
  t2[1] = { ...t2[1], id: UUID_A, name: 'Replacement' };
  t2[0] = { ...t2[0], next: UUID_A };
  const r2 = await repairTool().handler({ locationId: 'LOC', workflowId: 'WID', templates: t2 }, deps(gw2));
  assert.doesNotMatch(JSON.stringify(r2), /STEP_IDS_NOT_STORED/);
});

// Final review W6a (Important #3): repair PUTs the caller's WHOLE document, but its previewToken fingerprinted only
// id/type/next/parentKey/attributes — a teammate's rename or builder disable between preview and confirm was accepted
// and silently reverted.
for (const [label, change] of [
  ['a rename', (t) => ({ ...t, name: 'Renamed by a teammate' })],
  ['a builder disable', (t) => ({ ...t, advanceCanvasMeta: { ...(t.advanceCanvasMeta ?? {}), isDisabled: true } })],
]) {
  test(`repair confirm is refused PREVIEW_STALE after ${label} since the preview`, async () => {
    const { gw: g1 } = gateway();
    const preview = await repairTool().handler({ locationId: 'LOC', workflowId: 'WID', templates: baseTemplates() }, deps(g1));
    const token = preview.data?.preview?.previewToken;
    assert.ok(token, JSON.stringify(preview).slice(0, 200));
    const moved = baseTemplates().map((t) => (t.id === 's2' ? change(t) : t));
    const { gw: g2, calls } = gateway({ initial: workflow({ templates: moved }) });
    const r = await repairTool().handler({ locationId: 'LOC', workflowId: 'WID', templates: baseTemplates(), confirm: true, previewToken: token }, deps(g2));
    assert.match(JSON.stringify(r), /PREVIEW_STALE/);
    assert.equal(calls.some((c) => c.method === 'PUT'), false);
  });
}
