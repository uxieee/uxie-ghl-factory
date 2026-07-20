import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('README describes the workflow write tools truthfully', () => {
  assert.doesNotMatch(readme, /Status: Plan 4 internal surface/i);
  assert.match(readme, /\| `build_workflow` \|[^\n]*draft[^\n]*never publish/i);
  assert.match(readme, /\| `edit_workflow` \|[^\n]*preview[^\n]*confirm[^\n]*never publish/i);
  assert.match(readme, /\| `publish_workflow` \|[^\n]*preview[^\n]*confirm/i);
});

// This guard's PURPOSE is to stop the README claiming live proof it does not have.
// Originally it asserted the writes were "not been live-called". Task 5 ran on GROM AU
// 2026-07-21, so the claim flipped — and the guard flips with it: a live-proof claim is
// now only allowed if a dated write-tool ledger backs it up. The invariant is unchanged
// (never claim more than the evidence), only which side of it we are on.
test('any live-proof claim for the write tools is backed by a dated ledger', () => {
  const claimsLive = /LIVE-PROVEN/i.test(readme);
  if (!claimsLive) {
    assert.match(readme, /not been live-called/i,
      'without a live-proof claim the README must say the writes were not live-called');
    return;
  }
  assert.match(readme, /Live proof ledger — write tools \(Task 5\)/i, 'live claim needs its ledger');
  assert.match(readme, /\d{4}-\d{2}-\d{2}/, 'ledger must carry a date');
  assert.match(readme, /GROM AU/, 'ledger must name the account');
  // The write tools each need a ledger row, so the claim cannot outrun the evidence.
  for (const tool of ['build_workflow', 'edit_workflow', 'publish_workflow', 'fast_forward_contacts']) {
    assert.match(readme, new RegExp(`\\| \`?${tool}\``, 'i'), `${tool} needs a ledger row`);
  }
  assert.match(readme, /deleted afterwards|Cleanup/i, 'ledger must show canary cleanup');
});

test('the historical read-only ledger is preserved', () => {
  assert.match(readme, /Historical live proof ledger/i);
});
