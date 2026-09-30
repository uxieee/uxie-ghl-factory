// Builder trigger rules the API does not enforce (measured on the sandbox 2026-09-30, own drafts, all stored with 200):
// unique-only triggers, per-workflow-kind trigger sets, deprecated string operators. Refuse the first (the editor cannot work with it),
// warn on the other two.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const mk = (extra = {}) => { const warnings = []; return { warnings, ctx: { loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('a'), catalog: loadCatalog(), warn: (w) => warnings.push(w), ...extra } }; };
const hook = (ref) => ({ ref, type: 'inbound_webhook', name: `hook ${ref}`, filters: [] });

test('two inbound_webhook triggers are refused (TRIGGER_UNIQUE_ONLY); one is fine; the hatch builds both', () => {
  assert.throws(() => compile({ name: 'W', triggers: [hook('a'), hook('b')], graph: [] }, mk().ctx), (e) => e.code === 'TRIGGER_UNIQUE_ONLY');
  assert.doesNotThrow(() => compile({ name: 'W', triggers: [hook('a')], graph: [] }, mk().ctx));
  assert.doesNotThrow(() => compile({ name: 'W', triggers: [hook('a'), hook('b')], graph: [] }, mk({ skipWorkflowRules: ['TRIGGER_UNIQUE_ONLY'] }).ctx));
});

test('a native contact trigger in a Company workflow warns (TRIGGER_KIND_MISMATCH); inbound_webhook and a contact workflow do not', () => {
  const a = mk(); compile({ name: 'W', workflowType: 'business', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }], graph: [] }, a.ctx);
  assert.ok(a.warnings.some((w) => /^TRIGGER_KIND_MISMATCH/.test(w) && /business/.test(w)), JSON.stringify(a.warnings));
  const b = mk(); compile({ name: 'W', workflowType: 'business', triggers: [hook('a')], graph: [] }, b.ctx);
  assert.equal(b.warnings.some((w) => /TRIGGER_KIND_MISMATCH/.test(w)), false);
  const c = mk(); compile({ name: 'W', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }], graph: [] }, c.ctx);
  assert.equal(c.warnings.some((w) => /TRIGGER_KIND_MISMATCH/.test(w)), false);
});

test('TRIGGER_KIND_MISMATCH is keyed to the Company workflowType values only: business and company warn, agent and other values (control) do not', () => {
  const native = [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }];
  for (const wt of ['business', 'company']) { const a = mk(); compile({ name: 'W', workflowType: wt, triggers: native, graph: [] }, a.ctx); assert.ok(a.warnings.some((w) => /^TRIGGER_KIND_MISMATCH/.test(w)), `${wt}: ${JSON.stringify(a.warnings)}`); }
  for (const wt of ['agent', 'contact', 'workflow', undefined]) { const a = mk(); compile({ name: 'W', workflowType: wt, triggers: native, graph: [] }, a.ctx); assert.equal(a.warnings.some((w) => /TRIGGER_KIND_MISMATCH/.test(w)), false, `${wt}: ${JSON.stringify(a.warnings)}`); }
});

test('a deprecated string operator on one of the 14 triggers warns (TRIGGER_OPERATOR_DEPRECATED); another trigger type does not', () => {
  const a = mk();
  try { compile({ name: 'W', triggers: [{ ref: 't', type: 'order_submission', name: 'T', filters: [{ field: 'x', operator: 'matches_intent', value: 'y' }] }], graph: [] }, a.ctx); } catch { /* the compile may refuse for other reasons; the advisory is raised first */ }
  assert.ok(a.warnings.some((w) => /^TRIGGER_OPERATOR_DEPRECATED/.test(w)), JSON.stringify(a.warnings));
  const b = mk();
  try { compile({ name: 'W', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [{ field: 'x', operator: 'matches_intent', value: 'y' }] }], graph: [] }, b.ctx); } catch { /* ignore */ }
  assert.equal(b.warnings.some((w) => /TRIGGER_OPERATOR_DEPRECATED/.test(w)), false);
});

