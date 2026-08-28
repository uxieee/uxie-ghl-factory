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
//
// ACTIONS and TRIGGERS ONLY. Two SEPARATE maps, never one shared namespace — 🔴 a real,
// OBSERVED collision exists in the live GHL catalog: `contact_engagement_score` is BOTH
// an action (required inputs: operator, points) AND a trigger (0 inputs), 1 of 481 keys
// measured against the live catalog, 2026-08-16. Folding both into one `byKey` map lets
// one silently shadow the other depending on parse order (triggers were parsed second,
// so they always won) — the exact defect this split exists to prevent. This mirrors the
// split already applied in action-schema.mjs's `parseActionSchema` / `parseTriggerSchema`
// for the same observed collision; keep the two files' shapes consistent.
export function parseMarketplaceActions(assets) {
  const byKey = new Map();
  for (const app of assets?.actions ?? []) {
    for (const action of app?.actions ?? []) {
      if (action?.key) byKey.set(action.key, entryFrom('action', app.appName, action));
    }
  }
  return byKey;
}

export function parseMarketplaceTriggers(assets) {
  const byKey = new Map();
  for (const app of assets?.triggers ?? []) {
    for (const trigger of app?.triggers ?? []) {
      if (trigger?.key) byKey.set(trigger.key, entryFrom('trigger', app.appName, trigger));
    }
  }
  return byKey;
}

// The module payloads are per-app arrays; an app appears in both responses, so merge
// its key lists rather than letting the second overwrite the first.
//
// 🔴 actionKeys and triggerKeys are kept as TWO SEPARATE lists, never one shared `keys[]`
// — the same collision class documented at the top of this file. A key that is BOTH an
// action and a trigger (`contact_engagement_score`) can belong to DIFFERENT apps: one app
// publishes it as an action, a different app publishes it as a trigger. A single mixed
// `keys[]` folded both into one list per app, which fed a single shared key→appId map
// downstream (see `buildMarketplaceIndex`) — that map could resolve an action lookup to
// the app that actually owns the *trigger* half of the collision, silently reporting an
// uninstalled action's app as installed. See buildMarketplaceIndex's docstring for the
// full reproduction. Each list is deduped — an app can appear once per field across the
// merge, and a duplicate key in the raw payload must not produce a duplicate list entry.
export function parseInstalledModules({ triggers = [], actions = [] } = {}) {
  const byAppId = new Map();
  const absorb = (rows, field, listKey) => {
    for (const app of rows ?? []) {
      if (!app?.appId) continue;
      const existing = byAppId.get(app.appId) ?? {
        appId: app.appId,
        appName: app.name,
        companyName: app.companyName,
        totalInstallations: app.totalInstallations,
        averageRating: app.averageRating,
        isInstalled: app.isInstalled === true,
        actionKeys: [],
        triggerKeys: [],
      };
      existing.isInstalled = existing.isInstalled || app.isInstalled === true;
      for (const item of app[field] ?? []) {
        if (item?.key && !existing[listKey].includes(item.key)) existing[listKey].push(item.key);
      }
      byAppId.set(app.appId, existing);
    }
  };
  absorb(actions, 'actions', 'actionKeys');
  absorb(triggers, 'triggers', 'triggerKeys');
  return byAppId;
}

// Join install truth back onto the schema, KIND-AWARE — never one shared key→appId map.
//
// 🔴 REAL, OBSERVED collision class (same one documented at the top of this file, but this
// is the install-JOIN half of it, not the schema half): action-space and trigger-space are
// separate namespaces that can share a key string, AND — the part a single shared map gets
// wrong — the two halves of a collision can belong to DIFFERENT apps entirely. Example:
//   app A publishes 'shared_key' as an ACTION and is NOT installed
//   app B publishes 'shared_key' as a TRIGGER and IS installed
// A single `appIdByKey` map built from a mixed keys[] list would resolve 'shared_key' to
// app B for BOTH the action lookup and the trigger lookup — so `get('shared_key', 'action')`
// would report `installed: true` and `appId: app-B`, even though the app that actually
// publishes that key as an action was never installed. `MARKETPLACE_APP_NOT_INSTALLED`
// would never fire, and the compiler would emit a step for an app the location does not
// have — exactly the failure the module endpoint exists to prevent.
//
// The fix: two separate appId maps, one per kind, each built ONLY from that kind's key
// list. An action entry's `appId`/`installed` can only ever come from an app that
// publishes that key AS AN ACTION; a trigger entry's, only from an app that publishes it
// AS A TRIGGER.
export function buildMarketplaceIndex({ assets, modules, legs } = {}) {
  const actionSchema = parseMarketplaceActions(assets);
  const triggerSchema = parseMarketplaceTriggers(assets);
  const apps = parseInstalledModules(modules ?? {});
  const appIdByKind = { action: new Map(), trigger: new Map() };
  for (const app of apps.values()) {
    for (const key of app.actionKeys) appIdByKind.action.set(key, app.appId);
    for (const key of app.triggerKeys) appIdByKind.trigger.set(key, app.appId);
  }

  const join = (schema, kind) => {
    const appIdByKey = appIdByKind[kind];
    const joined = new Map();
    for (const [key, entry] of schema) {
      const appId = appIdByKey.get(key);
      const app = appId ? apps.get(appId) : undefined;
      joined.set(key, { ...entry, appId: appId ?? null, installed: app?.isInstalled === true });
    }
    return joined;
  };
  const byKind = { action: join(actionSchema, 'action'), trigger: join(triggerSchema, 'trigger') };

  return {
    // WHICH READS FAILED. A key missing from the assets schema, or an app reading installed:false,
    // means nothing when the read behind it did not succeed — the compiler must say "unknown",
    // never "not installed" (F5-11). Absent legs = a caller that built the index from data it
    // already trusts (tests, the empty index a native build uses).
    readFailed: {
      assets: legs?.assets === 'failed',
      actions: legs?.actions === 'failed',
      triggers: legs?.triggers === 'failed',
    },
    // `kind` is REQUIRED — must be exactly 'action' or 'trigger'. Action and trigger
    // keys are NOT one namespace (see parseMarketplaceActions's docstring for the
    // observed `contact_engagement_score` collision); the caller must always say which
    // one it means. There is deliberately no default/fallback/"whichever exists" path —
    // a silent fallback is how the original bug (triggers always winning a collision)
    // survived undetected. Every caller of `.get` on this index must pass kind.
    get: (key, kind) => {
      if (kind !== 'action' && kind !== 'trigger') {
        throw new Error(
          `marketplace index .get(key, kind) requires kind to be 'action' or 'trigger', got ${JSON.stringify(kind)}`);
      }
      return byKind[kind].get(key);
    },
  };
}
