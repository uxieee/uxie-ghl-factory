import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarketplaceActions, parseMarketplaceTriggers, parseInstalledModules,
  buildMarketplaceIndex } from './marketplace.mjs';
import ASSETS from './fixtures/marketplace-assets.json' with { type: 'json' };
import MODULES from './fixtures/marketplace-modules.json' with { type: 'json' };

test('assets parse yields the action schema keyed by action key', () => {
  const byKey = parseMarketplaceActions(ASSETS);
  const action = byKey.get('imessage_a');
  assert.equal(action.kind, 'action');
  assert.equal(action.version, '1.5');
  assert.equal(action.templateId, '01JTG3GNCCGBMXS0BY7NE3XY91');
  assert.ok(Array.isArray(action.inputs));
});

test('assets parse yields trigger customVars', () => {
  const trigger = parseMarketplaceTriggers(ASSETS).get('imessage_t');
  assert.equal(trigger.kind, 'trigger');
  assert.equal(trigger.version, '1.4');
  assert.equal(trigger.templateId, '01JTG30GR5C99TGPCJA8Z5899R');
  assert.ok(trigger.customVars.some((v) => v.reference === 'message'));
});

// parseMarketplaceActions and parseMarketplaceTriggers are separate maps, deliberately —
// not a shared namespace. Actions and triggers CAN and DO share a key in the live catalog
// (see the collision tests below), so folding them into one map would let one silently
// shadow the other.
test('an action key is absent from the trigger map, and vice versa', () => {
  assert.equal(parseMarketplaceActions(ASSETS).get('imessage_t'), undefined);
  assert.equal(parseMarketplaceTriggers(ASSETS).get('imessage_a'), undefined);
});

test('module parse yields app identity and install truth', () => {
  const apps = parseInstalledModules(MODULES);
  const app = apps.get('65a908766a9bd0008de6ee04');
  assert.equal(app.isInstalled, true);
  assert.equal(app.companyName, 'JAG Digital');
  assert.ok(app.totalInstallations > 0);
  assert.ok(app.actionKeys.includes('imessage_a'));
});

// actionKeys and triggerKeys are kept SEPARATE, deliberately — not one shared `keys[]`.
// This is what lets buildMarketplaceIndex build kind-separated appId maps below; a single
// mixed list would re-introduce the cross-app collision bug (see the fixture further down).
test('module parse keeps actionKeys and triggerKeys as separate lists', () => {
  const apps = parseInstalledModules(MODULES);
  const app = apps.get('65a908766a9bd0008de6ee04');
  assert.ok(app.actionKeys.includes('imessage_a'));
  assert.ok(!app.actionKeys.includes('imessage_t'));
  assert.ok(app.triggerKeys.includes('imessage_t'));
  assert.ok(!app.triggerKeys.includes('imessage_a'));
});

test('index joins schema to install truth', () => {
  const index = buildMarketplaceIndex({ assets: ASSETS, modules: MODULES });
  const entry = index.get('imessage_a', 'action');
  assert.equal(entry.installed, true);
  assert.equal(entry.appId, '65a908766a9bd0008de6ee04');
  assert.equal(entry.version, '1.5');
});

test('a key present in assets but absent from the installed modules is installed:false', () => {
  const index = buildMarketplaceIndex({ assets: ASSETS, modules: { actions: [], triggers: [] } });
  assert.equal(index.get('imessage_a', 'action').installed, false);
});

test('an unknown key resolves to undefined', () => {
  assert.equal(buildMarketplaceIndex({ assets: ASSETS, modules: MODULES }).get('nope', 'action'), undefined);
});

// An action key looked up with kind:'trigger' (or vice versa) is undefined, NOT a
// fallback to the other kind. This is the load-bearing behaviour: the caller must be
// explicit, and a wrong-kind lookup must miss cleanly rather than silently resolve.
test('a key looked up under the wrong kind resolves to undefined, not the other kind\'s entry', () => {
  const index = buildMarketplaceIndex({ assets: ASSETS, modules: MODULES });
  assert.equal(index.get('imessage_a', 'trigger'), undefined);
  assert.equal(index.get('imessage_t', 'action'), undefined);
});

// `kind` is REQUIRED, no default — omitting it (or passing anything else) throws rather
// than silently picking one. This is the guard that stops the bug from being reintroduced
// by a caller that forgets to specify.
test('.get with no kind, or an invalid kind, throws rather than guessing', () => {
  const index = buildMarketplaceIndex({ assets: ASSETS, modules: MODULES });
  assert.throws(() => index.get('imessage_a'));
  assert.throws(() => index.get('imessage_a', 'bogus'));
});

