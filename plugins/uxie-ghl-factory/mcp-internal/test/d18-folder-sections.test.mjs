import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepResidue, submissionsSection, safeDetail, SweepAbort } from '../../skills/ghl-forms/scripts/d18-folder-sections.mjs';

const form = (i, name) => ({ id: `form${i}`, name: name ?? `Plain form ${i}` });
const mkCall = ({ forms = [], folders = [], total, formsAlwaysFull = false } = {}) => {
  const calls = [];
  const call = async (name, a) => {
    calls.push([name, a]);
    if (name === 'list_forms') {
      if (formsAlwaysFull) return { ok: true, data: { forms: Array.from({ length: a.limit }, (_, i) => form(`${a.skip}-${i}`)), total: 1e6 } };
      const slice = forms.slice(a.skip, a.skip + a.limit);
      return { ok: true, data: { forms: slice, total: total ?? forms.length } };
    }
    if (name === 'create_custom_field_folder') return { ok: false, code: 'CONFIRM_REQUIRED', data: { preview: { existingFolders: folders } } };
    throw new Error(`unexpected ${name}`);
  };
  return { call, calls };
};
const run = (c, over = {}) => sweepResidue({ call: c.call, locationId: 'LOC', stamp: '1', expectedForms: new Set(['formR']), expectedFolders: new Set(['foldR']), incidentStamps: ['111111', '222222'], ...over });
const base = () => ({ forms: [form('R', 'TEST-CONF-W9-FORMS-FORM-111'), form(1)], folders: [{ id: 'foldR', name: 'TEST-CONF-D18F-FOLDER-777' }] });

test('sweep passes when only the recorded objects match; other W9 forms objects are not strays', async () => {
  const c = mkCall({ forms: [{ id: 'formR', name: 'TEST-CONF-D18F-FORM-777' }, { id: 'other', name: 'TEST-CONF-W9-FORMS-FORM-OTHER' }, form(1)], folders: [{ id: 'foldR', name: 'TEST-CONF-D18F-FOLDER-777' }] });
  const out = await run(c); assert.equal(out.forms, 3);
  assert.ok(c.calls.every(([n, a]) => n === 'list_forms' || (n === 'create_custom_field_folder' && a.confirm === undefined)), 'only reads: list_forms and an unconfirmed preview');
});
test('a stray D18F form, a stray W9-FORMS-FOLDER folder, or a missing recorded id aborts', async () => {
  await assert.rejects(run(mkCall({ forms: [{ id: 'formR', name: 'x' }, { id: 'stray', name: 'TEST-CONF-D18F-FORM-999' }], folders: [{ id: 'foldR', name: 'f' }] })), SweepAbort);
  await assert.rejects(run(mkCall({ forms: [{ id: 'formR', name: 'x' }], folders: [{ id: 'foldR', name: 'f' }, { id: 'sf', name: 'TEST-CONF-W9-FORMS-FOLDER2-5' }] })), SweepAbort);
  await assert.rejects(run(mkCall({ forms: [], folders: [{ id: 'foldR', name: 'f' }] })), /missing/);
});
test('an object carrying either incident stamp aborts, even with an unrelated name prefix', async () => {
  for (const st of ['111111', '222222']) await assert.rejects(run(mkCall({ forms: [{ id: 'formR', name: 'x' }, { id: 'q', name: `anything-${st}` }], folders: [{ id: 'foldR', name: 'f' }] })), /incident stamp/);
});
test('F2: the forms listing is paged to its end (250 rows = 3 pages), and a listing that never ends aborts', async () => {
  const forms = [{ id: 'formR', name: 'x' }, ...Array.from({ length: 249 }, (_, i) => form(i))];
  const c = mkCall({ forms, folders: [{ id: 'foldR', name: 'f' }] }); await run(c);
  assert.equal(c.calls.filter(([n]) => n === 'list_forms').length, 3);
  await assert.rejects(run(mkCall({ formsAlwaysFull: true, folders: [] })), /still full/);
});
test('F2: a total larger than what was read aborts; a full 1000-row folder page aborts', async () => {
  await assert.rejects(run(mkCall({ forms: [{ id: 'formR', name: 'x' }], total: 9, folders: [{ id: 'foldR', name: 'f' }] })), /reports total/);
  await assert.rejects(run(mkCall({ forms: [{ id: 'formR', name: 'x' }], folders: Array.from({ length: 1000 }, (_, i) => ({ id: i === 0 ? 'foldR' : `z${i}`, name: 'f' })) })), /full 1000/);
});
test('F3: the log says what the listing holds and that nested forms are not claimed', async () => {
  const lines = []; await run(mkCall({ forms: [{ id: 'formR', name: 'x' }], folders: [{ id: 'foldR', name: 'f' }] }), { log: (l) => lines.push(l) });
  assert.ok(lines.some((l) => /this listing holds 1 form\/folder row\(s\).*forms nested in folders are not claimed/.test(l)));
});
test('no incident stamps (or a non-digit stamp) aborts, fail closed', async () => {
  for (const bad of [undefined, [], ['abc']]) await assert.rejects(run(mkCall({ forms: [{ id: 'formR', name: 'x' }], folders: [{ id: 'foldR', name: 'f' }] }), { incidentStamps: bad }), /no incident stamps/);
});
test('no recorded ids at all aborts', async () => { await assert.rejects(run(mkCall(), { expectedForms: new Set(), expectedFolders: new Set() }), /no recorded ids/); });

