// build_funnel_page structure + styling knobs (knowledge sniffs/funnels-wave11-structure-styling-2026-09-28,
// sniffs/funnels-wave12-structure-tool-2026-09-28): section sticky/width/full-width rows, entrance and hover
// animations compiled as the builder compiles them, and page popups.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOOLS } from '../core/tools.mjs';
import { makeSection, resetIds, makeLeaf } from '../core/funnel-pages.mjs';
import { applyPageEdits, verifyEdits } from '../core/page-edit.mjs';
import { keyframesFor, entranceCss, hoverCss, entranceClass, hoverClass, stripAnimationCss, parentAnimationOffset } from '../core/page-animation.mjs';
import { makePopup, popupRefProblems } from '../core/page-popup.mjs';

const tool = TOOLS.find((t) => t.name === 'build_funnel_page');
const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/animation-keyframes.golden.json', import.meta.url), 'utf8'));

test('keyframes equal csso(builder generator) for all 21 entrance animations at six scales', () => {
  // The fixture is the builder bundle's generateKeyframes output minified by csso 5.0.5 — what the builder saves.
  assert.equal(Object.keys(GOLDEN).length, 126);
  for (const [k, want] of Object.entries(GOLDEN)) {
    const [name, s] = k.split('|');
    assert.equal(keyframesFor(name, `${name}-heading-X1`, s === '' ? undefined : Number(s)), want, k);
  }
});

test('entrance + hover rules are byte-equal to the builder\'s saved sectionStyles', () => {
  // Substrings of the builder's own save (wave11 pd.ui3.json), for the same knobs and node ids.
  const builderEntrance = '.animate__fadeInUp-heading-S0C00{animation:fadeInUp-heading-S0C00 2s linear .5s forwards!important;-webkit-animation-name:fadeInUp-heading-S0C00;animation-name:fadeInUp-heading-S0C00}'
    + '@-webkit-keyframes fadeInUp-heading-S0C00{0%{opacity:0;-webkit-transform:translate3d(0,100%,0) scale(1);transform:translate3d(0,100%,0) scale(1)}to{opacity:1;-webkit-transform:scale(1);transform:scale(1)}}'
    + '@keyframes fadeInUp-heading-S0C00{0%{opacity:0;-webkit-transform:translate3d(0,100%,0) scale(1);transform:translate3d(0,100%,0) scale(1)}to{opacity:1;-webkit-transform:scale(1);transform:scale(1)}}';
  const builderHover = '.button-S0C01,.cbutton-S0C01{--hover-duration:0.3s;--hover-delay:0s;--hover-easing:ease-in-out;--hover-scale:1.2}';
  assert.equal(entranceCss('heading-S0C00', { entranceAnimation: { value: 'animate__animated animate__fadeInUp' }, animationDuration: { value: 2 }, animationDelay: { value: 0.5 } }), builderEntrance);
  assert.equal(hoverCss('button-S0C01', hoverClass({ name: 'hvr-grow', scale: 1.2 })), builderHover);
  // The stored class is the builder's too.
  assert.deepEqual(hoverClass({ name: 'hvr-grow', scale: 1.2 }), { hoverAnimation: { value: 'hvr-grow' }, hoverScale: { value: 1.2 }, hoverAdjustByEffect: { value: { 'hvr-grow': { hoverScale: { value: 1.2 } } } } });
  assert.deepEqual(entranceClass({ name: 'fadeInUp', duration: 2, delay: 0.5 }), { entranceAnimation: { value: 'animate__animated animate__fadeInUp' }, animationDuration: { value: 2 }, animationDelay: { value: 0.5 } });
});

test('an entrance with no timing knob compiles nothing (the global animate.css class runs as is)', () => {
  assert.equal(entranceCss('h1', entranceClass({ name: 'zoomIn' })), '');
  assert.throws(() => entranceClass({ name: 'wobble' }), /one of/);
  assert.throws(() => hoverClass({ name: 'hvr-grow', angle: 5 }), /does not take angle/);
  assert.throws(() => hoverClass({ name: 'hvr-fade', fillColor: '#f00' }), /colour knobs are set in the builder/);
});

test('a re-set animation replaces its rules instead of stacking them; the parent offset adds to the delay', () => {
  const first = entranceCss('p-1', entranceClass({ name: 'fadeIn', duration: 1 })) + hoverCss('b-2', hoverClass({ name: 'hvr-grow', scale: 1.1 }));
  const css = `.x{color:red}${first}.y{color:blue}`;
  assert.equal(stripAnimationCss(css, 'p-1'), `.x{color:red}${hoverCss('b-2', hoverClass({ name: 'hvr-grow', scale: 1.1 }))}.y{color:blue}`);
  assert.equal(stripAnimationCss(stripAnimationCss(css, 'p-1'), 'b-2'), '.x{color:red}.y{color:blue}');
  const section = { metaData: { id: 's', meta: 'section', child: ['r'], class: { entranceAnimation: { value: 'animate__animated animate__fadeIn' }, animationDuration: { value: 2 }, animationDelay: { value: 1 } } },
    elements: [{ id: 'r', meta: 'row', child: ['c'] }, { id: 'c', meta: 'col', child: ['h'] }, { id: 'h', meta: 'heading', child: [] }] };
  assert.equal(parentAnimationOffset('h', section), 3);
  assert.match(entranceCss('h', entranceClass({ name: 'fadeIn', delay: 0.5 }), 3), /linear 3\.5s forwards/);
});

