// CLIENT POLICY, evaluated but never defined here. A doctrine pack is JSON the project supplies
// (.ghl/<locationId>/lint-pack.json); the engine states only whether a document conforms. Keeping
// it declarative is the point: an agency's "never send before 8am" is not a GHL rule and must not
// become one in the engine.
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function loadDoctrinePack(json) {
  const errors = [];
  let raw = json;
  if (typeof json === 'string') {
    try { raw = JSON.parse(json); } catch (e) { return { rules: null, errors: [`not valid JSON: ${e.message}`] }; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { rules: null, errors: ['a doctrine pack must be a JSON object'] };
  const rules = {};
  if (raw.sendWindow !== undefined) {
    const w = raw.sendWindow;
    if (!w || typeof w !== 'object') errors.push('sendWindow must be an object');
    else if (!HHMM.test(w.start ?? '') || !HHMM.test(w.end ?? '')) errors.push('sendWindow.start/end must be HH:MM');
    else rules.sendWindow = { start: w.start, end: w.end, days: Array.isArray(w.days) ? w.days : null };
  }
  if (raw.requireRedirectPage !== undefined) {
    if (typeof raw.requireRedirectPage !== 'boolean') errors.push('requireRedirectPage must be a boolean');
    else rules.requireRedirectPage = raw.requireRedirectPage;
  }
  if (raw.noteColors !== undefined) {
    if (!raw.noteColors || typeof raw.noteColors !== 'object') errors.push('noteColors must be an object of name -> #RRGGBB');
    else rules.noteColors = Object.values(raw.noteColors).filter((v) => typeof v === 'string');
  }
  if (raw.captureDependentFields !== undefined) {
    if (raw.captureDependentFields !== 'allCustomFields' && !Array.isArray(raw.captureDependentFields)) {
      errors.push("captureDependentFields must be an array of fieldKeys or the string 'allCustomFields'");
    } else rules.captureDependentFields = raw.captureDependentFields;
  }
  return { rules: Object.keys(rules).length ? rules : null, errors };
}

const toMinutes = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };

export function runDoctrine(doc, rules) {
  if (!rules) return [];
  const out = [];
  const templates = doc?.templates ?? [];
  const add = (rule, severity, msg, ids = {}) => out.push({ pack: 'doctrine', rule, severity, msg, ...ids });

  if (rules.sendWindow) {
    const { start, end } = rules.sendWindow;
    for (const t of templates) {
      const w = t?.attributes?.window;
      if (!w || w.condition !== 'when' || !w.start || !w.end) continue;
      if (toMinutes(w.start) < toMinutes(start) || toMinutes(w.end) > toMinutes(end)) {
        add('sendWindow', 'error',
          `'${t.name ?? t.id}' has a send window ${w.start}-${w.end}, outside this account's policy ${start}-${end}`,
          { stepId: t.id });
      }
    }
  }
  if (rules.requireRedirectPage) {
    for (const t of templates) {
      if (t?.type !== 'internal_notification' || !t.attributes?.notification) continue;
      if (!t.attributes.notification.redirectPage) {
        add('requireRedirectPage', 'error',
          `in-app notification '${t.name ?? t.id}' has no redirectPage, which this account requires`, { stepId: t.id });
      }
    }
  }
  if (rules.noteColors) {
    const allowed = rules.noteColors.map((c) => c.toUpperCase());
    for (const t of templates) {
      if (t?.type !== 'add_notes' || typeof t.attributes?.color !== 'string') continue;
      if (!allowed.includes(t.attributes.color.toUpperCase())) {
        add('noteColors', 'warning',
          `note '${t.name ?? t.id}' uses ${t.attributes.color}; this account's palette is ${allowed.join(', ')}`, { stepId: t.id });
      }
    }
  }
  return out;
}
