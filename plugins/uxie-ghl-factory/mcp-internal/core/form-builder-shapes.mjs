// What the form builder writes for each built-in element when its tile is dropped and the form is saved — measured, not read from source:
// every palette tile dragged onto the canvas of an own form, one blocked Save, the save body's `fields` recorded
// (knowledge sniffs/funnels-wave43-reproof-forms-2026-09-30, ui-cap.builder-save-palette.BLOCKED.json → live-builder-field-shapes.json).
//
// WHY IT MATTERS: GHL stores `fields` verbatim and the PUBLIC widget renders from `type` alone, but the BUILDER's canvas reads more. A form whose Submit
// element lacks the builder's button styling (padding, border, shadow, colours …) opens EMPTY in the form builder — "Drag and drop components",
// no fields at all — and the next builder Save writes that empty canvas over the form. Bisected live: [first_name] shows, [email, phone] show,
// [button with only type/tag/label] shows nothing, the builder's own button shows. The tool now completes every key the builder writes.
export const BUILDER_FIELD_SHAPES = Object.freeze({
  "full_name": {"label": "Full Name", "tag": "full_name", "hiddenFieldQueryKey": "full_name", "type": "text", "typeLabel": "Text", "placeholder": "Enter your full name", "required": false, "standard": true, "active": false, "fieldWidthPercentage": 100},
  "first_name": {"active": false, "fieldWidthPercentage": 100, "hiddenFieldQueryKey": "first_name", "label": "First Name", "placeholder": "Enter your first name", "standard": true, "tag": "first_name", "type": "text", "typeLabel": "Text"},
  "last_name": {"label": "Last Name", "tag": "last_name", "hiddenFieldQueryKey": "last_name", "type": "text", "typeLabel": "Text", "placeholder": "Enter your last name", "required": false, "standard": true, "active": false, "fieldWidthPercentage": 100},
  "date_of_birth": {"label": "Date of birth", "tag": "date_of_birth", "type": "date", "typeLabel": "Date", "format": "YYYY-MM-DD", "separator": "-", "placeholder": "DD / MM / YYYY", "standard": true, "hiddenFieldQueryKey": "date_of_birth", "active": false, "fieldWidthPercentage": 100},
  "phone": {"active": false, "fieldWidthPercentage": 100, "hiddenFieldQueryKey": "phone", "label": "Phone", "placeholder": "Enter your phone", "required": true, "standard": true, "tag": "phone", "type": "text", "typeLabel": "Text"},
  "email": {"active": false, "fieldWidthPercentage": 100, "hiddenFieldQueryKey": "email", "label": "Email", "placeholder": "Enter your email", "required": true, "standard": true, "tag": "email", "type": "email", "typeLabel": "Email"},
  "organization": {"label": "Organization", "tag": "organization", "hiddenFieldQueryKey": "organization", "type": "text", "typeLabel": "Text", "placeholder": "Enter your organization", "required": false, "standard": true, "title": "Organization", "active": false, "fieldWidthPercentage": 100},
  "website": {"label": "Website", "tag": "website", "hiddenFieldQueryKey": "website", "type": "text", "typeLabel": "Text", "placeholder": "https://yourwebsite.com", "standard": true, "title": "Website", "active": false, "fieldWidthPercentage": 100},
  "image": {"label": "Image 1", "tag": "image", "hiddenFieldQueryKey": "image_1", "type": "img", "placeholder": "", "standard": true, "active": false},
  "header": {"label": "<h1 style=\"padding-left: 0px!important;\">Text</h1>", "tag": "header", "hiddenFieldQueryKey": "header_1", "type": "h1", "placeholder": "header", "typeLabel": "Text", "weight": 400, "bgColor": "FFFFFF00", "align": "left", "shadow": {"horizontal": 0, "vertical": 0, "blur": 0, "spread": 0, "color": "FFFFFF"}, "padding": {"top": 0, "bottom": 0, "left": 0, "right": 0}, "border": {"border": 0, "radius": 0, "color": "FFFFFF", "type": "none"}, "standard": true, "active": false},
  "html": {"label": "HTML 1", "tag": "html", "hiddenFieldQueryKey": "html_1", "type": "html", "placeholder": "The Custom HTML goes here", "html": "", "standard": true, "active": false},
  "captcha": {"label": "Bot protection", "tag": "captcha", "hiddenFieldQueryKey": "captcha", "type": "captcha", "standard": true, "invisible": false, "active": false},
  "source": {"label": "Source", "tag": "source", "hiddenFieldQueryKey": "source", "type": "source", "value": "", "standard": true, "active": false},
  "terms_and_conditions": {"label": "T & C", "tag": "terms_and_conditions", "type": "terms_and_conditions", "required": true, "hiddenFieldQueryKey": "terms_and_conditions", "textColor": "000000", "linkColor": "188bf6", "placeholder": "<p style='font-family: Inter; font-size: 16px; font-weight: 400; color: #344054FF;'>I agree to terms & conditions provided by the company. By providing my phone number, I agree to receive text messages from the business.</p>", "preview": "<p style='font-family: Inter; font-size: 16px; font-weight: 400; color: #000000;'>I agree to terms & conditions provided by the company. By providing my phone number, I agree to receive text messages from the business.</p>", "standard": true, "active": false},
  "group_address": {"label": "Address", "tag": "group_address", "hiddenFieldQueryKey": "group_address", "type": "group", "placeholder": "Street Address", "required": false, "standard": true, "title": "Street Address", "active": false},
  "button": {"label": "Submit", "tag": "button", "hiddenFieldQueryKey": "button", "type": "submit", "placeholder": "Button", "submitSubText": "", "bgColor": "155EEFFF", "padding": {"top": 9, "bottom": 9, "left": 10, "right": 10}, "border": 0, "borderType": "none", "borderColor": "FFFFFF", "borderRadius": 6, "shadow": {"horizontal": 0, "vertical": 0, "blur": 0, "spread": 0, "color": "FFFFFF"}, "fullwidth": true, "color": "FFFFFF", "weight": 500, "radius": 4, "subTextColor": "000000", "subTextWeight": 200, "align": "center", "standard": true, "active": false, "fieldWidthPercentage": 100}
});

const clone = (v) => structuredClone(v);

/**
 * Fill, on every BUILT-IN element, the keys the builder writes and the caller left out. What the caller sent is never changed; an element whose tag is
 * not a built-in (a custom-field question) is left as it is. Numbered kinds (image / header / html) keep the `hiddenFieldQueryKey` already chosen.
 * @returns {{fields: object[], added: {index:number, tag:string, keys:string[]}[]}}
 */
export function shapeForBuilder(input) {
  const added = [];
  const fields = (input ?? []).map((f, index) => {
    const shape = f && typeof f === 'object' ? BUILDER_FIELD_SHAPES[f.tag] : undefined;
    if (!shape) return f;
    const out = { ...f }; const keys = [];
    for (const [k, v] of Object.entries(shape)) {
      if (out[k] !== undefined) continue;
      if (k === 'typeLabel' && out.type !== shape.type) continue; // the label names the renderer; a caller's other renderer keeps its own
      out[k] = clone(v); keys.push(k);
    }
    if (keys.length) added.push({ index, tag: f.tag, keys });
    return out;
  });
  return { fields, added };
}
