// wave10: (a) MERGE_TAG_UNKNOWN names strictMergeTags:false as its remedy, and the hatch never reached the compile ctx through
// build_workflow (orchestrate.mjs) or edit_workflow — so the advice could not be followed (live 2026-09-28, knowledge
// sniffs/workflows-wave1-2026-09-25/live-3AG-opp-task-mergetags-run1-lint-refused-control.json). (b) The wording said "it will
// render literally"; measured, an unresolvable tag renders EMPTY in a contact-field value (live-3AG-opp-task-mergetags.json).
// (c) Ten invoice tags render the literal word "undefined" when unset (live-3AH-invoice-payment-mergetags.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { orchestrate } from './orchestrate.mjs';
import { evaluateMergeTags, checkMergeTags, INVOICE_UNDEFINED_TAGS } from './merge-tags.mjs';
import { loadCatalog } from './catalog.mjs';

const tpl = (value) => [{ id: 's1', type: 'update_contact_field', name: 'Render', attributes: { fields: [{ field: 'city', value }] } }];

test('the build path passes strictMergeTags / skipMergeTagCheck into the compile ctx (source contract)', () => {
  const src = readFileSync(new URL('./orchestrate.mjs', import.meta.url), 'utf8');
  const call = src.slice(src.indexOf('built = compile(ir, {'), src.indexOf('} catch (e) {', src.indexOf('built = compile(ir, {')));
  assert.match(call, /strictMergeTags:\s*opts\.strictMergeTags/);
  assert.match(call, /skipMergeTagCheck:\s*opts\.skipMergeTagCheck/);
  const tools = readFileSync(new URL('../../../mcp-internal/core/tools.mjs', import.meta.url), 'utf8');
  assert.equal((tools.match(/strictMergeTags: z\.boolean\(\)\.optional\(\)/g) ?? []).length, 2, 'build_workflow AND edit_workflow expose the hatch');
  assert.match(tools, /strictMergeTags: args\.strictMergeTags === false \? false : undefined/);
  assert.match(tools, /\.\.\.\(args\.strictMergeTags === false \? \{ strictMergeTags: false \} : \{\}\)/);
});

test('control: without the hatch an unknown per-location tag throws MERGE_TAG_UNKNOWN; with strictMergeTags:false it warns instead', () => {
  const catalog = loadCatalog(); const warns = [];
  const ctx = { customFields: [{ fieldKey: 'contact.real_field' }], warn: (m) => warns.push(m) };
  assert.throws(() => checkMergeTags(tpl('{{contact.zz_not_a_field}}'), catalog, ctx), /MERGE_TAG_UNKNOWN/);
  assert.doesNotThrow(() => checkMergeTags(tpl('{{contact.zz_not_a_field}}'), catalog, { ...ctx, strictMergeTags: false }));
  assert.ok(warns.some((w) => /^MERGE_TAG: /.test(w) && /contact\.zz_not_a_field/.test(w)));
  assert.deepEqual(checkMergeTags(tpl('{{contact.zz_not_a_field}}'), catalog, { ...ctx, skipMergeTagCheck: true }), []);
});

test('the build path honours strictMergeTags:false end to end (compile no longer aborts on the unknown tag)', async () => {
  // A gateway that answers every read empty and refuses every write: compile runs BEFORE any write, so a MERGE_TAG_UNKNOWN abort
  // shows as failurePhase 'compile'; with the hatch the run gets past compile (and then stops at the refused write).
  const gw = { uid: 'U', call: async (m) => (m === 'GET' ? { ok: true, status: 200, json: {} } : { ok: false, status: 599, json: { message: 'test gateway: no writes' } }) };
  const spec = { name: 'TEST-CONF-WF-wave10', triggers: [], graph: [{ ref: 'u', kind: 'action', type: 'update_contact_field', name: 'Render',
    attributes: { type: 'update_contact_field', actionType: 'update_field_data', fields: [{ field: 'city', title: 'City', type: 'string', date: '', value: '{{appointment.zz_not_a_tag}}' }] } }] };
  const strict = await orchestrate(spec, gw, {});
  assert.equal(strict.failurePhase, 'compile'); assert.match(String(strict.aborted), /MERGE_TAG_UNKNOWN/);
  const loose = await orchestrate(spec, gw, { strictMergeTags: false });
  assert.notEqual(loose.failurePhase, 'compile', String(loose.aborted));
  assert.ok(loose.warnings.some((w) => /appointment\.zz_not_a_tag/.test(w)));
});

test('wording states what was measured — no "render literally" claim remains', () => {
  const F = evaluateMergeTags(tpl('{{zzbogus.name}} {{appointment.zz_nope}}'), loadCatalog().mergeTags, {});
  assert.ok(F.length >= 2);
  for (const f of F) { assert.doesNotMatch(f.msg, /render(s)? literally/); assert.match(f.msg, /renders EMPTY/); }
  // every author-facing string (template literals) in the module: none may still promise a literal render
  const lits = readFileSync(new URL('./merge-tags.mjs', import.meta.url), 'utf8').match(/`[^`]*`/g) ?? [];
  assert.deepEqual(lits.filter((l) => /render(s|ed)? (as )?literal/i.test(l)), []);
});

test('invoice tags that render "undefined" warn when bare, not when wrapped in {{default}}; other invoice tags stay quiet', () => {
  assert.equal(INVOICE_UNDEFINED_TAGS.size, 10);
  const cat = loadCatalog().mergeTags;
  const bare = evaluateMergeTags(tpl('City: {{invoice.customer.city}} / {{ invoice.company.address }}'), cat, {}).filter((f) => f.kind === 'renders-undefined');
  assert.deepEqual(bare.map((f) => f.tag).sort(), ['{{invoice.company.address}}', '{{invoice.customer.city}}']);
  assert.ok(bare.every((f) => f.severity === 'warning' && /"undefined"/.test(f.msg) && /\{\{default invoice\./.test(f.msg)));
  assert.deepEqual(evaluateMergeTags(tpl('City: {{default invoice.customer.city ""}}'), cat, {}).filter((f) => f.kind === 'renders-undefined'), []);
  assert.deepEqual(evaluateMergeTags(tpl('{{invoice.company.phone}} {{invoice.total_amount}} {{payment.customer.city}}'), cat, {}).filter((f) => f.kind === 'renders-undefined'), []);
});
