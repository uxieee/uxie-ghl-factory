// An embedded form / survey / calendar as the builder's pickers store it (knowledge sniffs/funnels-wave16-embeds-2026-09-29): a reference is
// {value, text} (calendar adds isTeamSelected:false), the on-submit menu is none | url | go-to-next-funnel-step, the fresh default is `none`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeEmbedExtra, EMBED_ACTION_VALUES, makeLeaf, auditPageData } from '../core/funnel-pages.mjs';

test('routeEmbedExtra: a fresh embed gets action none; an empty string becomes none; a named menu value stays', () => {
  assert.deepEqual(routeEmbedExtra('form', { formId: { value: 'F1', text: 'A form' } }).action, { value: 'none' });
  assert.deepEqual(routeEmbedExtra('form', { formId: { value: 'F1', text: 'A' }, action: { value: '' } }).action, { value: 'none' });
  assert.deepEqual(routeEmbedExtra('survey', { surveyId: { value: 'S1', text: 's' }, action: { value: 'go-to-next-funnel-step' } }).action, { value: 'go-to-next-funnel-step' });
  assert.deepEqual(routeEmbedExtra('calendar', { calendarId: { value: 'C1', text: 'Cal' }, action: 'url' }).action, { value: 'url' });
  assert.deepEqual(EMBED_ACTION_VALUES, ['none', 'url', 'go-to-next-funnel-step']);
});

test('routeEmbedExtra: the 19-value button list is refused on an embed', () => {
  for (const bad of ['sell-product', 'openPopup', 'click-to-call', 'download-file']) {
    assert.throws(() => routeEmbedExtra('form', { formId: { value: 'F1', text: 'A' }, action: { value: bad } }), /is not one the builder offers on an embedded form/, bad);
  }
});

test('routeEmbedExtra: a calendar reference gains isTeamSelected:false; a bare string reference is refused with the shape to send', () => {
  assert.deepEqual(routeEmbedExtra('calendar', { calendarId: { value: 'C1', text: 'Cal' } }).calendarId, { isTeamSelected: false, value: 'C1', text: 'Cal' });
  assert.deepEqual(routeEmbedExtra('calendar', { calendarId: { value: 'C1', text: 'Cal', isTeamSelected: true } }).calendarId.isTeamSelected, true);
  for (const [meta, prop] of [['form', 'formId'], ['survey', 'surveyId'], ['calendar', 'calendarId']]) {
    assert.throws(() => routeEmbedExtra(meta, { [prop]: 'BARE' }), /must be \{value: "<id>", text:/, meta);
    assert.throws(() => routeEmbedExtra(meta, { [prop]: { value: 5 } }), /must be the asset id/, meta);
  }
});

test('routeEmbedExtra leaves every other kind alone', () => {
  const x = { action: { value: 'sell-product' } };
  assert.equal(routeEmbedExtra('button', x), x);
});

test('makeLeaf builds a survey / calendar in the builder\'s stored shape', () => {
  const svy = makeLeaf({ meta: 'survey', salt: 'e', extra: { surveyId: { value: 'S1', text: 'a survey' } } });
  assert.deepEqual(svy.extra.surveyId, { value: 'S1', text: 'a survey' });
  assert.deepEqual(svy.extra.action, { value: 'none' });
  const cal = makeLeaf({ meta: 'calendar', salt: 'e', extra: { calendarId: { value: 'C1', text: 'Cal' } } });
  assert.deepEqual(cal.extra.calendarId, { value: 'C1', text: 'Cal', isTeamSelected: false });
});

test('audit: an existing page with a survey action outside the embed menu, or a reference with no text, is a problem', () => {
  const leaf = (meta, extra) => makeLeaf({ meta, salt: 'a', extra });
  const bad = leaf('survey', { surveyId: { value: 'S1', text: 'x' } });
  bad.extra.action = { value: 'sell-product' };
  const noText = leaf('calendar', { calendarId: { value: 'C1', text: 'Cal' } });
  delete noText.extra.calendarId.text;
  const problems = auditPageData({ sections: [{ id: 's1', metaData: { child: [] }, elements: [bad, noText], general: { sectionStyles: 's1' } }] });
  const text = JSON.stringify(problems);
  assert.match(text, /not on the builder's menu for an embedded survey/);
  assert.match(text, /extra\.calendarId has no \.text/);
});
