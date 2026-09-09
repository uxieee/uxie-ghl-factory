// The publish path on build_funnel_page, and the publish STATE it reports on every run.
//
// Why the state matters enough to test: the public renderer serves the newest `live` version if a
// page has one, and falls back to the newest draft if the page has NEVER been published
// (funnels/40-rules rule 27, proven live 2026-09-10). So an unpublished page shows every autosave
// publicly within seconds — and the first publish silently inverts that, pinning the page and
// leaving every later write invisible with a 201 on each one. These tests pin both regimes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = TOOLS.find((t) => t.name === 'build_funnel_page');

const SECTION = {
  background: '#fff',
  columns: [{ widthPct: 100, elements: [{ meta: 'heading', html: 'Hello', tag: 'h1' }] }],
};
const base = { locationId: 'LOC', funnelId: 'F1', pageId: 'P1', stepId: 'S1', sections: [SECTION], confirm: true };

// updated_at is a Firestore {_seconds,_nanoseconds} object, not a string — mirror the real shape.
const v = (id, pageType, secs) => ({ version_id: id, pageType, updated_at: { _seconds: secs, _nanoseconds: 0 } });

// versionsFn is called fresh each time so a test can change the answer after the publish write.
const deps = ({ versions = [], uid = 'USER1', calls = [], publishStatus = 201, sections = null }) => ({
  state: {},
  makeGw: () => ({
    uid,
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (path.startsWith('/funnels/builder/autosave/')) return { ok: true, status: 201, json: { ok: true } };
      if (path.startsWith('/funnels/builder/page/data')) {
        return { ok: true, status: 200, json: { sections: sections ?? lastSent(calls) } };
      }
      if (path.startsWith('/funnels/builder/get-versions')) {
        return { ok: true, status: 200, json: typeof versions === 'function' ? versions(calls) : versions };
      }
      if (path === '/funnels/builder/publish-version') {
        return { ok: publishStatus < 400, status: publishStatus, json: { status: true } };
      }
      throw new Error(`unexpected call ${method} ${path}`);
    },
  }),
});
// echo back exactly the sections the autosave sent, so read-back verification passes by default
const lastSent = (calls) => {
  const save = [...calls].reverse().find((c) => c.path.startsWith('/funnels/builder/autosave/'));
  return (save?.body?.pageData?.sections ?? []).map((s) => ({ id: s.id }));
};

test('publish is opt-in: the default run sends no publish-version call', async () => {
  const calls = [];
  const res = await tool.handler({ ...base }, deps({ versions: [v('a', 'draft', 100)], calls }));
  assert.equal(res.ok, true);
  assert.ok(!calls.some((c) => c.path === '/funnels/builder/publish-version'),
    'a caller who did not ask to publish must never publish — it is outward-facing');
  assert.equal(res.data.published, undefined);
});

test('an UNPUBLISHED page reports the draft-fallback regime, and no stale warning', async () => {
  const res = await tool.handler({ ...base }, deps({ versions: [v('a', 'draft', 100)] }));
  assert.equal(res.data.publishState.pinned, false);
  assert.equal(res.data.publishState.draftsSincePublish, null);
  assert.match(res.data.publishState.servingNote, /never been published/);
  assert.equal(res.data.warning, undefined);
});

test('a PINNED page warns that this write is invisible, and counts the stacked drafts', async () => {
  const versions = [v('new', 'draft', 900), v('mid', 'draft', 500), v('old', 'live', 100)];
  const res = await tool.handler({ ...base }, deps({ versions }));
  assert.equal(res.data.publishState.pinned, true);
  assert.equal(res.data.publishState.draftsSincePublish, 2, 'two drafts sit ahead of the live version');
  assert.equal(res.data.publishState.staleBySeconds, 800, 'newest draft 900 minus pinned 100');
  assert.match(res.data.warning, /NOT visible at the public URL/);
});

