// The build path validates through six phases (orchestrate.mjs): dependency resolution,
// compile, workflow + graph-context rules, asset pre-flight, the custom-code sandbox, and
// round-trip verify with the persisted-required-field assertion. The edit path had grown most
// of that ladder piecemeal (resolver, compiler, workflow rules, schema check) but four layers
// never made it over — so an edit could point a step at a deleted user, write custom code that
// throws on its first run, or leave a builder-required field missing, and the tool reported ok.
//
// These tests pin the ported layers to the edit path's standing doctrine: network grows only
// for ops that can need the check, findings on untouched legacy steps demote to warnings,
// reporting layers fail open, and every refusal names its hatch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const editTool = () => TOOLS.find((candidate) => candidate.name === 'edit_workflow');

const AI_STEP = (over = {}) => ({
  id: 's1', type: 'conversationai_ai_message', name: 'Handover line', next: null,
  parent: null, parentKey: null, order: 0,
  attributes: { type: 'conversationai_ai_message', message: 'short', waitForReply: true },
  ...over,
});
const SMS_STEP = {
  id: 'sms1', type: 'sms', name: 'Nudge', next: null, parent: null, parentKey: null, order: 1,
  attributes: { type: 'sms', body: 'original' },
};
const CODE_STEP = {
  id: 'cc1', type: 'custom_code', name: 'Compute', next: null, parent: null, parentKey: null, order: 2,
  attributes: { type: 'custom_code', language: 'javascript', code: 'output = { a: 1 }', inputData: { x: '1' }, output: { a: 'sample' } },
};

const workflow = (templates) => ({
  _id: 'WID', id: 'WID', name: 'Flow', status: 'draft', version: 3,
  workflowData: { templates },
});

// The same fake gateway shape edit-workflow-schema-check.test.mjs uses, extended with the
// three endpoints the ported layers call. Each is configurable per test.
function gateway(templates, {
  assetVerdict = { errors: [], warnings: [] },
  sandbox = { output: { b: 2 }, hasError: false },
  phoneNumbers = [],
  dropOnPut = [],
} = {}) {
  const calls = [];
  let current = structuredClone(workflow(templates));
  const gw = {
    uid: 'UID',
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (method === 'POST' && path === '/workflow/LOC/validate-assets') {
        return { ok: true, status: 200, json: structuredClone(assetVerdict) };
      }
      if (method === 'POST' && path === '/workflow/custom-code/run-test') {
        return { ok: true, status: 200, json: structuredClone(sandbox) };
      }
      if (method === 'GET' && path.startsWith('/phone-system/numbers')) {
        return { ok: true, status: 200, json: { phoneNumbers: structuredClone(phoneNumbers) } };
      }
      if (method === 'GET' && path.includes('/workflows-marketplace/')) {
        return { ok: true, status: 200, json: { actions: [], triggers: [] } };
      }
      if (method === 'GET' && path.startsWith('/workflow/LOC/WID')) return { ok: true, status: 200, json: structuredClone(current) };
      if (method === 'GET' && path.includes('/customFields/search')) return { ok: true, status: 200, json: { customFields: [] } };
      if (method === 'GET' && path.includes('/customValues')) return { ok: true, status: 200, json: { customValues: [] } };
      if (method === 'GET' && path.includes('/tags')) return { ok: true, status: 200, json: { tags: [] } };
      if (method === 'GET' && path.includes('/trigger')) return { ok: true, status: 200, json: { triggers: [] } };
      if (method === 'PUT' && path === '/workflow/LOC/WID') {
        const stored = structuredClone(body);
        // Simulate the server silently dropping named attribute keys — the class the persisted
        // required-field check exists for (the key never survives, so no echo can carry it).
        for (const t of stored.workflowData?.templates ?? []) {
          for (const key of dropOnPut) delete t.attributes?.[key];
        }
        current = { ...current, ...stored, workflowData: stored.workflowData ?? current.workflowData };
        return { ok: true, status: 200, json: structuredClone(current) };
      }
      return { ok: true, status: 200, json: {} };
    },
    stored: () => current,
  };
  return { gw, calls };
}
const deps = (gw) => ({ makeGw: () => gw, state: {} });
const run = (gw, extra = {}) => editTool().handler(
  { locationId: 'LOC', workflowId: 'WID', acknowledgeDrift: true, ...extra }, deps(gw));

