// bl-950: GHL stores the form's redirect target as formAction.redirectUrl, but the write key is formAction.redirect_url (the tool
// doc says so). A caller who passes the stored name (redirectUrl) had it silently dropped on write (live 2026-11-09: verified:false,
// stored ""). The tool now maps redirectUrl to redirect_url on input, so the write carries the key GHL reads.
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
      if (method === 'POST' && path === '/forms/F1') { current = { ...current, name: body.name, formData: structuredClone(body.formData) }; return { status: 201, ok: true, json: { data: structuredClone(current) } }; }
      return { status: 404, ok: false, json: { message: `no fixture for ${method} ${path}` } };
    },
    readBackUntil: async (fn) => ({ hit: await fn(), attempts: 1 }),
  };
  return { gw, calls };
}
const base = { form: { fields: [{ tag: 'first_name' }], formAction: { actionType: '2', thankyouText: 'TY', redirectUrl: '' } } };

test('a redirectUrl passed in formAction is written as redirect_url, not dropped', async () => {
  const { gw, calls } = formGateway(base);
  const r = await tool().handler({ locationId: 'LOC', formId: 'F1', formAction: { actionType: '2', thankyouText: 'TY', redirectUrl: 'https://example.com/x' }, confirm: true }, deps(gw));
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.body.formData.form.formAction.redirect_url, 'https://example.com/x');
  assert.equal('redirectUrl' in post.body.formData.form.formAction, false, 'the camel key must not be sent');
  assert.equal(post.body.formData.form.formAction.thankyouText, 'TY', 'the other action keys are kept');
});

test('redirect_url, the documented key, is unchanged', async () => {
  const { gw, calls } = formGateway(base);
  await tool().handler({ locationId: 'LOC', formId: 'F1', formAction: { actionType: '2', redirect_url: 'https://example.com/y' }, confirm: true }, deps(gw));
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.body.formData.form.formAction.redirect_url, 'https://example.com/y');
});
