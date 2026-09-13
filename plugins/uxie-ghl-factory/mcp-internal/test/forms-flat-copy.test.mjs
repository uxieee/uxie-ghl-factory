// "Write both, trust neither." Some form documents carry FLAT fields/style/formAction beside `form`
// — a malformed save creates them, because the merge is at formData, one level above form. The
// widget renders `form` (proven live 2026-09-12), but a natively embedded funnel form was observed
// rendering the FLAT copy on one live page after a save that changed only `form` (2026-09-12,
// unreplicated, no /forms/data capture). Re-sending a stale flat copy verbatim is how that page kept
// its old styling after a "successful" save. So: when the flat keys already exist, keep them equal
// to `form`; never create them on a clean document.
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
const inner = (bg) => ({ fields: [{ tag: 'first_name' }], style: { background: bg }, formAction: { actionType: '1' } });

test('a document that already carries flat copies gets them kept equal to `form` on write', async () => {
  const { gw, calls } = formGateway({ form: inner('OLD'), ...inner('OLD'), language: 'en' });
  const r = await tool().handler({ locationId: 'LOC', formId: 'F1', style: { background: 'NEW' }, confirm: true }, deps(gw));
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.body.formData.form.style.background, 'NEW');
  assert.equal(post.body.formData.style.background, 'NEW', 'the flat copy must not be re-sent stale');
  assert.equal(post.body.formData.language, 'en', 'unrelated siblings are preserved');
});

test('a clean document (no flat copies) never gains them', async () => {
  const { gw, calls } = formGateway({ form: inner('OLD'), language: 'en' });
  await tool().handler({ locationId: 'LOC', formId: 'F1', style: { background: 'NEW' }, confirm: true }, deps(gw));
  const post = calls.find((c) => c.method === 'POST');
  assert.deepEqual(Object.keys(post.body.formData).sort(), ['form', 'language']);
});
