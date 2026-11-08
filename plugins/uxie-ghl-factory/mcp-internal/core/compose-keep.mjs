// fn-7 (2026-11-08): what a FULL build_funnel_page write keeps from the page as it is stored.
//
// A full build composes the page from scratch (core/funnel-pages.mjs buildPageData), so every page field the full
// build cannot send was reset on every save, silently: trackingCode to {headerCode:'', footerCode:''} (measured:
// the header block of TEST-CONF-FN5 was gone after a full republish, M1b), and also the raw custom CSS, custom
// fonts, page background, typography, palette colours and fonts to load. The full build's schema has no field for
// trackingCode, customCss, customFonts or background, so a stored value is never blanked by omission.
//
// Popups are the one field the caller replaces by sending `popups`. When it does not send them, stored popups
// would be dropped, so the write is refused (`refused`) and nothing is written.
//
// Pure: takes the composed pageData (mutated and returned) and the stored pageData as read from
// GET /funnels/builder/page/data. Returns what was kept, and what would have been dropped.

import { createHash } from 'node:crypto';

const popupTitle = (p) => p?.elements?.find((e) => e?.meta === 'hl_main_popup')?.title ?? p?.id ?? '?';

// Stored items first, then composed items whose key the stored list does not already hold.
const unionBy = (stored = [], composed = [], keyOf = (x) => x) => {
  const have = new Set(stored.map(keyOf));
  return [...stored, ...composed.filter((c) => !have.has(keyOf(c)))];
};

// The :root custom properties a stylesheet declares, as {'--name': 'value'}.
export function rootVarsOf(css = '') {
  const out = {};
  for (const block of String(css).matchAll(/:root\s*\{([^}]*)\}/g)) {
    // The last declaration of a block may have no ';' before the closing brace.
    for (const d of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) out[d[1]] = d[2].trim();
  }
  return out;
}

/**
 * @param {object} next        the composed pageData (mutated)
 * @param {object|null} stored the stored pageData, or null for a page with no data yet
 * @param {{popupsGiven?: boolean, givenTypography?: object}} opts
 * @returns {{kept: string[], replaced: string[], refused: null|Array<object>}}
 */
