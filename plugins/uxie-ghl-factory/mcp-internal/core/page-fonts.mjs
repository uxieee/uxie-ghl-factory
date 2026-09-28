// Fonts on a funnel page: how a font must be written so that it loads today AND after anyone saves the page
// in the builder.
//
// Measured 2026-09-28 (knowledge sniffs/funnels-wave12-structure-tool-2026-09-28
// live-page.typography-differential.json):
// - the public page requests the faces listed in `general.general.fontsToLoad`;
// - the builder RECOMPUTES that list on every save from the fonts elements reference through `var(--…)` only
//   (its getFontsAppliedToElements → resolveFontVarReferences). A node written with a LITERAL family
//   (`font-family:Lobster`) keeps its rule but drops out of the list, so its face stops loading; written as
//   `var(--lobster)` with `--lobster:'Lobster'` in the page's `:root`, it survived a builder save and loaded;
// - `--headlinefont` / `--contentfont` exist only as `:root` declarations in `pageData.pageStyles` — the
//   renderer does not derive them from `settings.typography` — and an element uses them only through a
//   compiled `font-family:var(--headlinefont)` rule (what the builder compiles from `extra.typography`).
// So every family the tool writes goes through a variable named the way the builder names it.

// The builder's createRootVarLabel: `--` + the family, quotes dropped, spaces → hyphens, lower-cased.
export const fontSlug = (family) => `--${String(family).trim().replace(/'/g, '').replace(/"/g, '').replace(/ /g, '-').toLowerCase()}`;

const GENERIC = new Set(['inherit', 'initial', 'unset', 'revert', 'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'emoji', 'math', 'fangsong', '']);

/**
 * A registry of the families a page uses. `ref(value)` turns a CSS font-family value into the builder's
 * shape — the first family as `var(--slug)`, any fallback stack kept after it — and records the family.
 * Generic keywords and values that are already a var() pass through untouched. Two DIFFERENT family names
 * that would share a slug (the builder's scheme maps "Open Sans" and "open-sans" to one variable) are
 * refused: one variable cannot carry two faces.
 */
export function fontRegistry(initial = []) {
  const bySlug = new Map();
  const add = (family) => {
    const f = String(family).trim().replace(/^['"]|['"]$/g, '');
    if (!f || GENERIC.has(f.toLowerCase()) || /\(/.test(f)) return null;
    const slug = fontSlug(f);
    const had = bySlug.get(slug);
    if (had !== undefined && had !== f) {
      throw Object.assign(new Error(`fonts "${had}" and "${f}" would share the page variable ${slug}; the builder names a font's variable by its lower-cased, hyphenated name`), { remediation: 'Spell each font family one way on the page.' });
    }
    bySlug.set(slug, f);
    return slug;
  };
  for (const f of initial) add(f);
  return {
    add,
    ref(value) {
      if (value == null) return value;
      const v = String(value).trim();
      if (!v || /^var\(/i.test(v)) return value;
      const [first, ...rest] = v.split(',');
      const slug = add(first);
      if (!slug) return value;
      return [`var(${slug})`, ...rest.map((s) => s.trim())].join(', ');
    },
    families: () => [...bySlug.values()],
    vars: () => Object.fromEntries([...bySlug.entries()].map(([slug, f]) => [slug, `'${f}'`])),
  };
}

// The builder's typography setting shape (settings.settings.typography.fonts.<which>Font).
export const TYPOGRAPHY_SLOTS = Object.freeze({ headline: ['headlineFont', 'headlinefont', 'Headline Font'], content: ['contentFont', 'contentfont', 'Content Font'] });
export const typographyValue = (family) => ({ text: family, value: `var(${fontSlug(family)})` });

/** Is this page slot set to a real font (not the builder's `Default` / inherit)? */
export function typographyFamily(pageData, which) {
  const [key] = TYPOGRAPHY_SLOTS[which];
  const v = pageData?.settings?.settings?.typography?.fonts?.[key]?.value;
  if (!v || !v.text || v.value === 'inherit' || v.text === 'Default') return null;
  return v.text;
}

/**
 * Set one or more `--name: 'value'` declarations in a page stylesheet. A declaration that already exists is
 * rewritten in place (the builder's own `:root{ … --headlinefont: 'Default'; … }` block must not win the
 * cascade over ours); the rest go into a `:root{}` block at the START, so a custom-CSS suffix stays the suffix.
 */
export function setRootVars(pageStyles, vars) {
  let css = pageStyles ?? '';
  const missing = {};
  for (const [name, value] of Object.entries(vars)) {
    const re = new RegExp(`(${name.replace(/[-]/g, '\\-')}\\s*:\\s*)[^;}]*`, 'g');
    if (re.test(css)) css = css.replace(re, `$1${value}`);
    else missing[name] = value;
  }
  const block = Object.entries(missing).map(([n, v]) => `${n}:${v}`).join(';');
  return block ? `:root{${block}}${css}` : css;
}

/** The compiled rule the builder writes for a text node whose extra.typography names a page font. */
export const typographyRule = (id, which) => `.hl_page-preview--content .c${id}{font-family:var(--${TYPOGRAPHY_SLOTS[which][1]})}`;
