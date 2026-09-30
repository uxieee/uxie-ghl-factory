// build_course: the course's credential TEMPLATE goes under spec.award (the key `credential` is refused by the secret guard, live 2026-09-30).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = TOOLS.find((t) => t.name === 'build_course');
const base = { course: { title: 'C' }, offer: { type: 'free', publish: true }, chapters: [{ title: 'Ch', dripDays: 0, lessons: [{ title: 'L', text: '<p>x</p>' }] }] };
const run = (spec) => tool.handler({ locationId: 'L', spec, confirm: false }, { state: {}, makeGw: () => { throw new Error('no gateway on a preview'); } });

test('award: builds a preview that names the credential template, under `award`', async () => {
  const r = await run({ ...base, award: { title: 'Onboarding Certificate', type: 'certificate' } });
  assert.equal(r.code, 'CONFIRM_REQUIRED');
  assert.equal(r.data.preview.valid, true);
  assert.deepEqual(r.data.preview.wouldCreate.award, { title: 'Onboarding Certificate', type: 'certificate' });
  assert.equal(r.data.preview.wouldCreate.counts.credentialTemplates, 1);
  assert.equal('credential' in r.data.preview.wouldCreate, false);
});

test('award: a badge template previews too, and a spec without award is unchanged', async () => {
  const b = await run({ ...base, award: { title: 'Badge', type: 'badge' } });
  assert.equal(b.data.preview.wouldCreate.award.type, 'badge');
  const n = await run(base);
  assert.equal(n.data.preview.wouldCreate.counts.credentialTemplates, 0);
  assert.equal('award' in n.data.preview.wouldCreate, false);
});

test('CONTROLS: credential: is still refused, and a secret-looking value under award is refused', async () => {
  const c = await run({ ...base, credential: { title: 'x', type: 'certificate' } });
  assert.equal(c.ok, false); assert.equal(c.code, 'VALIDATION_FAILED');
  const s = await run({ ...base, award: { title: 'Bearer abcdefghijklmnopqrstuvwxyz0123', type: 'badge' } });
  assert.equal(s.ok, false); assert.equal(s.code, 'VALIDATION_FAILED');
});
