// bl-340: update_form_data cannot write conditionalLogic. The raw whole-document POST writes it (forms f2, live
// 2026-11-09: a rule stored and read back on a separate request). The typed tool dropped it: the key was not in the
// input schema or the patch list, so the call either said "nothing to change" or wrote the document without the rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = () => TOOLS.find((t) => t.name === 'update_form_data');
const deps = (gw) => ({ state: { tokenFile: '/fixture/token.txt' }, makeGw: () => gw });

function formGateway(formData) {
  const calls = [];
  let current = { _id: 'F1', name: 'Opt-in', formData: structuredClone(formData) };
  const gw = {
    loc: 'LOC', uid: 'USER',
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (method === 'GET' && path === '/forms/F1') return { status: 200, ok: true, json: { form: structuredClone(current) } };
      if (method === 'POST' && path === '/forms/F1') {
        current = { ...current, name: body.name, formData: structuredClone(body.formData) };
        return { status: 201, ok: true, json: { data: structuredClone(current) } };
      }
      return { status: 404, ok: false, json: { message: `no fixture for ${method} ${path}` } };
    },
    readBackUntil: async (fn) => ({ hit: await fn(), attempts: 1 }),
  };
  return { gw, calls };
}

const rule = {
  id: 'cond-1', operation: 'isEqualTo', field: 'email', value: 'x@example.com',
  action: 'redirectToUrl', redirect_url: 'https://example.com/TEST-CONF',
};
const base = {
  form: {
    fields: [{ tag: 'first_name' }, { tag: 'email' }],
    formAction: { actionType: '2', thankyouText: 'TY', redirect_url: '' },
    conditionalLogic: [],
  },
};

test('a conditionalLogic rule passed to update_form_data is written under formData.form, not dropped', async () => {
  const { gw, calls } = formGateway(base);
  const r = await tool().handler({ locationId: 'LOC', formId: 'F1', conditionalLogic: [rule], confirm: true }, deps(gw));
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  const post = calls.find((c) => c.method === 'POST');
  assert.ok(post, 'a POST must be sent');
  assert.deepEqual(post.body.formData.form.conditionalLogic, [rule]);
});

test('the preview lists conditionalLogic as a change before any write', async () => {
  const { gw, calls } = formGateway(base);
  const r = await tool().handler({ locationId: 'LOC', formId: 'F1', conditionalLogic: [rule] }, deps(gw));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'CONFIRM_REQUIRED', JSON.stringify(r).slice(0, 300));
  assert.ok(r.data.preview.changes.some((c) => c.key === 'conditionalLogic'), JSON.stringify(r.data.preview.changes));
  assert.equal(calls.some((c) => c.method === 'POST'), false, 'a preview writes nothing');
});

test('the other form keys survive a conditionalLogic-only update', async () => {
  const { gw, calls } = formGateway(base);
  await tool().handler({ locationId: 'LOC', formId: 'F1', conditionalLogic: [rule], confirm: true }, deps(gw));
  const post = calls.find((c) => c.method === 'POST');
  assert.deepEqual(post.body.formData.form.fields, base.form.fields, 'fields are re-sent verbatim');
  assert.equal(post.body.formData.form.formAction.thankyouText, 'TY', 'formAction keys are kept');
});

test('a conditionalLogic-only update is not "nothing to change"', async () => {
  const { gw } = formGateway(base);
  const r = await tool().handler({ locationId: 'LOC', formId: 'F1', conditionalLogic: [rule], confirm: true }, deps(gw));
  assert.notEqual(r.code, 'VALIDATION_FAILED', JSON.stringify(r).slice(0, 200));
});

test('a conditionalLogic write is verified only when the read-back carries the rule (value for value)', async () => {
  const { gw } = formGateway(base);
  const r = await tool().handler({ locationId: 'LOC', formId: 'F1', conditionalLogic: [rule], confirm: true }, deps(gw));
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  assert.equal(r.data.verified, true);
});

test('GHL stores a rule redirect_url as redirectUrl, and the read-back still verifies it (live 2026-11-09, probe in knowledge sniffs live-f5b)', async () => {
  // The fixture stores what GHL stored in the live probe: the same rule with redirectUrl in place of redirect_url.
  const { gw } = formGateway(base);
  const realGw = gw.call;
  gw.call = async (method, path, body) => {
    const res = await realGw(method, path, body);
    if (method === 'POST' && path === '/forms/F1') {
      const stored = structuredClone(body);
      stored.formData.form.conditionalLogic = stored.formData.form.conditionalLogic.map(({ redirect_url, ...r }) => ({ ...r, redirectUrl: redirect_url }));
      return { ...res, json: { data: { ...res.json.data, formData: stored.formData } } };
    }
    return res;
  };
  const r = await tool().handler({ locationId: 'LOC', formId: 'F1', conditionalLogic: [rule], confirm: true }, deps(gw));
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  assert.equal(r.data.verified, true, 'the read-back must carry the rule value for value, under GHL\'s renamed key');
});
