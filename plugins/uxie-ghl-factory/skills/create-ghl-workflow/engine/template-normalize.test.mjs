// modifyStep was a raw shallow merge: a wait window patched without `days` and a notification
// patched with a flat `notificationType` were written as given (F5-20) while the build path's
// builders knew the full shape all along.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeStoredAttributes, NORMALIZE_SKIP } from './template-normalize.mjs';
import { applyOps } from './edit-driver.mjs';
import { loadCatalog } from './catalog.mjs';
import { makeSeededIdGen } from './idgen.mjs';

const ctx = () => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 0, idGen: makeSeededIdGen('n'), catalog: loadCatalog(), warn: () => {} });

test('a wait window patched without days comes back with the UI default and windowCondition', () => {
  const t = { id: 'w', type: 'wait', name: 'Wait', attributes: { type: 'time', startAfter: { type: 'days', value: 1, when: 'after' }, window: { condition: 'when', start: '08:00', end: '18:00' } } };
  const { attributes } = normalizeStoredAttributes(t, ctx());
  assert.deepEqual(attributes.window, { condition: 'when', days: [0, 1, 2, 3, 4, 5, 6], start: '08:00', end: '18:00' });
  assert.deepEqual(attributes.windowCondition, { field: '', operator: '', value: '' });
  assert.equal(attributes.isHybridAction, true);
});

test("an in-app notification keeps the drawer's own `type` key without reporting it dropped", () => {
  const t = { id: 'n', type: 'internal_notification', name: 'Ping', attributes: { type: 'notification', notification: { type: 'send_notification', body: 'hi', title: 'T', userType: 'all', redirectPage: 'conversation' } } };
  const r = normalizeStoredAttributes(t, ctx());
  assert.equal(r.attributes.notification.redirectPage, 'conversation');
  assert.equal(r.attributes.notification.type, 'send_notification');
  assert.ok(!r.warnings.some((w) => /NOTIFICATION_KEY_DROPPED/.test(w)), JSON.stringify(r.warnings));
});

test('skipped types are returned unchanged with a warning naming retypeStep', () => {
  const t = { id: 'o', type: 'internal_update_opportunity', name: 'Move', attributes: { allowBackward: false, __customInputFields__: [], __customInputs__: {} } };
  const { attributes, warnings } = normalizeStoredAttributes(t, ctx());
  assert.deepEqual(attributes, t.attributes);
  assert.match(warnings[0], /retypeStep/);
  assert.ok(NORMALIZE_SKIP.has('internal_update_opportunity'));
});

// THE LOSS GUARD. Re-running a builder over stored attributes is only safe if it is
// information-preserving; this asserts that over every shipped capture, which is the closest
// thing to the live population the repo holds.
test('every shipped step example survives normalisation: no throw, and nothing it carried is lost', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../catalog/step-examples');
  const lost = [];
  let checked = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const ex = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const tpl = ex.templates?.[0] ?? ex;
    if (!tpl?.type || !tpl.attributes || NORMALIZE_SKIP.has(tpl.type) || tpl.isMarketplaceAction) continue;
    checked++;
    let out;
    try { out = normalizeStoredAttributes(tpl, ctx()).attributes; } catch (e) { lost.push(`${f}: THREW ${e.code ?? ''} ${String(e.message).slice(0, 90)}`); continue; }
    for (const [k, v] of Object.entries(tpl.attributes)) {
      if (!(k in out)) lost.push(`${f}: LOST key ${k}`);
      else if (JSON.stringify(out[k]) !== JSON.stringify(v) && !['window', 'notification'].includes(k)) lost.push(`${f}: CHANGED ${k}: ${JSON.stringify(v)} -> ${JSON.stringify(out[k])}`);
    }
  }
  assert.ok(checked >= 20, `expected to check a real sample, checked ${checked}`);
  assert.deepEqual(lost, []);
});

test('modifyStep through applyOps applies the normalisation', () => {
  const stored = [{ id: 'w', type: 'wait', name: 'Wait', next: null, parentKey: null, order: 0, attributes: { type: 'time', startAfter: { type: 'days', value: 1, when: 'after' }, cat: '', isHybridAction: true, hybridActionType: 'wait', convertToMultipath: false, transitions: [] } }];
  const { templates } = applyOps(stored, [{ op: 'modifyStep', stepId: 'w', attrPatch: { window: { condition: 'when', start: '09:00', end: '17:00' } } }], { ctx: ctx(), idGen: makeSeededIdGen('m') });
  assert.deepEqual(templates[0].attributes.window.days, [0, 1, 2, 3, 4, 5, 6]);
});
