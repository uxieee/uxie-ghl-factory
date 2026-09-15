import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normPath, routeKey, endpointKey, catalogIndex, rowHash, endpointHashes, primarySurfaces, buildDeps }
  from '../../../../scripts/lib/proof-deps.mjs';

const B = 'https://backend.leadconnectorhq.com', SV = 'https://services.leadconnectorhq.com';
const CAT = [
  { id: 'p1', method: 'GET', origin: B, path: '/opportunities/pipelines', service: 'pipelines-opportunities', query: [], body: null },
  { id: 'w1', method: 'GET', origin: B, path: '/opportunities/pipelines/', service: 'workflows', query: [], body: null },
  { id: 'f1', method: 'GET', origin: SV, path: '/opportunities/pipelines', service: 'forms', query: [], body: null },
  { id: 'wf', method: 'POST', origin: B, path: '/workflow/{locationId}', service: 'workflows', query: [], body: { name: 'string' } },
  { id: 'bl', method: 'DELETE', origin: B, path: '/blacklist/{kind}/{id}', service: 'workflows', aka: ['/blocklist/{type}/{id}'] },
  { id: 'n1', method: 'GET', origin: B, path: '/merge-tags', service: null },
];
const MAN = [
  { tool: 'build_workflow', method: 'POST', path: '/workflow/:locationId' },
  { tool: 'build_workflow', method: 'GET', path: '/opportunities/pipelines' },
  { tool: 'build_workflow', method: 'DELETE', path: '/blocklist/${type}/${id}' },
  { tool: 'search_merge_tags', method: 'GET', path: '/merge-tags?locationId=x' },
];

test('normPath folds every parameter style, the query and trailing slashes', () => {
  assert.equal(normPath('/workflow/:locationId/'), '/workflow/{}');
  assert.equal(normPath('/a/${x}/b/{y}?q=1'), '/a/{}/b/{}');
  assert.equal(normPath('/'), '/');
});

test('keys carry the origin; routes do not', () => {
  assert.equal(routeKey('get', '/x/{id}'), 'GET /x/{}');
  assert.equal(endpointKey('GET', B, '/x/{id}/'), `GET ${B} /x/{}`);
});

test('two catalogue rows sharing a key hash as one sorted set, independent of id', () => {
  const idx = catalogIndex(CAT);
  const k = `GET ${B} /opportunities/pipelines`;
  assert.equal(idx.byKey.get(k).length, 2);
  const renamed = catalogIndex(CAT.map((e) => ({ ...e, id: `${e.id}-renamed` })));
  assert.equal(rowHash(idx.byKey.get(k)), rowHash(renamed.byKey.get(k)));
});

test('an aka path joins its row, and a changed body changes the hash', () => {
  const idx = catalogIndex(CAT);
  const h = endpointHashes('build_workflow', MAN, idx);
  assert.ok(h[`DELETE ${B} /blacklist/{}/{}`]);
  assert.ok(h[`POST ${B} /workflow/{}`]);
  assert.ok(h[`GET ${SV} /opportunities/pipelines`], 'the manifest has no origin, so both origins are dependencies');
  const changed = catalogIndex(CAT.map((e) => (e.id === 'wf' ? { ...e, body: { name: 'number' } } : e)));
  assert.notEqual(endpointHashes('build_workflow', MAN, changed)[`POST ${B} /workflow/{}`], h[`POST ${B} /workflow/{}`]);
});

test('primary surface is the majority service, ties keep all, no service is unassigned', () => {
  const idx = catalogIndex(CAT);
  assert.deepEqual(primarySurfaces('build_workflow', MAN, idx), ['workflows']);
  assert.deepEqual(primarySurfaces('search_merge_tags', MAN, idx), ['unassigned']);
  const tie = [{ tool: 't', method: 'GET', path: '/opportunities/pipelines' }];
  assert.deepEqual(primarySurfaces('t', tie, catalogIndex(CAT.filter((e) => e.id !== 'w1'))), ['forms', 'pipelines-opportunities']);
});

