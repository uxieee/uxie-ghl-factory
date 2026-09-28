// find_contact / create_update_contact are for runs that start WITHOUT a contact. In a run that already holds
// one, GHL skips the step — "Only one contact is allowed per workflow, and <name> is already in use." — and a
// skipped find_contact routes down its FOUND branch, so the workflow "finds" every time (live 2026-09-28,
// knowledge sniffs/workflows-wave1-2026-09-25/live-3G-contacts.json; contact-less behaviour live-3J2-find-contactless.json).
//
// Only an inbound_webhook trigger is PROVEN to start a contact-less run. A workflow with no trigger (runs come
// from enrolment) or with any other trigger carries a contact on those runs. Advisory (`warning`): a mixed
// workflow may use the steps on its webhook runs on purpose.
export const CONTACT_LESS_TRIGGERS = new Set(['inbound_webhook']);
const STEPS = new Set(['find_contact', 'create_update_contact']);

export function lintContactLessSteps(templates, triggers) {
  const T = Array.isArray(templates) ? templates.filter(Boolean) : [];
  const G = Array.isArray(triggers) ? triggers.filter(Boolean) : [];
  const steps = T.filter((t) => STEPS.has(t.type));
  if (!steps.length) return [];
  const carrying = G.filter((g) => !CONTACT_LESS_TRIGGERS.has(g.type)).map((g) => g.type);
  if (G.length && !carrying.length) return [];
  const why = G.length ? `runs from its ${[...new Set(carrying)].join(', ')} trigger(s) already hold a contact`
    : 'it has no trigger, so every run comes from enrolling a contact';
  return steps.map((t) => ({ code: 'CONTACT_STEP_IN_CONTACT_RUN', severity: 'warning', stepId: t.id,
    msg: `${t.type} '${t.name ?? t.id}': ${why}. GHL skips this step in any run that holds a contact`
      + (t.type === 'find_contact' ? ' and the run continues down FOUND — the find always "finds".' : ' — nothing is created or updated.')
      + ' It works on runs started by an inbound_webhook trigger.' }));
}