// ── Asset pre-flight ──────────────────────────────────────────────────────────────────────

const USER_GONE = (stepId) => ({
  ruleId: 'ASSET_USER_NOT_FOUND', assetType: 'user', assetId: 'u1',
  message: 'user not found', severity: 'error', stepId, stepName: null, stepType: null,
});

test('an asset error on a step this edit touched refuses the edit, naming ignoreAssetErrors', async () => {
  const { gw, calls } = gateway([AI_STEP()], { assetVerdict: { errors: [USER_GONE('s1')], warnings: [] } });
  const result = await run(gw, { confirm: true, ops: [{ op: 'modifyStep', stepId: 's1', attrPatch: { message: 'new' } }] });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'VALIDATION_FAILED');
  assert.match(result.detail, /user not found/);
  assert.match(result.remediation, /ignoreAssetErrors/);
  assert.deepEqual(calls.filter((c) => c.method === 'PUT'), [], 'refused before any write');
});

test('ignoreAssetErrors is the hatch: the same edit writes, with the verdict carried in data', async () => {
  const { gw } = gateway([AI_STEP()], { assetVerdict: { errors: [USER_GONE('s1')], warnings: [] } });
  const result = await run(gw, { confirm: true, ignoreAssetErrors: true, ops: [{ op: 'modifyStep', stepId: 's1', attrPatch: { message: 'new' } }] });

  assert.equal(result.ok, true);
  assert.equal(result.data.assetPreflight.errors.length, 1);
});

test('an asset error on an UNTOUCHED step is legacy debt: it warns and does not block', async () => {
  const { gw } = gateway([AI_STEP(), SMS_STEP], { assetVerdict: { errors: [USER_GONE('sms1')], warnings: [] } });
  const result = await run(gw, { confirm: true, ops: [{ op: 'modifyStep', stepId: 's1', attrPatch: { message: 'new' } }] });

  assert.equal(result.ok, true, 'someone else\'s broken reference must not fail this caller\'s edit');
  assert.ok(result.data.warnings.some((w) => /pre-existing, untouched/.test(w)));
});

test('a graph-only op does not POST validate-assets — the network shape is a pinned contract', async () => {
  const { gw, calls } = gateway([AI_STEP()]);
  await run(gw, { confirm: true, ops: [{ op: 'renameStep', stepId: 's1', name: 'Renamed' }] });
  assert.deepEqual(calls.filter((c) => c.path === '/workflow/LOC/validate-assets'), []);
});

// ── Custom-code sandbox pre-flight ────────────────────────────────────────────────────────

test('a touched custom_code step runs in the sandbox and the REAL output reaches the PUT', async () => {
  const { gw, calls } = gateway([CODE_STEP], { sandbox: { output: { b: 2 }, hasError: false } });
  const result = await run(gw, { confirm: true, ops: [{ op: 'modifyStep', stepId: 'cc1', attrPatch: { code: 'output = { b: 2 }' } }] });

  assert.equal(result.ok, true);
  assert.equal(calls.filter((c) => c.path === '/workflow/custom-code/run-test').length, 1);
  const stored = gw.stored().workflowData.templates.find((t) => t.id === 'cc1');
  assert.deepEqual(stored.attributes.output, { b: 2 }, 'the authored sample was replaced by the sandbox result');
  assert.equal(result.data.customCodeTests[0].replacedOutput, true);
  assert.ok(result.data.warnings.some((w) => /output keys differ/.test(w)), 'the key drift is named');
});

