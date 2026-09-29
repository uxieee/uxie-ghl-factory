// Form elements the public widget will actually render. GHL stores `formData.form.fields` verbatim — no
// defaults, no validation — and the widget renders each element by its `type`. An element with no `type`
// is dropped from the render entirely (no label, no input), while the save, the read-back and the widget's
// data payload all still carry it. create_form shipped a webinar registration form whose name and email
// had no type: the page showed a lone Register button, and GHL accepted the blank submit and created a
// contact with no name and no email (knowledge sniffs/funnels-wave23-form-fields-2026-09-29:
// live-render-differential.json proves `type` alone decides rendering; `standard` and
// `hiddenFieldQueryKey` do not).
//
// The table is the form builder's own `standardFields` (formBuilder src/util/methods.ts, mined
// knowledge sniffs/funnels-completeness-2026-09-29/mined-formBuilder-2026-09-29; the 46 rows are listed in c-stdfields.txt):
// the tags that are built-in contact fields, with the renderer `type`, the hiddenFieldQueryKey and the `required` default
// the builder applies client-side before it saves. Until 2026-09-29 it was copied from a corpus table that disagreed
// with the builder on three tags — `image` → 'image' (the widget renders only `type:"img"`, so the image was dropped),
// `country` → 'text' (the builder's country is a `select` dropdown), `group_address` → 'group_address' (the builder
// writes `group` plus `form.address`, below). None of those three had ever been rendered live.

/** Built-in element tag → the builder's renderer, query key and required default (absent = not required). */
export const STANDARD_ELEMENTS = Object.freeze({
  full_name: { type: 'text' },
  first_name: { type: 'text' },
  last_name: { type: 'text' },
  date_of_birth: { type: 'date' },
  phone: { type: 'text', required: true },
  email: { type: 'email', required: true },
  button: { type: 'submit' },
  group_address: { type: 'group', key: 'addressId', label: 'Address', placeholder: 'Street Address' },
  address: { type: 'text' },
  city: { type: 'text' },
  state: { type: 'text' },
  country: { type: 'select' },
  postal_code: { type: 'text' },
  organization: { type: 'text' },
  website: { type: 'text' },
  image: { type: 'img' },
  header: { type: 'h1' },
  html: { type: 'html' },
  captcha: { type: 'captcha' },
  source: { type: 'source' },
  terms_and_conditions: { type: 'terms_and_conditions', required: true },
});

// Tags the builder numbers per occurrence (`header_1`, `image_2`) for their hiddenFieldQueryKey.
const NUMBERED = new Set(['header', 'html', 'image']);

/** Every renderer the builder writes and the form widget dispatches (standard elements plus the question kinds). */
export const RENDERERS = Object.freeze([
  'text', 'email', 'date', 'submit', 'payment', 'group', 'img', 'h1', 'html', 'captcha', 'source',
  'terms_and_conditions', 'textarea', 'large_text', 'textbox_list', 'single_options', 'multiple_options', 'radio', 'checkbox',
  'numerical', 'number', 'phone', 'monetory', 'file_upload', 'signature', 'url', 'rating', 'score', 'select',
]);

// ── The address group ── the builder's composite "Address" element. On drop it takes the street/city/state/country/
// postal-code elements OUT of the list into `addressSettings.children` (a caller's own copy of one wins over the
// default); on save it writes `form.address` = addressSettings AND splices the children back into `fields` right after
// the group element (formBuilder BuilderHeader.vue formDataToBeSubmitted; util/default.ts defaultAddressSettings).
// Labels and placeholders are the builder's English strings (src/locales/en.json fields.address.*).
export const ADDRESS_CHILDREN = Object.freeze([
  { label: 'Street Address', tag: 'address', hiddenFieldQueryKey: 'address', type: 'text', placeholder: 'Enter your full address', required: false, standard: true },
  { label: 'City', tag: 'city', hiddenFieldQueryKey: 'city', type: 'text', placeholder: 'Enter your city', required: false, standard: true },
  { label: 'State', tag: 'state', hiddenFieldQueryKey: 'state', type: 'text', placeholder: 'Enter your state', required: false, standard: true },
  { label: 'Country', tag: 'country', hiddenFieldQueryKey: 'country', type: 'select', placeholder: 'Enter your country', required: false, standard: true },
  { label: 'Postal Code', tag: 'postal_code', hiddenFieldQueryKey: 'postal_code', type: 'text', placeholder: 'ZIP or postal code', required: false, standard: true },
].map(Object.freeze));
const CHILD_TAGS = new Set(ADDRESS_CHILDREN.map((c) => c.tag));
/**
 * The builder's save of an address group: `fields` with the five children right after the group element (the caller's
 * own child elements moved there, defaults for the rest) and the `form.address` settings. No group → unchanged, null.
 */
