import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';
import { applyUiDefaults } from './ui-defaults.mjs';

const catalog = loadCatalog();
const ctx = (extra = {}) => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('a'), catalog, ...extra });
const wf = (graph) => ({ name: 'D', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }], graph });

test('catalog carries corpus-verified uiDefaults and uiForced blocks', () => {
  const withD = Object.keys(catalog.step ? {} : {});
  const sms = catalog.step('sms');
  assert.deepEqual(sms.uiDefaults, { body: '' });
  assert.ok(catalog.step('goto')?.uiForced?.type === 'goto');
  assert.ok(catalog.step('call')?.uiDefaultsUnverified, 'call has only 4 corpus nodes — defaults stay unverified, never emitted');
});

test('an engine-built step gains the UI defaults it lacked; authored values always win', () => {
  const built = compile(wf([{ ref: 'w', kind: 'action', type: 'webhook', name: 'Hook', attributes: { url: 'https://x', method: 'POST' } }]), ctx());
  const w = built.autoSaveBody.workflowData.templates.find((t) => t.type === 'webhook');
  const d = catalog.step('webhook').uiDefaults;
  for (const k of Object.keys(d)) assert.ok(k in w.attributes, `webhook default '${k}' emitted`);
  assert.equal(w.attributes.url, 'https://x');          // authored wins
  assert.equal(w.attributes.method, 'POST');
});

test('forced fields: set when missing, warned (never overwritten) when the engine disagrees', () => {
  const warns = [];
  const tpls = [{ id: 'g', type: 'goto', name: 'G', attributes: { targetNodeId: 'x' } }, { id: 'h', type: 'goto', name: 'H', attributes: { targetNodeId: 'x', type: 'nope' } }];
  const added = applyUiDefaults(tpls, catalog, { warn: (m) => warns.push(m) });
  assert.equal(tpls[0].attributes.type, 'goto');
  assert.equal(tpls[1].attributes.type, 'nope');            // never silently overwritten
  assert.ok(warns.some((m) => /UI_FORCED_MISMATCH.*'H'.*type/.test(m)));
  assert.ok(added >= 1);
});

test('the hatch skips everything; transitions are never touched', () => {
  const tpls = [{ id: 's', type: 'sms', name: 'S', attributes: {} }, { id: 'tr', type: 'transition', name: 'T', attributes: {} }];
  assert.equal(applyUiDefaults(tpls, catalog, { skipUiDefaults: true }), 0);
  applyUiDefaults(tpls, catalog, {});
  assert.equal(tpls[0].attributes.body, '');
  assert.deepEqual(tpls[1].attributes, {});
});

test('defaults are applied BEFORE enforcement: a default never satisfies a requirement by itself', () => {
  // sms default body '' is the UI's placeholder; enforcement still refuses it, as the UI does on save
  assert.throws(() => compile(wf([{ ref: 's', kind: 'action', type: 'sms', name: 'S', attributes: {} }]), ctx()), /ENFORCEMENT.*body/s);
});
