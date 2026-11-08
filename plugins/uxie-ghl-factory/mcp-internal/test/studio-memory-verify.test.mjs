import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileAiAgentPlan } from '../core/tools.mjs';

// QA FAIL #2 on w9-m1: the from-scratch create verified every authored switch except memoryEnabled, so a create
// that GHL ignored would still report verified:true. memoryEnabled is an authored switch like customApiEnabled.

test('from-scratch studio create verifies memoryEnabled:true when the caller authored it', () => {
  const plan = compileAiAgentPlan('studio', {
    locationId: 'L', companyId: 'A',
    spec: { name: 'S', systemPrompt: 'You are a canary.', buildPrompt: 'Build a greeter.', memoryEnabled: true },
  });
  assert.equal(plan.verifyExpected.config.memoryEnabled, true);
});

test('from-scratch studio create verifies memoryEnabled:false when the caller authored it', () => {
  const plan = compileAiAgentPlan('studio', {
    locationId: 'L', companyId: 'A',
    spec: { name: 'S', systemPrompt: 'You are a canary.', buildPrompt: 'Build a greeter.', memoryEnabled: false },
  });
  assert.equal(plan.verifyExpected.config.memoryEnabled, false);
});

test('from-scratch studio create does not assert memoryEnabled when the caller did not author it', () => {
  const plan = compileAiAgentPlan('studio', {
    locationId: 'L', companyId: 'A',
    spec: { name: 'S', systemPrompt: 'You are a canary.', buildPrompt: 'Build a greeter.' },
  });
  assert.equal('memoryEnabled' in plan.verifyExpected.config, false);
});
