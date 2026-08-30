// marketplaceDrift — TRIGGER-ONLY, by live evidence, not by choice.
//
// A stored marketplace TRIGGER carries `version` and `templateId`. A stored marketplace
// ACTION step does NOT — its complete key set, live-captured 2026-08-16 (the marketplace-canary client account),
// is `id, stepIndex, order, attributes, name, type, isMarketplaceAction`. No version
// anywhere. There is nothing stored on the action side to compare against, so there is
// nothing to detect there.
//
// parseActionSchema and parseTriggerSchema are kept as SEPARATE maps on purpose — see the
// last test in this file for the real, observed collision (`contact_engagement_score`)
// that makes a shared map unsafe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseActionSchema, parseTriggerSchema, marketplaceDrift, missingForStep } from './action-schema.mjs';

const assets = {
  actions: [{ appName: 'App', actions: [{ key: 'act_a', version: '1.0', templateId: 'T1', inputs: [] }] }],
  triggers: [{ appName: 'App', triggers: [{ key: 'trg_a', version: '1.3', templateId: 'T2', inputs: [] }] }],
};

test('a stored trigger at an older version is reported as drift', () => {
  const stored = [{ type: 'trg_a', name: 'In', masterType: 'marketplace', version: '1.1', templateId: 'T2' }];
  const drift = marketplaceDrift(stored, parseTriggerSchema(assets));
  assert.equal(drift.length, 1);
  assert.equal(drift[0].kind, 'version');
  assert.equal(drift[0].stored.version, '1.1');
  assert.equal(drift[0].installed.version, '1.3');
});

test('a changed templateId is reported', () => {
  const stored = [{ type: 'trg_a', name: 'In', masterType: 'marketplace', version: '1.3', templateId: 'OLD' }];
  const drift = marketplaceDrift(stored, parseTriggerSchema(assets));
  assert.equal(drift[0].kind, 'templateId');
});

test('a matching trigger is not drift', () => {
  const stored = [{ type: 'trg_a', name: 'In', masterType: 'marketplace', version: '1.3', templateId: 'T2' }];
  assert.deepEqual(marketplaceDrift(stored, parseTriggerSchema(assets)), []);
});

test('a non-marketplace trigger is ignored entirely', () => {
  const stored = [{ type: 'contact_tag', name: 'Tagged', masterType: 'highlevel' }];
  assert.deepEqual(marketplaceDrift(stored, parseTriggerSchema(assets)), []);
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
  assert.deepEqual(marketplaceDrift([storedAction], parseTriggerSchema(assets)), []);
});

// 🔴 REGRESSION — this is the real bug, not a synthetic worst-case. Measured against the
// live GHL catalog (2026-08-16): 319 action keys, 162 trigger keys, exactly ONE collision —
// `contact_engagement_score` — 1 of 481 total keys. It is a real action (required inputs:
// operator, points) AND a real trigger (0 inputs). Earlier in this task, parseActionSchema
// briefly merged both sections into one map; because triggers were parsed second, the
// trigger entry (fields: []) silently overwrote the action entry, and
// `missingForStep`/`checkWorkflow` stopped reporting the two required fields for this type
// — check_workflow would have reported clean while the builder showed "Resolve 2 Errors".
// parseActionSchema and parseTriggerSchema must stay two separate maps so this is
// structurally impossible, not just handled by precedence. Do NOT re-merge them.
test('a key that is BOTH an action and a trigger keeps its ACTION required-fields', () => {
  const collidingAssets = {
    actions: [{
      appName: 'App',
      actions: [{
        key: 'contact_engagement_score',
        inputs: [
          { field: 'operator', title: 'Operator', required: true, fieldType: 'select' },
          { field: 'points', title: 'Points', required: true, fieldType: 'numerical' },
        ],
      }],
    }],
    triggers: [{
      appName: 'App',
      triggers: [{ key: 'contact_engagement_score', inputs: [] }],
    }],
  };
  const actionSchema = parseActionSchema(collidingAssets);
  assert.deepEqual(actionSchema.get('contact_engagement_score').requiredFields, ['operator', 'points']);

  const missing = missingForStep({ id: 's1', name: 'n', type: 'contact_engagement_score', attributes: {} }, actionSchema);
  assert.equal(missing.length, 2, 'the trigger entry must never shadow the action required fields');
  assert.deepEqual(missing.map((m) => m.field).sort(), ['operator', 'points']);
});
