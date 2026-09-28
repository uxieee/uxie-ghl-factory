// An sms step with a saved template (`template_id`) SENDS THE TEMPLATE, not its own `body`. Live 2026-09-28
// (knowledge sniffs/workflows-wave1-2026-09-25/live-3U3-sms-template-differential.json): body "…BODY-WINS" +
// template_id → the recorded message carried the snippet's body, merge tags rendered. The drawer copies the
// snippet into `body` when a template is picked, so the two only differ when one was edited afterwards —
// by an API author, or by an edit that changed `body` and left `template_id`. That edit saves and does nothing.
// manual-sms (the same drawer) does the same: its queued task carried the snippet's text, not the body
// (live-3U7-manual-actions-walk.json, extras.body).
// Advisory (`warning`): the template may be the intent; the stale body is what misleads a reader.
const TYPES = new Set(['sms', 'manual-sms']);
const hasTemplate = (a) => typeof a?.template_id === 'string' && a.template_id !== '' && a.template_id !== 'none';

export function lintSmsTemplateBody(templates) {
  const T = Array.isArray(templates) ? templates.filter(Boolean) : [];
  return T.filter((t) => TYPES.has(t.type) && hasTemplate(t.attributes) && typeof t.attributes.body === 'string' && t.attributes.body.trim() !== '')
    .map((t) => ({ code: 'SMS_TEMPLATE_OVERRIDES_BODY', severity: 'warning', stepId: t.id,
      msg: `${t.type} '${t.name ?? t.id}' has template_id '${t.attributes.template_id}' AND a body. GHL sends the TEMPLATE's text; `
        + 'this step\'s body is ignored at runtime. To send the body, clear template_id (or set it to "none"); to send the template, '
        + 'make the body match it so the step reads truthfully.' }));
}
