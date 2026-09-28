// Form elements the public widget will actually render. GHL stores `formData.form.fields` verbatim — no
// defaults, no validation — and the widget renders each element by its `type`. An element with no `type`
// is dropped from the render entirely (no label, no input), while the save, the read-back and the widget's
// data payload all still carry it. create_form shipped a webinar registration form whose name and email
// had no type: the page showed a lone Register button, and GHL accepted the blank submit and created a
// contact with no name and no email (knowledge sniffs/funnels-wave23-form-fields-2026-09-29:
// live-render-differential.json proves `type` alone decides rendering; `standard` and
// `hiddenFieldQueryKey` do not).
//
// The table is the builder's own `standardFields` (knowledge corpus forms/_data/elements.json, from
// builder-app src/util/methods.ts): the tags that are built-in contact fields, with the renderer and the
// `required` default the builder applies client-side before it saves.

/** Built-in element tag → the builder's renderer and its required default (absent = not required). */
export const STANDARD_ELEMENTS = Object.freeze({
  full_name: { type: 'text' },
  first_name: { type: 'text' },
  last_name: { type: 'text' },
  date_of_birth: { type: 'date' },
  phone: { type: 'text', required: true },
  email: { type: 'email', required: true },
  button: { type: 'submit' },
  group_address: { type: 'group_address' },
  address: { type: 'text' },
  city: { type: 'text' },
  state: { type: 'text' },
  country: { type: 'text' },
  postal_code: { type: 'text' },
  organization: { type: 'text' },
  website: { type: 'text' },
  image: { type: 'image' },
  header: { type: 'h1' },
  html: { type: 'html' },
  captcha: { type: 'captcha' },
  source: { type: 'source' },
  terms_and_conditions: { type: 'terms_and_conditions', required: true },
});

// Tags the builder numbers per occurrence (`header_1`, `image_2`) for their hiddenFieldQueryKey.
const NUMBERED = new Set(['header', 'html', 'image']);

/** Every renderer the builder writes (standard elements plus the custom-field question kinds). */
export const RENDERERS = Object.freeze([
  'text', 'email', 'date', 'submit', 'payment', 'group_address', 'image', 'h1', 'html', 'captcha', 'source',
  'terms_and_conditions', 'textarea', 'textbox_list', 'single_options', 'multiple_options', 'radio', 'checkbox',
  'numerical', 'monetory', 'file_upload', 'signature', 'url', 'rating', 'score',
]);

// `select` renders only on the built-in country element; on any other tag the widget drops the field
// (corpus forms/30-types/standard-elements.md, live-136). A fixed option list is `single_options`.
const typeProblem = (tag, type) => {
  if (type === 'select') return tag === 'country' ? null : '`type: "select"` renders only on `country`; use `single_options` for an option list';
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
      put('hiddenFieldQueryKey', NUMBERED.has(tag) ? `${tag}_${counts[tag]}` : tag);
      if (std.required) put('required', true);
    }
    if (out.type === undefined || out.type === null || out.type === '') {
      problems.push(`fields[${index}] (tag ${tag}) has no \`type\`: GHL's widget renders no label and no input for it. `
        + 'A custom-field question takes the renderer of its custom field (text, textarea, single_options, radio, …).');
    } else {
      const why = typeProblem(tag, out.type);
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
  const inputs = (fields ?? []).filter((f) => f && !['submit', 'h1', 'html', 'image', 'captcha', 'source'].includes(f.type));
  if (!inputs.length || inputs.some((f) => f.required === true)) return null;
  return 'No input on this form is required, so a visitor can submit it empty: GHL accepts that and creates a '
    + 'contact with no name, email or phone. Set required:true on email (or phone) unless blank submits are intended.';
}
