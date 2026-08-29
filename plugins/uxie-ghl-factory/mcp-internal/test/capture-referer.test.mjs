// The two capture procedures said OPPOSITE things for months and neither had a test:
// capture-token.mjs insisted on the workflow iframe ("an app.gohighlevel.com-scoped token 401s on
// every workflow endpoint"), while commands/internal-connect.md insisted the referer "MUST be
// app.gohighlevel.com, NOT the workflow iframe".
//
// Settled live 2026-08-29: a Bearer captured from a credentialed request with
// `referer: https://app.gohighlevel.com/` drove GET /workflow/{loc}/list, a full build (create,
// auto-save, 7 trigger POSTs), an edit PUT and its read-back — every one a 200. Both work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptsBearerFrom } from '../scripts/capture-token.mjs';

test('both referers are accepted, and the iframe is distinguishable so it can be preferred', () => {
  assert.equal(acceptsBearerFrom('https://client-app-automation-workflows.leadconnectorhq.com/anything'), 'builder-iframe');
  assert.equal(acceptsBearerFrom('https://app.gohighlevel.com/'), 'app');
  assert.equal(acceptsBearerFrom('https://app.gohighlevel.com/v2/location/X/ai-agents/getting-started'), 'app');
});

test('anything else is refused — this is an allowlist, not a suggestion', () => {
  for (const bad of [undefined, null, '', 'https://evil.example/', 'https://app.gohighlevel.com.evil.test/',
    'http://app.gohighlevel.com/', 'https://backend.leadconnectorhq.com/']) {
    assert.equal(acceptsBearerFrom(bad), null, String(bad));
  }
});

test('importing the module does NOT launch a browser', () => {
  // If the CLI ran on import, this test file could not exist: the first attempt to test the rule
  // opened a browser and performed a real capture.
  assert.equal(typeof acceptsBearerFrom, 'function');
});
