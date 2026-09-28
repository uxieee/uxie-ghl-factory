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

// ── Custom (uploaded) fonts ── measured on a builder-saved page (knowledge sniffs/funnels-wave12-structure-tool-2026-09-28
// live-page.custom-fonts.json; funnels-wave14-object-tools-2026-09-29 reads-custom-font-shape.json):
//   slot   {id, text, value: {text: <name>, value: "'customhl-<fontId>-<name>'"}, isCustom: true}
//   general.general.customFonts [{name, url, id, format}] — the renderer emits @font-face from these
//   :root  --headlinefont: 'customhl-<fontId>-<name>';  --customhl-<fontId>-<slug>: 'customhl-<fontId>-<name>';
//   fontsToLoad does NOT list it (it is not a Google/bunny face).
// A custom font is named by its id from GET /funnels/custom-fonts; uploading one is left to the builder.
export const isCustomFont = (f) => typeof f === 'object' && f !== null && f.custom === true;
export const customFamily = (f) => `customhl-${f.id}-${f.name}`;
export const customTypographyValue = (f) => ({ text: f.name, value: `'${customFamily(f)}'` });

/** The slot object and the :root variables for one typography slot, custom font or family name. */
export function typographySlot(which, font, currentText) {
  const [, varName, label] = TYPOGRAPHY_SLOTS[which];
  if (isCustomFont(font)) {
    const fam = customFamily(font);
    return { slot: { id: varName, text: currentText ?? label, value: customTypographyValue(font), isCustom: true },
      vars: { [`--${varName}`]: `'${fam}'`, [fontSlug(fam)]: `'${fam}'` }, family: null };
  }
  return { slot: { id: varName, text: currentText ?? label, value: typographyValue(font), isCustom: false },
    vars: { [`--${varName}`]: `'${font}'`, [fontSlug(font)]: `'${font}'` }, family: font };
}

/** Record a custom font where the renderer reads it (general.general.customFonts), once per id. */
export function upsertCustomFont(pageData, f) {
  const g = pageData.general?.general;
  if (!g) return;
  const list = (g.customFonts ?? []).filter((x) => x.id !== f.id);
  g.customFonts = [...list, { name: f.name, url: f.url, id: f.id, format: f.format }];
}

/** Resolve {customFontId} against the location's uploaded fonts. */
export async function resolveCustomFont(gw, locationId, id) {
  const r = await gw.call('GET', `/funnels/custom-fonts?locationId=${encodeURIComponent(locationId)}`);
  if (!r.ok) return { res: r, font: null, count: null };
  const rows = Array.isArray(r.json?.data) ? r.json.data : Array.isArray(r.json) ? r.json : [];
  const hit = rows.find((x) => (x._id ?? x.id) === id && x.deleted !== true);
  return { res: r, count: rows.length, font: hit ? { custom: true, id: hit._id ?? hit.id, name: hit.name, url: hit.url, format: hit.format } : null };
}
