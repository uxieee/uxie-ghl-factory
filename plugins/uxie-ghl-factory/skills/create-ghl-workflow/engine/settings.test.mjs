import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, SETTINGS_SPEC, KNOWN_SETTINGS_KEYS, TIMEZONES } from './settings.mjs';

const ctx = { uid: 'U1', now: '2026-08-22T00:00:00.000Z' };

test('defaults are the UI\'s own: allowMultiple ON, multiple opps ON, timezone account, window off', () => {
  const { body, warnings } = normalizeSettings(undefined, ctx);
  assert.deepEqual(body, {
    allowMultiple: true, allowMultipleOpportunity: true, stopOnResponse: false, autoMarkAsRead: false,
    removeContactFromLastStep: true, timezone: 'account', window: null, senderAddress: {}, eventStartDate: '',
    scheduledPauseDates: [], workflowNote: null, statsView: false,
  });
  assert.deepEqual(warnings, []);
  assert.equal(SETTINGS_SPEC.allowMultiple.def, true, 'SettingState + corpus 313/326 say re-entry defaults ON');
});

test('an unknown settings key REFUSES (SETTINGS_KEY) instead of being silently dropped', () => {
  assert.throws(() => normalizeSettings({ allowReentry: true }, ctx), (e) => e.code === 'SETTINGS_KEY' && /allowReentry/.test(e.message) && /allowMultiple/.test(e.message));
  assert.throws(() => normalizeSettings({ window: { start: '08:00', end: '17:00', days: [1], foo: 1 } }, ctx), (e) => e.code === 'SETTINGS_KEY');
  assert.throws(() => normalizeSettings({ senderAddress: { fromName: 'x' } }, ctx), (e) => e.code === 'SETTINGS_KEY' && /snake_case/.test(e.message));
});

test('timezone is account|contact only — an IANA zone is refused with the explanation', () => {
  assert.deepEqual(TIMEZONES, ['account', 'contact']);
  assert.equal(normalizeSettings({ timezone: 'contact' }, ctx).body.timezone, 'contact');
  assert.throws(() => normalizeSettings({ timezone: 'Australia/Sydney' }, ctx), (e) => e.code === 'SETTINGS_VALUE' && /IANA/.test(e.message));
});

test('window: the stored shape is {condition:"when", start, end, days[]} with the UI defaults filled in', () => {
  assert.deepEqual(normalizeSettings({ window: { days: [5, 1, 1, 3] } }, ctx).body.window, { condition: 'when', start: '08:00', end: '17:00', days: [1, 3, 5] });
  assert.deepEqual(normalizeSettings({ window: true }, ctx).body.window, { condition: 'when', start: '08:00', end: '17:00', days: [1, 2, 3, 4, 5] });
  assert.equal(normalizeSettings({ window: null }, ctx).body.window, null);
  assert.equal(normalizeSettings({ window: false }, ctx).body.window, null);
  assert.throws(() => normalizeSettings({ window: { start: '8am', end: '17:00', days: [1] } }, ctx), (e) => e.code === 'SETTINGS_VALUE' && /HH:mm/.test(e.message));
  assert.throws(() => normalizeSettings({ window: { start: '08:00', end: '17:00', days: [7] } }, ctx), (e) => e.code === 'SETTINGS_VALUE' && /0 \(Sunday\)/.test(e.message));
  assert.throws(() => normalizeSettings({ window: { start: '08:00', end: '17:00', days: [] } }, ctx), (e) => e.code === 'SETTINGS_VALUE');
  assert.throws(() => normalizeSettings({ window: { condition: 'exact', start: '08:00', end: '17:00', days: [1] } }, ctx), (e) => e.code === 'SETTINGS_VALUE' && /'when'/.test(e.message));
  const { warnings } = normalizeSettings({ window: { start: '17:00', end: '08:00', days: [1] } }, ctx);
  assert.ok(warnings.some((w) => /not after start/.test(w)), 'inverted window is advisory (the UI does not validate it either)');
});

test('senderAddress: empty keys dropped like the UI; From name requires From email (checkSenderAddress)', () => {
  assert.deepEqual(normalizeSettings({ senderAddress: { from_name: '', from_email: 'sender@example.com', from_number: '' } }, ctx).body.senderAddress, { from_email: 'sender@example.com' });
  assert.throws(() => normalizeSettings({ senderAddress: { from_name: 'Sarah' } }, ctx), (e) => e.code === 'SETTINGS_VALUE' && /From Name requires From Email/.test(e.message));
  const ok = normalizeSettings({ senderAddress: { from_name: 'Sarah', from_email: '{{user.email}}', from_number: '+15551234567' } }, ctx);
  assert.deepEqual(ok.body.senderAddress, { from_name: 'Sarah', from_email: '{{user.email}}', from_number: '+15551234567' });
  assert.deepEqual(ok.warnings, [], 'merge tags and E.164 numbers pass clean');
  const odd = normalizeSettings({ senderAddress: { from_email: 'not-an-email', from_number: 'call me' } }, ctx);
  assert.equal(odd.warnings.length, 2, 'format oddities are advisory, not refusals');
});

test('workflowNote: a string is promoted to the stored IWorkflowNote shape; an object passes through', () => {
  const { body } = normalizeSettings({ workflowNote: 'why this exists' }, ctx);
  assert.deepEqual(body.workflowNote, { content: 'why this exists', createdBy: 'U1', createdAt: '2026-08-22T00:00:00.000Z', updatedBy: 'U1', updatedAt: '2026-08-22T00:00:00.000Z' });
  assert.equal(normalizeSettings({ workflowNote: '' }, ctx).body.workflowNote, null);
  assert.equal(normalizeSettings({ workflowNote: { content: 'x', createdByName: 'Xander' } }, ctx).body.workflowNote.createdByName, 'Xander');
  assert.throws(() => normalizeSettings({ workflowNote: { content: 'x', color: 'red' } }, ctx), (e) => e.code === 'SETTINGS_KEY');
  assert.throws(() => normalizeSettings({ workflowNote: 42 }, ctx), (e) => e.code === 'SETTINGS_VALUE');
});

test('booleans must be booleans; statsView flows as a setting', () => {
  assert.throws(() => normalizeSettings({ stopOnResponse: 'yes' }, ctx), (e) => e.code === 'SETTINGS_VALUE' && /Stop on response/.test(e.message));
  assert.equal(normalizeSettings({ statsView: true }, ctx).body.statsView, true);
});

test('hatch: skipSettingsCheck turns refusals into warnings and still normalizes', () => {
  const { body, warnings } = normalizeSettings({ bogus: 1, timezone: 'UTC' }, { ...ctx, skipSettingsCheck: true });
  assert.equal(body.timezone, 'account');
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((w) => w.startsWith('(skipSettingsCheck)')));
});

test('ctx.warn receives advisories; KNOWN_SETTINGS_KEYS matches the spec', () => {
  const seen = [];
  normalizeSettings({ eventStartDate: '2026-01-01', scheduledPauseDates: [{ from: 'x' }] }, { ...ctx, warn: (m) => seen.push(m) });
  assert.equal(seen.length, 2);
  assert.deepEqual([...KNOWN_SETTINGS_KEYS].sort(), Object.keys(SETTINGS_SPEC).sort());
});
