import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactUrlTokens } from '../core/url-token-redact.mjs';

// bl-730, option (a) of the W10 ruling (2026-11-06): a signed URL's token is redacted only in the files export_workflow
// writes (writeTo), and in knowledge/sniffs. Tool results keep the URL whole: a raw_request PUT needs it.
test('a URL whose token parameter is replaced in an export file, the other parameters kept', () => {
  const out = redactUrlTokens({ fileUrl: 'https://storage.example/f/a.pdf?token=abcdef0123456789xyz0&X-Goog-Expires=3600' });
  assert.equal(out.fileUrl, 'https://storage.example/f/a.pdf?token=<redacted>&X-Goog-Expires=3600');
});

test('a URL without a token parameter is unchanged', () => {
  const url = 'https://storage.example/f/a.pdf?width=2&height=3';
  assert.deepEqual(redactUrlTokens({ fileUrl: url }), { fileUrl: url });
});

test('the signature parameters are redacted as well, case-insensitively for X-Amz-Signature', () => {
  const out = redactUrlTokens({ a: 'https://h/x?X-Amz-Signature=deadbeefcafe0123456789ab&sig=cafecafecafecafecafe1', b: 'https://h/y?access_token=abcdef0123456789xyz0' });
  assert.match(out.a, /X-Amz-Signature=<redacted>/);
  assert.match(out.a, /sig=<redacted>/);
  assert.match(out.b, /access_token=<redacted>/);
});

test('nested values are walked, and non-URL strings are left alone', () => {
  const out = redactUrlTokens({ steps: [{ fileUrl: 'https://h/z?token=abcdef0123456789xyz0' }], note: 'token=not-a-url', n: 4 });
  assert.match(out.steps[0].fileUrl, /token=<redacted>/);
  assert.equal(out.note, 'token=not-a-url');
  assert.equal(out.n, 4);
});

test('a signed URL embedded in a longer string (an HTML snippet) is redacted too', () => {
  const out = redactUrlTokens({ body: '<img src="https://storage.example/f.png?alt=media&token=0123456789abcdef0123">' });
  assert.match(out.body, /token=<redacted>"/);
});

test('a Google V4 signature parameter is redacted', () => {
  const out = redactUrlTokens({ u: 'https://storage.example/o?X-Goog-Signature=abcdef0123456789abcdef01' });
  assert.equal(out.u, 'https://storage.example/o?X-Goog-Signature=<redacted>');
});
