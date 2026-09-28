// Page fonts (bl-267 + page typography): every family goes through a page variable named as the builder names
// it, so a later builder save — which recomputes fontsToLoad from var(--…) references only — keeps it loading.
// Measured: knowledge sniffs/funnels-wave12-structure-tool-2026-09-28/live-page.typography-differential.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { fontSlug, fontRegistry, setRootVars, typographyFamily, typographyRule } from '../core/page-fonts.mjs';
import { applyPageEdits, verifyEdits } from '../core/page-edit.mjs';

const tool = TOOLS.find((t) => t.name === 'build_funnel_page');

test('slugs are the builder\'s createRootVarLabel: deterministic, same font = same var', () => {
  assert.equal(fontSlug('Playfair Display'), '--playfair-display');
  assert.equal(fontSlug("'Lobster'"), '--lobster');
  assert.equal(fontSlug('Playfair Display'), fontSlug('Playfair Display'));
  const reg = fontRegistry();
  assert.equal(reg.ref('Playfair Display'), 'var(--playfair-display)');
  assert.equal(reg.ref('Playfair Display'), 'var(--playfair-display)');
  assert.deepEqual(reg.families(), ['Playfair Display']);
});

test('two different families never share a slug — a clash is refused', () => {
  const reg = fontRegistry(['Open Sans']);
  assert.throws(() => reg.ref('open-sans'), /would share the page variable --open-sans/);
  assert.throws(() => fontRegistry(['Open Sans', 'OPEN SANS']), /would share/);
  // distinct names, distinct slugs
  const r2 = fontRegistry(['Lato', 'Lora']);
  assert.deepEqual(Object.keys(r2.vars()), ['--lato', '--lora']);
});

test('generic keywords, var() values and fallback stacks', () => {
  const reg = fontRegistry();
  assert.equal(reg.ref('inherit'), 'inherit');
  assert.equal(reg.ref('var(--headlinefont)'), 'var(--headlinefont)');
  assert.equal(reg.ref('Inter, sans-serif'), 'var(--inter), sans-serif');
  assert.deepEqual(reg.families(), ['Inter']);
});

test(':root variables are rewritten in place (the builder block must not win), missing ones prepended', () => {
  const builder = ":root{ --white: #ffffff;\n--headlinefont: 'Default';\n--contentfont: 'Default'; } .x{} custom";
  const out = setRootVars(builder, { '--headlinefont': "'Playfair Display'", '--lato': "'Lato'" });
  assert.ok(out.includes("--headlinefont: 'Playfair Display';"));
  assert.ok(out.startsWith(":root{--lato:'Lato'}"));
  assert.ok(out.endsWith('custom'));
  assert.equal(setRootVars('', {}), '');
});

const deps = () => ({ state: {}, makeGw: () => ({ call: async () => { throw new Error('no network in a preview'); } }) });
const base = { locationId: 'LOC', funnelId: 'F1', pageId: 'P1', stepId: 'S1' };

test('compose preview accepts page typography, font: headline and literal fonts', async () => {
  // Capture the page the tool would write by making the preview fail open: read it off the audit path instead.
  const r = await tool.handler({ ...base, typography: { headlineFont: 'Playfair Display' },
    sections: [{ columns: [{ elements: [
      { meta: 'heading', html: '<h1>A</h1>', font: 'headline' },
      { meta: 'heading', html: '<h2>B</h2>', css: { font: 'Lobster', color: '#111', size: 30 } },
      { meta: 'paragraph', html: '<p>C</p>', styles: { fontFamily: { value: 'Lato' } } },
    ] }] }] }, deps());
  assert.equal(r.code, 'CONFIRM_REQUIRED');
});

test('font: headline without page typography is refused (it would reference an unset variable)', async () => {
  const r = await tool.handler({ ...base, sections: [{ columns: [{ elements: [{ meta: 'heading', font: 'headline' }] }] }] }, deps());
  assert.equal(r.code, 'VALIDATION_FAILED');
  assert.match(JSON.stringify(r), /has none set/);
  const clash = await tool.handler({ ...base, sections: [{ columns: [{ elements: [
    { meta: 'heading', css: { font: 'Open Sans', color: '#000', size: 20 } }, { meta: 'paragraph', css: { font: 'open-sans', color: '#000', size: 16 } }] }] }] }, deps());
  assert.equal(clash.code, 'VALIDATION_FAILED');
});

