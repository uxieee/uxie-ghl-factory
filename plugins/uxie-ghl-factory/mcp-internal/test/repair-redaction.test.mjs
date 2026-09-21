// The sanctioned round trip was the corrupting one.
//
// export_workflow --writeTo writes a SCRUBBED file, and the tool's own note said repair_workflow
// accepts that file as templatesPath. But the scrub fires on the KEY NAME without reading the
// value: GHL stores a custom_webhook's attributes.authorization as {type:"NONE", data:null} — no
// credential in it at all — and the export hands back the string "<redacted>". PUT that back on a
// step whose authorization IS configured and the real value is replaced by the placeholder, through
// a full-document PUT with no validator on the far side.
//
// repair_workflow's refusal is now the SHARED redacted-write guard (core/raw-request-guards.mjs
// refuseRedactedWrite) — edit_workflow and raw_request carry the same check; see
// test/redacted-write-guard.test.mjs for the cross-tool suite. This file keeps the
// repair_workflow-specific regression coverage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { containsSecrets, REDACTED } from '../core/errors.mjs';

const repair = TOOLS.find((t) => t.name === 'repair_workflow');
const deps = { state: {}, makeGw: () => ({ call: async () => ({ status: 200, json: {} }) }) };
const hook = (auth) => ({ id: 's1', type: 'custom_webhook', name: 'Hook 1',
  attributes: { url: 'https://example.test/h', authorization: auth } });
const tag = { id: 's2', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['a'] } };

test('repair_workflow REFUSES a document still carrying redaction placeholders', async () => {
  const r = await repair.handler(
    { locationId: 'LOC', workflowId: 'W', templates: [hook(REDACTED), tag], confirm: true }, deps);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'VALIDATION_FAILED');
  // it has to name the STEP and the PATH — "something is redacted" is not actionable on a 40-step doc
  assert.match(r.detail, /s1 "Hook 1"/);
  assert.match(r.detail, /custom_webhook/);
  assert.match(r.detail, /attributes\.authorization/);
  // and say what writing it would actually do
  assert.match(r.detail, /REPLACE the stored value/);
  assert.match(r.remediation, /re-entered by hand/, 'the usability point: name the STEPS to redo, not just that a secret exists');
});

test('a redaction placeholder nested deeper is still found', async () => {
  const nested = { id: 's3', type: 'custom_webhook', name: 'Deep',
    attributes: { headers: [{ key: 'X', value: REDACTED }] } };
  const r = await repair.handler(
    { locationId: 'LOC', workflowId: 'W', templates: [nested], confirm: true }, deps);
  assert.equal(r.ok, false);
  assert.match(r.detail, /attributes\.headers\[0\]\.value/);
});

test('a document with REAL values is not blocked by this check', async () => {
  // the control that matters: the refusal must not make repair_workflow unusable, which is the
  // state it was already in for a different reason
  const r = await repair.handler(
    { locationId: 'LOC', workflowId: 'W', templates: [hook({ type: 'NONE', data: null }), tag], confirm: true }, deps);
  // A separate, pre-existing tool-argument credential scanner can ALSO answer VALIDATION_FAILED on
  // an unrelated shape, so the assertion specific to THIS guard is that its message never appears.
  assert.doesNotMatch(r.detail ?? '', /redaction placeholder/,
    `a real authorization object must pass this guard, got ${r.code}: ${r.detail}`);
});

// The other half: our own scrubbed output has to survive being read back as input.
test('the redaction placeholder is not itself treated as a credential', () => {
  assert.equal(containsSecrets({ authorization: REDACTED }), false,
    'refusing our own placeholder makes our scrubbed output unusable as our own input');
  // narrow on purpose — a real credential under the same key is still refused
  assert.equal(containsSecrets({ authorization: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop' }), true);
  assert.equal(containsSecrets({ body: { config: { cookie: 'abc123def456ghi789jkl' } } }), true);
});
