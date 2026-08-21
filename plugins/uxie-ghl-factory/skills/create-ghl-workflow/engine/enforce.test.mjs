import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compile } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';
import { fires, checkEnforcement } from './enforce.mjs';

// The acceptance criterion these tests encode (Xander, 2026-08-21): "every workflow that the
// engine makes is correct, and I will encounter no errors when they are in GHL already."
// So: shapes GHL would flag are REFUSED here; shapes GHL demonstrably stores and runs pass.
// Every exemption below is GHL's own, carried by the rule's AST — not special-cased in the engine.

const __dir = dirname(fileURLToPath(import.meta.url));
const ctx = (extra = {}) => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('a'), catalog: loadCatalog(), ...extra });
const wf = (graph) => ({ name: 'E', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }], graph });
const throws = (graph, re) => assert.throws(() => compile(wf(graph), ctx()), re ?? /ENFORCEMENT/);
const compiles = (graph, c) => compile(wf(graph), c ?? ctx());

// ── the cases that used to compile SILENTLY (findings F34) ────────────────────────────────
test('a bodyless email internal_notification is REFUSED, not defaulted to empty strings', () => {
  throws([{ ref: 'n', kind: 'action', type: 'internal_notification', name: 'N',
    attributes: { type: 'email' } }], /ENFORCEMENT.*email/s);
});

test('a user_replied wait without channel/repliedBy is REFUSED (GHL error-level)', () => {
  throws([{ ref: 'w', kind: 'wait', name: 'W', waitType: 'user_replied' }], /ENFORCEMENT.*(channel|repliedBy)/s);
});

test('a 0-minute unwindowed time wait is REFUSED', () => {
  throws([{ ref: 'w', kind: 'wait', name: 'W', config: { unit: 'minutes', value: 0, when: 'after' } }],
    /ENFORCEMENT.*startAfter\.value/s);
});

// ── GHL's own exemptions, carried by the ASTs — real shapes must keep compiling ───────────
test("GHL's windowed-zero-wait exemption holds: window present → value 0 is legal", () => {
  // 4 real published workflows hold windowed 0-minute waits; GHL's guard exempts them (!window && …).
  const built = compiles([{ ref: 'w', kind: 'wait', name: 'W',
    config: { unit: 'minutes', value: 0, when: 'after' },
    window: { condition: 'when', start: '09:00', end: '17:00', days: [1, 2, 3] } }]);
  const t = built.autoSaveBody.workflowData.templates.find((x) => x.type === 'wait');
  assert.equal(t.attributes.startAfter.value, 0);
});

test('template-mode email notification (template_id, no inline html) is legal', () => {
  // 3 real published Living-In-Idaho notifications; GHL's own validator misses this exemption and
  // wrongly warns on them — the outer chain (!email.template_id) carries it for us.
  compiles([{ ref: 'n', kind: 'action', type: 'internal_notification', name: 'N',
    attributes: { type: 'email', email: { subject: 's', template_id: '6a0790804b3943ec5b585679', templatesource: 'email-builder' } } }]);
});

test('remove_contact_tag with removeAll and no tags is legal (the early-return exemption)', () => {
  // 2 real published nodes; GHL's validator returns early on removeAll — captured as !(removeAll).
  compiles([{ ref: 'r', kind: 'action', type: 'remove_contact_tag', name: 'R',
    attributes: { tags: [], removeAll: true } }]);
});

test('sms requires body OR attachments — either alone satisfies', () => {
  throws([{ ref: 's', kind: 'action', type: 'sms', name: 'S', attributes: {} }], /ENFORCEMENT.*body/s);
  compiles([{ ref: 's', kind: 'action', type: 'sms', name: 'S', attributes: { body: 'hi' } }]);
  compiles([{ ref: 's', kind: 'action', type: 'sms', name: 'S', attributes: { attachments: ['https://x/y.png'] } }]);
});

test('custom_webhook: no url is REFUSED; url alone is completed by the engine\'s valid defaults', () => {
  // The compiler fills a complete envelope (event:'CUSTOM', method:'POST', JSON body) — so a
  // url-only authoring is VALID by construction, and only a missing url can survive to enforcement.
  throws([{ ref: 'h', kind: 'action', type: 'custom_webhook', name: 'H', attributes: {} }], /url/);
  const built = compiles([{ ref: 'h', kind: 'action', type: 'custom_webhook', name: 'H', attributes: { url: 'https://x' } }]);
  const t = built.autoSaveBody.workflowData.templates.find((x) => x.type === 'custom_webhook');
  assert.equal(t.attributes.method, 'POST');
  assert.equal(t.attributes.event, 'CUSTOM');
});

// ── the hatch: explicit, loud, and precise ────────────────────────────────────────────────
test('skipEnforcement: true bypasses; a targeted rule key bypasses only that rule', () => {
  const bad = [{ ref: 'n', kind: 'action', type: 'internal_notification', name: 'N', attributes: { type: 'email' } }];
  compile(wf(bad), ctx({ skipEnforcement: true }));                                        // full bypass
  compile(wf(bad), ctx({ skipEnforcement: [
    'internal_notification.email@email', 'internal_notification.email.subject@email', 'internal_notification.email.html@email'] }));
  assert.throws(() => compile(wf(bad), ctx({ skipEnforcement: ['internal_notification.email@email'] })), /ENFORCEMENT/);
});