test('compose writes what the builder keeps: var rules, fontsToLoad, :root, typography setting', async () => {
  let written = null;
  const d = { state: {}, rereadOptions: { tries: 1, delays: [0] }, makeGw: () => ({ uid: 'U', call: async (method, path, body) => {
    if (path.startsWith('/funnels/builder/autosave/')) { written = body.pageData; return { ok: true, status: 201, json: {} }; }
    if (path.startsWith('/funnels/builder/page/data')) return { ok: true, status: 200, json: written ?? {} };
    if (path.startsWith('/funnels/page/')) return { ok: true, status: 200, json: { meta: {} } };
    return { ok: true, status: 200, json: [] };
  } }) };
  await tool.handler({ ...base, confirm: true, typography: { headlineFont: 'Playfair Display', contentFont: 'Lato' },
    sections: [{ columns: [{ elements: [
      { meta: 'heading', html: '<h1>A</h1>', font: 'headline' },
      { meta: 'heading', html: '<h2>B</h2>', css: { font: 'Lobster', color: '#111', size: 30 } },
    ] }] }] }, d);
  assert.ok(written, 'autosave body captured');
  const css = written.sections[0].general.sectionStyles;
  const [h1, h2] = written.sections[0].elements.filter((e) => e.type === 'element');
  assert.ok(css.includes(typographyRule(h1.id, 'headline')));
  assert.deepEqual(h1.extra.typography, { value: 'var(--headlinefont)' });
  assert.ok(css.includes(`.c${h2.id}{font-family:var(--lobster);`));
  assert.deepEqual(h2.styles.fontFamily, { value: 'var(--lobster)' });
  for (const f of ['Lobster', 'Playfair Display', 'Lato']) assert.ok(written.general.general.fontsToLoad.includes(f), f);
  assert.match(written.pageStyles, /--headlinefont:'Playfair Display'/);
  assert.match(written.pageStyles, /--lobster:'Lobster'/);
  assert.deepEqual(written.settings.settings.typography.fonts.headlineFont.value, { text: 'Playfair Display', value: 'var(--playfair-display)' });
  assert.equal(typographyFamily(written, 'content'), 'Lato');
});

test('edit: page typography op writes setting + fontsToLoad + :root in place, and verifies all three', () => {
  const pd = { settings: { settings: { typography: { fonts: { headlineFont: { id: 'headlinefont', text: 'Headline Font', value: { text: 'Default', value: 'inherit' } }, contentFont: { id: 'contentfont', text: 'Content Font', value: { text: 'Default', value: 'inherit' } } } } } },
    general: { general: { fontsToLoad: ['Arial'] } }, pageStyles: ":root{ --headlinefont: 'Default'; }", sections: [] };
  const { pageData, report, errors } = applyPageEdits(pd, [{ op: 'page', typography: { headlineFont: 'Playfair Display' } }]);
  assert.equal(errors.length, 0);
  assert.equal(typographyFamily(pageData, 'headline'), 'Playfair Display');
  assert.deepEqual(pageData.general.general.fontsToLoad, ['Arial', 'Playfair Display']);
  assert.ok(pageData.pageStyles.includes("--headlinefont: 'Playfair Display'"));
  assert.ok(pageData.pageStyles.includes("--playfair-display:'Playfair Display'"));
  assert.ok(verifyEdits(pageData, report).every((v) => v.applied));
  assert.equal(verifyEdits(pd, report)[0].applied, false);
});

