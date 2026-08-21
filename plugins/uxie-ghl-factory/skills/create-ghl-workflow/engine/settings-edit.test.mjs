import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partitionOps, mergeSettingsOps, applyOp, SETTINGS_OPS } from './edit-driver.mjs';
import { editCommitBody, settingsFromDoc, settingsCommitFields } from './edit.mjs';

const fresh = () => ({
  _id: 'W', id: 'W', status: 'draft', version: 3, name: 'x',
  allowMultiple: false, allowMultipleOpportunity: true, stopOnResponse: false, autoMarkAsRead: false,
  removeContactFromLastStep: true, timezone: 'account', window: null, senderAddress: {}, eventStartDate: null,
  scheduledPauseDates: [], workflowNote: null, meta: null,
  workflowData: { templates: [{ id: 'a', type: 'sms', name: 'A', order: 0, attributes: { body: 'hi' }, next: null }] },
});
const noDiff = { createdSteps: [], modifiedSteps: [], deletedSteps: [] };

test('partitionOps lifts updateSettings out of the step/trigger streams; applyOp refuses it with a routing hint', () => {
  const { stepOps, triggerOps, settingsOps } = partitionOps([
    { op: 'renameStep', stepId: 'a', name: 'B' }, { op: 'updateSettings', settings: { stopOnResponse: true } }, { op: 'addTrigger', trigger: {} },
  ]);
  assert.equal(stepOps.length, 1); assert.equal(triggerOps.length, 1); assert.equal(settingsOps.length, 1);
  assert.ok(SETTINGS_OPS.has('updateSettings'));
  assert.throws(() => applyOp([], { op: 'updateSettings', settings: {} }, { ctx: {}, idGen: () => 'x' }), /SETTINGS op/);
});

test('mergeSettingsOps folds ops in order; null when none', () => {
  assert.equal(mergeSettingsOps([]), null);
  assert.deepEqual(mergeSettingsOps([{ op: 'updateSettings', settings: { timezone: 'contact', stopOnResponse: true } }, { op: 'updateSettings', settings: { stopOnResponse: false } }]), { timezone: 'contact', stopOnResponse: false });
  assert.throws(() => mergeSettingsOps([{ op: 'updateSettings' }]), /needs a 'settings' object/);
});

test('no settingsPatch → commit body byte-identical to before the op existed', () => {
  const f = fresh();
  const body = editCommitBody(f, f.workflowData.templates, noDiff, 'U');
  assert.equal(body.window, null); assert.equal(body.meta, null); assert.equal(body.allowMultiple, false);
  assert.deepEqual(Object.keys(body).sort(), [...Object.keys(f), 'updatedBy', 'triggersChanged', 'createdSteps', 'modifiedSteps', 'deletedSteps'].filter((k, i, a) => a.indexOf(k) === i).sort());
});

test('settingsPatch merges over the stored values and lands the UI\'s stored shapes', () => {
  const f = fresh();
  const body = editCommitBody(f, f.workflowData.templates, noDiff, 'U', {
    settingsPatch: { window: { days: [1, 2] }, stopOnResponse: true, workflowNote: 'hello', statsView: true },
    now: '2026-08-22T00:00:00.000Z',
  });
  assert.deepEqual(body.window, { condition: 'when', start: '08:00', end: '17:00', days: [1, 2] });
  assert.equal(body.stopOnResponse, true);
  assert.equal(body.allowMultiple, false, 'untouched stored values survive');
  assert.equal(body.timezone, 'account');
  assert.deepEqual(body.workflowNote, { content: 'hello', createdBy: 'U', createdAt: '2026-08-22T00:00:00.000Z', updatedBy: 'U', updatedAt: '2026-08-22T00:00:00.000Z' });
  assert.deepEqual(body.meta, { statsView: true });
  assert.equal(body.eventStartDate, '', 'stored null is carried as the UI sends it');
});

test('window:null switches the time window off; meta is only touched when statsView is involved', () => {
  const f = { ...fresh(), window: { condition: 'when', start: '09:00', end: '18:00', days: [1] }, meta: { stepIndexCounter: { x: 1 } } };
  const body = editCommitBody(f, f.workflowData.templates, noDiff, 'U', { settingsPatch: { window: null } });
  assert.equal(body.window, null);
  assert.deepEqual(body.meta, { stepIndexCounter: { x: 1 } }, 'stored meta untouched when statsView is neither patched nor stored');
  const f2 = { ...fresh(), meta: { stepIndexCounter: { x: 1 }, statsView: true } };
  const body2 = editCommitBody(f2, f2.workflowData.templates, noDiff, 'U', { settingsPatch: { statsView: false } });
  assert.deepEqual(body2.meta, { stepIndexCounter: { x: 1 }, statsView: false });
});

test('an unknown key or impossible value refuses at commit; a stored note keeps its authorship on edit', () => {
  const f = fresh();
  assert.throws(() => editCommitBody(f, f.workflowData.templates, noDiff, 'U', { settingsPatch: { allowReEntry: true } }), (e) => e.code === 'SETTINGS_KEY');
  assert.throws(() => editCommitBody(f, f.workflowData.templates, noDiff, 'U', { settingsPatch: { timezone: 'UTC' } }), (e) => e.code === 'SETTINGS_VALUE');
  const f2 = { ...fresh(), workflowNote: { content: 'old', createdBy: 'X', createdByName: 'Xander', createdAt: '2025-01-01T00:00:00.000Z', updatedBy: 'X', updatedAt: '2025-01-01T00:00:00.000Z' } };
  const body = editCommitBody(f2, f2.workflowData.templates, noDiff, 'U', { settingsPatch: { workflowNote: 'new' }, now: '2026-08-22T00:00:00.000Z' });
  assert.deepEqual(body.workflowNote, { content: 'new', createdBy: 'X', createdByName: 'Xander', createdAt: '2025-01-01T00:00:00.000Z', updatedBy: 'U', updatedAt: '2026-08-22T00:00:00.000Z' });
});

test('a legacy doc with From name but no From email does not brick an unrelated settings edit (advisory), but a senderAddress edit is held to the rule', () => {
  const f = { ...fresh(), senderAddress: { from_name: 'Legacy' } };
  const seen = [];
  const body = editCommitBody(f, f.workflowData.templates, noDiff, 'U', { settingsPatch: { stopOnResponse: true }, warn: (m) => seen.push(m) });
  assert.deepEqual(body.senderAddress, { from_name: 'Legacy' });
  assert.ok(seen.some((m) => /pre-existing/.test(m)));
  assert.throws(() => editCommitBody(f, f.workflowData.templates, noDiff, 'U', { settingsPatch: { senderAddress: { from_name: 'New' } } }), (e) => e.code === 'SETTINGS_VALUE');
});

test('settingsFromDoc mirrors what the Settings drawer loads', () => {
  const s = settingsFromDoc({ ...fresh(), meta: { statsView: true }, window: { condition: 'when', start: '08:00', end: '17:00', days: [1] } });
  assert.equal(s.statsView, true); assert.equal(s.window.start, '08:00'); assert.equal(s.eventStartDate, '');
  assert.deepEqual(Object.keys(settingsCommitFields(fresh(), {}, 'U')).sort(), ['allowMultiple', 'allowMultipleOpportunity', 'autoMarkAsRead', 'eventStartDate', 'removeContactFromLastStep', 'scheduledPauseDates', 'senderAddress', 'stopOnResponse', 'timezone', 'window', 'workflowNote']);
});
