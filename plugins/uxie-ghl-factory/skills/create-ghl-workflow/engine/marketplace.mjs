// Live per-location marketplace app index. Pure — the fetch lives in the caller
// (orchestrate.mjs), exactly like resolve.mjs. Two sources, two jobs:
//
//   /workflows-marketplace/location/{loc}/assets   -> the SCHEMA (key, version,
//       templateId, inputs, customVars, branchesConfig). Already fetched by
//       check_workflow. NOT install-filtered: it answers "available here", and was
//       observed returning 46 vs 45 apps across two locations of one account.
//   /marketplace/core/search/module?...isInstalled=true -> INSTALL TRUTH plus app
//       identity (appId, publisher, install count), which assets does not carry.
//
// Both are needed. Assets alone would hand the compiler a templateId for an app the
// location does not have, which is the defect this module exists to prevent.

const entryFrom = (kind, appName, raw) => ({
  kind,
  key: raw.key,
  appName,
  version: raw.version,
  templateId: raw.templateId,
  inputs: Array.isArray(raw.inputs) ? raw.inputs : [],
  customVars: Array.isArray(raw.customVars) ? raw.customVars : [],
  branchesConfig: raw.branchesConfig ?? null,
  info: raw.info ?? null,
});

// The assets payload nests twice: apps, then their actions/triggers.
export function parseMarketplaceAssets(assets) {
  const byKey = new Map();
  for (const app of assets?.actions ?? []) {
    for (const action of app?.actions ?? []) {
      if (action?.key) byKey.set(action.key, entryFrom('action', app.appName, action));
    }
  }
  for (const app of assets?.triggers ?? []) {
    for (const trigger of app?.triggers ?? []) {
      if (trigger?.key) byKey.set(trigger.key, entryFrom('trigger', app.appName, trigger));
    }
  }
  return byKey;
}

// The module payloads are per-app arrays; an app appears in both responses, so merge
// its key lists rather than letting the second overwrite the first.
export function parseInstalledModules({ triggers = [], actions = [] } = {}) {
  const byAppId = new Map();
  const absorb = (rows, field) => {
    for (const app of rows ?? []) {
      if (!app?.appId) continue;
      const existing = byAppId.get(app.appId) ?? {
        appId: app.appId,
        appName: app.name,
        companyName: app.companyName,
        totalInstallations: app.totalInstallations,
        averageRating: app.averageRating,
        isInstalled: app.isInstalled === true,
        keys: [],
      };
      existing.isInstalled = existing.isInstalled || app.isInstalled === true;
      for (const item of app[field] ?? []) if (item?.key) existing.keys.push(item.key);
      byAppId.set(app.appId, existing);
    }
  };
  absorb(actions, 'actions');
  absorb(triggers, 'triggers');
  return byAppId;
}

export function buildMarketplaceIndex({ assets, modules } = {}) {
  const schema = parseMarketplaceAssets(assets);
  const apps = parseInstalledModules(modules ?? {});
  const appIdByKey = new Map();
  for (const app of apps.values()) for (const key of app.keys) appIdByKey.set(key, app.appId);

  const joined = new Map();
  for (const [key, entry] of schema) {
    const appId = appIdByKey.get(key);
    const app = appId ? apps.get(appId) : undefined;
    joined.set(key, { ...entry, appId: appId ?? null, installed: app?.isInstalled === true });
  }
  return {
    get: (key) => joined.get(key),
    all: () => [...joined.values()],
    installedApps: () => [...apps.values()].filter((a) => a.isInstalled),
  };
}