test('a failing sandbox run warns and keeps the authored sample; strictCustomCode refuses instead', async () => {
  const failing = { sandbox: { hasError: true, errorMessage: 'boom' } };
  const modify = { op: 'modifyStep', stepId: 'cc1', attrPatch: { code: 'throw new Error("boom")' } };

  const lax = await run(gateway([CODE_STEP], failing).gw, { confirm: true, ops: [modify] });
  assert.equal(lax.ok, true);
  assert.ok(lax.data.warnings.some((w) => /sandbox test did not pass \(boom\)/.test(w)));
  assert.deepEqual(lax.data.customCodeTests[0].outputKeys, []);

  const { gw, calls } = gateway([CODE_STEP], failing);
  const strict = await run(gw, { confirm: true, strictCustomCode: true, ops: [modify] });
  assert.equal(strict.ok, false);
  assert.equal(strict.code, 'ENGINE_ABORT');
  assert.match(strict.detail, /boom/);
  assert.deepEqual(calls.filter((c) => c.method === 'PUT'), [], 'refused before any write');
});

test('the sandbox is scoped to steps THIS edit touched, and skipCustomCodeTest skips it', async () => {
  // s1 is edited; the untouched cc1 must not be re-run (a pass would silently rewrite its output).
  const { gw, calls } = gateway([AI_STEP(), CODE_STEP]);
  await run(gw, { confirm: true, ops: [{ op: 'modifyStep', stepId: 's1', attrPatch: { message: 'new' } }] });
  assert.deepEqual(calls.filter((c) => c.path === '/workflow/custom-code/run-test'), []);

  const skipped = gateway([CODE_STEP]);
  await run(skipped.gw, { confirm: true, skipCustomCodeTest: true, ops: [{ op: 'modifyStep', stepId: 'cc1', attrPatch: { code: 'output = {}' } }] });
  assert.deepEqual(skipped.calls.filter((c) => c.path === '/workflow/custom-code/run-test'), []);
});

// ── Account readiness ─────────────────────────────────────────────────────────────────────

test('editing an SMS step on a location with no number warns, advisorily', async () => {
  const { gw } = gateway([SMS_STEP], { phoneNumbers: [] });
  const result = await run(gw, { confirm: true, ops: [{ op: 'modifyStep', stepId: 'sms1', attrPatch: { body: 'hi' } }] });

  assert.equal(result.ok, true, 'readiness never blocks — the account can be fixed after the edit');
  const sms = result.data.readiness.find((c) => c.key === 'sms_number');
  assert.equal(sms.ok, false);
  assert.ok(result.data.warnings.some((w) => /readiness: NO SMS number/.test(w)));
});

test('readiness reads run only when a touched step needs them', async () => {
  const { gw, calls } = gateway([AI_STEP(), SMS_STEP]);
  await run(gw, { confirm: true, ops: [{ op: 'modifyStep', stepId: 's1', attrPatch: { message: 'new' } }] });
  assert.deepEqual(calls.filter((c) => c.path.startsWith('/phone-system/')), [],
    'the untouched legacy SMS step must not make an unrelated edit fetch phone-system state');
});

// ── Persisted required fields (round-trip verify) ─────────────────────────────────────────

test('a builder-required field the server DROPS is named in verify.missingRequired', async () => {
  // The authored side cannot produce this case any more — modifyStep re-normalises through the
  // compiler, which defaults waitForReply — so the remaining class is the build path's original
  // one: the server accepts the PUT and stores the step WITHOUT the key. Round-trip sees a
  // dropped attribute; missingRequired says WHY it matters (red badge, publish block).
  const { gw } = gateway([AI_STEP()], { dropOnPut: ['waitForReply'] });
  const result = await run(gw, { confirm: true, ops: [{ op: 'modifyStep', stepId: 's1', attrPatch: { message: 'new' } }] });

  assert.equal(result.ok, false, 'a dropped attribute already fails the round-trip');
  assert.deepEqual(result.data.verify.missingRequired, [
    { id: 's1', name: 'Handover line', type: 'conversationai_ai_message', missing: ['waitForReply'] },
  ]);
  assert.ok(result.data.warnings.some((w) => /red error badge/.test(w)));
});

