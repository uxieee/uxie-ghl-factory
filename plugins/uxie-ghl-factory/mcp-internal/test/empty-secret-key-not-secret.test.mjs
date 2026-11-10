// An EMPTY string under a secret-named key is not a credential: the chatgpt drawer's default apiKey:""
// was refused on the key name (live 2026-09-28). Anything non-empty under such a key is still refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containsSecrets } from '../core/errors.mjs';

test('chatgpt apiKey:"" passes', () => {
  assert.equal(containsSecrets({ spec: { graph: [{ type: 'chatgpt', attributes: { type: 'chatgpt', apiKey: '', model: 'gpt-5-nano' } }] } }), false);
});

test('a non-empty value under a secret-named key is still refused (controls)', () => {
  for (const v of [' ', 'x', 'sk-abc', 'null', ['']])
    assert.equal(containsSecrets({ attributes: { apiKey: v } }), true, JSON.stringify(v));
  assert.equal(containsSecrets({ attributes: { password: 'p' } }), true);
});

// bl-112 (2026-11-10): a NONE/null authorization is no longer passed through: it carries the placeholder on its key, so validate and
// repair can restore it from the stored step. Contract change; QA sign-off needed (the old contract let NONE/null out unmarked).
test('scrubSecrets passes an empty value through, and puts the placeholder on every authorization key (bl-112), redacts everything else', async () => {
  const { scrubSecrets } = await import('../core/errors.mjs');
  const out = scrubSecrets({ attributes: { apiKey: '', authorization: { type: 'NONE', data: null } } });
  assert.deepEqual(out, { attributes: { apiKey: '', authorization: '<redacted>' } });
  const ctl = scrubSecrets({ attributes: { apiKey: 'sk-abc', authorization: { type: 'BEARER', data: 'x' }, password: ' ' } });
  assert.deepEqual(ctl, { attributes: { apiKey: '<redacted>', authorization: '<redacted>', password: '<redacted>' } });
});
