// A custom_webhook's no-auth object {type:"NONE", data:null} is not a credential; everything else under
// an `authorization` key is still refused (live 2026-09-28: the drawer's own default was refused).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containsSecrets } from '../core/errors.mjs';

test('authorization {type:"NONE", data:null} (and data absent) passes', () => {
  assert.equal(containsSecrets({ spec: { graph: [{ attributes: { authorization: { type: 'NONE', data: null } } }] } }), false);
  assert.equal(containsSecrets({ attributes: { authorization: { type: 'NONE' } } }), false);
});

test('any other authorization value is still refused (controls)', () => {
  for (const v of [{ type: 'BEARER', data: 'x' }, { type: 'NONE', data: 'x' }, { type: 'NONE', data: null, extra: 1 }, 'Bearer abc', { type: 'BASIC', data: { username: 'u', password: 'p' } }])
    assert.equal(containsSecrets({ attributes: { authorization: v } }), true, JSON.stringify(v));
});