// ── the permanent replay gate: every live capture must pass its type's rules ──────────────
test('every verified-live step-example passes enforcement (the corpus acid test, pinned)', () => {
  const dir = join(__dir, '../catalog/step-examples');
  const catalog = loadCatalog();
  const failures = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const n = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    // an empty capture vouches for nothing (voicemail/transition — flagged for re-harvest)
    if (!n?.attributes || !Object.keys(n.attributes).length) continue;
    const meta = catalog.step(n.type);
    if (!meta?.enforcement) continue;
    try { checkEnforcement({ ref: f }, n.attributes, meta, {}); }
    catch (e) { failures.push(`${f}: ${String(e.message).split('\n')[0]}`); }
  }
  assert.deepEqual(failures, [], 'a live capture tripping a rule means the rule (or its translation) is wrong');
});

// ── fires() semantics stay honest ─────────────────────────────────────────────────────────
test('fires() never treats an evaluation error as a violation', () => {
  assert.equal(fires({ ast: { guard: { op: 'nope' }, outer: [] } }, {}), false);
});

// ── the modifyStep bypass, closed at the commit point ─────────────────────────────────────
test('editCommitBody: a modifyStep patch that empties an sms body REFUSES; unwired/hatched callers unchanged', async () => {
  const { editCommitBody } = await import('./edit.mjs');
  const { applyOps } = await import('./edit-driver.mjs');
  const base = () => [
    { id: 's1', type: 'sms', name: 'S', attributes: { body: 'hello', type: 'sms' }, order: 0, next: null },
  ];
  let n = 0;
  const { templates, diff } = applyOps(base(), [{ op: 'modifyStep', stepId: 's1', attrPatch: { body: '' } }], { ctx: {}, idGen: () => `x${n++}` });
  assert.equal(templates[0].attributes.body, '');                       // the patch itself merges — that is modifyStep's contract
  const fresh = { status: 'draft', version: 1, workflowData: { templates: base() } };
  const catalog = loadCatalog();
  // wired caller: the emptied body is caught at commit
  assert.throws(() => editCommitBody(fresh, templates, diff, 'uid', { catalog }), /ENFORCEMENT.*body/s);
  // unwired caller (no catalog): exact prior behaviour — fail-open
  assert.doesNotThrow(() => editCommitBody(fresh, templates, diff, 'uid'));
  // hatch: full or targeted
  assert.doesNotThrow(() => editCommitBody(fresh, templates, diff, 'uid', { catalog, skipEnforcement: true }));
  assert.doesNotThrow(() => editCommitBody(fresh, templates, diff, 'uid', { catalog, skipEnforcement: ['sms.body'] }));
  // a pre-existing violation on an UNTOUCHED step does not block an unrelated edit
  const legacy = [
    { id: 'bad', type: 'sms', name: 'Old broken', attributes: { body: '', type: 'sms' }, order: 0, next: 's2' },
    { id: 's2', type: 'sms', name: 'Fine', attributes: { body: 'ok', type: 'sms' }, order: 1, next: null, parentKey: 'bad' },
  ];
  assert.doesNotThrow(() => editCommitBody({ status: 'draft', version: 1, workflowData: { templates: legacy } },
    legacy, { createdSteps: [], modifiedSteps: ['s2'], deletedSteps: [] }, 'uid', { catalog }));
});

// ── v2 rules: the wait error family + the advisory warn tier (2026-08-21 session 2) ───────
test('an UNCONFIGURED wait is REFUSED — GHL grades it error (isWaitStepUnconfigured)', () => {
  const catalog = loadCatalog();
  const meta = catalog.step('wait');
  // typeless: ONLY the new wait.type rule is in scope (every variant-scoped rule's outer is false)
  assert.throws(() => checkEnforcement({ ref: 'w' }, {}, meta, {}), /ENFORCEMENT.*'type'/s);
  // static time-wait with nothing set: the unconfigured rule AND the old startAfter rule both fire
  assert.throws(() => checkEnforcement({ ref: 'w' }, { type: 'time', timePeriodInputMode: 'static' }, meta, {}), /'type'[\s\S]*'startAfter'|'startAfter'[\s\S]*'type'/);
  checkEnforcement({ ref: 'w' }, { type: 'time', startAfter: { value: 5, unit: 'minutes' } }, meta, {});   // configured → clean
});

test('a wait name over 100 chars is REFUSED (isWithinLimits, GHL error-level)', () => {
  const meta = loadCatalog().step('wait');
  const base = { type: 'time', startAfter: { value: 5, unit: 'minutes' } };
  assert.throws(() => checkEnforcement({ ref: 'w' }, { ...base, name: 'x'.repeat(101) }, meta, {}), /ENFORCEMENT.*name/s);
  checkEnforcement({ ref: 'w' }, { ...base, name: 'x'.repeat(100) }, meta, {});
});

test('warn tier surfaces value-checks via ctx.warn and never blocks (webhook empty header row)', () => {
  const meta = loadCatalog().step('webhook');
  const warns = [];
  const ctx = { warn: (m) => warns.push(m) };
  const ok = { url: 'https://x', method: 'POST' };                       // a COMPLETE webhook (throw rules satisfied)
  checkEnforcement({ ref: 'h' }, { ...ok, headers: [{ key: '', value: 'v' }] }, meta, ctx);   // no throw
  assert.equal(warns.length, 1);
  assert.match(warns[0], /ENFORCEMENT_SOFT.*headers/s);
  warns.length = 0;
  checkEnforcement({ ref: 'h' }, { ...ok, headers: [{ key: 'k', value: 'v' }] }, meta, ctx);
  assert.deepEqual(warns, []);
});
