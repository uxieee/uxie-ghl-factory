import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('README labels the current work as Plan 3 and lists every workflow write tool truthfully', () => {
  assert.match(readme, /Status: Plan 3 internal surface/i);
  assert.doesNotMatch(readme, /Status: Plan 4 internal surface/i);
  assert.match(readme, /\| `build_workflow` \|[^\n]*draft[^\n]*never publish/i);
  assert.match(readme, /\| `edit_workflow` \|[^\n]*preview[^\n]*confirm[^\n]*never publish/i);
  assert.match(readme, /\| `publish_workflow` \|[^\n]*preview[^\n]*confirm/i);
  assert.match(readme, /Task 5[^\n]*human-gated/i);
  assert.match(readme, /not been live-called/i);
  assert.match(readme, /Historical live proof ledger/i);
});
