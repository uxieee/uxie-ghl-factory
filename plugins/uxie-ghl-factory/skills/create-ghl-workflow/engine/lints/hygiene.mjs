// Generic authoring hygiene: shapes that are legal, save clean, and are almost always a mistake.
// These are NOT GHL rules — nothing here is refused by the builder — so every one is a warning.
// Client-specific policy belongs in a doctrine pack, not here.
const isType = (t, ...types) => types.includes(t?.type);

const consecutiveRemoves = (templates) => {
  const byId = new Map(templates.map((t) => [t.id, t]));
  const out = [];
  for (const t of templates) {
    if (!isType(t, 'remove_from_workflow')) continue;
    const next = typeof t.next === 'string' ? byId.get(t.next) : null;
    if (isType(next, 'remove_from_workflow')) {
      out.push({ stepId: t.id, name: t.name ?? t.id,
        msg: `'${t.name ?? t.id}' is followed by another remove_from_workflow — one step takes an ARRAY of workflows, so a chain is almost always an accident` });
    }
  }
  return out;
};

export const HYGIENE_RULES = [
  {
    rule: 'notification-no-redirect',
    severity: 'warning',
    run: (doc) => (doc.templates ?? [])
      .filter((t) => isType(t, 'internal_notification') && t.attributes?.notification
        && !t.attributes.notification.redirectPage)
      .map((t) => ({ stepId: t.id, name: t.name ?? t.id,
        msg: `in-app notification '${t.name ?? t.id}' has no redirectPage — the recipient taps it and lands nowhere useful` })),
  },
  {
    rule: 'remove-chain',
    severity: 'warning',
    run: (doc) => consecutiveRemoves(doc.templates ?? []),
  },
  {
    rule: 'hybrid-wait-no-timeout',
    severity: 'warning',
    run: (doc) => (doc.templates ?? [])
      .filter((t) => isType(t, 'wait')
        && ['reply', 'email_event'].includes(t.attributes?.type)
        && t.attributes?.convertToMultipath === false)
      .map((t) => ({ stepId: t.id, name: t.name ?? t.id,
        msg: `wait '${t.name ?? t.id}' waits on a ${t.attributes.type} with convertToMultipath:false — there is no timeout leg, so a contact who never replies waits forever` })),
  },
  {
    rule: 'missing-else-leg',
    severity: 'warning',
    run: (doc) => {
      const templates = doc.templates ?? [];
      const byId = new Map(templates.map((t) => [t.id, t]));
      const out = [];
      for (const t of templates) {
        if (!isType(t, 'if_else') || !Array.isArray(t.next) || t.next.length < 2) continue;
        // predefined-branch containers (ai_decision-style) carry their own default leg
        if (t.attributes?.transitions?.some((x) => x?.conditionType === 'pre-defined')) continue;
        const legs = t.next.map((id) => byId.get(id)).filter(Boolean);
        if (legs.length < 2) continue;
        const elseLeg = legs[legs.length - 1];
        const conditioned = legs.slice(0, -1);
        const elseEmpty = elseLeg.next === null || elseLeg.next === undefined;
        if (elseEmpty && conditioned.some((b) => typeof b.next === 'string')) {
          out.push({ stepId: t.id, name: t.name ?? t.id,
            msg: `'${t.name ?? t.id}' has steps on a conditioned branch but an EMPTY else leg — everyone who does not match falls out of the workflow silently` });
        }
      }
      return out;
    },
  },
];
