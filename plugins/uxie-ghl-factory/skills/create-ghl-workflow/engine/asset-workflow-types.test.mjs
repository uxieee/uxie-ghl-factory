import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetWorkflowTypes, assetsPath } from './action-schema.mjs';

// The builder's own rule (states/marketplace.ts:43-64; utils/workflows.ts:1569-1594). Live 2026-09-25:
// the four answers differ (contacts 85/53, company 80/47, custom_object 77/45 INTERNAL; union 90/55).
test('control: a contact workflow (no type) and an agent workflow read the contacts catalogue', () => {
  assert.equal(assetWorkflowTypes({}), 'default,contacts');
  assert.equal(assetWorkflowTypes(undefined), 'default,contacts');
  assert.equal(assetWorkflowTypes({ workflowType: 'agent' }), 'default,contacts');
  assert.equal(assetWorkflowTypes({ workflowType: 'contact' }), 'contact');
});

test('a business (company) workflow reads default,company', () => {
  assert.equal(assetWorkflowTypes({ workflowType: 'business' }), 'default,company');
});

test('an object-based workflow reads default,custom_object — resolved key or pre-resolution object name', () => {
  assert.equal(assetWorkflowTypes({ customObjectType: 'custom_objects.pet' }), 'default,custom_object');
  assert.equal(assetWorkflowTypes({ object: 'Pet' }), 'default,custom_object');
});

test('the object test wins over a config workflowType, as in the builder (isWFObjectBased is checked last and overrides)', () => {
  assert.equal(assetWorkflowTypes({ workflowType: 'business', customObjectType: 'custom_objects.pet' }), 'default,custom_object');
});

test('assetsPath puts the value into the one route, commas literal (the pinned wire shape)', () => {
  assert.equal(assetsPath('LOC', { workflowType: 'business' }), '/workflows-marketplace/location/LOC/assets?workflowTypes=default,company');
  assert.equal(assetsPath('LOC'), '/workflows-marketplace/location/LOC/assets?workflowTypes=default,contacts');
});