export function addressGroup(fields) {
  const list = fields ?? [];
  const at = list.findIndex((f) => f?.tag === 'group_address');
  if (at === -1) return { fields: list, address: null };
  const own = new Map(list.filter((f) => CHILD_TAGS.has(f?.tag)).map((f) => [f.tag, f]));
  const children = ADDRESS_CHILDREN.map((c) => ({ ...c, ...(own.get(c.tag) ?? {}) }));
  const rest = list.filter((f) => !CHILD_TAGS.has(f?.tag));
  const g = rest.findIndex((f) => f?.tag === 'group_address');
  return {
    fields: [...rest.slice(0, g + 1), ...children, ...rest.slice(g + 1)],
    address: { autoCompleteEnabled: true, required: true, children, label: 'Address', placeholder: 'Search address' },
  };
}

// `select` renders only on the built-in country element; on any other tag the widget drops the field
// (corpus forms/30-types/standard-elements.md, live-136). A fixed option list is `single_options`.
const typeProblem = (tag, type, f = {}) => {
  if (type === 'select') return tag === 'country' ? null : '`type: "select"` renders only on `country`; use `single_options` for an option list';
  if (type === 'image') return '`type: "image"` is not dispatched by the form widget: an image element is `type: "img"` with a `url`';
  if (type === 'img' && !('url' in f)) return 'an image element renders only with a `url` (the widget checks `type==="img" && "url" in field`)';
  if (type === 'group_address') return 'the address group is `type: "group"`';
  if (type === 'score' && f.dataType !== 'SCORE') return '`type: "score"` renders only with `dataType: "SCORE"` (a score custom field)';
  return RENDERERS.includes(type) ? null : `\`type: "${type}"\` is not a renderer the builder writes (${RENDERERS.join(', ')})`;
};

/**
 * Give each element the keys the widget needs to render it, the way the builder saves it, or say why it
 * cannot. A built-in tag with no `type` gets the builder's `type`, `standard: true`, its
 * `hiddenFieldQueryKey` and its `required` default — only keys the caller left out; an element that
 * already has a `type` is only checked, never changed. Anything else without
 * a renderable `type` is a problem: a custom-field question's renderer depends on its custom field, so it
 * is never guessed.
 * @returns {{fields: object[], filled: {index:number, tag:string, added:string[]}[], problems: string[]}}
 */
export function renderableFields(input) {
  const counts = {};
  const filled = [];
  const problems = [];
  const fields = (input ?? []).map((f, index) => {
    if (!f || typeof f !== 'object') return f;
    const tag = f.tag;
    const std = STANDARD_ELEMENTS[tag];
    const out = { ...f };
    const added = [];
    const put = (k, v) => { if (out[k] === undefined) { out[k] = v; added.push(k); } };
    if (std) counts[tag] = (counts[tag] ?? 0) + 1;
    // Only an element the widget would drop is completed; one that already names its renderer is kept as sent.
    if (std && (out.type === undefined || out.type === null || out.type === '')) {
      out.type = undefined;
      put('type', std.type);
      put('standard', true);
      put('hiddenFieldQueryKey', std.key ?? (NUMBERED.has(tag) ? `${tag}_${counts[tag]}` : tag));
      if (std.required) put('required', true);
      if (std.label) put('label', std.label);
      if (std.placeholder) put('placeholder', std.placeholder);
    }
    if (out.type === undefined || out.type === null || out.type === '') {
      problems.push(`fields[${index}] (tag ${tag}) has no \`type\`: GHL's widget renders no label and no input for it. `
        + 'A custom-field question takes the renderer of its custom field (text, textarea, single_options, radio, …).');
    } else {
      const why = typeProblem(tag, out.type, out);
      if (why) problems.push(`fields[${index}] (tag ${tag}): ${why}.`);
    }
    if (added.length) filled.push({ index, tag, added });
    return out;
  });
  return { fields, filled, problems };
}

/**
 * GHL accepts a submit with every field empty and creates a contact with no name, email or phone. The
 * widget only blocks an empty submit when some input element is required.
 */
export function blankSubmitWarning(fields) {
  const inputs = (fields ?? []).filter((f) => f && !['submit', 'h1', 'html', 'img', 'group', 'captcha', 'source'].includes(f.type));
  if (!inputs.length || inputs.some((f) => f.required === true)) return null;
  return 'No input on this form is required, so a visitor can submit it empty: GHL accepts that and creates a '
    + 'contact with no name, email or phone. Set required:true on email (or phone) unless blank submits are intended.';
}

/**
 * Does the stored value carry everything that was sent, value for value? The save stores what it is given, adds its
 * own keys (ids, defaults) and renames two (formAction.redirect_url → redirectUrl, style.ac_branding → acBranding), so
 * the check is "every sent key, under its stored name, has the sent value" — never key presence alone, which the
 * PREVIOUS document satisfies on every edit that does not add a tag.
 */
const RENAMED = Object.freeze({ redirect_url: 'redirectUrl', ac_branding: 'acBranding' });
export function carries(sent, stored) {
  if (Array.isArray(sent)) return Array.isArray(stored) && stored.length === sent.length && sent.every((v, i) => carries(v, stored[i]));
  if (sent && typeof sent === 'object') {
    if (!stored || typeof stored !== 'object') return false;
    return Object.entries(sent).every(([k, v]) => v === undefined || carries(v, stored[RENAMED[k] ?? k] ?? stored[k]));
  }
  return sent === stored;
}
