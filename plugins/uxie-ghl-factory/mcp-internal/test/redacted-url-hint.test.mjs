import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refuseRedactedWrite } from '../core/raw-request-guards.mjs';

// The review found the refusal told the operator to re-enter a signed URL by hand, which is wrong: get_workflow
// returns the whole URL. A credential-named key IS unrecoverable, so its hint stays.
test('a write carrying a redacted signed-URL token is told to re-read the workflow, not re-enter by hand', () => {
  const r = refuseRedactedWrite({ steps: [{ id: 's1', type: 'email', previewUrl: 'https://storage.example/p.png?token=<redacted>' }] });
  assert.ok(r, 'the placeholder is refused');
  assert.match(r.hint, /get_workflow/);
  assert.match(r.hint, /re-read/i);
  assert.doesNotMatch(r.hint, /re-entered by hand in the builder — the real values cannot be read back/);
});

test('a credential-named placeholder keeps the unrecoverable hint', () => {
  const r = refuseRedactedWrite({ steps: [{ id: 's2', type: 'custom_webhook', attributes: { authorization: '<redacted>' } }] });
  assert.ok(r);
  assert.match(r.hint, /re-entered by hand/);
});
