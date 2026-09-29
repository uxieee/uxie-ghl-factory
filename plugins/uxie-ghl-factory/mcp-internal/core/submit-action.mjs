// An embedded form, survey or calendar with no on-submit action gives the visitor nothing to see after a
// successful submit. A person submitted twice, 15 s apart, on a page build_funnel_page composed with only a
// formId (extra.action.value ""), and called the form "not working"; both submissions were stored (knowledge
// sniffs/funnels-wave23-form-fields-2026-09-29/live-human-batch.json w16IsoRetry; funnels silent-failures
// rule 49). The builder's own value for a fresh embed is "none", shown as "Please select an action" (page
// builder bundle `embeddedActions`; wave16 ui-cap.embeds-save.json), so both spellings mean "no action".
// The action is left as the caller wrote it: this only says so.

export const SUBMIT_ACTION_KINDS = Object.freeze(['form', 'survey', 'calendar']);
const NO_ACTION = new Set(['', 'none']);

/** Every form/survey/calendar node (sections and popups) whose extra.action is empty or "none". */
export function emptySubmitActions(pageData) {
  const out = [];
  const walk = (els) => {
    for (const n of els ?? []) {
      if (n?.type !== 'element' || !SUBMIT_ACTION_KINDS.includes(n.meta)) continue;
      const a = n.extra?.action?.value;
      if (a === undefined || a === null || NO_ACTION.has(a)) out.push({ id: n.id, kind: n.meta, action: a ?? null });
    }
  };
  for (const s of pageData?.sections ?? []) walk(s.elements);
  for (const p of pageData?.popupsList ?? []) walk(p.elements);
  return out;
}

/** The preview/result entry, or null when every embed has an action. */
export function submitActionWarning(pageData) {
  const nodes = emptySubmitActions(pageData);
  if (!nodes.length) return null;
  return {
    nodes,
    warning: `${nodes.length} form/survey/calendar element(s) have no on-submit action. Submissions are stored, but the `
      + 'visitor sees no success state and tends to resubmit. Set extra.action to go-to-next-funnel-step (onto a step '
      + 'that confirms the submit, not one that carries the same form) or to url with extra.visitWebsite.',
  };
}
