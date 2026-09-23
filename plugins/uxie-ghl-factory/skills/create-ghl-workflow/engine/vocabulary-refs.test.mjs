import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsVocabularies, checkVocabularyRefs, fetchDispositionNames } from './vocabulary-refs.mjs';

const trig = (value, extra = {}) => ({ id: 't1', name: 'Call Outcome Router', type: 'call_status',
  conditions: [{ field: 'custom_disposition', operator: 'contains-any', value }], ...extra });
const NAMES = ['No Answer', 'Voicemail', 'Not Interested'];

test('a disposition name the account lacks is reported; a present one is not (differential)', () => {
  const r = checkVocabularyRefs([trig(['No Answer', 'Booked Demo'])], { callDispositions: NAMES });
  assert.equal(r.checked, 2);
  assert.deepEqual(r.findings.map((f) => f.value), ['Booked Demo']);
  assert.match(r.findings[0].message, /matches by NAME|by NAME/);
});

test('a case/space variant is still a miss, with the account\'s spelling suggested', () => {
  const r = checkVocabularyRefs([trig(['no answer '])], { callDispositions: NAMES });
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].suggestion, 'No Answer');
});

test('an unreadable vocabulary is NOT CHECKED, never clean', () => {
  const r = checkVocabularyRefs([trig(['Booked Demo'])], { callDispositions: null });
  assert.equal(r.findings.length, 0);
  assert.equal(r.notChecked.length, 1);
});

test('only name-matched conditions are judged, and only they trigger a fetch', () => {
  const other = { id: 't2', type: 'call_status', conditions: [{ field: 'call_status', operator: 'contains-any', value: ['busy'] }] };
  assert.equal(needsVocabularies([other]), false);
  assert.equal(needsVocabularies([trig(['x'])]), true);
  assert.equal(checkVocabularyRefs([other], { callDispositions: NAMES }).checked, 0);
  // authored filters[] are read too
  assert.equal(checkVocabularyRefs([{ type: 'call_status', filters: [{ field: 'custom_disposition', value: ['Ghost'] }] }], { callDispositions: NAMES }).findings.length, 1);
});

test('fetchDispositionNames walks pages, drops deleted rows, and returns null on a failed page', async () => {
  const pages = { 1: { dispositions: [{ name: 'A' }, { name: 'Gone', isDeleted: true }], totalPages: 2 }, 2: { dispositions: [{ name: 'B' }], totalPages: 2 } };
  const call = async (_m, p) => ({ ok: true, json: pages[Number(/page=(\d+)/.exec(p)[1])] });
  assert.deepEqual(await fetchDispositionNames(call, 'LOC'), ['A', 'B']);
  assert.equal(await fetchDispositionNames(async () => ({ ok: false, json: null }), 'LOC'), null);
});
