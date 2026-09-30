// marketing-countdown: a Countdown Timer asset bound by id. The builder-made node is test/fixtures/builder-created-nodes.json (knowledge
// sniffs/funnels-wave45-f8-2026-09-30: Add Elements → Countdown Timers, drag, builder Save, read back).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOOLS } from '../core/tools.mjs';
import { makeLeaf } from '../core/funnel-pages.mjs';
import { assetBindingExtra } from '../core/kind-oracle-defaults.mjs';

const FIX = JSON.parse(readFileSync(new URL('./fixtures/builder-created-nodes.json', import.meta.url), 'utf8')).builderCreated['marketing-countdown'];
const ASSET = { _id: 'TIMER_ASSET_ID', name: 'T', templateId: 'simple', timerType: 'fixed', endDate: '2026-10-01T05:55:15.000Z', timezone: 'Europe/London', adaptToContactTimezone: false, deleted: false };
const NOW = '2026-09-30T05:56:39.477Z';
const tool = TOOLS.find((t) => t.name === 'build_funnel_page');
const base = { locationId: 'LOC', funnelId: 'F1', pageId: 'P1', stepId: 'S1' };

test('a node bound to a fixed asset equals the builder\'s, but for the browser-zone end time', () => {
  const n = JSON.parse(JSON.stringify(makeLeaf({ meta: 'marketing-countdown', extra: { ...assetBindingExtra(ASSET, NOW), countdownTimerId: { value: 'TIMER_ASSET_ID' } } })));
  const diff = Object.keys(FIX.extra).filter((k) => k !== 'nodeId' && JSON.stringify(n.extra[k]) !== JSON.stringify(FIX.extra[k]));
  assert.deepEqual(diff, ['visibility', 'startDate', 'endTime'].filter((k) => diff.includes(k)), 'only the stated ones may differ');
  assert.ok(!diff.includes('endDate') && !diff.includes('timezone') && !diff.includes('timerType') && !diff.includes('countdownTimerId'));
  assert.deepEqual(n.extra.endTime, { value: '06:55', disabled: true }, 'the asset timezone wall clock (the builder wrote its own browser zone: 13:55)');
  assert.equal(n.title, 'Countdown');
  assert.deepEqual(n.class, FIX.class);
  assert.deepEqual(n.extra.theme, {});
});

test('recurring and dynamic assets: only the type is mirrored (their bound shape was not measured)', () => {
  assert.deepEqual(assetBindingExtra({ ...ASSET, timerType: 'recurring' }, NOW), { timerType: { value: 'recurring', disabled: true } });
});

function deps(assets) {
  let written = null;
  return { get written() { return written; }, state: {}, nowMs: () => Date.parse(NOW), rereadOptions: { tries: 1, delays: [0] }, makeGw: () => ({ uid: 'U', call: async (method, path, body) => {
    if (path.startsWith('/countdown-timer/')) { const t = assets[path.split('/').pop()]; return t ? { ok: true, status: 200, json: t } : { ok: false, status: 404, json: {} }; }
    if (path.startsWith('/funnels/custom-fonts')) return { ok: true, status: 200, json: { data: [] } };
    if (path.startsWith('/funnels/builder/autosave/')) { written = body.pageData; return { ok: true, status: 201, json: {} }; }
    if (path.startsWith('/funnels/builder/page/data')) return { ok: true, status: 200, json: written ?? {} };
    if (path.startsWith('/funnels/page/')) return { ok: true, status: 200, json: { meta: {} } };
    return { ok: true, status: 200, json: [] };
  } }) };
}
const sec = (id) => [{ columns: [{ elements: [{ meta: 'marketing-countdown', extra: { countdownTimerId: { value: id } } }] }] }];

test('compose resolves the asset, writes its settings on the node, and refuses an unknown id before writing', async () => {
  const d = deps({ TIMER_ASSET_ID: ASSET });
  const r = await tool.handler({ ...base, confirm: true, sections: sec('TIMER_ASSET_ID') }, d);
  assert.equal(r.ok, true, JSON.stringify(r));
  const node = d.written.sections.flatMap((s) => s.elements).find((x) => x.meta === 'marketing-countdown');
  assert.equal(node.extra.countdownTimerId.value, 'TIMER_ASSET_ID');
  assert.equal(node.extra.endDate.value, ASSET.endDate);
  assert.equal(node.extra.timezone.value, 'Europe/London');
  const d2 = deps({});
  const bad = await tool.handler({ ...base, confirm: true, sections: sec('NOPE') }, d2);
  assert.equal(bad.code, 'VALIDATION_FAILED');
  assert.match(bad.detail, /not a Countdown Timer asset/);
  assert.equal(d2.written, null);
});
