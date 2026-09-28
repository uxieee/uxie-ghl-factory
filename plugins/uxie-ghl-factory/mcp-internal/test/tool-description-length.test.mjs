import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

// Claude Code shows a model only the first 2048 characters of a tool description (TOOL-DESIGN.md). Anything past
// that is invisible, including traps and pointers to what the tool does not do. build_funnel_page had grown to 5095
// and edit_funnel to 3772 before anyone noticed (2026-09-29). Move detail into the skill references instead.
const LIMIT = 2048;

test('every tool description fits in the 2048 characters a client shows', () => {
  const over = TOOLS.filter((t) => t.description.length > LIMIT).map((t) => `${t.name} (${t.description.length})`);
  assert.deepEqual(over, [], `descriptions over ${LIMIT} chars: ${over.join(', ')}`);
});

test('CONTROL: the scan reads real descriptions', () => {
  assert.ok(TOOLS.length > 50, 'expected the full tool list');
  assert.ok(TOOLS.every((t) => typeof t.description === 'string' && t.description.length > 50));
});
