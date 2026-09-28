// Gaps the T1 draft-only trigger sweep found (live 2026-09-28, knowledge sniffs/workflows-wave1-2026-09-25/live-3BR-t1-trigger-drafts.json):
// custom_date_reminder was unauthorable (its `config` key refused by the IR allowlist), and the marketplace operator table
// refused the drawer's own defaults (multiselect is-any-of; numerical ==).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIR } from './ir.mjs';
import { loadCatalog } from './catalog.mjs';
import { marketplaceOperatorModel } from './compiler.mjs';

const table = loadCatalog().marketplaceFilterOperators;

test('custom_date_reminder may carry `config`; every other trigger type still refuses it', () => {
  assert.doesNotThrow(() => parseIR({ name: 'x', triggers: [{ ref: 't', type: 'custom_date_reminder', name: 'D', config: { field: 'F' }, filters: [] }], graph: [] }));
  assert.throws(() => parseIR({ name: 'x', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', config: { field: 'F' }, filters: [] }], graph: [] }),
    (e) => e.code === 'TRIGGER_KEY');
});

test('multiselect: the drawer menu is is-any-of / is-none-of / has_value / has_no_value and its default is-any-of', () => {
  const m = marketplaceOperatorModel({ filters: [{ field: 'message.type', fieldType: 'multiselect' }] }, 'message.type', table);
  assert.deepEqual(m.menu, ['is-any-of', 'is-none-of', 'has_value', 'has_no_value']);
  assert.equal(m.def, 'is-any-of');
});

test('multiselect array-to-array (asset flag, or a contact./business. field) offers contains-any', () => {
  const flagged = marketplaceOperatorModel({ filters: [{ field: 'tags', fieldType: 'multiselect', useArrayToArrayComparison: true }] }, 'tags', table);
  assert.equal(flagged.def, 'contains-any'); assert.ok(flagged.menu.includes('contains-any')); assert.ok(!flagged.menu.includes('is-any-of'));
  const cf = marketplaceOperatorModel({ filters: [{ field: 'contact.abc', fieldType: 'multiselect' }] }, 'contact.abc', table);
  assert.equal(cf.def, 'contains-any');
});

test('numerical has its own menu (== … between) with default ==, not the string menu', () => {
  const m = marketplaceOperatorModel({ filters: [{ field: 'duration', fieldType: 'numerical' }] }, 'duration', table);
  assert.equal(m.def, '=='); assert.ok(m.menu.includes('between')); assert.ok(!m.menu.includes('string-contains-any-of'));
});

test('an asset customOperators list wins, in its order; a malformed entry is ignored', () => {
  const m = marketplaceOperatorModel({ filters: [{ field: 'f', fieldType: 'string', customOperators: [{ value: '>', label: 'gt' }, null, { value: '<', label: 'lt' }] }] }, 'f', table);
  assert.deepEqual(m.menu, ['>', '<']); assert.equal(m.def, '>');
});

test('INTEGRATION_AI multiselect also offers array-contains-substring', () => {
  const m = marketplaceOperatorModel({ workflowsTriggerType: 'INTEGRATION_AI', filters: [{ field: 'x', fieldType: 'multiselect' }] }, 'x', table);
  assert.ok(m.menu.includes('array-contains-substring'));
});

// build_workflow's own refusal says "pass ignoreAssetErrors to build anyway" (orchestrate.mjs). The tool never declared or
// forwarded the hatch, so the advice could not be followed (T1 sweep, 2026-09-28).
test('build_workflow declares ignoreAssetErrors and forwards it to orchestrate (source contract)', async () => {
  const { readFileSync } = await import('node:fs');
  const tools = readFileSync(new URL('../../../mcp-internal/core/tools.mjs', import.meta.url), 'utf8');
  const build = tools.slice(tools.indexOf("name: 'build_workflow',"), tools.indexOf("const data = buildWorkflowData(report"));
  assert.match(build, /ignoreAssetErrors: z\.boolean\(\)\.default\(false\)/);
  assert.match(build, /ignoreAssetErrors: args\.ignoreAssetErrors === true/);
  const orch = readFileSync(new URL('./orchestrate.mjs', import.meta.url), 'utf8');
  assert.match(orch, /opts\.ignoreAssetErrors !== true/);
});