// --- Real, observed collision: contact_engagement_score --------------------------------
//
// Measured against the live GHL catalog (319 action keys, 162 trigger keys), 2026-08-16:
// exactly ONE key exists as both an action and a trigger, out of 481 total keys —
// `contact_engagement_score`. The action declares required inputs (`operator`, `points`);
// the trigger declares none. This fixture reproduces that shape inline (not the shared
// marketplace-assets.json fixture, which does not carry the collision) so this test keeps
// failing if the two-map split is ever collapsed back into one shared namespace.
const COLLISION_ASSETS = {
  actions: [{
    appName: 'Engagement Scoring',
    actions: [{
      key: 'contact_engagement_score', version: '2.0', templateId: 'TPL-SCORE-ACTION',
      inputs: [
        { field: 'operator', title: 'Operator', required: true, fieldType: 'string' },
        { field: 'points', title: 'Points', required: true, fieldType: 'numerical' },
      ],
    }],
  }],
  triggers: [{
    appName: 'Engagement Scoring',
    triggers: [{
      key: 'contact_engagement_score', version: '1.0', templateId: 'TPL-SCORE-TRIGGER',
      inputs: [],
    }],
  }],
};
const COLLISION_MODULES = {
  actions: [{
    appId: 'app-score', name: 'Engagement Scoring', companyName: 'Engagement Scoring',
    isInstalled: true, actions: [{ key: 'contact_engagement_score' }],
  }],
  triggers: [{
    appId: 'app-score', name: 'Engagement Scoring', companyName: 'Engagement Scoring',
    isInstalled: true, triggers: [{ key: 'contact_engagement_score' }],
  }],
};

test('contact_engagement_score: get(key, "action") returns the ACTION entry with its required inputs', () => {
  const index = buildMarketplaceIndex({ assets: COLLISION_ASSETS, modules: COLLISION_MODULES });
  const action = index.get('contact_engagement_score', 'action');
  assert.equal(action.kind, 'action');
  assert.equal(action.templateId, 'TPL-SCORE-ACTION');
  assert.deepEqual(action.inputs.map((f) => f.field), ['operator', 'points']);
});

test('contact_engagement_score: get(key, "trigger") returns the TRIGGER entry, not the action', () => {
  const index = buildMarketplaceIndex({ assets: COLLISION_ASSETS, modules: COLLISION_MODULES });
  const trigger = index.get('contact_engagement_score', 'trigger');
  assert.equal(trigger.kind, 'trigger');
  assert.equal(trigger.templateId, 'TPL-SCORE-TRIGGER');
  assert.deepEqual(trigger.inputs, []);
});

// --- CROSS-APP collision: the install gate's OWN bug, not the schema split's ------------
//
// The two fixtures above (COLLISION_ASSETS/COLLISION_MODULES) put both halves of the
// `contact_engagement_score` collision under the SAME appId ('app-score') — which proves
// the SCHEMA maps (parseMarketplaceActions/parseMarketplaceTriggers) don't shadow each
// other, but proves NOTHING about the install JOIN, because a single shared key→appId map
// would still resolve correctly when both kinds happen to belong to one app.
//
// The install join is GLOBAL ACROSS APPS: in the live catalog, nothing guarantees the
// action half and the trigger half of a colliding key belong to the same app. This fixture
// reproduces the case that actually breaks a shared appIdByKey map: app A publishes
// 'shared_key' as an ACTION and is NOT installed (so it never appears in the module
// response — the real module endpoint is queried with isInstalled=true); app B publishes
// 'shared_key' as a TRIGGER and IS installed. A shared map would let app B's install
// status leak onto the action lookup, silently defeating MARKETPLACE_APP_NOT_INSTALLED.
const CROSS_APP_ASSETS = {
  actions: [{
    appName: 'Uninstalled Scoring App',
    actions: [{
      key: 'shared_key', version: '1.0', templateId: 'TPL-A-ACTION', inputs: [],
    }],
  }],
  triggers: [{
    appName: 'Installed Inbox App',
    triggers: [{
      key: 'shared_key', version: '1.0', templateId: 'TPL-B-TRIGGER', inputs: [],
    }],
  }],
};
// App A is deliberately ABSENT here — it is not installed, so the real
// `isInstalled=true` module endpoint would never return it.
const CROSS_APP_MODULES = {
  actions: [],
  triggers: [{
    appId: 'app-B', name: 'Installed Inbox App', companyName: 'Installed Inbox App',
    isInstalled: true, triggers: [{ key: 'shared_key' }],
  }],
};

test('cross-app collision: an uninstalled action does not inherit a different app\'s install truth', () => {
  const index = buildMarketplaceIndex({ assets: CROSS_APP_ASSETS, modules: CROSS_APP_MODULES });
  const action = index.get('shared_key', 'action');
  assert.equal(action.installed, false, 'app A is not installed — must not inherit app B\'s isInstalled:true');
  assert.notEqual(action.appId, 'app-B', 'must never resolve to the OTHER app that happens to share the key');
  assert.ok(action.appId === null || action.appId === undefined,
    'app A never appears in the module response (not installed), so there is no appId to resolve to');
});

test('cross-app collision: the installed trigger resolves to its OWN app, unaffected', () => {
  const index = buildMarketplaceIndex({ assets: CROSS_APP_ASSETS, modules: CROSS_APP_MODULES });
  const trigger = index.get('shared_key', 'trigger');
  assert.equal(trigger.installed, true);
  assert.equal(trigger.appId, 'app-B');
});
