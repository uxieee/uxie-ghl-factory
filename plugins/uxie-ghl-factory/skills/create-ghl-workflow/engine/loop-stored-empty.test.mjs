// w6c-3 (QA fail #4, ruling 2026-11-07 "authoring refuses, preserving warns"): the rules layer and the tool entry for an empty Loop.
// REFUSE: an empty loop this write adds, or empties (build, edit, repair), and ANY empty loop on a publish of a draft (GHL's validator
// would 400 it; DECISION, QA's question on w6c-3). WARN and pass: a stored empty loop this write leaves as stored (same stepId, still
// empty) on edit and repair, drafts and already-published workflows alike. Export and lift never refuse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { evaluateWorkflowRules } from './graph-rules.mjs';
import { validateDocument } from './write-validation.mjs';
import { loadCatalog } from './catalog.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = (f) => join(HERE, '../../../../../../knowledge/sniffs/workflows-w6c-2026-11-06/fixtures', f);
const catalog = loadCatalog();
const rules = catalog.workflowRules;
const stored = JSON.parse(readFileSync(FIX('loop-list.json'), 'utf8')).templates;   // one loop, empty body, as GHL stores it
const trig = [{ id: 'trg', type: 'contact_tag', name: 'T', filters: [] }];
const blockingRules = (r) => (r.findings ?? []).map((f) => f.rule);
const warnedRules = (r) => (r.advisories ?? []).map((f) => f.rule);

test('rules: a stored empty loop this write leaves as stored passes with an advisory (not a finding)', () => {
  const r = evaluateWorkflowRules({ templates: stored, triggers: trig, storedEmptyLoopIds: new Set([stored[0].id]) }, rules);
  assert.ok(!blockingRules(r).includes('checkLoopHasBody'), 'not refused');
  assert.ok(warnedRules(r).includes('checkLoopHasBody'), 'warned');
});

test('rules: an empty loop this write adds (not stored) is refused', () => {
  const r = evaluateWorkflowRules({ templates: stored, triggers: trig, storedEmptyLoopIds: new Set() }, rules);
  assert.ok(blockingRules(r).includes('checkLoopHasBody'));
});

test('rules: a loop this write empties (was non-empty in the stored document) is refused', () => {
  // The stored loop had a body; the edit removed it. The loop's id is not in storedEmptyLoopIds (it was not empty when stored).
  const r = evaluateWorkflowRules({ templates: stored, triggers: trig, storedEmptyLoopIds: new Set() }, rules);
  assert.ok(blockingRules(r).includes('checkLoopHasBody'));
});

test('tool entry (edit): a stored empty loop the edit leaves as stored does not block (warns)', () => {
  const r = validateDocument({ intent: 'edit', templates: stored, triggers: trig, storedTemplates: stored, catalog });
  assert.equal(r.blocked, false, 'the edit is not blocked');
  assert.deepEqual(r.rules.findings.map((f) => f.rule), [], 'no rules finding');
  assert.ok(r.rules.advisories.some((f) => f.rule === 'checkLoopHasBody'), 'the warning is reported');
});

test('tool entry (repair): a stored empty loop does not block a repair (warns)', () => {
  const r = validateDocument({ intent: 'repair', templates: stored, triggers: trig, storedTemplates: stored, catalog });
  assert.equal(r.blocked, false);
  assert.ok(r.rules.advisories.some((f) => f.rule === 'checkLoopHasBody'));
});

test('tool entry (edit): an empty loop this write adds (no stored counterpart) blocks the edit', () => {
  const r = validateDocument({ intent: 'edit', templates: stored, triggers: trig, storedTemplates: [], catalog });
  assert.equal(r.blocked, true);
  assert.ok(r.rules.findings.some((f) => f.rule === 'checkLoopHasBody'));
});

// DECISION (orchestrator, QA's question on w6c-3, DECISIONS.md latest): publishing a draft refuses an empty loop offline, because GHL's
// validator would 400 it. Warn-and-pass is for edit and repair only (a draft or an already-published workflow).
test('tool entry (publish): a draft with a stored empty loop is refused on publish (GHL validator would 400 it)', () => {
  const r = validateDocument({ intent: 'publish', templates: stored, triggers: trig, status: 'draft', storedTemplates: stored, catalog });
  assert.equal(r.blocked, true, 'the publish is refused');
  assert.ok(r.rules.findings.some((f) => f.rule === 'checkLoopHasBody'), 'on the empty loop');
});

test('tool entry (edit of a published workflow): an untouched stored empty loop warns and passes; an added one refuses', () => {
  const kept = validateDocument({ intent: 'edit', templates: stored, triggers: trig, status: 'published', storedTemplates: stored, catalog });
  assert.equal(kept.publishing, true, 'the published edit is judged as a publish');
  assert.equal(kept.blocked, false);
  assert.ok(kept.rules.advisories.some((f) => f.rule === 'checkLoopHasBody'));
  const added = validateDocument({ intent: 'edit', templates: stored, triggers: trig, status: 'published', storedTemplates: [], catalog });
  assert.equal(added.blocked, true, 'a loop this edit adds refuses, published or not');
});