// ── Graph-context rules ───────────────────────────────────────────────────────────────────

test('a goto with a step after it warns, exactly as the build path would', async () => {
  const templates = [
    { id: 'p', type: 'add_contact_tag', name: 'Tag', next: 'g', parent: null, parentKey: null, order: 0,
      attributes: { type: 'add_contact_tag', tags: ['x'] } },
    { id: 'g', type: 'goto', name: 'Jump', next: 'x', parent: null, parentKey: null, order: 1,
      attributes: { type: 'goto', targetNodeId: 'x' } },
    { id: 'x', type: 'add_contact_tag', name: 'After', next: null, parent: null, parentKey: null, order: 2,
      attributes: { type: 'add_contact_tag', tags: ['y'] } },
  ];
  const { gw } = gateway(templates);
  const result = await run(gw, { confirm: true, allowGotoLoops: true, ops: [{ op: 'renameStep', stepId: 'x', name: 'Renamed' }] });

  assert.equal(result.ok, true, 'warning-severity in GHL, so it warns and never blocks');
  assert.ok(result.data.warnings.some((w) => /goto/.test(w) && /unreachable/.test(w)));
});

// ── Preview parity ────────────────────────────────────────────────────────────────────────

test('the preview already carries the pre-flight verdicts, before anything is written', async () => {
  const { gw, calls } = gateway([CODE_STEP], {
    assetVerdict: { errors: [], warnings: [USER_GONE('cc1')] },
    sandbox: { output: { b: 2 }, hasError: false },
  });
  const result = await run(gw, { ops: [{ op: 'modifyStep', stepId: 'cc1', attrPatch: { code: 'output = { b: 2 }' } }] });

  assert.equal(result.code, 'CONFIRM_REQUIRED');
  assert.equal(result.data.preview.assetPreflight.warnings.length, 1);
  assert.equal(result.data.preview.customCodeTests.length, 1);
  assert.deepEqual(calls.filter((c) => c.method === 'PUT'), [], 'the preview wrote nothing');
});

// ── Backlog 3 + 4 (R-96): the pre-flight is named as PRE-write, and re-run POST-write ────────
// Eight trigger re-points on one account reported ok while the asset pre-flight kept naming the
// OLD reference on every call. It was right every time — the write had not landed — and was
// read as a stale cache and hatched past with ignoreAssetErrors. Two guards: the verdict says
// which document it describes, and a hatch that would suppress an error on the very id the edit
// is replacing is refused.
test('a hatched write re-runs the reference validator on the PERSISTED document and names an error that survived', async () => {
  const { gw, calls } = gateway([AI_STEP()], { assetVerdict: { errors: [USER_GONE('s1')], warnings: [] } });
  const result = await run(gw, { confirm: true, ignoreAssetErrors: true, ops: [{ op: 'modifyStep', stepId: 's1', attrPatch: { message: 'new' } }] });
  assert.equal(result.ok, true);
  assert.equal(result.data.assetPreflight.phase, 'pre-write');
  assert.equal(result.data.verify.assetPreflightAfter.phase, 'post-write');
  assert.equal(result.data.verify.assetPreflightAfter.persisting.length, 1);
  assert.ok(result.data.warnings.some((w) => /^ASSET_ERROR_PERSISTS_AFTER_WRITE/.test(w) && /user not found/.test(w)), result.data.warnings.join('\n'));
  assert.equal(calls.filter((c) => c.path === '/workflow/LOC/validate-assets').length, 2, 'once before the write, once over the stored document');
});

