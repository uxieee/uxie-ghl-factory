// fn-4 (2026-11-08), QA follow-up on fn-3r: build_funnel_page's publishState was computed before its own publish, so after a VERIFIED publish the
// result still said "This page is PINNED … NOT the draft this call just wrote". That reads as a warning that the publish did not take. The state
// is now derived by one pure function, and recomputed from the read-back after a verified publish. A publish that did not take still says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishStateOf } from '../core/page-publish-state.mjs';

const row = (version_id, pageType, seconds) => ({ version_id, pageType, updated_at: { _seconds: seconds } });

test('a page with no versions: never published, and the note says the public URL serves the draft', () => {
  const s = publishStateOf([]);
  assert.equal(s.pinned, false);
  assert.equal(s.draftsSincePublish, null);
  assert.match(s.servingNote, /has never been published/);
});

test('a pinned page with no publish in this call keeps the warning that the public URL serves the pinned version', () => {
  const s = publishStateOf([row('D2', 'draft', 200), row('L1', 'live', 100)]);
  assert.equal(s.pinned, true);
  assert.equal(s.draftsSincePublish, 1);
  assert.equal(s.staleBySeconds, 100);
  assert.match(s.servingNote, /PINNED.*NOT the draft this call just wrote/);
});

test('after a VERIFIED publish of this call, the note says the public URL serves the version it published, not the warning', () => {
  const s = publishStateOf([row('L1', 'live', 300), row('D0', 'draft', 100)], { justPublished: 'L1' });
  assert.equal(s.pinned, true);
  assert.equal(s.staleBySeconds, 0, 'the live version is the newest: nothing is stacked behind it');
  assert.doesNotMatch(s.servingNote, /NOT the draft/, 'a verified publish must not read as a warning');
  assert.match(s.servingNote, /Verified.*version L1/);
});

test('when this call published a version and the live one is NOT it, the publish did not take, and the note says the pinned version is served', () => {
  const s = publishStateOf([row('D2', 'draft', 300), row('L0', 'live', 100)], { justPublished: 'L1' });
  assert.match(s.servingNote, /PINNED.*NOT the draft/);
  assert.doesNotMatch(s.servingNote, /Verified/);
});
