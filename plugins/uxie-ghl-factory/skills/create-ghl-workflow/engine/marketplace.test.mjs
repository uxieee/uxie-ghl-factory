import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarketplaceAssets, parseInstalledModules, buildMarketplaceIndex } from './marketplace.mjs';
import ASSETS from './fixtures/marketplace-assets.json' with { type: 'json' };
import MODULES from './fixtures/marketplace-modules.json' with { type: 'json' };

test('assets parse yields the action schema keyed by action key', () => {
  const byKey = parseMarketplaceAssets(ASSETS);
  const action = byKey.get('imessage_a');
  assert.equal(action.kind, 'action');
  assert.equal(action.version, '1.5');
  assert.equal(action.templateId, '01JTG3GNCCGBMXS0BY7NE3XY91');
  assert.ok(Array.isArray(action.inputs));
});

test('assets parse yields trigger customVars', () => {
  const trigger = parseMarketplaceAssets(ASSETS).get('imessage_t');
  assert.equal(trigger.kind, 'trigger');
  assert.equal(trigger.version, '1.4');
  assert.equal(trigger.templateId, '01JTG30GR5C99TGPCJA8Z5899R');
  assert.ok(trigger.customVars.some((v) => v.reference === 'message'));
});

test('module parse yields app identity and install truth', () => {
  const apps = parseInstalledModules(MODULES);
  const app = apps.get('65a908766a9bd0008de6ee04');
  assert.equal(app.isInstalled, true);
  assert.equal(app.companyName, 'JAG Digital');
  assert.ok(app.totalInstallations > 0);
  assert.ok(app.keys.includes('imessage_a'));
});

test('index joins schema to install truth', () => {
  const index = buildMarketplaceIndex({ assets: ASSETS, modules: MODULES });
  const entry = index.get('imessage_a');
  assert.equal(entry.installed, true);
  assert.equal(entry.appId, '65a908766a9bd0008de6ee04');
  assert.equal(entry.version, '1.5');
});

test('a key present in assets but absent from the installed modules is installed:false', () => {
  const index = buildMarketplaceIndex({ assets: ASSETS, modules: { actions: [], triggers: [] } });
  assert.equal(index.get('imessage_a').installed, false);
});

test('an unknown key resolves to undefined', () => {
  assert.equal(buildMarketplaceIndex({ assets: ASSETS, modules: MODULES }).get('nope'), undefined);
});
