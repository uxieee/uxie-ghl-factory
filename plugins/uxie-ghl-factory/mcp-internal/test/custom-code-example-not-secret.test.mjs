// The custom_code step example must pass the credential guard so it can be authored through build_workflow / edit_workflow.
// The guard's labelled-secret rule refuses code that writes a literal `Authorization:` label before a value (live 2026-09-30,
// coordinator ruling: fix the example, not the guard), so the example names the header through a variable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { containsSecrets } from '../core/errors.mjs';

const example = JSON.parse(readFileSync(new URL('../../skills/create-ghl-workflow/catalog/step-examples/custom_code.json', import.meta.url), 'utf8'));

test("the custom_code example's attributes pass the credential guard", () => {
  assert.equal(containsSecrets(example.attributes), false);
});

test('control: the same code with a literal Authorization label is refused', () => {
  const literal = example.attributes.code.replace("[AUTH]:", 'Authorization:');
  assert.notEqual(literal, example.attributes.code, 'the example no longer uses the variable form the control depends on');
  assert.equal(containsSecrets({ ...example.attributes, code: literal }), true);
});
