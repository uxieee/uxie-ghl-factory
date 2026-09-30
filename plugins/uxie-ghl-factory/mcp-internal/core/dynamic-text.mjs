// Dynamic text from URL: a `{{query_param.x}}` pill in page text with a default and a case transform (the text editor's
// "Insert dynamic text from URL"). Measured from a builder Save + the public page (knowledge sniffs/funnels-wave44-b-rest-2026-09-30):
//  - the text HTML carries `<span data-dtr-token="NAME" data-dtr-default="DEFAULT" data-dtr-transform="upper" class="dtr-token">{{ query_param.NAME }}</span>`;
//  - the node's extra carries `dtr: { NAME: { default, transform, normalize } }` (normalize = the dialog's "Normalize separators", on by default);
//  - the public renderer swaps the pill for the URL parameter, transformed (`?f10_name=hello%20wORLD` → "HELLO WORLD"), and shows the default as
//    written when the parameter is absent (the transform is NOT applied to the default).
// The six transform names are the dialog's Format list (None, UPPERCASE, lowercase, Title Case, Sentence case, Capitalize first); `upper` was
// measured from the builder, the other five are the builder source's names (DTR_TRANSFORMS) and are proven only as far as the public renderer accepts them.

export const DTR_TRANSFORMS = Object.freeze(['none', 'upper', 'lower', 'title', 'sentence', 'capitalize']);
export const DTR_KINDS = Object.freeze(['paragraph', 'heading', 'sub-heading']);
/** Conservative: letters, digits, `_` and `-` (the builder's own PARAM_NAME_RE was not recovered). */
export const DTR_PARAM_RE = /^[A-Za-z0-9_-]{1,64}$/;

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `html` with each `{{query_param.NAME}}` named in `spec` turned into the builder's pill, and the `dtr` map for the node's extra.
 * spec: { NAME: { default?: string, transform?: 'none'|'upper'|…, normalize?: boolean } }. Throws with the reason on a bad param name,
 * an unknown transform, or a name whose placeholder is not in the html.
 */
export function applyDynamicText(html, spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec) || !Object.keys(spec).length) throw new Error('dynamicText: give an object {paramName: {default, transform, normalize}}');
  let out = String(html ?? '');
  const dtr = {};
  for (const [name, cfg] of Object.entries(spec)) {
    if (!DTR_PARAM_RE.test(name)) throw new Error(`dynamicText: "${name}" is not a URL parameter name (letters, digits, _ and - only, up to 64)`);
    const c = cfg && typeof cfg === 'object' ? cfg : {};
    const transform = c.transform ?? 'none';
    if (!DTR_TRANSFORMS.includes(transform)) throw new Error(`dynamicText.${name}.transform "${transform}" — one of ${DTR_TRANSFORMS.join(', ')}`);
    if (c.default !== undefined && typeof c.default !== 'string') throw new Error(`dynamicText.${name}.default must be a string`);
    // a pill already in the text (an earlier write, or the builder) goes back to its placeholder, so a second call updates it
    out = out.replace(new RegExp(`<span[^>]*data-dtr-token="${escRe(escAttr(name))}"[^>]*>[^<]*</span>`, 'g'), () => `{{query_param.${name}}}`);
    const re = new RegExp(`\\{\\{\\s*query_param\\.${escRe(name)}\\s*\\}\\}`, 'g');
    if (!re.test(out)) throw new Error(`dynamicText.${name}: the text has no {{query_param.${name}}} placeholder to turn into the pill`);
    const def = c.default ?? '';
    const pill = `<span data-dtr-token="${escAttr(name)}" data-dtr-default="${escAttr(def)}" data-dtr-transform="${transform}" class="dtr-token">{{ query_param.${name} }}</span>`;
    out = out.replace(new RegExp(re.source, 'g'), () => pill);
    dtr[name] = { default: def, transform, normalize: c.normalize !== false };
  }
  return { html: out, dtr };
}
