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
