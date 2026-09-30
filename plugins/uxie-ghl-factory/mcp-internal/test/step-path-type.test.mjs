// The Add-step modal offers three page types, and every path field runs one validator (funnelWebsiteApp): lowercase `[a-z0-9-_/]`, ≤ 5 segments,
// no reserved storefront/blog run. The tool used to accept any string for both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkStepPath, planCreateStep, planUpdateStep, STEP_TYPES } from '../core/funnel-ops.mjs';

const funnel = { _id: 'F1', domainId: 'D1', steps: [{ id: 'S1', name: 'A', url: '/a' }] };

test('checkStepPath: the UI\'s validator', () => {
  assert.deepEqual(checkStepPath('/a/b_c-d/e1'), { path: '/a/b_c-d/e1' });
  assert.deepEqual(checkStepPath('offer'), { path: '/offer' }, 'a leading slash is added, as the UI does');
  assert.match(checkStepPath('').refuse, /required/);
  assert.match(checkStepPath('/Has-Upper').refuse, /lowercase letters/);
  assert.match(checkStepPath('/a b').refuse, /lowercase letters/);
  assert.match(checkStepPath('/a.html').refuse, /lowercase letters/);
  assert.match(checkStepPath('/a/x/y/z/w/v').refuse, /6 segments; at most 5/);
  assert.equal(checkStepPath('/a/x/y/z/w').path, '/a/x/y/z/w');
});

test('checkStepPath: a reserved run anywhere in the path is refused; near-misses are not', () => {
  for (const p of ['/b', '/c/x', '/x/product', '/collections', '/post/y', '/category', '/author', '/tag', '/store/account', '/deep/store/account/x']) assert.match(checkStepPath(p).refuse, /reserved segment/, p);
  for (const p of ['/store', '/account', '/bb', '/product-x', '/my/tags', '/store/x/account']) assert.ok(checkStepPath(p).path, p);
});

test('planCreateStep: only the three modal types, a valid path, and the domain rule still first', () => {
  assert.deepEqual(STEP_TYPES, ['optin_funnel_page', 'sales_funnel_page', 'misc_funnel_page']);
  assert.equal(planCreateStep({ funnel, step: { name: 'N', url: 'ok', id: 'X' } }).body.step.type, 'optin_funnel_page');
  assert.equal(planCreateStep({ funnel, step: { name: 'N', url: 'ok', type: 'sales_funnel_page', id: 'X' } }).body.step.type, 'sales_funnel_page');
  assert.match(planCreateStep({ funnel, step: { name: 'N', url: 'ok', type: 'webinar' } }).refuse, /not one the Add-step modal offers/);
  assert.match(planCreateStep({ funnel, step: { name: 'N', url: '/Bad' } }).refuse, /lowercase/);
  assert.match(planCreateStep({ funnel, step: { name: 'N', url: '/tag' } }).refuse, /reserved/);
  assert.match(planCreateStep({ funnel: { ...funnel, domainId: '' }, step: { name: 'N', url: '/Bad' } }).refuse, /no domain attached/);
});

test('planUpdateStep validates a moved path the same way; a rename alone needs none', () => {
  assert.match(planUpdateStep({ funnel, stepId: 'S1', url: '/a/x/y/z/w/v', domainName: 'd.example.com' }).refuse, /at most 5/);
  assert.match(planUpdateStep({ funnel, stepId: 'S1', url: '/store/account', domainName: 'd.example.com' }).refuse, /reserved/);
  assert.equal(planUpdateStep({ funnel, stepId: 'S1', url: '/fine', domainName: 'd.example.com' }).body.url, '/fine');
  assert.equal(planUpdateStep({ funnel, stepId: 'S1', name: 'New name' }).body.name, 'New name');
});
