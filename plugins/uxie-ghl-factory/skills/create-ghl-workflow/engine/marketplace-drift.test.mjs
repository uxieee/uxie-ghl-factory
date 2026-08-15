// marketplaceDrift — TRIGGER-ONLY, by live evidence, not by choice.
//
// A stored marketplace TRIGGER carries `version` and `templateId`. A stored marketplace
// ACTION step does NOT — its complete key set, live-captured 2026-08-16 (JING SPA account),
// is `id, stepIndex, order, attributes, name, type, isMarketplaceAction`. No version
// anywhere. There is nothing stored on the action side to compare against, so there is
// nothing to detect there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseActionSchema, marketplaceDrift } from './action-schema.mjs';

const assets = {
  actions: [{ appName: 'App', actions: [{ key: 'act_a', version: '1.0', templateId: 'T1', inputs: [] }] }],
  triggers: [{ appName: 'App', triggers: [{ key: 'trg_a', version: '1.3', templateId: 'T2', inputs: [] }] }],
};

test('parseActionSchema retains version and templateId', () => {
  const spec = parseActionSchema(assets).get('act_a');
  assert.equal(spec.version, '1.0');
  assert.equal(spec.templateId, 'T1');
});

test('a stored trigger at an older version is reported as drift', () => {
  const stored = [{ type: 'trg_a', name: 'In', masterType: 'marketplace', version: '1.1', templateId: 'T2' }];
  const drift = marketplaceDrift(stored, parseActionSchema(assets));
  assert.equal(drift.length, 1);
  assert.equal(drift[0].kind, 'version');
  assert.equal(drift[0].stored.version, '1.1');
  assert.equal(drift[0].installed.version, '1.3');
});

test('a changed templateId is reported', () => {
  const stored = [{ type: 'trg_a', name: 'In', masterType: 'marketplace', version: '1.3', templateId: 'OLD' }];
  const drift = marketplaceDrift(stored, parseActionSchema(assets));
  assert.equal(drift[0].kind, 'templateId');
});

test('a matching trigger is not drift', () => {
  const stored = [{ type: 'trg_a', name: 'In', masterType: 'marketplace', version: '1.3', templateId: 'T2' }];
  assert.deepEqual(marketplaceDrift(stored, parseActionSchema(assets)), []);
});

test('a non-marketplace trigger is ignored entirely', () => {
  const stored = [{ type: 'contact_tag', name: 'Tagged', masterType: 'highlevel' }];
  assert.deepEqual(marketplaceDrift(stored, parseActionSchema(assets)), []);
});

// The scoping is enforced by construction, not incidentally: a stored marketplace ACTION
// step's real shape (id, stepIndex, order, attributes, name, type, isMarketplaceAction) has
// no `masterType` field at all — marketplaceDrift keys off `masterType === 'marketplace'`,
// a field that simply does not exist on an action. Passing an action-shaped object through
// must produce nothing, proving actions cannot slip into a comparison that has no stored
// value to compare.
test('a stored marketplace ACTION produces no drift entry — actions carry no version to compare', () => {
  const storedAction = {
    id: 's1',
    stepIndex: 1,
    order: 1,
    attributes: {},
    name: 'Send Whatsapp Message',
    type: 'act_a',
    isMarketplaceAction: true,
  };
  assert.deepEqual(marketplaceDrift([storedAction], parseActionSchema(assets)), []);
});
