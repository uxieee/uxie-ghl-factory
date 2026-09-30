// A composed video must carry a SOURCE in the builder's own shape. The generic media empty gave videoProperties a
// background-image shape with no url, and the public page showed an empty 16:9 box while every write answered 201
// (knowledge sniffs/funnels-wave17-analytics-2026-09-29/live-tool.video-default.json; the builder's shape is
// readback.video.json there).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { makeLeaf, normalizeVideoExtra, videoSourceProblems, videoTypeOf } from '../core/funnel-pages.mjs';
import { applyPageEdits } from '../core/page-edit.mjs';

test('the default video is the builder\'s shape: videoProperties.value with a player type, RAW playback objects', () => {
  const x = makeLeaf({ meta: 'video', salt: 'v' }).extra;
  assert.equal(x.videoProperties.value.type, 'youtube');
  assert.ok(!('mediaType' in x.videoProperties.value), 'not the background-image shape');
  assert.equal(x.playBackControls.showProgressBar, true);
  assert.ok(!('value' in x.playBackControls), 'playBackControls is a RAW object');
  assert.equal(x.leadVideoOptions.isLeadGenVideo, false);
});

test('a url alone gets the full value and the type read off the url; an authored type wins', () => {
  const t = (url) => normalizeVideoExtra({ videoProperties: { value: { url } } }).videoProperties.value;
  assert.equal(t('https://www.youtube.com/watch?v=abc').type, 'youtube');
  assert.equal(t('https://youtu.be/abc').type, 'youtube');
  assert.equal(t('https://vimeo.com/123').type, 'vimeo');
  assert.equal(t('https://fast.wistia.com/medias/x').type, 'wistia');
  assert.equal(t('https://cdn.example.com/a.mp4').type, 'html');
  assert.equal(t('https://youtu.be/abc').controls, 1, 'the builder keys around it are kept');
  const hosted = normalizeVideoExtra({ videoProperties: { value: { selfHostedVideo: { id: 'M1', name: 'a.mp4', url: 'https://x/a.mp4' } } } }).videoProperties.value;
  assert.equal(hosted.type, 'selfHosted');
  assert.equal(normalizeVideoExtra({ videoProperties: { value: { url: 'https://youtu.be/abc', type: 'custom_embed' } } }).videoProperties.value.type, 'custom_embed');
  assert.equal(videoTypeOf('https://example.com/page'), 'custom_embed');
});

test('videoTypeOf is the builder\'s own classifier (page builder getVideoType): direct files → html; everything unknown → custom_embed', () => {
  for (const u of ['https://a/x.mov', 'https://a/x.M4V', 'https://a/x.avi?t=1', 'https://a/x.ogv', 'https://a/x.webm', 'https://a/x.mp4']) assert.equal(videoTypeOf(u), 'html', u);
  for (const u of ['https://www.loom.com/share/abc', 'https://a/x.m3u8', 'https://a/x.ogg', 'https://fast.wistia.net/medias/x', 'https://wi.st/abc']) assert.equal(videoTypeOf(u), 'custom_embed', u);
  assert.equal(videoTypeOf(''), 'youtube', 'the builder\'s empty default');
  assert.equal(videoTypeOf('https://vimeo.com/1'), 'vimeo');
});

test('an authored type that disagrees with its url is an audit problem (the builder re-derives it); selfHosted and custom_embed are exempt', () => {
  const page = (value) => ({ sections: [{ id: 's', elements: [makeLeaf({ meta: 'video', salt: 'p', extra: { videoProperties: { value } } })] }] });
  const bad = videoSourceProblems(page({ url: 'https://www.loom.com/share/abc', type: 'youtube' }));
  assert.equal(bad.length, 1);
  assert.match(bad[0], /reads it as 'custom_embed'/);
  assert.equal(videoSourceProblems(page({ url: 'https://www.loom.com/share/abc', type: 'custom_embed' })).length, 0);
  assert.equal(videoSourceProblems(page({ url: 'https://a/x.mov', type: 'html' })).length, 0);
  assert.equal(videoSourceProblems(page({ url: 'https://a/x.mov', type: 'youtube' })).length, 1);
});

test('a video with no source is a problem; a sourced one is not (control)', () => {
  const page = (extra) => ({ sections: [{ id: 's', elements: [makeLeaf({ meta: 'video', salt: 'p', extra })] }] });
  assert.equal(videoSourceProblems(page({})).length, 1);
  assert.equal(videoSourceProblems(page({ videoProperties: { value: { url: 'https://youtu.be/abc' } } })).length, 0);
  assert.equal(videoSourceProblems(page({ videoProperties: { value: { selfHostedVideo: { id: 'M1' } } } })).length, 0);
});

test('build_funnel_page refuses a composed video with no source, before any write', async () => {
  const calls = [];
  const deps = { state: {}, makeGw: () => ({ uid: 'U', call: async (m, p, b) => { calls.push({ m, p }); return { ok: true, status: 200, json: {} }; } }) };
  const tool = TOOLS.find((t) => t.name === 'build_funnel_page');
  const r = await tool.handler({ locationId: 'L', funnelId: 'F', pageId: 'P', stepId: 'S', confirm: true,
    sections: [{ columns: [{ elements: [{ meta: 'video' }] }] }] }, deps);
  assert.equal(r.code, 'VALIDATION_FAILED');
  assert.match(r.detail ?? r.message ?? JSON.stringify(r), /no source/);
  assert.ok(!calls.some((c) => c.m !== 'GET'), 'nothing was written');
});

test('edit mode: setting only a new url keeps the stored value and follows the url\'s player type', () => {
  const leaf = makeLeaf({ meta: 'video', salt: 'e', extra: { videoProperties: { value: { url: 'https://youtu.be/abc' } } } });
  const pd = { sections: [{ id: 'sec', general: {}, elements: [leaf] }] };
  const { pageData, errors } = applyPageEdits(pd, [{ op: 'set', nodeId: leaf.id, extra: { videoProperties: { value: { url: 'https://vimeo.com/42' } } } }]);
  assert.equal(errors.length, 0);
  const v = pageData.sections[0].elements[0].extra.videoProperties.value;
  assert.equal(v.type, 'vimeo');
  assert.equal(v.controls, 1);
  assert.equal(v.selfHostedVideo.thumbnailName, 'Video Thumbnail.png');
});
