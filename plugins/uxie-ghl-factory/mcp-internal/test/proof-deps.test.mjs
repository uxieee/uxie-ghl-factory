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