test('a step or trigger name over 100 characters warns (NAME_LENGTH); 100 does not', () => {
  const tag = (name) => ({ ref: 'a', kind: 'action', type: 'add_contact_tag', name, attributes: { type: 'add_contact_tag', tags: ['x'] } });
  const long = mk(); compile({ name: 'W', triggers: [], graph: [tag('n'.repeat(101))] }, long.ctx);
  assert.ok(long.warnings.some((w) => /^NAME_LENGTH/.test(w) && /101 characters/.test(w)), JSON.stringify(long.warnings));
  const ok = mk(); compile({ name: 'W', triggers: [], graph: [tag('n'.repeat(100))] }, ok.ctx);
  assert.equal(ok.warnings.some((w) => /^NAME_LENGTH/.test(w)), false);
  const trig = mk(); compile({ name: 'W', triggers: [{ ref: 't', type: 'contact_tag', name: 'T'.repeat(101), filters: [] }], graph: [] }, trig.ctx);
  assert.ok(trig.warnings.some((w) => /^NAME_LENGTH: trigger/.test(w)), JSON.stringify(trig.warnings));
});

test('a wait keeps an authored windowCondition and specificTimeSecond (they used to be overwritten / dropped)', () => {
  const w = (attributes, extra = {}) => ({ name: 'W', triggers: [], graph: [{ ref: 'w', kind: 'wait', waitType: attributes.type, name: 'wait', attributes, ...extra }] });
  const a = mk(); const out = compile(w({ type: 'time', startAfter: { type: 'minutes', value: 1, when: 'after' }, windowCondition: { field: 'day_month', operator: '!=', value: '15' } }, { window: { condition: 'when', days: [1], start: '09:00', end: '17:00' } }), a.ctx);
  const wait = out.autoSaveBody.workflowData.templates.find((t) => t.type === 'wait');
  assert.deepEqual(wait.attributes.windowCondition, { field: 'day_month', operator: '!=', value: '15' });
  const d = mk(); const o2 = compile(w({ type: 'specific_date', specificDate: '2026-12-31', specificTimeHour: 9, specificTimeMinute: 0, specificTimePeriod: 'AM', specificTimeSecond: 30 }), d.ctx);
  assert.equal(o2.autoSaveBody.workflowData.templates.find((t) => t.type === 'wait').attributes.specificTimeSecond, 30);
  const dflt = mk(); const o3 = compile(w({ type: 'time', startAfter: { type: 'minutes', value: 1, when: 'after' } }, { window: { condition: 'when', days: [1], start: '09:00', end: '17:00' } }), dflt.ctx);
  assert.deepEqual(o3.autoSaveBody.workflowData.templates.find((t) => t.type === 'wait').attributes.windowCondition, { field: '', operator: '', value: '' });
});

test('an object-workflow step the location\'s asset index lists (find_object_record) is not refused as OBJECT_STEP; an unlisted native step still is', () => {
  const spec = (type, marketplace) => ({ name: 'W', customObjectType: 'custom_objects.x', triggers: [{ ref: 't', type: 'inbound_webhook', name: 'hook', filters: [] }],
    graph: [{ ref: 's', kind: 'action', type, ...(marketplace ? { marketplace: true } : {}), name: 'step', attributes: marketplace ? { filter_on: 'earliest' } : { type, tags: ['x'] } }] });
  const listed = mk(); listed.ctx.marketplace = { get: (k, kind) => (k === 'find_object_record' && kind === 'action' ? { key: k } : undefined), has: () => true };
  try { compile(spec('find_object_record', true), listed.ctx); } catch (e) { assert.notEqual(e.code, 'OBJECT_STEP', String(e.message)); }
  assert.throws(() => compile(spec('add_contact_tag', false), mk().ctx), (e) => e.code === 'OBJECT_STEP');
});
