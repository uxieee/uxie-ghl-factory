// wave25: filters on GHL first-party (INTERNAL) marketplace triggers. Live 2026-09-29 (knowledge sniffs/workflows-wave1-
// 2026-09-25): the builder stores a Company Created "Company Name" row as {operator, field:'name', value, title:'Company
// Name', type:'string', id:'name'} (live-R7-1-builder-company-capture.json); 1.25.0 stored the same row WITHOUT title and
// warned TRIGGER_FILTER_UNCHECKED (live-W25-e-drafts.json D1). The rows now come from the rulebook's schemaFilters, and the
// marketplace block reads the asset filter's `title`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { loadCatalog } from './catalog.mjs';
import { buildMarketplaceIndex } from './marketplace.mjs';

const catalog = loadCatalog();
const COMPANY_ASSETS = { actions: [], triggers: [{ appName: 'company', triggers: [{
  _id: 'a1', templateId: 'T1', key: 'business_created', version: 1, workflowsTriggerType: 'INTERNAL', info: { name: 'Company Created' },
  customVars: [], filters: [{ field: 'name', title: 'Company Name', fieldType: 'string', showOperator: true }] }] }] };
const run = (trigger, { marketplace = null } = {}) => {
  const warnings = []; let n = 0;
  const out = compile({ name: 'wf', workflowType: 'business', triggers: [trigger], graph: [] },
    { loc: 'L', cid: 'C', uid: 'U', companyAge: 0, idGen: () => `id-${++n}`, catalog, warn: (m) => warnings.push(m),
      ...(marketplace ? { marketplace } : {}) });
  return { conditions: out.triggerBodies[0].conditions, warnings };
};
const BUILDER_ROW = { operator: 'string-contains-any-of', field: 'name', value: ['tcwf'], title: 'Company Name', type: 'string', id: 'name' };
const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

test('business_created "name" (marketplace, live asset) stores the builder\'s row — title included — and no UNCHECKED warning', () => {
  const marketplace = buildMarketplaceIndex({ assets: COMPANY_ASSETS, modules: { actions: [], triggers: [] } });
  const { conditions, warnings } = run({ ref: 't', type: 'business_created', marketplace: true, name: 'c',
    filters: [{ field: 'name', operator: 'string-contains-any-of', value: ['tcwf'] }] }, { marketplace });
  assert.deepEqual(sorted(conditions[0]), sorted(BUILDER_ROW));
  assert.deepEqual(warnings.filter((w) => /TRIGGER_FILTER/.test(w)), []);
});

test('with no live asset the rulebook row still supplies id, type and title; a row named by its title resolves', () => {
  const { conditions, warnings } = run({ ref: 't', type: 'business_created', name: 'c', filters: [{ field: 'Company Name', operator: 'string-contains-any-of', value: ['tcwf'] }] });
  assert.deepEqual(sorted(conditions[0]), sorted(BUILDER_ROW));
  assert.deepEqual(warnings.filter((w) => /TRIGGER_FILTER/.test(w)), []);
});

test('CONTROL: a field the trigger does not declare is TRIGGER_FILTER_UNKNOWN, listing what it offers', () => {
  const { conditions, warnings } = run({ ref: 't', type: 'business_created', name: 'c', filters: [{ field: 'nmae', operator: 'string-contains-any-of', value: ['x'] }] });
  assert.equal(conditions[0].field, 'nmae');
  const w = warnings.find((x) => /TRIGGER_FILTER_UNKNOWN/.test(x));
  assert.ok(w && /name \(Company Name, string\)/.test(w), w);
});

test('a multiselect INTERNAL row without the live asset warns that its comparison mode is unknown', () => {
  const t = catalog.trigger('coupon_code_redeemed');
  const multi = (t.schemaFilters ?? []).find((r) => /^multiselect/.test(r.fieldType));
  assert.ok(multi, 'premise: coupon_code_redeemed declares a multiselect filter');
  const { warnings } = run({ ref: 't', type: 'coupon_code_redeemed', name: 'c', filters: [{ field: multi.field, operator: 'is-any-of', value: ['x'] }] });
  assert.ok(warnings.some((w) => /TRIGGER_FILTER_ARRAY_MODE_UNKNOWN/.test(w)));
});

test('CONTROL: native trigger rows are unchanged (contact_tag; affiliate_new_lead, which carries both filterRows and schemaFilters)', () => {
  // Literals are the 1.25.0 (plugin main bc631df9) compile of the same filters.
  assert.deepEqual(run({ ref: 't', type: 'contact_tag', name: 't', filters: [{ field: 'tagsAdded', value: 'x' }] }).conditions,
    [{ field: 'tagsAdded', operator: 'index-of-true', value: 'x', title: 'Tag added', type: 'select', id: 'tag-added' }]);
  assert.deepEqual(run({ ref: 't', type: 'affiliate_new_lead', name: 't', filters: [{ field: 'campaign.id', value: 'x', operator: '==' }] }).conditions,
    [{ field: 'campaign.id', operator: '==', value: 'x', title: 'In campaign', type: 'select' }]);
});
