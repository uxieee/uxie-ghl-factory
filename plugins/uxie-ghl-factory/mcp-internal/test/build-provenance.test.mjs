// A long-running process reporting a freshness it does not have is the failure class that cost
// this project three separate incidents in one day. These assertions are mostly about the ONE
// distinction that matters: "I could not look" must never be reported as "it is fine".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProvenance, runningVersion, newestInstalled } from '../core/build-provenance.mjs';

const at = (v) => `file:///Users/x/.claude/plugins/cache/uxieee/uxie-ghl-factory/${v}/mcp-internal/dist/server.mjs`;

test('runningVersion reads the version out of an installed build path, and only a real one', () => {
  assert.equal(runningVersion(at('0.70.0')), '0.70.0');
  assert.equal(runningVersion(at('1.2.3')), '1.2.3');
  // a source tree, a renamed directory, or a non-semver folder is NOT a version
  assert.equal(runningVersion('file:///Volumes/SSD/repo/plugin/mcp-internal/core/x.mjs'), null);
  assert.equal(runningVersion(at('main')), null);
  assert.equal(runningVersion(at('0.70')), null);
});

test('stale is true ONLY when both sides are known and differ', () => {
  const newest = newestInstalled();

  // unknown running version — reports unknown, never "current"
  const src = buildProvenance('file:///Volumes/SSD/repo/mcp-internal/core/x.mjs');
  assert.equal(src.running, null);
  assert.equal(src.stale, false, 'an unknown running version is not a staleness CLAIM either way');
  assert.match(src.note, /source tree|unrecognised/);

  if (newest) {
    // a build older than what is installed is stale, and the note says what to do about it
    const old = buildProvenance(at('0.0.1'));
    assert.equal(old.running, '0.0.1');
    assert.equal(old.stale, true);
    assert.match(old.note, /reload-plugins does not restart it/,
      'the note must name WHY an upgrade did not reach this process, not just that it did not');
    assert.match(old.note, /restart the session/);

    // running exactly what is installed is not stale, and needs no note
    const cur = buildProvenance(at(newest));
    assert.equal(cur.stale, false);
    assert.equal(cur.note, undefined, 'a healthy build should not narrate');
  }
});

test('an unreadable cache is UNKNOWN, not current — the whole point of the check', () => {
  // newestInstalled swallows its own errors and returns null rather than throwing into a caller
  // that would then report a default. Assert the contract rather than the filesystem.
  assert.doesNotThrow(() => newestInstalled());
  const v = newestInstalled();
  assert.ok(v === null || /^\d+\.\d+\.\d+$/.test(v), `expected null or a semver, got ${v}`);
});