test('on a pinned page a verifyUrl fetch is labelled as measuring the PUBLISHED version', async () => {
  const prevFetch = globalThis.fetch;
  const calls = [];
  // Serve HTML containing every node-id marker the tool actually wrote, so the poll succeeds on the
  // FIRST request. The label under test is independent of whether the markers were found, and a
  // miss walks the full 6 x 2s retry ladder — 12s, tripling this suite's runtime on its own.
  globalThis.fetch = async () => {
    const sent = [...calls].reverse().find((c) => c.path.startsWith('/funnels/builder/autosave/'));
    const ids = (sent?.body?.pageData?.sections ?? [])
      .flatMap((sec) => (sec.elements ?? []).filter((e) => e.type === 'element').map((e) => `c${e.id}`));
    return { status: 200, text: async () => `<html>${ids.join(' ')}</html>` };
  };
  try {
    const versions = [v('new', 'draft', 900), v('old', 'live', 100)];
    const res = await tool.handler({ ...base, verifyUrl: 'https://example.com/p' }, deps({ versions, calls }));
    assert.equal(res.data.render.allNodesPresent, true, 'the poll should hit on the first request');
    assert.equal(res.data.render.measures, 'the PUBLISHED version, not this write');
    assert.match(res.data.render.note, /not evidence about your write/);
  } finally { globalThis.fetch = prevFetch; }
});

test('publish:true publishes the NEWEST version by snake_case version_id and asserts it went live', async () => {
  const calls = [];
  // after the publish write, the same version reads back as live
  const versions = (c) => (c.some((x) => x.path === '/funnels/builder/publish-version')
    ? [v('new', 'live', 900), v('old', 'draft', 100)]
    : [v('new', 'draft', 900), v('old', 'draft', 100)]);
  const res = await tool.handler({ ...base, publish: true }, deps({ versions, calls }));
  assert.equal(res.ok, true);
  const pub = calls.find((c) => c.path === '/funnels/builder/publish-version');
  assert.ok(pub, 'publish-version must be called');
  assert.equal(pub.body.versionId, 'new', 'publishes the newest version, read from snake_case version_id');
  assert.equal(pub.body.userId, 'USER1', 'userId is required — omitting it 422s');
  assert.equal(res.data.published.verified, true);
  assert.equal(res.data.published.pageType, 'live', 'a published version is stamped live, not published');
});

test('publish REFUSES when the version list has no usable version_id — camelCase is not accepted', async () => {
  const calls = [];
  const res = await tool.handler({ ...base, publish: true },
    deps({ versions: [{ versionId: 'camel', pageType: 'draft' }], calls }));
  assert.equal(res.ok, false);
  assert.ok(!calls.some((c) => c.path === '/funnels/builder/publish-version'),
    'publishing nothing silently is the failure this guard exists to prevent');
  assert.match(res.detail, /without a usable version_id/);
});

test('publish REFUSES on a blank uid rather than sending a 422', async () => {
  const calls = [];
  const res = await tool.handler({ ...base, publish: true },
    deps({ versions: [v('new', 'draft', 900)], uid: '  ', calls }));
  assert.equal(res.ok, false);
  assert.ok(!calls.some((c) => c.path === '/funnels/builder/publish-version'));
  assert.match(res.detail, /no user id/);
});

test('publish REFUSES when the draft read back with sections missing', async () => {
  const calls = [];
  const res = await tool.handler({ ...base, publish: true },
    deps({ versions: [v('new', 'draft', 900)], sections: [], calls }));
  assert.equal(res.ok, false);
  assert.ok(!calls.some((c) => c.path === '/funnels/builder/publish-version'),
    'publishing pins the public page — never pin a write that did not land');
  assert.match(res.detail, /NOT published/);
});

test('publish reports VERIFY_FAILED when the version does not read back as live', async () => {
  const res = await tool.handler({ ...base, publish: true },
    deps({ versions: [v('new', 'draft', 900)] })); // never flips
  assert.equal(res.ok, false);
  assert.match(res.detail, /did not read back as live/);
  assert.equal(res.data.published.verified, false);
});

test('the preview says whether the call will publish, before any write', async () => {
  const quiet = deps({ versions: [] });
  const plain = await tool.handler({ ...base, confirm: false }, quiet);
  assert.equal(plain.ok, false);
  assert.match(plain.data.preview.note, /does not publish/);
  assert.equal(plain.data.preview.willPublish, false);
  const pub = await tool.handler({ ...base, confirm: false, publish: true }, quiet);
  assert.match(pub.data.preview.note, /PUBLISHES/);
  assert.equal(pub.data.preview.willPublish, true);
});
