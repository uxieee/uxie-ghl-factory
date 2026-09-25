import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from './catalog.mjs';

test('known step types resolve', () => {
  const c = loadCatalog();
  assert.equal(c.step('add_contact_tag').isMultipathContainer, false);
  assert.equal(c.step('if_else').isMultipathContainer, true);
});

test('trigger master type resolves', () => {
  assert.equal(loadCatalog().trigger('contact_tag').masterType, 'highlevel');
});

test('unknown type returns undefined', () => {
  assert.equal(loadCatalog().step('nope'), undefined);
});

test('voice_ai_outbound_call resolves as an internal action requiring agentId/fromPhoneNumber', () => {
  const step = loadCatalog().step('voice_ai_outbound_call');
  assert.equal(step.isMultipathContainer, false);
  assert.deepEqual(step.situational, ['workflowsActionType']);
  assert.deepEqual(step.requiredFields, ['agentId', 'fromPhoneNumber']);
});

test('catalog exposes the native switch-off, and says a disabled WAIT is not honoured (live 2026-09-25)', () => {
  const pause = loadCatalog().stepCapabilities().isDisabled;
  assert.match(pause.appliesTo, /^actions/);
  assert.deepEqual(pause.notHonouredBy, ['wait']);
  assert.match(pause.description, /disabled WAIT still waits/);
  assert.equal(pause.irField, 'disabled');
  assert.equal(pause.templatePath, 'advanceCanvasMeta.isDisabled');
});
