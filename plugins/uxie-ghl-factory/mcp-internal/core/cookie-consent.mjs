// Cookie consent banner — the FUNNEL-level config the builder's Cookie Consent panel saves (POST /funnels/funnel/cookie-consent) and reads
// (GET, same path). Measured 2026-09-28 (enable + Save) and 2026-09-30 (Don't ask, Center floating, Top banner — saves BLOCKED, never sent):
// knowledge sniffs/funnels-wave4-page-2026-09-26/live-page.cookie-consent.json, sniffs/funnels-wave45-f8-2026-09-30.
//  - the save is the WHOLE object — the builder never sends a partial one; funnelId + pageId (the page it was saved from) ride along;
//  - `style` is CSS the builder compiles from the colours and fonts: this tool leaves the colours, fonts and the preference popup alone, so it keeps
//    the stored `style` (or the builder's default for a first save) — change those on the panel;
//  - enabling shows a disclaimer the user must tick and Agree to; here that is `acknowledged: true`, never assumed.

/** The object a first enable saves with nothing changed (the panel's own defaults). */
export const CC_DEFAULTS = Object.freeze({
  "version": 2,
  "bgColor": "#fef0c7",
  "textColor": "#000000",
  "customiseBtnText": "Customize",
  "acceptAllBtnText": "Accept all",
  "acceptEssentialBtnText": "Accept essential",
  "primaryTextColor": "#ffffff",
  "okBtnText": "Ok",
  "secondaryTextColor": "#000000",
  "customiseTextColor": "#000000",
  "linkColor": "#000000",
  "primaryColor": "#000000",
  "secondaryColor": "#ffffff",
  "customiseColor": "#ffffff",
  "isOwnPolicyLink": false,
  "policyLink": "",
  "policyLinkText": "Learn more",
  "selectedFont": "Inter",
  "fontSize": 16,
  "essentialCookies": [],
  "complianceType": "ask-opt-in",
  "showCustomise": false,
  "msgDescription": "We use cookies to improve your experience on our site. By using our site, you consent to the use of cookies. Rejecting cookies will prevent non-essential cookies from loading.",
  "consentExpiration": 14,
  "cookieListSettings": {
    "title": "Customize Consent Preferences",
    "description": "We use cookies to ensure the basic functionalities of the website and to enhance your online experience. You can choose for each category to opt-in/out whenever you want. For more details about cookies and how I use them, read the full cookie policy.",
    "bgColor": "#ffffff",
    "titleTextColor": "#101828",
    "descriptionTextColor": "#344054",
    "savePreferencesBgColor": "#145eef",
    "savePreferencesTextColor": "#ffffff",
    "cancelBgColor": "#ffffff",
    "cancelTextColor": "#354054",
    "rejectBgColor": "#fef3f2",
    "rejectTextColor": "#b42418",
    "switchColor": "#155EEF",
    "rejectBtnText": "Reject",
    "savePreferencesBtnText": "Save preferences",
    "cancelBtnText": "Cancel"
  },
  "cookieList": [
    {
      "category": "essential",
      "title": "Essential",
      "description": "Essential cookies are required to enable the basic features of this site, such as providing secure log-in or adjusting your consent preferences. These cookies do not store any personally identifiable data.",
      "cookies": [],
      "isEnabled": true,
      "isDisabled": true
    },
    {
      "category": "functional",
      "title": "Functional",
      "description": "Functional cookies help perform certain functionalities like sharing the content of the website on social media platforms, collecting feedback, and other third-party features.",
      "cookies": [],
      "isEnabled": false,
      "isDisabled": false
    },
    {
      "category": "analytics",
      "title": "Analytics",
      "description": "Analytical cookies are used to understand how visitors interact with the website. These cookies help provide information on metrics such as the number of visitors, bounce rate, traffic source, etc.",
      "cookies": [],
      "isEnabled": false,
      "isDisabled": false
    },
    {
      "category": "performance",
      "title": "Performance",
      "description": "to be filled",
      "cookies": [],
      "isEnabled": false,
      "isDisabled": false
    },
    {
      "category": "advertising",
      "title": "Advertising",
      "description": "to be filled",
      "cookies": [],
      "isEnabled": false,
      "isDisabled": false
    },
    {
      "category": "uncategorized",
      "title": "Uncategorized",
      "description": "to be filled",
      "cookies": [],
      "isEnabled": false,
      "isDisabled": false
    }
  ],
  "layoutSettings": {
    "position": "bottom-banner",
    "floatingCookie": false,
    "floaterPosition": "right",
    "bgColor": "#fef0c7",
    "borderColor": "#ffffff",
    "iconColor": "#ffffff"
  },
  "regionSettings": {
    "type": "worldwide",
    "countries": []
  },
  "selectedFontToLoad": "Inter",
  "style": ".hl-cookie-consent-banner{background-color:#fef0c7}.hl-cookie-consent-banner .banner-text,.hl-cookie-consent-banner .learn-more{color:#000;font-family:Inter;font-size:16px}.hl-cookie-consent-banner .button.primary{color:#fff;background-color:#000;font-family:Inter;font-size:16px}.hl-cookie-consent-banner .button.customize,.hl-cookie-consent-banner .button.secondary{color:#000;background-color:#fff;font-family:Inter;font-size:16px}.hl-cc-preference-popup{background-color:#fff;font-family:Inter}.hl-cc-preference-popup .hl-cc-preference-popup-title{color:#101828;font-size:18px}.hl-cc-preference-popup .hl-cc-preference-popup-description{color:#344054;font-size:14px}.hl-cc-preference-popup-footer .cancel{color:#354054;background-color:#fff}.hl-cc-preference-popup-footer .save{color:#fff;background-color:#145eef}.hl-cc-preference-popup-footer .reject{color:#b42418;background-color:#fef3f2}.hl-cc-switch input:checked+.hl-slider{background-color:#155eef}.hl-cc-preference-popup-content .hl-cc-preference-category-header{color:#101828}",
  "isCookieEnabled": true
});