export function keepStoredPageFields(next, stored, { popupsGiven = false, givenTypography = {} } = {}) {
  const kept = [];
  const replaced = [];
  if (!stored || typeof stored !== 'object') return { kept, replaced, refused: null };

  // A refusal is reported, not returned early: the preview shows what the write would keep next to it (fn-7b). The
  // write checks `refused` before it sends anything.
  const storedPopups = stored.popupsList ?? [];
  const refused = storedPopups.length && !popupsGiven
    ? [{ field: 'popupsList', storedCount: storedPopups.length, names: storedPopups.map(popupTitle) }] : null;
  if (storedPopups.length && popupsGiven) replaced.push(...storedPopups.map(popupTitle));

  // Header and footer code: a full build cannot send them, so the stored code stands. Blank is never written over it.
  const t = stored.trackingCode ?? {};
  next.trackingCode = { headerCode: t.headerCode ?? '', footerCode: t.footerCode ?? '' };
  if (t.headerCode) kept.push('headerCode');
  if (t.footerCode) kept.push('footerCode');

  // The builder's general block: custom fonts, palette, fonts to load, and the raw custom CSS.
  const sg = stored.general?.general ?? {};
  const ng = next.general?.general;
  if (ng) {
    if (sg.customFonts?.length) { ng.customFonts = unionBy(sg.customFonts, ng.customFonts ?? [], (f) => f?.id); kept.push('customFonts'); }
    // A stored palette entry or font counts as kept only when the composed page does not already carry it: a default
    // page's own palette and fonts are not a preservation (fn-7b).
    const composedColors = ng.colors ?? [];
    const extraColors = (sg.colors ?? []).filter((c) => !composedColors.some((b) => JSON.stringify(b) === JSON.stringify(c)));
    if (extraColors.length) { ng.colors = [...composedColors, ...extraColors]; kept.push('colors'); }
    const composedFonts = ng.fontsToLoad ?? [];
    const extraFonts = (sg.fontsToLoad ?? []).filter((f) => !composedFonts.includes(f));
    if (extraFonts.length) {
      ng.fontsToLoad = [...composedFonts, ...extraFonts];
      ng.fontsToLoadForPreview = unionBy(sg.fontsToLoadForPreview ?? extraFonts, ng.fontsToLoadForPreview ?? []);
      kept.push('fontsToLoad');
    }
    if (sg.pageStyles) { ng.pageStyles = sg.pageStyles; kept.push('customCss'); }
  }

  // The served sheet: the stored custom CSS (appended, as the edit path serves it), and the stored :root variables
  // the composed sheet does not declare (fonts, text and link colours, palette variables).
  let served = next.pageStyles ?? '';
  if (sg.pageStyles && !served.includes(sg.pageStyles)) served += sg.pageStyles;
  const have = rootVarsOf(served);
  const missing = Object.entries(rootVarsOf(stored.pageStyles ?? '')).filter(([k]) => !(k in have));
  if (missing.length) served += `:root{${missing.map(([k, v]) => `${k}:${v};`).join('')}}`;
  next.pageStyles = served;
  if (missing.length) kept.push('rootVariables');

  // Page background and typography: the full build's own arguments cannot set them, except the fonts and colours
  // that `typography` names. Those named keys are the caller's; every other key keeps its stored value.
  const ss = stored.settings?.settings ?? {};
  const ns = next.settings?.settings;
  // Only a value that differs from the builder's own default counts as stored content, so `kept` names what a user set.
  const bg = ss.background;
  if (ns && bg) {
    ns.background = bg;
    if ((bg.backgroundColor?.value ?? 'var(--white)') !== 'var(--white)' || bg.bgImage?.value?.url) kept.push('background');
  }
  const st = ss.typography;
  const nt = ns?.typography;
  if (nt && st) {
    const DEFAULT_FONT = 'inherit';
    const DEFAULT_COLOR = { textColor: '#000000', linkColor: '#188bf6' };
    for (const k of ['headlineFont', 'contentFont']) {
      if (givenTypography[k] === undefined && st.fonts?.[k]) {
        nt.fonts = nt.fonts ?? {}; nt.fonts[k] = st.fonts[k];
        if ((st.fonts[k].value?.value ?? DEFAULT_FONT) !== DEFAULT_FONT) kept.push(k);
      }
    }
    for (const k of ['textColor', 'linkColor']) {
      if (givenTypography[k] === undefined && st.colors?.[k]) {
        nt.colors = nt.colors ?? {}; nt.colors[k] = st.colors[k];
        if ((st.colors[k].value?.value ?? DEFAULT_COLOR[k]) !== DEFAULT_COLOR[k]) kept.push(k);
      }
    }
  }

  return { kept, replaced, refused };
}

/** The one-line note a write result carries when it kept anything (fn-7b: the preview uses the same text). */
export function keptNoteOf(kept) {
  return `Kept from the stored page, which this full build did not send: ${kept.join(', ')}. To change any of them, use edit mode (edits: page, append-popup, remove-popup).`;
}

// Keys sorted at every level, so the same stored content always hashes the same.
const stable = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

/**
 * A fingerprint of the stored fields a full build depends on (the ones keepStoredPageFields reads, and the popups it
 * would refuse on). A preview returns it; a confirm that sends it back is refused with PREVIEW_STALE when it changed.
 * Sections are left out: a builder edit of the nodes does not change what a full build keeps.
 */
export function storedFingerprint(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const g = s.general?.general ?? {};
  const ss = s.settings?.settings ?? {};
  return createHash('sha256').update(stable({
    trackingCode: s.trackingCode ?? null,
    general: { customFonts: g.customFonts ?? null, colors: g.colors ?? null, fontsToLoad: g.fontsToLoad ?? null, pageStyles: g.pageStyles ?? null },
    pageStyles: s.pageStyles ?? null,
    background: ss.background ?? null,
    typography: ss.typography ?? null,
    popups: (s.popupsList ?? []).map((p) => [p?.id ?? null, popupTitle(p)]),
  })).digest('hex');
}
