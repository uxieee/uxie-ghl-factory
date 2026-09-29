// bl-336: the labelled-secret rule read the English word "session" as a credential label, so prose like
// "A page filter is per session: a session that touched the page" came back as "per session: <redacted> session…".
// A bare `session` now redacts only when the value after it is credential-shaped (16+ characters, no spaces).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubSecrets, containsSecrets } from '../core/errors.mjs';

const TOKEN32 = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6';

test('prose "per session: <word>" stays', () => {
  const note = 'A page filter is per session: a session that touched the page counts.';
  assert.equal(scrubSecrets(note), note);
  assert.equal(scrubSecrets('Session: abc123'), 'Session: abc123');
  assert.equal(scrubSecrets('one per session: yes'), 'one per session: yes');
  assert.equal(containsSecrets('per session: word'), false);
});

test('"session: <32-char token>" is redacted, in scrub and in the guard', () => {
  assert.equal(scrubSecrets(`session: ${TOKEN32}`), 'session: <redacted>');
  assert.equal(scrubSecrets(`Session=${TOKEN32}`), 'Session= <redacted>');
  assert.equal(containsSecrets(`session: ${TOKEN32}`), true);
});

test('session id / token / key / secret / cookie / credential labels redact whatever follows (short values too)', () => {
  for (const label of ['session id', 'session_id', 'sessionId', 'session token', 'sessionToken', 'session key', 'session secret', 'session cookie', 'session credentials']) {
    assert.equal(scrubSecrets(`${label}: abc`), `${label}: <redacted>`, label);
    assert.equal(containsSecrets(`${label}: abc`), true, `${label} guard`);
  }
});

test('the other labels are unchanged (control)', () => {
  assert.equal(scrubSecrets('token: abc'), 'token: <redacted>');
  assert.equal(scrubSecrets('password=hunter2'), 'password= <redacted>');
  assert.equal(scrubSecrets('cookie: sid=abc'), 'cookie: <redacted>');
});

test('a JSON KEY named session is still redacted by name (the key-name rule is separate)', () => {
  assert.deepEqual(scrubSecrets({ session: 'abc', note: 'per session: fine' }), { session: '<redacted>', note: 'per session: fine' });
});