test('ignoreAssetErrors is REFUSED when the flagged asset id is one this edit is replacing — the error IS the failed re-point', async () => {
  const step = AI_STEP({ attributes: { type: 'conversationai_ai_message', message: 'assign to u1 please', waitForReply: true } });
  const { gw, calls } = gateway([step], { assetVerdict: { errors: [USER_GONE('s1')], warnings: [] } });
  const result = await run(gw, {
    confirm: true, ignoreAssetErrors: true,
    ops: [{ op: 'replaceInAttributes', type: 'conversationai_ai_message', path: 'message', find: 'u1', replace: 'u2' }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'VALIDATION_FAILED');
  assert.match(result.detail, /ignoreAssetErrors refused/);
  assert.match(result.detail, /REPLACING/);
  assert.match(result.remediation, /R-96/);
  assert.deepEqual(calls.filter((c) => c.method === 'PUT'), [], 'nothing written');
});

test('the refusal wording for a plain asset error names the phase and the hatch risk', async () => {
  const { gw } = gateway([AI_STEP()], { assetVerdict: { errors: [USER_GONE('s1')], warnings: [] } });
  const result = await run(gw, { confirm: true, ops: [{ op: 'modifyStep', stepId: 's1', attrPatch: { message: 'new' } }] });
  assert.equal(result.ok, false);
  assert.match(result.remediation, /pre-write/);
  assert.match(result.remediation, /hides a failed re-point/);
});

// ── Backlog 15 + 25: measured field caps are REFUSED before the write, and named on the card ──
// A 550-char promptInstructions, 640-char splitter description and 640-char ai_message each
// committed with `verify.roundTrip: true`; only `schemaViolations` said anything, and it was not
// read. The four measured caps now refuse on a touched step (hatch: allowOverCap), every schema
// violation also lands in `warnings`, and describe_step_type carries the caps.
test('an over-cap value on a touched step is refused before any write, naming the cap and allowOverCap', async () => {
  const { gw, calls } = gateway([AI_STEP()]);
  const result = await run(gw, { confirm: true, ops: [{ op: 'modifyStep', stepId: 's1', attrPatch: { message: 'm'.repeat(601) } }] });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'VALIDATION_FAILED');
  assert.match(result.detail, /601 characters; the builder's cap is 600/);
  assert.match(result.remediation, /allowOverCap/);
  assert.equal(result.data.fieldCaps[0].field, 'message');
  assert.deepEqual(calls.filter((c) => c.method === 'PUT'), [], 'nothing written');
});

test('allowOverCap writes the value and keeps a FIELD_CAP warning; an untouched over-cap step is not this caller\'s debt', async () => {
  const { gw } = gateway([AI_STEP()]);
  const hatched = await run(gw, { confirm: true, allowOverCap: true, ops: [{ op: 'modifyStep', stepId: 's1', attrPatch: { message: 'm'.repeat(601) } }] });
  assert.equal(hatched.ok, true, JSON.stringify(hatched));
  assert.ok(hatched.data.warnings.some((w) => /^FIELD_CAP \(allowOverCap\)/.test(w)), hatched.data.warnings.join('\n'));
  const long = AI_STEP({ attributes: { type: 'conversationai_ai_message', message: 'm'.repeat(700), waitForReply: true } });
  const other = await run(gateway([long, SMS_STEP]).gw, { confirm: true, ops: [{ op: 'modifyStep', stepId: 'sms1', attrPatch: { body: 'new' } }] });
  assert.equal(other.ok, true, JSON.stringify(other));
});

test('describe_step_type carries the measured caps for the four flow-bot types', async () => {
  const describe = TOOLS.find((t) => t.name === 'describe_step_type');
  const r = await describe.handler({ type: 'conversationai_book_appointment' }, deps({}));
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.caps, { promptInstructions: 500 });
  assert.match(r.data.capsNote, /allowOverCap/);
  const sms = await describe.handler({ type: 'sms' }, deps({}));
  assert.equal(sms.ok, true);
  assert.equal(sms.data.caps, undefined, 'no measured cap → no caps key');
});