test('build deps: tier-1 apps, else all mapped apps, plus the builder pin for workflows', () => {
  const map = { surfaces: {
    forms: [{ app: 'formSurveyApp', tier: 1 }, { app: 'quizResultBuilderApp', tier: 2 }],
    funnels: [{ app: 'funnelsApp', tier: 2 }, { app: 'websitesApp', tier: 3 }],
    workflows: [{ app: 'automationApp', tier: 2 }],
  } };
  const apps = new Map([['formSurveyApp', { build: 10 }], ['funnelsApp', { build: 3 }], ['websitesApp', { build: 4 }], ['automationApp', { build: 7 }]]);
  assert.deepEqual(buildDeps(['forms'], map, { apps }), { formSurveyApp: 10 });
  assert.deepEqual(buildDeps(['funnels'], map, { apps }), { funnelsApp: 3, websitesApp: 4 });
  assert.deepEqual(buildDeps(['workflows'], map, { apps, builderEntry: 'assets/index-X.js' }), { automationApp: 7, 'builder-chunks': 'assets/index-X.js' });
  assert.deepEqual(buildDeps(['brand-kit'], map, { apps }), {});
});

// 🔴 A GUESS MAY NOT GATE A PROOF. Observed 2026-09-15: adPublishingApp — tier 3, confidence GUESS,
// no stated reason, and touched by ZERO capability rows — shipped 112→113 and demoted all 27
// workflow tools to `shipped`, holding `confirmed` at 0. It had shipped seven times in seventeen
// days. The old fallback (`tier1.length ? tier1 : list`) made every listed app gate, because no
// surface has a tier-1 app. Console bl-145.
test('a GUESS-confidence app is recorded in the map but never gates a proof', () => {
  const map = { surfaces: {
    workflows: [
      { app: 'reportingApp', tier: 2, confidence: 'LIKELY' },
      { app: 'adPublishingApp', tier: 3, confidence: 'GUESS' },
      { app: 'notificationApp', tier: 3, confidence: 'GUESS' },
    ],
    funnels: [{ app: 'funnelsApp', tier: 2, confidence: 'CERTAIN' }, { app: 'guessyApp', tier: 3, confidence: 'guess' }],
    allguess: [{ app: 'guessyApp', tier: 3, confidence: 'GUESS' }],
    noconfidence: [{ app: 'reportingApp', tier: 2 }],
  } };
  const apps = new Map([['reportingApp', { build: 268 }], ['adPublishingApp', { build: 113 }],
    ['notificationApp', { build: 261 }], ['funnelsApp', { build: 3 }], ['guessyApp', { build: 9 }]]);

  assert.deepEqual(buildDeps(['workflows'], map, { apps, builderEntry: 'assets/index-X.js' }),
    { 'builder-chunks': 'assets/index-X.js', reportingApp: 268 },
    'the two GUESS apps are dropped; the LIKELY one and the builder SPA still gate');
  assert.deepEqual(buildDeps(['funnels'], map, { apps }), { funnelsApp: 3 }, 'case-insensitive');

  // Every app a guess → nothing gates, which is the honest answer: we have no credible build
  // dependency for that surface. It must not silently fall back to gating on the guesses again.
  assert.deepEqual(buildDeps(['allguess'], map, { apps }), {});

  // An entry with NO confidence is not a guess — absence of the field is not a claim of ignorance,
  // and demoting every unannotated legacy row would be a second, opposite bug.
  assert.deepEqual(buildDeps(['noconfidence'], map, { apps }), { reportingApp: 268 });
});

// The builder SPA is the RIGHT kind of dependency and must survive the change: the workflow builder
// is its own app, the federated manifest cannot see it, and its 2026-09-14 redeploy correctly
// demoted these tools. This fix is against guesses driving the signal, not against build drift.
test('the workflow builder SPA still gates even when every federated app for the surface is a guess', () => {
  const map = { surfaces: { workflows: [{ app: 'adPublishingApp', tier: 3, confidence: 'GUESS' }] } };
  const apps = new Map([['adPublishingApp', { build: 113 }]]);
  assert.deepEqual(buildDeps(['workflows'], map, { apps, builderEntry: 'assets/index-Y.js' }),
    { 'builder-chunks': 'assets/index-Y.js' });
});
