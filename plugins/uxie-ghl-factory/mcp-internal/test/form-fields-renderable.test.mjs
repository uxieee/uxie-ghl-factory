// GHL stores form fields verbatim and the widget renders each by `type`. create_form (≤1.17.0) saved
// {label, tag} elements with no type: the live webinar registration page showed only its Register button,
// and GHL accepted the blank submit and created a contact with no name or email (knowledge sniffs
// funnels-wave23-form-fields-2026-09-29). These pin the completion, the refusal, and the differential
// against the released behaviour: the same input that used to be written verbatim is now written renderable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { renderableFields, blankSubmitWarning, STANDARD_ELEMENTS } from '../core/form-fields.mjs';
import { addressGroup, carries, ADDRESS_CHILDREN } from '../core/form-fields.mjs';

const tool = (n) => TOOLS.find((t) => t.name === n);
const deps = (gw) => ({ state: { tokenFile: '/fixture/token.txt' }, makeGw: () => gw });

// The W1 form exactly as create_form saved it on 2026-09-25.
const W1 = [{ label: 'First name', tag: 'first_name' }, { label: 'Email', tag: 'email' }, { label: 'Register', tag: 'button', type: 'submit' }];

function gateway(initial = { _id: 'F1', name: 'Opt-in', formData: { form: { fields: [] } } }) {
  const calls = [];
  let current = structuredClone(initial);
  return {
    calls,
    gw: {
      loc: 'LOC', uid: 'USER',
      call: async (method, path, body) => {
        calls.push({ method, path, body });
        if (method === 'POST' && path === '/forms/') return { status: 201, ok: true, json: { form: { _id: 'F1' } } };
        if (method === 'GET' && path === '/forms/F1') return { status: 200, ok: true, json: { form: structuredClone(current) } };
        if (method === 'POST' && path === '/forms/F1') { current = { ...current, name: body.name, formData: structuredClone(body.formData) }; return { status: 201, ok: true, json: {} }; }
        return { status: 404, ok: false, json: { message: `no fixture for ${method} ${path}` } };
      },
      readBackUntil: async (fn) => ({ hit: await fn(), attempts: 1 }),
    },
  };
}

test('built-in tags without type get the builder shape; an element with a type is left exactly as sent', () => {
  const { fields, filled, problems } = renderableFields(W1);
  assert.deepEqual(problems, []);
  assert.deepEqual(fields[0], { label: 'First name', tag: 'first_name', type: 'text', standard: true, hiddenFieldQueryKey: 'first_name' });
  assert.deepEqual(fields[1], { label: 'Email', tag: 'email', type: 'email', standard: true, hiddenFieldQueryKey: 'email', required: true });
  assert.deepEqual(fields[2], W1[2], 'the typed button is not touched');
  assert.deepEqual(filled.map((f) => f.tag), ['first_name', 'email']);
});

test('caller keys win over the builder defaults', () => {
  const { fields } = renderableFields([{ tag: 'email', label: 'E', required: false, hiddenFieldQueryKey: 'mail' }]);
  assert.equal(fields[0].required, false);
  assert.equal(fields[0].hiddenFieldQueryKey, 'mail');
  assert.equal(fields[0].type, 'email');
});

test('numbered elements get header_1, header_2 as the builder writes them', () => {
  const { fields } = renderableFields([{ tag: 'header', label: '<p>a</p>' }, { tag: 'header', label: '<p>b</p>' }]);
  assert.deepEqual(fields.map((f) => [f.type, f.hiddenFieldQueryKey]), [['h1', 'header_1'], ['h1', 'header_2']]);
});

test('a custom-field question without type, an unknown type, and select off country are refused by name', () => {
  const { problems } = renderableFields([
    { tag: 'cf123', label: 'Q' },
    { tag: 'first_name', type: 'textbox', label: 'x' },
    { tag: 'state', type: 'select', label: 'State' },
    { tag: 'country', type: 'select', label: 'Country' },
  ]);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /fields\[0\] \(tag cf123\) has no `type`/);
  assert.match(problems[1], /fields\[1\].*"textbox"/);
  assert.match(problems[2], /fields\[2\].*single_options/);
});

test('every built-in renderer is one the check accepts', () => {
  const { problems } = renderableFields(Object.entries(STANDARD_ELEMENTS).map(([tag, d]) => ({ tag, type: d.type, ...(d.type === 'img' ? { url: 'https://x.test/a.png' } : {}) })));
  assert.deepEqual(problems, []);
});

test('blank-submit warning: fires with no required input, silent once one is required', () => {
  assert.match(blankSubmitWarning([{ tag: 'first_name', type: 'text' }, { tag: 'button', type: 'submit' }]), /blank|empty/);
  assert.equal(blankSubmitWarning([{ tag: 'email', type: 'email', required: true }, { tag: 'button', type: 'submit' }]), null);
  assert.equal(blankSubmitWarning([{ tag: 'button', type: 'submit' }]), null, 'a button-only form has nothing to leave blank');
});

test('DIFFERENTIAL create_form: the W1 input is now SAVED renderable (released 1.17.0 saved it verbatim)', async () => {
  const { gw, calls } = gateway();
  const r = await tool('create_form').handler({ locationId: 'LOC', name: 'W1', fields: W1, confirm: true }, deps(gw));
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 400));
  const saved = calls.find((c) => c.method === 'POST' && c.path === '/forms/F1').body.formData.form.fields;
  assert.ok(saved.every((f) => f.type), 'every saved element has a renderer');
  assert.notDeepEqual(saved, W1, 'the saved document differs from the verbatim input the released tool wrote');
  assert.deepEqual(r.data.completed.map((c) => c.tag), ['first_name', 'email']);
  assert.equal(r.data.blankSubmit, undefined, 'email is completed as required, so no blank-submit warning');
});