// Custom (uploaded) fonts: the builder's own stored shape, read off a builder-saved page
// (knowledge sniffs/funnels-wave14-object-tools-2026-09-29 reads-custom-font-shape.json).
const FONT_ROW = { _id: 'CF1', name: 'Pacifico Regular', fontFamily: 'Pacifico', format: 'ttf', url: 'https://cdn.example/media/f.ttf', deleted: false };
const fontDeps = (rows = [FONT_ROW]) => {
  let written = null;
  return { get written() { return written; }, state: {}, rereadOptions: { tries: 1, delays: [0] }, makeGw: () => ({ uid: 'U', call: async (method, path, body) => {
    if (path.startsWith('/funnels/custom-fonts')) return { ok: true, status: 200, json: { data: rows } };
    if (path.startsWith('/funnels/builder/autosave/')) { written = body.pageData; return { ok: true, status: 201, json: {} }; }
    if (path.startsWith('/funnels/builder/page/data')) return { ok: true, status: 200, json: written ?? {} };
    if (path.startsWith('/funnels/page/')) return { ok: true, status: 200, json: { meta: {} } };
    return { ok: true, status: 200, json: [] };
  } }) };
};

test('custom font by id: the builder\'s slot shape, a customFonts entry, :root vars, and NOT in fontsToLoad', async () => {
  const d = fontDeps();
  const r = await tool.handler({ ...base, confirm: true, typography: { headlineFont: { customFontId: 'CF1' }, contentFont: 'Lato' },
    sections: [{ columns: [{ elements: [{ meta: 'heading', html: '<h1>A</h1>', font: 'headline' }] }] }] }, d);
  assert.equal(r.ok, true, JSON.stringify(r));
  const pd = d.written;
  assert.deepEqual(pd.settings.settings.typography.fonts.headlineFont.value, { text: 'Pacifico Regular', value: "'customhl-CF1-Pacifico Regular'" });
  assert.equal(pd.settings.settings.typography.fonts.headlineFont.isCustom, true);
  assert.deepEqual(pd.general.general.customFonts, [{ name: 'Pacifico Regular', url: 'https://cdn.example/media/f.ttf', id: 'CF1', format: 'ttf' }]);
  assert.ok(!pd.general.general.fontsToLoad.some((f) => /Pacifico|customhl/.test(f)));
  assert.ok(pd.general.general.fontsToLoad.includes('Lato'));
  assert.match(pd.pageStyles, /--headlinefont:\s*'customhl-CF1-Pacifico Regular'/);
  assert.match(pd.pageStyles, /--customhl-cf1-pacifico-regular:\s*'customhl-CF1-Pacifico Regular'/);
});

test('an unknown custom font id is refused before anything is composed', async () => {
  const d = fontDeps([]);
  const r = await tool.handler({ ...base, confirm: true, typography: { headlineFont: { customFontId: 'NOPE' } }, sections: [{ columns: [{ elements: [{ meta: 'heading' }] }] }] }, d);
  assert.equal(r.code, 'VALIDATION_FAILED');
  assert.match(r.detail, /not on this location/);
  assert.equal(d.written, null);
});

test('edit: page op typography with a custom font writes and verifies the same three stores', () => {
  const f = { custom: true, id: 'CF1', name: 'Pacifico Regular', url: 'https://cdn.example/media/f.ttf', format: 'ttf' };
  const pd = { settings: { settings: { typography: { fonts: { headlineFont: { id: 'headlinefont', text: 'Headline Font', value: { text: 'Default', value: 'inherit' } } } } } },
    general: { general: { fontsToLoad: ['Arial'] } }, pageStyles: ":root{ --headlinefont: 'Default'; }", sections: [] };
  const { pageData, report, errors } = applyPageEdits(pd, [{ op: 'page', typography: { headlineFont: f } }]);
  assert.equal(errors.length, 0);
  assert.equal(pageData.settings.settings.typography.fonts.headlineFont.isCustom, true);
  assert.deepEqual(pageData.general.general.fontsToLoad, ['Arial']);
  assert.equal(pageData.general.general.customFonts[0].id, 'CF1');
  assert.ok(verifyEdits(pageData, report).every((v) => v.applied), JSON.stringify(verifyEdits(pageData, report)));
  assert.equal(verifyEdits(pd, report)[0].applied, false);
});
