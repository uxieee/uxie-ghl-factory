import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { checkSelection, diffStored, manifestIndex, CONFLICT_KEYS, PUSH_CATEGORIES, buildPushBody, nonEmptyCategories } from '../core/snapshots.mjs';

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

// ---------------------------------------------------------------------------------------------
// push_snapshot. This is the only DESTRUCTIVE tool here and the only one that cannot verify its
// own work, so what it REFUSES is the whole safety story. Each of these pins a behaviour that a
// real load already got wrong once.

// A push gateway: the snapshot's manifest carries a source locationId, and workflow reads on that
// source answer with whatever status the test asks for.
const pushGw = ({ wfStatus = { wf1: 'draft', wf2: 'draft' }, sourceLoc = 'SRC', pushOk = true, manifestOk = true } = {}) => {
  const seen = { push: null, wfReads: [] };
  return {
    seen,
    uid: 'USER1',
    companyId: null,
    call: async (method, path, body) => {
      if (method === 'GET' && /^\/locations\/[^/]+$/.test(path)) {
        return { ok: true, status: 200, json: { location: { companyId: 'COMPANY1' } } };
      }
      // get_assets returns the snapshot's CONTENTS and carries NO locationId. Putting one here
      // would let the rail pass in tests while being inert in production — which is exactly what
      // shipped, and what the first live run caught.
      if (method === 'GET' && path.includes('/get_assets')) {
        return manifestOk
          ? { ok: true, status: 200, json: PREFETCH }
          : { ok: false, status: 400, json: { msg: "Can't find account data" } };
      }
      if (method === 'GET' && /^\/snapshots\/v2\/[^/]+\?/.test(path)) {
        return { ok: true, status: 200, json: { snapshots: [{ _id: 's1', name: 'One', locationId: sourceLoc }] } };
      }
      // The real read is `/workflow/{loc}/{id}?includeScheduledPauseInfo=true` — a mock that
      // forgets the query string silently matches nothing and every workflow reads as absent.
      const wf = path.match(/^\/workflow\/[^/]+\/([^/?]+)(?:\?|$)/);
      if (method === 'GET' && wf) {
        seen.wfReads.push(path);
        const st = wfStatus[wf[1]];
        return st ? { ok: true, status: 200, json: { status: st, name: `NAME-${wf[1]}` } } : { ok: false, status: 404, json: {} };
      }
      if (method === 'POST' && path.includes('set_assets_to_locations')) {
        seen.push = body;
        return pushOk
          ? { ok: true, status: 201, json: { success: true, message: 'Snapshot push preparation queued successfully' } }
          : { ok: false, status: 500, json: {} };
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
    readBackUntil: async (fn) => ({ hit: await fn(), attempts: 1 }),
  };
};
const runPush = (args, opts = {}) => {
  const gw = pushGw(opts);
  return tool('push_snapshot').handler(
    { locationId: 'LOC', snapshotId: 's1', targetLocationIds: ['TGT'], ...args },
    { state: {}, makeGw: () => gw },
  ).then((r) => ({ r, gw }));
};

// The target id appears in THREE places in the wire body. Getting one wrong is not an error —
// it is a load that targets the wrong set of accounts.
test('buildPushBody puts every target in all three places, and ships all 20 categories', () => {
  const b = buildPushBody(['A', 'B'], { workflow: ['w1'] });
  assert.deepEqual(b.selectedLocationIds, ['A', 'B']);
  assert.deepEqual(b.selectedLocationsData.available.selectedLocationIds, ['A', 'B']);
  assert.equal(b.selectedLocationsData.available.selectedLocationsCount, 2);
  assert.deepEqual(Object.keys(b.skipData).sort(), ['A', 'B']);
  for (const c of PUSH_CATEGORIES) assert.ok(Array.isArray(b.selectedSnapshotAssets[c]), `${c} must be present, empty arrays included`);
  assert.deepEqual(b.selectedSnapshotAssets.workflow, ['w1']);
  assert.deepEqual(b.selectedSnapshotAssets.tags, [], 'a category not asked for ships EMPTY, not absent');
});

// The wizard's Assets step renders no Workflows row while the body it sends carries every
// workflow id in the snapshot. A tool that mirrors the UI ships workflows nobody chose.
test('push_snapshot loads exactly what it is given — nothing is inferred from the snapshot', async () => {
  const { r, gw } = await runPush({ assets: { tags: ['t1'] }, confirm: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(gw.seen.push.selectedSnapshotAssets.tags, ['t1']);
  assert.deepEqual(gw.seen.push.selectedSnapshotAssets.workflow, [],
    'the snapshot HAS workflows; not asking for them must send none');
  assert.deepEqual(gw.seen.wfReads, [], 'no workflow was selected, so none should have been read');
});

test('push_snapshot refuses an empty selection rather than pushing nothing', async () => {
  for (const assets of [{}, { workflow: [] }]) {
    const { r, gw } = await runPush({ assets, confirm: true });
    assert.equal(r.ok, false, JSON.stringify(assets));
    assert.equal(r.code, 'VALIDATION_FAILED');
    assert.equal(gw.seen.push, null, 'nothing may reach the wire');
  }
});

// RAIL 1. 26 workflows went live on an account taking ~230 enrollments a week because the load
// carried published ones and nothing warned.
test('push_snapshot REFUSES published workflows, and hands back how to stand them down', async () => {
  const { r, gw } = await runPush({ assets: { workflow: ['wf1', 'wf2'] }, confirm: true }, { wfStatus: { wf1: 'published', wf2: 'draft' } });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'VALIDATION_FAILED');
  assert.equal(gw.seen.push, null, 'the push must NOT be sent');
  assert.deepEqual(r.data.publishedOnSource.map((w) => w.workflowId), ['wf1']);
  assert.ok(r.data.standDown, 'the refusal must carry the remedy, not just the complaint');
  // The load mints NEW ids on the target, so the source ids are useless there. Saying so is the
  // difference between a usable remedy and one that sends the operator to the wrong ids.
  assert.match(r.data.standDown.howToFind, /NEW ids/);
  assert.ok(r.data.standDown.names.includes('NAME-wf1'));
});

test('push_snapshot proceeds with published workflows only on an explicit override', async () => {
  const { r, gw } = await runPush(
    { assets: { workflow: ['wf1'] }, allowPublishedWorkflows: true, confirm: true },
    { wfStatus: { wf1: 'published' } },
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(gw.seen.push, 'the override must actually push');
  assert.ok(r.data.standDown, 'and must still hand back the stand-down plan');
});

// A workflow id that cannot be read is NOT the same as one that is not published — a folder id
// lives in `workflow` and reads as neither. Folding it into "safe" is how a published workflow
// slips through.
test('push_snapshot reports unreadable workflow ids as UNDETERMINED, not as safe', async () => {
  // wf3 is a nested id the manifest DOES carry (folders live inside `workflow`), so it passes the
  // membership gate and then fails to read as a workflow — the exact shape of a folder id.
  const { r } = await runPush({ assets: { workflow: ['wf1', 'wf3'] } }, { wfStatus: { wf1: 'draft' } });
  assert.equal(r.code, 'CONFIRM_REQUIRED', JSON.stringify(r));
  assert.deepEqual(r.data.preview.undeterminedWorkflows, ['wf3']);
  assert.ok(r.data.preview.warnings.some((w) => /UNKNOWN/.test(w)));
});

test('push_snapshot previews by default and sends nothing without confirm', async () => {
  const { r, gw } = await runPush({ assets: { tags: ['t1'] } });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'CONFIRM_REQUIRED');
  assert.equal(gw.seen.push, null);
  assert.deepEqual(r.data.preview.categories, ['tags']);
});

// An id absent from the snapshot is accepted by the push with a 201 and loads nothing.
test('push_snapshot refuses ids the snapshot does not contain', async () => {
  const { r, gw } = await runPush({ assets: { tags: ['t1', 'NOPE'] }, confirm: true });
  assert.equal(r.ok, false);
  assert.deepEqual(r.data.unknownIds, ['tags/NOPE']);
  assert.equal(gw.seen.push, null);
});

// The push answers "queued". Claiming verification from a 201 is the exact failure this plugin
// refuses everywhere else, so the success shape must say so out loud.
test('push_snapshot never claims verification — the push is queued, not applied', async () => {
  const { r } = await runPush({ assets: { tags: ['t1'] }, confirm: true });
  assert.equal(r.ok, true);
  assert.equal(r.data.queued, true);
  assert.equal(r.data.verified, false);
  assert.match(r.data.note, /QUEUED, NOT APPLIED/);
});

test('push_snapshot surfaces the dehydrating-snapshot 400 with what to do about it', async () => {
  const { r, gw } = await runPush({ assets: { tags: ['t1'] }, confirm: true }, { manifestOk: false });
  assert.equal(r.ok, false);
  assert.equal(gw.seen.push, null, 'an unreadable snapshot must never reach the push');
  assert.match(JSON.stringify(r), /list_snapshots/);
});

test('nonEmptyCategories ignores categories present but empty', () => {
  assert.deepEqual(nonEmptyCategories({ workflow: ['w'], tags: [], pipelines: ['p'] }), ['workflow', 'pipelines']);
});

// THE REGRESSION THIS PINS, found by running the tool for real rather than by any test.
// The published-workflow rail originally read the source account from get_assets — which returns
// the snapshot's CONTENTS and carries no locationId. So sourceLoc was always null, no workflow was
// ever read, and every id came back "undetermined". Safe by accident, and completely inert: the
// headline safety rail could never fire. A rail that silently never fires is worse than no rail,
// because it reads as a check that passed.
test('the source account is resolved from the snapshot LIST — get_assets does not carry it', async () => {
  const { r, gw } = await runPush(
    { assets: { workflow: ['wf1'] }, confirm: true },
    { wfStatus: { wf1: 'published' }, sourceLoc: 'SRC' },
  );
  assert.equal(r.ok, false, 'a published workflow must still be refused');
  assert.equal(gw.seen.push, null);
  assert.deepEqual(r.data.publishedOnSource.map((w) => w.workflowId), ['wf1']);
  assert.ok(gw.seen.wfReads.some((p) => p.startsWith('/workflow/SRC/')),
    'the workflow must have been read on the SOURCE account the list named');
});

// And when the list cannot name a source, the ids are UNDETERMINED — never silently "not published".
test('no resolvable source account means UNDETERMINED, never safe', async () => {
  const { r } = await runPush({ assets: { workflow: ['wf1'] } }, { sourceLoc: null });
  assert.equal(r.code, 'CONFIRM_REQUIRED');
  assert.deepEqual(r.data.preview.undeterminedWorkflows, ['wf1']);
  assert.deepEqual(r.data.preview.publishedOnSource, undefined);
  assert.ok(r.data.preview.warnings.some((w) => /UNKNOWN/.test(w)));
});

