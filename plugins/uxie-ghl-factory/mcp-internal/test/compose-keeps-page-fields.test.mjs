// fn-7 (2026-11-08): a FULL build_funnel_page write keeps the page fields the full build cannot send.
//
// Measured on the TEST-CONF-FN5 page: a full build republish wiped the page's header code (M1b). The full build
// composes the page from scratch and used to write trackingCode {headerCode:'', footerCode:''} unconditionally
// (core/funnel-pages.mjs buildPageData), with no droppedContent and audit "clean". The same compose also reset the
// raw custom CSS (general.general.pageStyles), custom fonts, page background, typography, palette colours and
// fonts-to-load. The full build's top-level schema cannot send trackingCode, customCss, customFonts or background,
// so the stored values are kept. Popups are the one field the caller replaces by sending `popups`: when the caller
// does not send them, stored popups would be dropped, so the write is refused and nothing is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

const tool = TOOLS.find((t) => t.name === 'build_funnel_page');

const SECTION = {
  background: '#fff',
  columns: [{ widthPct: 100, elements: [{ meta: 'heading', html: 'Hello', tag: 'h1' }] }],
};
const base = { locationId: 'LOC', funnelId: 'F1', pageId: 'P1', stepId: 'S1', sections: [SECTION], confirm: true };

const HEADER = '<script type="application/ld+json">{"@type":"LocalBusiness","name":"TEST-CONF-FN6"}</script>';
const FOOTER = '<!-- chat widget -->';
const CUSTOM_CSS = '.custom-rule{color:red}';

// The page as it is stored before the compose: header and footer code, custom CSS, custom font, background,
// typography, palette colours, fonts to load, and one popup.
const storedPage = () => ({
  funnelId: 'F1', locationId: 'LOC', pageId: 'P1', id: 'P1', stepId: 'S1',
  sections: [],
  settings: { settings: {
    background: { bgImage: { value: { url: '' } }, backgroundColor: { value: '#fafafa' } },
    typography: {
      fonts: {
        headlineFont: { id: 'headlinefont', text: 'Headline Font', value: { text: 'Brand', value: 'var(--headlinefont)' }, isCustom: true },
        contentFont: { id: 'contentfont', text: 'Content Font', value: { text: 'Default', value: 'inherit' }, isCustom: false } },
      colors: { textColor: { value: { label: 'var(--black)', value: '#111111' } }, linkColor: { value: { label: 'var(--blue)', value: '#188bf6' } } } },
  } },
  general: { general: {
    colors: [{ label: 'Brand', value: '#123456' }],
    fontsToLoad: ['Lato'], fontsToLoadForPreview: ['Lato'],
    pageStyles: CUSTOM_CSS,
    customFonts: [{ name: 'Brand', url: 'https://fonts.example/brand.woff2', id: 'cf1', format: 'woff2' }],
  } },
  pageStyles: `:root{--headlinefont:'Brand'}${CUSTOM_CSS}`,
  popupsList: [],
  trackingCode: { headerCode: HEADER, footerCode: FOOTER },
});

// Serves the stored page until the first autosave; after it, echoes back the sections that were saved, so the
// read-back verification passes. Keeps every call for assertions.
const deps = ({ stored = storedPage(), calls = [], storedStatus = 200 }) => ({
  state: {},
  makeGw: () => ({
    uid: 'USER1',
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      const saved = calls.some((c) => c.path.startsWith('/funnels/builder/autosave/'));
      if (path.startsWith('/funnels/builder/autosave/')) return { ok: true, status: 201, json: { ok: true } };
      if (path.startsWith('/funnels/page/')) return { ok: true, status: 200, json: { _id: 'P1', meta: { title: 'Kept title' } } };
      if (path.startsWith('/funnels/builder/page/data')) {
        if (!saved) return storedStatus === 200 ? { ok: true, status: 200, json: stored } : { ok: false, status: storedStatus, json: null };
        const save = calls.find((c) => c.path.startsWith('/funnels/builder/autosave/'));
        return { ok: true, status: 200, json: { sections: (save?.body?.pageData?.sections ?? []).map((s) => ({ id: s.id })) } };
      }
      if (path.startsWith('/funnels/builder/get-versions')) return { ok: true, status: 200, json: [] };
      throw new Error(`unexpected call ${method} ${path}`);
    },
  }),
});

const savedPageData = (calls) => calls.find((c) => c.path.startsWith('/funnels/builder/autosave/'))?.body?.pageData;

test('a full compose keeps the stored header AND footer code (not blank)', async () => {
  const calls = [];
  const res = await tool.handler({ ...base }, deps({ calls }));
  assert.equal(res.ok, true, `compose must succeed: ${JSON.stringify(res.message ?? res.code)}`);
  const pd = savedPageData(calls);
  assert.ok(pd, 'the autosave body carries the composed page');
  assert.equal(pd.trackingCode.headerCode, HEADER, 'header code survives a full rebuild');
  assert.equal(pd.trackingCode.footerCode, FOOTER, 'footer code survives a full rebuild');
});

