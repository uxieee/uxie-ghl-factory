import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromHttp, CODES } from '../core/errors.mjs';

// W10 bl-877-adjacent (bl-730 family): GHL answers a stale-version write with a 422 whose body says the version is
// outdated. Before this, every 422 without "Action validation failed" was reported as VALIDATION_FAILED with "check
// required fields" advice, which sends the reader to fix a payload that is not wrong. The stale version is a version
// conflict: the advice is to re-read the workflow.
test('a 422 that says the version is outdated is a version conflict, not a validation failure', () => {
  const f = fromHttp(422, { statusCode: 422, message: 'Your version is outdated' });
  assert.equal(f.code, CODES.VERSION_CONFLICT);
  assert.match(f.remediation, /re-read/i);
});

test('the same outdated-version text in a plain string body is also a version conflict', () => {
  assert.equal(fromHttp(422, 'Your version is outdated').code, CODES.VERSION_CONFLICT);
});

test('an ordinary 422 keeps VALIDATION_FAILED', () => {
  assert.equal(fromHttp(422, { message: ['name should not be empty'] }).code, CODES.VALIDATION_FAILED);
});

test('the outdated-version text is a version conflict whatever the status (the review found a 400 misreported)', () => {
  assert.equal(fromHttp(400, { message: 'Your version is outdated' }).code, CODES.VERSION_CONFLICT);
});
