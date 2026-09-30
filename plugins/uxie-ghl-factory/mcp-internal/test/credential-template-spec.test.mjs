// build_course's spec.credential is a credential TEMPLATE ({title, type: certificate|badge}), not a secret. The key name alone made the tool
// refuse every spec that attached one (live 2026-09-30).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containsSecrets, scrubSecrets } from '../core/errors.mjs';

test('a course credential template spec is not a secret, in the input guard or in the output scrub', () => {
  const spec = { course: { title: 'C' }, credential: { title: 'Onboarding Certificate', type: 'certificate' } };
  assert.equal(containsSecrets(spec), false);
  assert.deepEqual(scrubSecrets(spec).credential, { title: 'Onboarding Certificate', type: 'certificate' });
  assert.equal(containsSecrets({ credential: { title: 'Well done', type: 'badge' } }), false);
});

test('CONTROLS: any other shape under `credential` is still refused and redacted', () => {
  for (const v of [{ title: 'x', type: 'certificate', extra: 'y' }, { value: 'sk_live_abcdefghijklmnop' }, 'hunter2hunter2', { title: 'x', type: 'oauth' }, { title: '' }, ['a'], { title: 'Bearer abcdefghijklmnopqrstuv', type: 'badge' }])
    assert.equal(containsSecrets({ credential: v }), true, JSON.stringify(v));
  assert.equal(scrubSecrets({ credential: { value: 'sk_live_abcdefghijklmnop' } }).credential, '<redacted>');
  assert.equal(scrubSecrets({ credential: 'tok' }).credential, '<redacted>');
  assert.equal(containsSecrets({ password: { title: 'x', type: 'badge' } }), true);
});