export const COMPLIANCE_TYPES = Object.freeze(['ask-opt-in', 'do-not-ask']); // "Ask to opt in" / "Don't ask"
/** The Layout tab's five tiles → layoutSettings.position. Left / Right floating were not captured (their strings are unmeasured), so they are not offered. */
export const POSITIONS = Object.freeze({ 'bottom-banner': 'bottom-banner', 'top-banner': 'top-banner', 'center-floating': 'popup-banner position-center' });
export const DISCLAIMER = 'Cookie consent banners prevent marketing, performance and analytics cookies from loading until the visitor accepts; some external elements and essential cookies may still load. Third-party widgets and custom code (header / footer tracking, Custom JS/HTML) on the funnel are the owner\'s responsibility: get consent or remove them.';

const isInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;

/**
 * planCookieConsent({funnel, locationId, pageId, stored, cc}) → {refuse} | {method, path, body, changes, enabling}
 * stored: the current GET body, or null when the funnel has none. cc: {enabled?, acknowledged?, complianceType?, message?, consentExpiration?, position?, buttons?}.
 */
export function planCookieConsent({ funnel, locationId, pageId, stored, cc }) {
  if (!cc || typeof cc !== 'object' || Array.isArray(cc)) return { refuse: 'cookieConsent is {enabled?, acknowledged?, complianceType?, message?, consentExpiration?, position?, buttons?}' };
  const known = ['enabled', 'acknowledged', 'complianceType', 'message', 'consentExpiration', 'position', 'buttons'];
  const bad = Object.keys(cc).filter((k) => !known.includes(k));
  if (bad.length) return { refuse: `cookieConsent takes ${known.join(', ')} — not ${bad.join(', ')}. Colours, fonts, the policy link, the cookie list and the regions are edited on the builder's Cookie Consent panel.` };
  const pid = pageId ?? (funnel.steps ?? []).flatMap((s) => s.pages ?? [])[0];
  if (!pid) return { refuse: 'the funnel has no page to save the banner from (the builder saves it with the page id); create a step first, or name pageId' };
  const body = { ...CC_DEFAULTS, isCookieEnabled: false, ...(stored ?? {}), locationId, funnelId: funnel._id ?? funnel.id, pageId: pid };
  const changes = [];
  const set = (key, value, label) => { if (JSON.stringify(body[key]) !== JSON.stringify(value)) { changes.push({ key: label ?? key, from: body[key], to: value }); body[key] = value; } };
  const was = stored?.isCookieEnabled === true;
  if (cc.enabled !== undefined) {
    if (typeof cc.enabled !== 'boolean') return { refuse: 'cookieConsent.enabled is true or false' };
    if (cc.enabled && !was && cc.acknowledged !== true) return { refuse: `turning the banner ON needs cookieConsent.acknowledged: true — the panel asks the user to tick "I've read and understood" first. ${DISCLAIMER}` };
    set('isCookieEnabled', cc.enabled, 'enabled');
  } else if (!stored) return { refuse: 'this funnel has no cookie banner yet: pass enabled:true (and acknowledged:true) to create it' };
  if (cc.complianceType !== undefined) {
    if (!COMPLIANCE_TYPES.includes(cc.complianceType)) return { refuse: `complianceType is one of ${COMPLIANCE_TYPES.join(', ')} ("Ask to opt in" / "Don't ask")` };
    set('complianceType', cc.complianceType);
  }
  if (cc.message !== undefined) {
    if (typeof cc.message !== 'string' || !cc.message.trim() || cc.message.length > 1000) return { refuse: 'message is the banner text, 1 to 1000 characters' };
    set('msgDescription', cc.message, 'message');
  }
  if (cc.consentExpiration !== undefined) {
    if (!isInt(cc.consentExpiration, 1, 3650)) return { refuse: 'consentExpiration is a whole number of days, 1 to 3650' };
    set('consentExpiration', cc.consentExpiration);
  }
  if (cc.position !== undefined) {
    if (!POSITIONS[cc.position]) return { refuse: `position is one of ${Object.keys(POSITIONS).join(', ')} (left / right floating are not offered: their stored strings were not measured)` };
    set('layoutSettings', { ...body.layoutSettings, position: POSITIONS[cc.position] }, 'position');
  }
  if (cc.buttons !== undefined) {
    const map = { acceptAll: 'acceptAllBtnText', acceptEssential: 'acceptEssentialBtnText', ok: 'okBtnText' };
    for (const [k, v] of Object.entries(cc.buttons ?? {})) {
      if (!map[k]) return { refuse: `buttons.${k}: one of ${Object.keys(map).join(', ')}` };
      if (typeof v !== 'string' || !v.trim() || v.length > 60) return { refuse: `buttons.${k} is the button text, 1 to 60 characters` };
      set(map[k], v, `buttons.${k}`);
    }
  }
  if (!changes.length) return { refuse: 'nothing to change: the stored banner already has every value named' };
  return { method: 'POST', path: '/funnels/funnel/cookie-consent', body, changes, enabling: body.isCookieEnabled === true && !was };
}

/** The stored fields a plan's `changes` name, compared with a GET read-back → the ones that did not land. */
export function cookieConsentNotApplied(read, plan) {
  const bad = [];
  for (const c of plan.changes) {
    const key = c.key === 'enabled' ? 'isCookieEnabled' : c.key === 'message' ? 'msgDescription' : c.key === 'position' ? 'layoutSettings' : c.key.startsWith('buttons.') ? { acceptAll: 'acceptAllBtnText', acceptEssential: 'acceptEssentialBtnText', ok: 'okBtnText' }[c.key.slice(8)] : c.key;
    const got = key === 'layoutSettings' ? read?.layoutSettings?.position : read?.[key];
    const want = key === 'layoutSettings' ? c.to.position : c.to;
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push({ key: c.key, want, got: got ?? null });
  }
  return bad;
}
