import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { checkSelection, diffStored, manifestIndex, CONFLICT_KEYS } from '../core/snapshots.mjs';

// Snapshots are AGENCY-scoped: a mistake is not confined to one sub-account. Three of the four
// traps on this surface are silent — they answer 200 and produce a snapshot that is wrong rather
// than an error anyone can see — so these tests are mostly about what the tools REFUSE.

const tool = (n) => TOOLS.find((t) => t.name === n);

const PREFETCH = {
  data: {
    workflow: [{ id: 'wf1', name: 'A' }, { id: 'wf2', name: 'B', children: [{ id: 'wf3' }] }],
    tags: [{ id: 't1' }, { id: 't2' }],
    custom_fields: [{ _id: 'cf1' }],
  },
};

const gwFor = ({ prefetchOk = true, createStatus = 200, stored = null } = {}) => {
  const seen = { created: null, refreshed: null, conflicts: null };
  return {
    seen,
    uid: 'USER1',
    companyId: null, // deliberately absent: the JWT does not carry it
    call: async (method, path, body) => {
      if (method === 'GET' && /^\/locations\/[^/]+$/.test(path)) {
        return { ok: true, status: 200, json: { location: { companyId: 'COMPANY1' } } };
      }
      if (method === 'GET' && path.startsWith('/snapshots/v2/preFetchAssets/')) {
        return prefetchOk ? { ok: true, status: 200, json: PREFETCH } : { ok: false, status: 500, json: {} };
      }
      if (method === 'GET' && path.startsWith('/snapshots/assets/asset-names')) {
        return { ok: true, status: 200, json: ['workflow', 'tags', 'custom_fields'] };
      }
      if (method === 'GET' && path.startsWith('/snapshots/v2/')) {
        return { ok: true, status: 200, json: { snapshots: [{ _id: 's1', name: 'One', status: 'completed' }] } };
      }
      if (method === 'POST' && path.startsWith('/snapshots-appengine/v2/snapshots/')) {
        seen.refreshed = body; return { ok: true, status: 200, json: { success: true } };
      }
      if (method === 'POST' && path.startsWith('/snapshots-appengine/v2/snapshots')) {
        seen.created = body;
        return createStatus === 200
          ? { ok: true, status: 200, json: { snapshot: { id: 'NEWSNAP' } } }
          : { ok: true, status: 200, json: {} };
      }
      if (method === 'GET' && path.includes('/get_assets')) {
        return { ok: true, status: 200, json: stored ?? PREFETCH };
      }
      if (method === 'POST' && path.includes('/conflicts')) {
        seen.conflicts = body; return { ok: true, status: 200, json: { conflicts: [] } };
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
    readBackUntil: async (fn) => ({ hit: await fn(), attempts: 1 }),
  };
};
const run = (name, args, opts = {}) => {
  const gw = gwFor(opts);
  return tool(name).handler({ locationId: 'LOC', ...args }, { state: {}, makeGw: () => gw }).then((r) => ({ r, gw }));
};

test('the agency id is resolved from the location, because the JWT does not carry it', async () => {
  const { r } = await run('list_snapshots', {});
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.companyId, 'COMPANY1');
});

test('manifestIndex flattens nested folders, which live inside their parent category', async () => {
  const idx = manifestIndex(PREFETCH);
  assert.ok(idx.workflow.has('wf1') && idx.workflow.has('wf2'));
  assert.ok(idx.workflow.has('wf3'), 'a folder child must be indexed or a valid id reads as unknown');
  assert.ok(idx.custom_fields.has('cf1'), '_id is as valid an id key as id');
});

test('create_snapshot REFUSES an id the account does not have — the silent-empty trap', async () => {
  // A bad id, a bad category or a mismatched location gives 200 and an EMPTY snapshot. Nothing is
  // validated and nothing is reported, so this preflight is the only thing standing in front of it.
  const { r, gw } = await run('create_snapshot', {
    name: 'X', selectedAssets: { workflow: ['wf1', 'NOPE'] }, confirm: true,
  });
  assert.equal(r.ok, false);
  assert.match(r.detail, /not in this account's manifest/);
  assert.deepEqual(r.data.unknownIds, ['workflow/NOPE']);
  assert.equal(gw.seen.created, null, 'nothing may be written');
});

test('create_snapshot refuses an empty selection, which is nothing rather than everything', async () => {
  const { r, gw } = await run('create_snapshot', { name: 'X', selectedAssets: {}, confirm: true });
  assert.equal(r.ok, false);
  assert.match(r.detail, /selectedAssets is empty/);
  assert.equal(gw.seen.created, null);
});

test('create_snapshot uses the appengine endpoint, not /snapshots/create', async () => {
  // The legacy create returns 201, hangs in processing, captures any category you OMIT whole, and
  // ignores exemptClone. Choosing the endpoint is the single most consequential line here.
  const { r, gw } = await run('create_snapshot', { name: 'X', selectedAssets: { tags: ['t1'] }, confirm: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(gw.seen.created.company_id, 'COMPANY1');
  assert.equal(gw.seen.created.location_id, 'LOC');
  assert.deepEqual(gw.seen.created.selectedAssets, { tags: ['t1'] });
});

test('create_snapshot previews without writing', async () => {
  const { r, gw } = await run('create_snapshot', { name: 'X', selectedAssets: { tags: ['t1'] } });
  assert.equal(r.code, 'CONFIRM_REQUIRED');
  assert.equal(gw.seen.created, null);
  assert.match(r.data.preview.endpoint, /snapshots-appengine/);
  assert.match(r.data.preview.scope, /AGENCY-LEVEL/);
});

test('create_snapshot raises an alarm when the stored snapshot lacks what was asked for', async () => {
  // The create reports success either way. This diff is the only thing that shows the empty case.
  const { r } = await run(
    'create_snapshot',
    { name: 'X', selectedAssets: { tags: ['t1', 't2'] }, confirm: true },
    { stored: { data: { tags: [{ id: 't1' }] } } },
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.requestedButNotStored, ['tags/t2']);
  assert.match(r.data.alarm, /NOT in the stored snapshot/);
});

test('an unreadable manifest degrades to a warning, it does not block a legitimate create', async () => {
  const { r, gw } = await run(
    'create_snapshot',
    { name: 'X', selectedAssets: { tags: ['whatever'] }, confirm: true },
    { prefetchOk: false },
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(gw.seen.created, 'the write still goes through');
});

test('refresh_snapshot REFUSES an empty selection — the destructive default', async () => {
  // extras:{} re-captures the whole account and silently replaces a curated snapshot with
  // everything. This is the trap with the worst blast radius on the surface.
  const { r, gw } = await run('refresh_snapshot', { snapshotId: 's1', selectedAssets: {}, confirm: true });
  assert.equal(r.ok, false);
  assert.match(r.detail, /empty refresh is destructive/);
  assert.match(r.remediation, /re-captures the WHOLE account/i);
  assert.equal(gw.seen.refreshed, null);
});

test('refresh_snapshot re-sends the selection inside extras', async () => {
  const { r, gw } = await run('refresh_snapshot', { snapshotId: 's1', selectedAssets: { tags: ['t1'] }, confirm: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(gw.seen.refreshed, { extras: { selectedAssets: { tags: ['t1'] }, exemptClone: [] } });
});

test('check_snapshot_conflicts sends the key names the server wants, not the ones the UI shows', async () => {
  // locationIds and selectedAssets — the names the wizard displays — answer 400 ["Required","Required"].
  const { r, gw } = await run('check_snapshot_conflicts', { snapshotId: 's1', targetLocationIds: ['L2'], assets: { tags: ['t1'] } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(Object.keys(gw.seen.conflicts).sort(), [CONFLICT_KEYS.assets, CONFLICT_KEYS.locations].sort());
  assert.ok(!('locationIds' in gw.seen.conflicts));
  assert.ok(!('selectedAssets' in gw.seen.conflicts));
});

// There is no "check everything" call: the server answers
// 400 ["selectedSnapshotAssets must contain at least one asset key"] (proven live 2026-09-09).
// The tool used to default `assets` to {} and send it, turning a knowable refusal into a bare
// upstream 400 that says nothing about what the caller should have passed.
test('check_snapshot_conflicts refuses an empty asset selection itself, without spending a call', async () => {
  for (const assets of [undefined, {}]) {
    const { r, gw } = await run('check_snapshot_conflicts', { snapshotId: 's1', targetLocationIds: ['L2'], assets });
    assert.equal(r.ok, false, `assets=${JSON.stringify(assets)} must be refused`);
    assert.equal(r.code, 'VALIDATION_FAILED');
    assert.match(r.remediation, /get_snapshot_manifest/, 'the caller must be told where ids come from');
    assert.ok(gw.seen.conflicts == null, 'the refusal must happen before the wire call');
  }
});

test('diffStored reports only what was requested and is absent', () => {
  const stored = manifestIndex({ data: { tags: [{ id: 't1' }] } });
  assert.deepEqual(diffStored({ tags: ['t1'] }, stored), []);
  assert.deepEqual(diffStored({ tags: ['t1', 't9'] }, stored), ['tags/t9']);
  assert.deepEqual(diffStored({ workflow: ['wf1'] }, stored), ['workflow/wf1']);
});

test('checkSelection cannot judge a category it has no manifest for, and says nothing rather than guessing', () => {
  const idx = manifestIndex(PREFETCH);
  const out = checkSelection({ email_templates: ['e1'] }, idx, new Set(Object.keys(idx)));
  assert.deepEqual(out.unknownIds, [], 'no manifest for the category means unjudgeable, not wrong');
  assert.deepEqual(out.unknownCategories, ['email_templates']);
});
