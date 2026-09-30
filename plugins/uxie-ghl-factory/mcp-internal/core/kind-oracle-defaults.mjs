// Fresh-node values the page builder writes at RUNTIME, which neither its element registry nor createNewElement run offline can produce
// (they read the page's settings, the clock, or a component's own tag). Measured from nodes the builder itself made — Quick Add of each kind
// + a builder Save on a scratch page, read back on a separate request (knowledge sniffs/funnels-wave42-f7-defaults-2026-09-30, PROOF.md),
// and pinned by test/kind-oracle-defaults.test.mjs against test/fixtures/builder-created-nodes.json.
//
//  - tagName: the day and minute timers are the countdown COMPONENT (`c-countdown`); the registry says null, and a node with no tagName
//    renders nothing in the builder canvas (the bare timers of 1.18.0-1.34.0).
//  - typography: `changeToRootVar(DEFAULT_SETTINGS.typography.fonts.<x>.id)` — the page's content font for the timers, its headline font
//    for the navigation menu — unresolved in the offline factory, so the tables carry "".
//  - startDate/endDate: a fresh countdown is dated at the moment it is made (both the same instant).
//  - navigation menu styles/extras: the builder's fresh node differs from the registry values the older table copied (hover, spacing, align,
//    font size, search icon, chevron); its CONTENT (sample menu items, the sample logo, "Business Name") is deliberately not copied: a caller
//    names the menu, and a stock logo would publish on a client's page.
//  - blog: a fresh Blog element lists 6 posts per page (the registry default 3 predates it) with no max on the field.

// Props the catalogue declares for a kind but the builder's fresh node does not carry, and a builder Save DROPS (measured: the four
// webinar* props of a page countdown are on the tool's node before the save and gone after it). Left off unless the caller names them.
export const KIND_OMIT_EXTRA = Object.freeze({ countdown: /^webinar/ });

export const KIND_TAGNAME = Object.freeze({ 'day-timer': 'c-countdown', 'minute-timer': 'c-countdown' });

const val = (v) => ({ value: v });
const TIMER_TYPOGRAPHY = { typography: val('var(--contentfont)') };

/** Extra props by kind. A function receives the clock's ISO string (so a test can pin it). */
export const KIND_ORACLE_EXTRA = Object.freeze({
  countdown: (now) => ({ ...TIMER_TYPOGRAPHY, startDate: val(now), endDate: val(now) }),
  'day-timer': () => ({ ...TIMER_TYPOGRAPHY }),
  'minute-timer': () => ({ ...TIMER_TYPOGRAPHY }),
  'nav-menu-v2': () => ({
    typography: val('var(--headlinefont)'),
    desktopFontSize: { value: 14, unit: 'px' }, mobileFontSize: { value: 14, unit: 'px' },
    showSearchbar: val(false),
    iconEnd: val({ name: 'chevron-down', unicode: 'f078', fontFamily: 'Font Awesome 5 Free', color: 'var(--black)' }),
  }),
  blog: () => ({ paginationOverride: { value: 6, min: 0 } }),
});

/** Style props by kind (written under the caller's own styles). */
export const KIND_ORACLE_STYLES = Object.freeze({
  'nav-menu-v2': Object.freeze({
    hoverBackgroundColor: val('var(--cobalt)'),
    navMenuItemSpacingX: { value: 12, unit: 'px' },
    navMenuAlign: val('left'),
    borderColor: val('var(--black)'),
    itemBorderWidth: val('1px'),
    itemBorderRadius: val('0px'),
  }),
  // the fresh Blog: a filled cobalt "More stories" button, section padding 0 / 10 / 0 / 40 and no border (the tool's older gray outlined button came from a template)
  blog: Object.freeze({
    buttonColor: val('var(--cobalt)'), buttonTextColor: val('var(--white)'), buttonBorderColor: val('var(--white)'),
    paddingLeft: { value: 0, unit: 'px' }, paddingRight: { value: 0, unit: 'px' }, paddingBottom: { value: 40, unit: 'px' },
    borderWidth: val('0px'), borderStyle: val('none'),
  }),
});
