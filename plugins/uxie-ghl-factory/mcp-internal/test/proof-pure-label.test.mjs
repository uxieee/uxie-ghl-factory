// fn-4 (2026-11-08): compare_page_renders is a pure function (no account call), so its label is the seed's pure label. labelFor reads every
// passing run as a live proof, and syncLabels would then rewrite the label to "live-runtime (...)": the reading the seed exists to forbid.
// The tool is frozen at its pure label, like the other hand-labelled tools; its runs stay in the record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelFor, LABEL_FROZEN_TOOLS } from '../../../../scripts/lib/proof-record.mjs';
import { PURE_LABEL, syncLabels } from '../../../../scripts/proof.mjs';

const descriptions = { compare_page_renders: { description: `Compare a funnel page's three renders — proof: ${PURE_LABEL}; risk: read`, proof: PURE_LABEL } };
const rec = { tool: 'compare_page_renders', runs: [{ at: '2026-11-08', result: 'pass', how: 'suite', suite: 'render-scope', evidence: ['commit:21adc55f'] }] };

test('compare_page_renders is frozen at its pure label, so a passing run cannot turn it into a live proof', () => {
  assert.ok(LABEL_FROZEN_TOOLS.includes('compare_page_renders'));
  const { next, changed } = syncLabels(descriptions, { compare_page_renders: rec });
  assert.deepEqual(changed, []);
  assert.equal(next.compare_page_renders.proof, PURE_LABEL);
});

test('labelFor alone would read that passing run as live (the reason the freeze is needed)', () => {
  assert.match(labelFor(rec), /^live-runtime \(2026-11-08\)$/);
});
