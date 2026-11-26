import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forbiddenIn, assertCitationClean, commitEvidence } from '../../../../scripts/lib/proof-citation.mjs';
import { runForRow, alreadyRecorded, MASKED_LOCATION } from '../../../../scripts/proof-from-map.mjs';
import { createMarker } from '../../skills/create-ghl-workflow/scripts/exercised-marker.mjs';
import { validateRecord } from '../../../../scripts/lib/proof-record.mjs';

const SHA = 'a'.repeat(40);
const row = { tool: 'build_workflow', kshaFull: SHA, record: 'rec/one.json', startedAt: '2026-11-22T06:19:49.079Z', codeAtRecord: { 'x#y': 'h' } };
const ok = { citations: { [SHA]: 'rec/one.json' }, git: { isAncestorOfMain: () => true, blob: () => 'blob1' }, codeNow: () => ({ 'x#y': 'h' }) };

test('citation guard refuses sniff, knowledge, live-, dated folder and account-name values', () => {
  for (const bad of ['sniffs/drift/x.json', 'knowledge/corpus/a.md', 'live-flow17-reads.json', 'drift-w9-2026-11-22/', 'x-w9-2026-11-22/y', 'GROM Sandbox', 'sandbox']) {
    assert.ok(forbiddenIn(bad).length > 0, bad); assert.throws(() => assertCitationClean({ evidence: [bad] }), /refused/);
  }
  assert.deepEqual(forbiddenIn(`commit:${SHA}`), []);
});
test('commit evidence needs the full 40-hex sha', () => {
  assert.equal(commitEvidence(SHA), `commit:${SHA}`);
  assert.throws(() => commitEvidence('dd1cdc846'), /40-hex/); assert.throws(() => commitEvidence(undefined), /40-hex/);
});
test('a clean row becomes one pass run that cites only the commit and validates as a proof record', () => {
  const run = runForRow(row, ok);
  assert.deepEqual(run, { at: '2026-11-22', result: 'pass', how: 'manual', evidence: [`commit:${SHA}`] });
  const rec = { tool: 'build_workflow', surfaces: ['workflows'], runs: [run], depends: { hashedAt: '2026-11-22', endpoints: {}, builds: {}, code: { 'x#y': 'a'.repeat(64) } } };
  assert.deepEqual(validateRecord(rec), []);
});
test('the generator refuses: unmapped sha, non-ancestor, blob differs from main, code changed, missing codeAtRecord, forbidden location', () => {
  assert.throws(() => runForRow(row, { ...ok, citations: {} }), /does not map/);
  assert.throws(() => runForRow(row, { ...ok, citations: { [SHA]: 'other.json' } }), /does not map/);
  assert.throws(() => runForRow(row, { ...ok, git: { ...ok.git, isAncestorOfMain: () => false } }), /not an ancestor/);
  assert.throws(() => runForRow(row, { ...ok, git: { isAncestorOfMain: () => true, blob: (r) => (r === 'main' ? 'b2' : 'b1') } }), /blob/);
  assert.throws(() => runForRow(row, { ...ok, codeNow: () => ({ 'x#y': 'changed' }) }), /code changed/);
  assert.throws(() => runForRow({ ...row, codeAtRecord: undefined }, ok), /code changed/);
  assert.throws(() => runForRow(row, { ...ok, location: 'GROM' }), /refused/);
  assert.throws(() => runForRow({ ...row, startedAt: 'nope' }, ok), /startedAt/);
});
test('the exercised marker credits the subject tool, nothing under subject(false), the last-called tool otherwise', async () => {
  const mk = createMarker(); const seen = [];
  const call = mk.wrapCall(async (n) => ({ ok: true, n }));
  const rep = (c, m) => seen.push([c, m]);
  await call('build_workflow', {}); mk.check(true, 'builds', '', rep);
  mk.subject('export_workflow'); await call('get_workflow', {}); mk.check(false, 'export keeps steps', '', rep);
  mk.subject(false); mk.check(true, 'a raw control proves no tool', '', rep);
  mk.subject(null); mk.check(true, 'back to last-called (get_workflow)', '', rep);
  const e = Object.fromEntries(mk.entries().map((x) => [x.tool, x]));
  assert.deepEqual([e.build_workflow.passed, e.build_workflow.calls], [1, 1]);
  assert.deepEqual([e.export_workflow.failed, e.export_workflow.calls], [1, 0]);
  assert.deepEqual([e.get_workflow.passed, e.get_workflow.calls], [1, 1]);
  assert.equal(seen.length, 4);
});
test('W1: only a masked location is accepted; a raw id is refused', () => {
  const masked = '\u2026abcd';
  assert.equal(runForRow(row, { ...ok, location: masked }).location, masked);
  for (const bad of ['QQfakeFAKE0000QQfakeFAKE0000QQ', 'abcd', '\u2026abc', '\u2026abcde', '...abcd']) {
    assert.ok(!MASKED_LOCATION.test(bad), bad); assert.throws(() => runForRow(row, { ...ok, location: bad }), /masked form/);
  }
});
test('W2: writing twice adds one run, not two', () => {
  let rec = null; let writes = 0;
  const write = () => { const run = runForRow(row, ok); if (alreadyRecorded(rec, SHA)) return; rec = { runs: [...(rec?.runs ?? []), run] }; writes++; };
  write(); write();
  assert.equal(writes, 1); assert.equal(rec.runs.length, 1);
  assert.equal(alreadyRecorded(rec, 'b'.repeat(40)), false); assert.equal(alreadyRecorded(null, SHA), false);
});