test('section knobs: sticky, width and full-width rows, with the builder\'s compiled inner rule', () => {
  resetIds();
  const s = makeSection({ columns: [], sticky: 'bottom', width: 'small', fullWidthRows: true, salt: 'S0' });
  assert.deepEqual(s.metaData.extra.sticky, { value: 'stickyBottom' });
  assert.deepEqual(s.metaData.class.width, { value: 'midSection' });
  assert.deepEqual(s.metaData.extra.allowRowMaxWidth, { value: true });
  assert.match(s.general.sectionStyles, new RegExp(`#${s.id}>\\.inner\\{max-width:100%\\}`));
  const d = makeSection({ columns: [], salt: 'S1' });
  assert.equal(d.metaData.class.width, undefined);
  assert.match(d.general.sectionStyles, /\.inner\{max-width:1170px\}/, 'the default inner width is the builder\'s (it recompiles 1170 on every save)');
  assert.throws(() => makeSection({ columns: [], width: 'huge', salt: 'S2' }), /width must be one of/);
});

const page = () => {
  resetIds();
  const h = makeLeaf({ meta: 'heading', salt: 'T' });
  const b = makeLeaf({ meta: 'button', salt: 'T' });
  return { sections: [{ id: 'section-A', metaData: { id: 'section-A', meta: 'section', child: ['row-A'], class: {}, extra: { sticky: { value: 'noneSticky' } }, classStr: 'noBorder radius0 none' },
    elements: [{ id: 'row-A', meta: 'row', child: ['col-A'] }, { id: 'col-A', meta: 'col', child: [h.id, b.id] }, h, b],
    general: { sectionStyles: '#section-A>.inner{max-width:1170px}.z{}' } }], popupsList: [], pageStyles: '' };
};

test('set on a section writes its knobs, the classStr width and the inner rule; other section edits stay refused', () => {
  const pd = page();
  const { pageData, report, errors } = applyPageEdits(pd, [{ op: 'set', nodeId: 'section-A', sticky: 'top', width: 'midWide', fullWidthRows: true }]);
  assert.equal(errors.length, 0);
  const meta = pageData.sections[0].metaData;
  assert.deepEqual(meta.extra.sticky, { value: 'stickyTop' });
  assert.deepEqual(meta.class.width, { value: 'midWideSection' });
  assert.equal(meta.classStr, 'noBorder radius0 none midWideSection');
  assert.equal(pageData.sections[0].general.sectionStyles, '.z{}#section-A>.inner{max-width:100%}');
  assert.ok(verifyEdits(pageData, report).every((v) => v.applied));
  // f4b: a section's styling is set in place too, compiled through the builder's generic layer; `extra` stays refused
  const styled = applyPageEdits(pd, [{ op: 'set', nodeId: 'section-A', styles: { borderRadius: '8px' }, mobileStyles: { paddingTop: 10 }, visibility: { hideMobile: true } }]);
  assert.equal(styled.errors.length, 0);
  const sm = styled.pageData.sections[0].metaData;
  assert.deepEqual([sm.styles.borderRadius, sm.mobileStyles.paddingTop, sm.extra.visibility.value.hideMobile], [{ value: 8, unit: 'px' }, { value: 10, unit: 'px' }, true]);
  assert.match(styled.pageData.sections[0].general.sectionStyles, /\.section-A\{[^}]*border-radius:8px/);
  assert.match(styled.pageData.sections[0].general.sectionStyles, /@media screen and \(min-width:0px\) and \(max-width:767px\)\{\.hl_page-preview--content \.section-A\{padding-top:10px\}\}/);
  assert.ok(verifyEdits(styled.pageData, styled.report).every((v) => v.applied));
  assert.match(applyPageEdits(pd, [{ op: 'set', nodeId: 'section-A', extra: { x: { value: 1 } } }]).errors[0].error, /a section takes sticky, width, fullWidthRows, styles/);
});

