// The stale-read window is real and silent: an agent exports a workflow, reasons about it, and
// commits ops minutes later against a document someone else has since edited. The PUT carries the
// whole templates array, so the other edit is simply gone and nothing reports it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCache, scrubUpstream } from '../core/read-cache.mjs';

const state = () => ({ tokenFile: join(mkdtempSync(join(tmpdir(), 'ghl-cache-')), 'tok.txt') });

test('a snapshot round-trips, and the file is 0600', () => {
  const c = readCache(state());
  assert.equal(c.read('LOC', 'WID'), null, 'no snapshot yet');
  assert.equal(c.write('LOC', 'WID', { version: 7, templates: [{ id: 's1' }] }), true);
  const back = c.read('LOC', 'WID');
  assert.equal(back.version, 7);
  assert.deepEqual(back.templates, [{ id: 's1' }]);
  const mode = statSync(c.pathFor('LOC', 'WID')).mode & 0o777;
  assert.equal(mode, 0o600, `cache file mode ${mode.toString(8)}`);
});

test('anything credential-shaped is redacted before it is written', () => {
  const c = readCache(state());
  c.write('LOC', 'WID', { version: 1, templates: [{ id: 's', attributes: { headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc' } } }] });
  const raw = readFileSync(c.pathFor('LOC', 'WID'), 'utf8');
  assert.ok(!/eyJhbGciOi/.test(raw), 'a bearer token must never reach the cache file');
  assert.match(raw, /<redacted>/);
});

test('scrubUpstream walks arrays and nested objects', () => {
  const out = scrubUpstream({ a: ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz', { b: 'Bearer eyJhbGciOiJIUzI1NiJ9.zzz' }] });
  assert.deepEqual(out, { a: ['<redacted>', { b: '<redacted>' }] });
});

test('GHL_READ_CACHE=0 disables it entirely, and every failure degrades to "no cache"', () => {
  const prev = process.env.GHL_READ_CACHE;
  process.env.GHL_READ_CACHE = '0';
  try {
    const c = readCache(state());
    assert.equal(c.enabled, false);
    assert.equal(c.write('LOC', 'WID', { version: 1 }), false);
    assert.equal(c.read('LOC', 'WID'), null);
  } finally { if (prev === undefined) delete process.env.GHL_READ_CACHE; else process.env.GHL_READ_CACHE = prev; }
  const broken = readCache({ tokenFile: '/proc/nonexistent/deep/tok.txt' });
  assert.equal(broken.write('LOC', 'WID', { version: 1 }), false, 'an unwritable root is not an error');
  assert.equal(broken.read('LOC', 'WID'), null);
});