const subCall = ({ rows, byForm, ghost = 0, none = 0, win = 0 } = {}) => async (name, a) => {
  assert.equal(name, 'list_form_submissions');
  if (a.q) return { ok: true, data: { returned: none, submissions: [] } };
  if (a.startAt) return { ok: true, data: { returned: win, submissions: [] } };
  if (a.formId === 'f'.repeat(24)) return { ok: true, data: { returned: ghost, submissions: Array(ghost).fill({ formId: 'x' }) } };
  if (a.formId) { const r = byForm ?? rows.filter((x) => x.formId === a.formId); return { ok: true, data: { returned: r.length, submissions: r } }; }
  return { ok: true, data: { returned: rows.length, submissions: rows } };
};
const runSub = async (c) => { const res = []; await submissionsSection({ call: c, check: (cond, m) => res.push([Boolean(cond), m]), locationId: 'LOC', stamp: '1' }); return res; };
test('F6: healthy: unfiltered >=1, controls 0, formId filter returns only that form, ghost formId returns 0', async () => {
  const res = await runSub(subCall({ rows: [{ formId: 'A' }, { formId: 'B' }, { formId: 'A' }] }));
  assert.deepEqual(res.filter(([c]) => !c), []); assert.ok(res.length >= 5);
});
test('F6: a formId filter that returns another form\'s row FAILS', async () => {
  const res = await runSub(subCall({ rows: [{ formId: 'A' }], byForm: [{ formId: 'A' }, { formId: 'OTHER' }] }));
  assert.ok(res.some(([c, m]) => !c && /EVERY returned row carries exactly that formId/.test(m)));
});
test('F6: a ghost formId that returns rows FAILS; no row with a formId FAILS the precondition; no rows at all FAILS the precondition', async () => {
  assert.ok((await runSub(subCall({ rows: [{ formId: 'A' }], ghost: 2 }))).some(([c, m]) => !c && /ghost formId returns 0 rows/.test(m)));
  assert.ok((await runSub(subCall({ rows: [{ other: 1 }] }))).some(([c, m]) => !c && /PRECONDITION: a returned row carries a formId/.test(m)));
  assert.ok((await runSub(subCall({ rows: [] }))).some(([c, m]) => !c && /PRECONDITION: the location already has/.test(m)));
});
test('F7: failure details are the code plus key names only, never server text', () => {
  const d = safeDetail({ ok: false, code: 'TOKEN_EXPIRED', detail: 'Location with id SECRETLOC not found', message: 'SECRETMSG', data: { preview: { existingFolders: [{ id: 'X' }], alreadyExists: { id: 'Y' } }, status: 401 } });
  assert.match(d, /^TOKEN_EXPIRED keys=/); assert.doesNotMatch(d, /SECRETLOC|SECRETMSG|existingFolders":|\bX\b|\bY\b/); assert.equal(safeDetail({ ok: true }), '');
});