test('set animations on leaves: class + compiled rules; hover only on buttons; entrance only where the builder offers it', () => {
  const pd = page();
  const [h, b] = pd.sections[0].elements.slice(2);
  const { pageData, report, errors } = applyPageEdits(pd, [
    { op: 'set', nodeId: h.id, entranceAnimation: { name: 'fadeInUp', duration: 2, delay: 0.5 } },
    { op: 'set', nodeId: b.id, hoverAnimation: { name: 'hvr-grow', scale: 1.2 } },
  ]);
  assert.equal(errors.length, 0);
  const css = pageData.sections[0].general.sectionStyles;
  assert.ok(css.includes(`.animate__fadeInUp-${h.id}{animation:fadeInUp-${h.id} 2s linear .5s forwards!important`));
  assert.ok(css.includes(`.${b.id},.c${b.id}{--hover-duration:0.3s;--hover-delay:0s;--hover-easing:ease-in-out;--hover-scale:1.2}`));
  assert.ok(verifyEdits(pageData, report).every((v) => v.applied));
  // A second set replaces the first, knobs and rules alike.
  const again = applyPageEdits(pageData, [{ op: 'set', nodeId: h.id, entranceAnimation: { name: 'zoomIn', duration: 1 } }]).pageData;
  const hn = again.sections[0].elements.find((e) => e.id === h.id);
  assert.equal(hn.class.animationDelay, undefined);
  assert.ok(!again.sections[0].general.sectionStyles.includes('fadeInUp'));
  assert.match(applyPageEdits(pd, [{ op: 'set', nodeId: h.id, hoverAnimation: { name: 'hvr-grow' } }]).errors[0].error, /buttons only/);
  assert.match(applyPageEdits(pd, [{ op: 'set', nodeId: 'row-A', hoverAnimation: { name: 'hvr-grow' } }]).errors[0].error, /buttons only/);
});

const leafOf = (e, salt) => ({ leaf: makeLeaf({ meta: e.meta, extra: e.html ? { text: { value: e.html } } : {}, salt }), css: '' });

test('a popup: builder node shapes, page-level CSS with its chosen width, and an empty one is refused', () => {
  resetIds();
  const p = makePopup({ name: 'Offer', width: 'medium', showOn: { delay: 2 }, columns: [{ elements: [{ meta: 'heading', html: '<h2>Hi</h2>' }] }] }, 0, leafOf);
  const [node, row, col, leaf] = p.entry.elements;
  assert.equal(node.meta, 'hl_main_popup');
  assert.equal(p.entry.activeElementId, node.id);
  assert.deepEqual(node.child, [row.id]);
  assert.deepEqual(row.child, [col.id]);
  assert.deepEqual(col.child, [leaf.id]);
  assert.deepEqual(node.extra.showPopupOnMouseOut, { value: 'delay', delay: 2 });
  assert.deepEqual(node.extra.minWidth, { value: 'medium-page' });
  assert.ok(p.css.includes(`#${node.id}.popup-body{position:absolute!important;left:50%!important`));
  assert.ok(p.css.includes('width:720px}'));
  assert.throws(() => makePopup({ name: 'Empty', columns: [{ elements: [] }] }, 1, leafOf), /never renders a popup with no content/);
  assert.throws(() => makePopup({ name: 'X', showOn: 'hover', columns: [{ elements: [{ meta: 'heading' }] }] }, 2, leafOf), /showOn/);
});

test('openPopup must name a popup on the page', () => {
  const pd = page();
  pd.sections[0].elements[3].extra.action = { value: 'openPopup' };
  pd.sections[0].elements[3].extra.popupId = { value: 'hl_main_popup-NOPE' };
  assert.equal(popupRefProblems(pd).length, 1);
  assert.equal(popupRefProblems(pd, new Set(['other'])).length, 0);
});

test('compose preview: popups + a button that opens one; an unknown popup name is refused before any write', async () => {
  const calls = [];
  const deps = { state: {}, makeGw: () => ({ call: async (...a) => { calls.push(a); return { ok: true, status: 200, json: {} }; } }) };
  const base = { locationId: 'LOC', funnelId: 'F1', pageId: 'P1', stepId: 'S1' };
  const good = await tool.handler({ ...base,
    popups: [{ name: 'Offer', showOn: 'exit', columns: [{ elements: [{ meta: 'heading', html: '<h2>Wait</h2>' }] }] }],
    sections: [{ sticky: 'top', width: 'wide', columns: [{ elements: [
      { meta: 'heading', html: '<h1>Hi</h1>', entranceAnimation: { name: 'fadeIn', duration: 1 } },
      { meta: 'button', extra: { text: { value: 'Open' } }, openPopup: 'Offer', hoverAnimation: { name: 'hvr-grow', scale: 1.1 } }] }] }] }, deps);
  assert.equal(good.code, 'CONFIRM_REQUIRED');
  assert.equal(calls.length, 0);
  const bad = await tool.handler({ ...base, sections: [{ columns: [{ elements: [{ meta: 'button', openPopup: 'Nope' }] }] }] }, deps);
  assert.equal(bad.code, 'VALIDATION_FAILED');
  assert.match(bad.detail ?? bad.message ?? JSON.stringify(bad), /names no popup/);
  const both = await tool.handler({ ...base, sections: [{ fullWidthRows: true, maxWidth: 900, columns: [{ elements: [{ meta: 'heading' }] }] }] }, deps);
  assert.equal(both.code, 'VALIDATION_FAILED');
  const hoverHeading = await tool.handler({ ...base, sections: [{ columns: [{ elements: [{ meta: 'heading', hoverAnimation: { name: 'hvr-grow' } }] }] }] }, deps);
  assert.equal(hoverHeading.code, 'VALIDATION_FAILED');
});