test('a full compose keeps the raw custom CSS, custom fonts, page background, typography and palette', async () => {
  const calls = [];
  const res = await tool.handler({ ...base }, deps({ calls }));
  assert.equal(res.ok, true);
  const pd = savedPageData(calls);
  assert.equal(pd.general.general.pageStyles, CUSTOM_CSS, 'raw custom CSS kept');
  assert.ok(pd.pageStyles.includes(CUSTOM_CSS), 'the served sheet still carries the custom CSS');
  assert.deepEqual(pd.general.general.customFonts.map((f) => f.id), ['cf1'], 'custom font kept');
  assert.equal(pd.settings.settings.background.backgroundColor.value, '#fafafa', 'page background kept');
  assert.equal(pd.settings.settings.typography.fonts.headlineFont.value.value, 'var(--headlinefont)', 'headline font kept');
  assert.equal(pd.settings.settings.typography.colors.textColor.value.value, '#111111', 'text colour kept');
  assert.ok(pd.general.general.colors.some((c) => c.value === '#123456'), 'palette colour kept');
  assert.ok(pd.general.general.fontsToLoad.includes('Lato'), 'stored font still loads');
});

test('a full compose on a page with stored popups, without popups, is refused with droppedContent and writes nothing', async () => {
  const calls = [];
  const stored = storedPage();
  stored.popupsList = [{ id: 'pop1', elements: [{ id: 'pop1-root', meta: 'hl_main_popup', title: 'Exit offer' }] }];
  const res = await tool.handler({ ...base }, deps({ calls, stored }));
  assert.equal(res.ok, false, 'dropping stored popups must be refused');
  assert.ok(!calls.some((c) => c.path.startsWith('/funnels/builder/autosave/')), 'nothing is written');
  assert.ok(res.data?.droppedContent?.some((d) => d.field === 'popupsList' && d.names.includes('Exit offer')),
    'the refusal names the popup');
});

test('a brand-new page (no stored page data) still composes', async () => {
  const calls = [];
  const res = await tool.handler({ ...base }, deps({ calls, storedStatus: 404 }));
  assert.equal(res.ok, true, 'nothing stored means nothing to keep');
  assert.ok(savedPageData(calls), 'the page is written');
});

test('the full-build result names what it kept, and only the fields that had stored content', async () => {
  const res = await tool.handler({ ...base }, deps({ calls: [] }));
  assert.equal(res.ok, true);
  for (const f of ['headerCode', 'footerCode', 'customCss', 'customFonts', 'background', 'headlineFont', 'textColor', 'rootVariables']) {
    assert.ok(res.data.kept.includes(f), `kept names ${f}`);
  }
  // linkColor and contentFont hold the builder's own defaults on the stored page: nothing was kept there.
  assert.ok(!res.data.kept.includes('linkColor'));
  assert.ok(!res.data.kept.includes('contentFont'));
  assert.match(res.data.keptNote, /edit mode/i, 'a one-line note says how to change what was kept');
});

test('a page with nothing stored keeps nothing and names nothing', async () => {
  const res = await tool.handler({ ...base }, deps({ calls: [], storedStatus: 404 }));
  assert.equal(res.ok, true);
  assert.deepEqual(res.data.kept, []);
  assert.equal(res.data.keptNote, undefined);
});

test("the build_funnel_page description says what a full build keeps, what it refuses, and where to change it", () => {
  assert.match(tool.description, /keeps the page's existing header\/footer code, custom CSS, fonts and background/);
  assert.match(tool.description, /refuses .*popups/);
  assert.match(tool.description, /edit mode/);
});

// fn-7b (QA follow-ups a, b): kept lists only real preservations, the preview shows them before approval,
// and a confirm whose preview no longer matches the stored page is refused.

test('a default tool-built page keeps nothing: no colors, fontsToLoad or default is reported, and no keptNote', async () => {
  const first = [];
  await tool.handler({ ...base }, deps({ calls: first, storedStatus: 404 }));
  const built = JSON.parse(JSON.stringify(savedPageData(first)));
  const res = await tool.handler({ ...base }, deps({ calls: [], stored: built }));
  assert.equal(res.ok, true);
  assert.deepEqual(res.data.kept, [], 'the composed page already carries its own palette and fonts');
  assert.equal(res.data.keptNote, undefined);
});

test('the preview reads the stored page and shows what the write keeps and the popup refusal, with no write', async () => {
  const calls = [];
  const stored = storedPage();
  stored.popupsList = [{ id: 'pop1', elements: [{ id: 'pop1-root', meta: 'hl_main_popup', title: 'Exit offer' }] }];
  const res = await tool.handler({ ...base, confirm: false }, deps({ calls, stored }));
  assert.equal(res.code, 'CONFIRM_REQUIRED');
  assert.ok(res.data.preview.kept.includes('headerCode'), 'the preview names what the write keeps');
  assert.ok(res.data.preview.wouldRefuse?.some((d) => d.field === 'popupsList' && d.names.includes('Exit offer')),
    'the preview names the popup refusal before approval');
  assert.equal(typeof res.data.preview.previewToken, 'string', 'the preview returns a token the confirm must match');
  assert.ok(!calls.some((c) => c.path.startsWith('/funnels/builder/autosave/')), 'the preview writes nothing');
});

test('a confirm whose previewToken no longer matches the stored page is PREVIEW_STALE and writes nothing', async () => {
  const p = await tool.handler({ ...base, confirm: false }, deps({ calls: [] }));
  const token = p.data.preview.previewToken;
  const changed = storedPage();
  changed.trackingCode.headerCode = '<script>changed after the preview</script>';
  const calls = [];
  const res = await tool.handler({ ...base, confirm: true, previewToken: token }, deps({ calls, stored: changed }));
  assert.equal(res.code, 'PREVIEW_STALE');
  assert.ok(!calls.some((c) => c.path.startsWith('/funnels/builder/autosave/')), 'nothing is written');
  const matched = await tool.handler({ ...base, confirm: true, previewToken: token }, deps({ calls: [] }));
  assert.equal(matched.ok, true, 'the same stored page confirms against its own preview');
});
