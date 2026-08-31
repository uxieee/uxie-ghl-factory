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

// ---- flow-bot-rules-drift ---------------------------------------------------------------------
// Live (2026-08-30/31): in a flow bot a GLOBAL prohibition does not reach a node whose local
// instruction implies a narrower job — a node scoped to a medical handover produced the exact
// sentences the global prompt banned twice. The fix is a frozen behavioural block appended to
// every speaking node, and the audit then found FOUR VARIANTS of that block across 13 continue
// nodes. A rule meant to be constant must be repeated in EVERY speaking node BYTE-IDENTICALLY:
// variation invites the model to read the differences as meaningful.
//
// Prompt-driven fields, where a rules block belongs (settled from the marketplace asset,
// 2026-08-31). conversationai_custom_message is EXCLUDED deliberately: its `message` is sent to
// the lead VERBATIM ("Bot will send a custom message as it is") — a rules block there would be
// texted to the customer, so the rule never inspects or counts that step.
const SPEAKING_FIELDS = {
  conversationai_continue: 'instructions',
  conversationai_objective: 'instructions',
  conversationai_ai_message: 'message', // its field is titled "Enter the PROMPT for the message"
  conversationai_ai_splitter: 'description',
  conversationai_book_appointment: 'promptInstructions',
};

const normaliseSentence = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase().replace(/[.!?]+$/, '');
const sentenceTokens = (norm) => new Set(norm.split(/[^a-z0-9']+/).filter(Boolean));
const jaccard = (a, b) => {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
};
const truncate80 = (s) => (s.length > 80 ? `${s.slice(0, 80)}…` : s);

const flowBotRulesDrift = (templates) => {
  // Speaking nodes with their sentences: split on ./!/? followed by whitespace or end, normalise,
  // keep >= 40 chars. Token sets are computed once per sentence — O(nodes × sentences) overall.
  const speaking = [];
  for (const t of templates) {
    const field = SPEAKING_FIELDS[t?.type];
    if (!field) continue;
    const text = t.attributes?.[field];
    const sentences = new Map(); // normalised -> { raw, tokens }
    if (typeof text === 'string') {
      for (const raw of text.split(/(?<=[.!?])\s+/)) {
        const norm = normaliseSentence(raw);
        if (norm.length < 40 || sentences.has(norm)) continue;
        sentences.set(norm, { raw: raw.trim(), tokens: sentenceTokens(norm) });
      }
    }
    speaking.push({ t, sentences });
  }
  if (speaking.length < 2) return []; // nothing to compare

  // A shared rule sentence is a normalised sentence present in >= 2 speaking nodes.
  const byNorm = new Map(); // normalised -> { raw, tokens, nodes: Set<index> }
  speaking.forEach((n, i) => {
    for (const [norm, s] of n.sentences) {
      const e = byNorm.get(norm) ?? { raw: s.raw, tokens: s.tokens, nodes: new Set() };
      e.nodes.add(i);
      byNorm.set(norm, e);
    }
  });
  const shared = [...byNorm.values()].filter((e) => e.nodes.size >= 2);

  const out = [];
  speaking.forEach((n, i) => {
    const name = n.t.name ?? n.t.id;
    const missingCore = [];
    for (const s of shared) {
      if (s.nodes.has(i)) continue;
      let variant = null;
      for (const cand of n.sentences.values()) {
        if (jaccard(s.tokens, cand.tokens) >= 0.6) { variant = cand; break; }
      }
      if (variant) {
        out.push({ stepId: n.t.id, name,
          msg: `'${name}' carries a VARIANT of a rule sentence that ${s.nodes.size} other node(s) carry verbatim — "${truncate80(s.raw)}" vs "${truncate80(variant.raw)}". A behavioural rule repeated across speaking nodes must be byte-identical; variation invites the model to read the difference as meaningful.` });
      } else if (s.nodes.size >= 2 && s.nodes.size * 2 >= speaking.length) {
        missingCore.push(s); // core rule: present in >= 50% of speaking nodes AND >= 2
      }
    }
    if (missingCore.length > 0) {
      out.push({ stepId: n.t.id, name,
        msg: `'${name}' (${n.t.type}) carries none of ${missingCore.length} behavioural rule sentence(s) the other speaking nodes share — a global rule does not reach a node whose local text implies a narrower job; repeat the block here, byte-identically, with its positive half.` });
    }
  });
  return out;
};

export const HYGIENE_RULES = [
  {
    rule: 'flow-bot-rules-drift',
    severity: 'warning',
    run: (doc) => flowBotRulesDrift(doc.templates ?? []),
  },
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
    // GHL queues an UNASSIGNED manual task like any other — it is parked, not skipped. Live: two
    // contacts sat behind a manual-call saved with assignedUser:'' / standardAssignedUser:'' for
    // hours, receiving none of the sends below it. GHL has no validator for this shape
    // (catalog: steps['manual-call'].enforcement.provenZero = "no-ghl-validator"), so nothing
    // downstream will catch it.
    rule: 'manual-task-unassigned',
    severity: 'warning',
    run: (doc) => (doc.templates ?? [])
      .filter((t) => isType(t, 'manual-call', 'manual-sms', 'manual_call', 'manual_sms')
        && !t.attributes?.assignedUser && !t.attributes?.standardAssignedUser)
      .map((t) => ({ stepId: t.id, name: t.name ?? t.id,
        msg: `manual task '${t.name ?? t.id}' (${t.type}) has no assigned user — GHL still queues it and the contact waits behind it indefinitely; an unassigned manual task is parked, not skipped. Assign a user or drop the step` })),
  },
  {
    // conversationai_book_appointment exposes only calendarId and promptInstructions — there is
    // no field for WHICH appointment it acts on. Two clean-room fixtures measured the defaults,
    // both wrong: with one past and one future appointment it named the visit the contact had
    // already attended and offered to move it to times that had already passed; with three
    // confirmed future bookings it silently picked the soonest and never asked. Both were closed
    // purely by wording in promptInstructions, so a stock or empty value ships those defaults.
    rule: 'book-appointment-unsteered',
    severity: 'warning',
    run: (doc) => (doc.templates ?? [])
      .filter((t) => {
        if (!isType(t, 'conversationai_book_appointment')) return false;
        const pi = t.attributes?.promptInstructions;
        return pi == null || String(pi).trim() === '' || pi === 'Get the customer to book an appointment';
      })
      .map((t) => ({ stepId: t.id, name: t.name ?? t.id,
        msg: `'${t.name ?? t.id}' runs with the stock promptInstructions — the step has no field for WHICH appointment it acts on, and the measured defaults are wrong both ways: it offers to move an appointment the contact already attended to times that have already passed, and with several future bookings it silently picks the soonest without asking. Steer it with wording in promptInstructions (e.g. which appointment to act on, and to ask when there are several)` })),
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
