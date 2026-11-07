// w7-4 (rules 1–3; bl-497, bl-517, bl-529, bl-541): the custom CSS a caller writes is checked before it is trusted.
// Pure: no account call. A clean sheet returns [].
//
// Rules:
//   font-shorthand-inherit            `font: … inherit` mixing inherit with other values: the browser drops the whole declaration (bl-497).
//                                     A lone CSS-wide keyword (`font: inherit`, initial, unset, revert) is valid and not flagged.
//   import-ignored                    `@import`: GHL concatenates page CSS mid-sheet, so the import is ignored (bl-529).
//   mobile-media-no-container-mirror  each `@media (max-width:767px)` block needs its own rules mirrored in a
//                                     `@container (max-width:767px)` block, and `.hl-builder-main-wrapper{container-type:inline-size}`
//                                     must be set, or the mirror never matches: the builder's mobile view is a ~1440 px frame (bl-541).
//   class-level-selector              a compiled property (border-radius) on a selector with no id-level token (`#…`). GHL's compiled
//                                     id-scoped rules outrank class selectors, so the class rule loses on save, with or without
//                                     !important (bl-517). Only id-level !important is measured to win; this checker does not
//                                     assume it for classes. An id-level rule WITHOUT !important is not flagged, but that it wins
//                                     is UNPROVEN: bl-517 measured only the !important case (tracked on bl-517 for the w7 sweep).

const COMPILED_PROPS = Object.freeze(['border-radius']);
const CSS_WIDE = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const CONTAINER_TYPE_SELECTOR = '.hl-builder-main-wrapper';
const MOBILE_MEDIA = /@media\s+(?:only\s+)?(?:screen\s+and\s+)?\(\s*max-width\s*:\s*767px\s*\)/gi;
const MOBILE_CONTAINER = /@container\s+(?:[\w-]+\s+)?\(\s*max-width\s*:\s*767px\s*\)/gi;

const lineOf = (css, index) => css.slice(0, index).split('\n').length;
const normSel = (s) => s.replace(/\s+/g, ' ').trim();

/** Flat `selector{body}` rules in a piece of CSS (an @media or @container wrapper is skipped; its inner rules are read). */
function flatRules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((r) => ({ selector: normSel(r[1]), body: r[2], index: r.index }));
}

/** The text inside the braces that open after `from`, or null when the block never closes. */
function blockAfter(css, from) {
  const open = css.indexOf('{', from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  return null;
}

/** Every at-rule block matched by `re`: {index, rules}. */
function blocksOf(css, re) {
  const out = [];
  for (const m of css.matchAll(re)) {
    const inner = blockAfter(css, m.index + m[0].length);
    if (inner !== null) out.push({ index: m.index, rules: flatRules(inner) });
  }
  return out;
}

/** [{rule, line, why}] for every rule the custom CSS breaks. */
export function cssRuleProblems(css) {
  const text = String(css ?? '');
  const out = [];

  for (const m of text.matchAll(/(?:^|[;{}\s])font\s*:([^;{}]*)/gi)) {
    const value = m[1].replace(/!\s*important/i, '').trim().toLowerCase();
    if (CSS_WIDE.has(value) || !/\binherit\b/.test(value)) continue;
    out.push({
      rule: 'font-shorthand-inherit',
      line: lineOf(text, m.index + m[0].toLowerCase().indexOf('font')),
      why: 'a font shorthand that mixes inherit with other values is dropped by the browser, so the whole declaration is lost; set the font-* properties separately (bl-497).',
    });
  }

  for (const m of text.matchAll(/@import\b/gi)) {
    out.push({
      rule: 'import-ignored',
      line: lineOf(text, m.index),
      why: 'an @import is ignored: GHL concatenates page CSS mid-sheet. Load fonts through the page settings, not an import (bl-529).',
    });
  }

  const mobile = blocksOf(text, MOBILE_MEDIA);
  if (mobile.length) {
    const mirrored = new Set(blocksOf(text, MOBILE_CONTAINER).flatMap((c) => c.rules.map((r) => r.selector)));
    const containerTyped = flatRules(text).some((r) => r.selector === CONTAINER_TYPE_SELECTOR && /container-type\s*:\s*inline-size/i.test(r.body));
    for (const block of mobile) {
      const missing = block.rules.map((r) => r.selector).filter((s) => !mirrored.has(s));
      if (!missing.length && containerTyped) continue;
      const parts = [];
      if (missing.length) parts.push(`no @container (max-width:767px) mirror for: ${missing.join(', ')}`);
      if (!containerTyped) parts.push(`${CONTAINER_TYPE_SELECTOR}{container-type:inline-size} is not set, so the @container never matches`);
      out.push({
        rule: 'mobile-media-no-container-mirror',
        line: lineOf(text, block.index),
        why: `the builder's mobile view is a ~1440 px frame, so this @media never fires there: ${parts.join('; ')} (bl-541).`,
      });
    }
  }

  for (const r of flatRules(text)) {
    if (/#[\w-]/.test(r.selector)) continue; // id-level: a `#…` token
    for (const d of r.body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:([^;]*)/gi)) {
      const prop = d[1].toLowerCase();
      if (!COMPILED_PROPS.includes(prop)) continue;
      out.push({
        rule: 'class-level-selector',
        line: lineOf(text, r.index),
        why: `${prop} on the class-level selector "${r.selector}": GHL's compiled id-scoped rules outrank class selectors, so the value is lost on save. Write it on the node's id selector (#…) (bl-517).`,
      });
    }
  }

  return out;
}

/**
 * Native gaps: a control the builder does not offer. CSS for these is allowed only when the user asks for it.
 * A gap with a measured recipe carries `selector` and `css` (the checker must pass them). A gap whose recipe is not measured
 * yet carries `css: null` and a `status` naming the measurement; it ships no prose recipe (DECISIONS: bl-542, w7-7).
 */
export const NATIVE_GAPS = Object.freeze([
  Object.freeze({
    id: 'countdown-tile-and-labels',
    what: 'countdown tile background, border and radius; short unit labels (DAYS/HOURS/MINS/SECS as d/h/m/s)',
    bl: 'bl-542',
    cssAllowedOnlyIfAsked: true,
    status: 'gap: recipe pending measurement (w7-7)',
    selector: null,
    css: null,
  }),
  Object.freeze({
    id: 'popup-box-geometry',
    what: 'popup width, radius and padding (desktop)',
    bl: 'bl-544',
    cssAllowedOnlyIfAsked: true,
    selector: '#<popupId>.popup-body',
    css: 'width:560px !important;max-width:calc(100vw - 32px) !important;border-radius:12px !important;padding:32px !important',
    source: 'measured on a production funnel build, 2026-11; evidence on console row bl-544. The popup set operation takes only disabled, closeOnOutsideClick and showOn.',
    note: 'The shipped mobile rule for this popup is a public-only @media (max-width:767px) block with no @container mirror. cssRuleProblems flags that shape, so it is not recommended as-is.',
  }),
]);
