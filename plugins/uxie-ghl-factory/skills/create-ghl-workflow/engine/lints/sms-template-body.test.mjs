import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintSmsTemplateBody } from './sms-template-body.mjs';

const sms = (attributes) => ({ id: 's', type: 'sms', name: 'S', attributes: { type: 'sms', ...attributes } });

test('a template plus a body warns (the runtime sends the template)', () => {
  const f = lintSmsTemplateBody([sms({ body: 'BODY-WINS', template_id: 'tpl1' })]);
  assert.equal(f.length, 1);
  assert.equal(f[0].code, 'SMS_TEMPLATE_OVERRIDES_BODY');
});

test('no template, the "none" sentinel, an empty body, or another type stay quiet', () => {
  assert.deepEqual(lintSmsTemplateBody([sms({ body: 'x' })]), []);
  assert.deepEqual(lintSmsTemplateBody([sms({ body: 'x', template_id: 'none' })]), []);
  assert.deepEqual(lintSmsTemplateBody([sms({ body: '', template_id: 'tpl1' })]), []);
  assert.deepEqual(lintSmsTemplateBody([{ id: 'e', type: 'email', attributes: { body: 'x', template_id: 'tpl1' } }]), []);
});

test('manual-sms warns too (its queued task carried the template text)', () => {
  assert.equal(lintSmsTemplateBody([{ id: 'm', type: 'manual-sms', name: 'M', attributes: { body: 'x', template_id: 'tpl1' } }]).length, 1);
});