test('create_form refuses an unrenderable field before any write', async () => {
  const { gw, calls } = gateway();
  const r = await tool('create_form').handler({ locationId: 'LOC', name: 'X', fields: [{ tag: 'cf123', label: 'Q' }], confirm: true }, deps(gw));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'VALIDATION_FAILED');
  assert.match(r.detail ?? r.message ?? JSON.stringify(r), /cf123/);
  assert.equal(calls.length, 0, 'nothing was sent');
});

test('create_form preview shows what was completed and warns on a blank-submittable form', async () => {
  const { gw } = gateway();
  const r = await tool('create_form').handler({ locationId: 'LOC', name: 'X', fields: [{ tag: 'first_name', label: 'F', type: 'text' }, { tag: 'button', type: 'submit', label: 'Go' }] }, deps(gw));
  assert.equal(r.code, 'CONFIRM_REQUIRED');
  assert.match(r.data.preview.blankSubmit, /empty contact|no name/);
});

test('DIFFERENTIAL update_form_data: the same W1 fields are written renderable and the rest of the document is kept', async () => {
  const { gw, calls } = gateway({ _id: 'F1', name: 'W1', formData: { form: { fields: W1, formAction: { actionType: '2' } } } });
  const r = await tool('update_form_data').handler({ locationId: 'LOC', formId: 'F1', fields: W1, confirm: true }, deps(gw));
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 400));
  const body = calls.find((c) => c.method === 'POST').body.formData.form;
  assert.ok(body.fields.every((f) => f.type));
  assert.deepEqual(body.formAction, { actionType: '2' });
  assert.deepEqual(r.data.completed.map((c) => c.tag), ['first_name', 'email']);
});

test('update_form_data refuses an unrenderable field before reading or writing', async () => {
  const { gw, calls } = gateway();
  const r = await tool('update_form_data').handler({ locationId: 'LOC', formId: 'F1', fields: [{ tag: 'city', type: 'select' }], confirm: true }, deps(gw));
  assert.equal(r.code, 'VALIDATION_FAILED');
  assert.equal(calls.length, 0);
});

// f3 (2026-09-29): the builder's own types (formBuilder src/util/methods.ts standardFields), not the corpus table's.
test('image, country and the address group complete to the builder\'s types', () => {
  const { fields, problems } = renderableFields([{ tag: 'image', url: 'https://x.test/a.png' }, { tag: 'country' }, { tag: 'group_address' }]);
  assert.deepEqual(problems, []);
  assert.deepEqual(fields.map((f) => f.type), ['img', 'select', 'group']);
  assert.equal(fields[2].hiddenFieldQueryKey, 'group_address', 'the builder writes group_address (wave43 capture), not addressId');
  assert.equal(fields[0].hiddenFieldQueryKey, 'image_1');
});

test('an image without a url, type "image" and type "group_address" are refused by name', () => {
  const { problems } = renderableFields([{ tag: 'image' }, { tag: 'image', type: 'image', url: 'u' }, { tag: 'group_address', type: 'group_address' }]);
  assert.equal(problems.length, 3);
  assert.match(problems.join(' '), /url/); assert.match(problems.join(' '), /img/); assert.match(problems.join(' '), /"group"/);
});

test('the builder\'s own large_text, phone, number and img renderers are accepted; score needs dataType SCORE', () => {
  const ok = renderableFields([{ tag: 'cf1', type: 'large_text' }, { tag: 'cf2', type: 'phone' }, { tag: 'cf3', type: 'number' }, { tag: 'cf4', type: 'score', dataType: 'SCORE' }]);
  assert.deepEqual(ok.problems, []);
  assert.match(renderableFields([{ tag: 'cf5', type: 'score' }]).problems.join(' '), /SCORE/);
});

test('an address group is saved the builder\'s way: children after it, settings in form.address, caller copies win', () => {
  const { fields, address } = addressGroup([{ tag: 'first_name' }, { tag: 'city', label: 'Town' }, { tag: 'group_address', type: 'group' }, { tag: 'email' }]);
  assert.deepEqual(fields.map((f) => f.tag), ['first_name', 'group_address', 'address', 'city', 'state', 'country', 'postal_code', 'email']);
  assert.equal(fields.find((f) => f.tag === 'city').label, 'Town');
  assert.equal(address.children.length, ADDRESS_CHILDREN.length);
  assert.equal(address.children.find((c) => c.tag === 'country').type, 'select');
  assert.deepEqual(addressGroup([{ tag: 'email' }]), { fields: [{ tag: 'email' }], address: null });
});

test('the read-back compares VALUES under GHL\'s stored names, not key presence', () => {
  assert.equal(carries({ formAction: { redirect_url: 'https://a' } }, { formAction: { redirectUrl: 'https://a', extra: 1 } }), true);
  assert.equal(carries({ formAction: { redirect_url: 'https://NEW' } }, { formAction: { redirectUrl: 'https://old' } }), false, 'a stale value fails');
  assert.equal(carries({ fields: [{ tag: 'a', label: 'New' }] }, { fields: [{ tag: 'a', label: 'Old' }] }), false, 'a label-only edit is compared');
  assert.equal(carries({ fields: [{ tag: 'a' }] }, { fields: [{ tag: 'a' }, { tag: 'b' }] }), false, 'an extra stored element fails');
});
