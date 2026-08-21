// WORKFLOW-LEVEL SETTINGS — the builder's Settings tab, as a contract.
//
// Until 2026-08-22 `ir.settings` was read by the compiler for six keys and never validated:
// a key the compiler did not read (`window`, `workflowNote`, a typo) was SILENTLY DROPPED —
// the exact defect class this engine exists to kill. This module is the single place that
// knows every setting the UI can write, its stored key, type, value domain and UI default.
//
// Evidence (research repo, bundle-2026-08-21-2):
//   states/settings.ts           SettingState defaults: allowMultiple TRUE, allowMultipleOpportunity
//                                TRUE, stopOnResponse false, autoMarkAsRead false, timezone
//                                'account'|'contact' (WindowTimezone), eventStartDate ''
//   models/Workflow.ts:609-614   Window { condition: ActionCondition; start; end?; days[] }
//   models/Workflow.ts:829-830   senderAddress { from_name?, from_email?, from_number? }
//   models/Workflow.ts:860-868   IWorkflowNote { content, createdBy?, createdByName?, createdOn?,
//                                updatedBy?, updatedByName?, updatedOn? }
//   utils/WorkflowValidator.ts:132-139  checkSenderAddress: From Name requires From Email
//   LIVE (GROM AU 2026-08-22)    Settings tab → Save = PUT /workflow/{loc}/{wid} carrying
//                                window {condition:'when', start:'08:00', end:'17:00', days:[1..5]}
//                                (the UI's own defaults when "Specific time" is switched on),
//                                meta {statsView:false}, eventStartDate '' (stored null)
//   CORPUS (326 stored docs)     allowMultiple true ×313 — the UI default is ON; timezone only
//                                account ×296 / contact ×30; window null ×304 / object ×15 (all
//                                condition:'when'); workflowNote object ×105; senderAddress
//                                key sets {from_email,from_name}, {+from_number}, {from_number}
//
// Severity: REFUSE on an unknown key or an impossible value (IRError SETTINGS_KEY /
// SETTINGS_VALUE). Advisory (ctx.warn) on things the UI would accept but that look wrong.
// Hatch: ctx.skipSettingsCheck = true keeps the refusals off (values still normalized).
import { IRError } from './ir.mjs';

export const TIMEZONES = ['account', 'contact'];               // WindowTimezone — NOT an IANA zone
export const WINDOW_CONDITIONS = ['when'];                     // the global window always stores 'when'
export const SENDER_KEYS = ['from_name', 'from_email', 'from_number'];
export const NOTE_KEYS = ['content', 'createdBy', 'createdByName', 'createdOn', 'createdAt', 'updatedBy', 'updatedByName', 'updatedOn', 'updatedAt'];

// key → { ui label, default the UI would store, brief }
export const SETTINGS_SPEC = Object.freeze({
  allowMultiple:            { ui: 'Allow re-entry',                 def: true,      type: 'boolean' },
  allowMultipleOpportunity: { ui: 'Allow multiple opportunities',   def: true,      type: 'boolean' },
  stopOnResponse:           { ui: 'Stop on response',               def: false,     type: 'boolean' },
  autoMarkAsRead:           { ui: 'Mark as read',                   def: false,     type: 'boolean' },
  timezone:                 { ui: 'Timezone',                       def: 'account', type: 'enum', values: TIMEZONES },
  window:                   { ui: 'Time window — Specific time',    def: null,      type: 'window' },
  senderAddress:            { ui: 'Sender details / From number',   def: {},        type: 'sender' },
  workflowNote:             { ui: 'Workflow note (Notes panel)',     def: null,      type: 'note' },
  eventStartDate:           { ui: '(deprecated) event start date',  def: '',        type: 'string' },
  removeContactFromLastStep:{ ui: '(no control; always true)',       def: true,      type: 'boolean' },
  scheduledPauseDates:      { ui: 'Pause workflow (DERIVED — see scheduled-pause/config)', def: [], type: 'array' },
  statsView:                { ui: 'Stats view toggle (meta.statsView)', def: false, type: 'boolean' },
});
export const KNOWN_SETTINGS_KEYS = new Set(Object.keys(SETTINGS_SPEC));

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@{}]+@[^\s@{}]+\.[^\s@{}]+$/;
const E164ISH = /^\+?[1-9]\d{6,14}$/;
const isMergeTag = (v) => typeof v === 'string' && /\{\{[^}]+\}\}/.test(v);

/**
 * Validate + normalize `ir.settings` into the exact top-level keys a UI save would carry.
 * Returns { body, warnings }. Throws IRError on an unknown key or an impossible value
 * (unless ctx.skipSettingsCheck).
 */
export function normalizeSettings(settings, ctx = {}) {
  const s = settings ?? {};
  const strict = ctx.skipSettingsCheck !== true;
  const warnings = [];
  const warn = (m) => { warnings.push(m); if (typeof ctx.warn === 'function') ctx.warn(m); };
  const refuse = (code, msg) => { if (strict) throw new IRError(code, msg); warnings.push(`(skipSettingsCheck) ${msg}`); };

  if (s && (typeof s !== 'object' || Array.isArray(s))) refuse('SETTINGS_VALUE', `settings must be an object (got ${Array.isArray(s) ? 'array' : typeof s})`);
  const unknown = Object.keys(s).filter((k) => !KNOWN_SETTINGS_KEYS.has(k));
  if (unknown.length) refuse('SETTINGS_KEY',
    `unknown settings key(s) [${unknown.join(', ')}] — the compiler never reads these, so they would be silently ` +
    `discarded. Known settings: ${[...KNOWN_SETTINGS_KEYS].join(', ')}.`);

  const bool = (k) => {
    const v = s[k];
    if (v === undefined) return SETTINGS_SPEC[k].def;
    if (typeof v !== 'boolean') refuse('SETTINGS_VALUE', `settings.${k} must be true/false (got ${JSON.stringify(v)}); UI control: "${SETTINGS_SPEC[k].ui}"`);
    return Boolean(v);
  };

  // timezone — the picker offers exactly two values; an IANA string is NOT what the UI stores
  let timezone = s.timezone === undefined ? 'account' : s.timezone;
  if (!TIMEZONES.includes(timezone)) {
    refuse('SETTINGS_VALUE', `settings.timezone must be 'account' (sub-account timezone) or 'contact' (each contact's own) — got ${JSON.stringify(timezone)}. The builder's picker has no other value; an IANA zone is never stored here.`);
    timezone = 'account';
  }

  // window — null/undefined = "Specific time" OFF; object = ON with the UI's shape
  let window = null;
  if (s.window != null && s.window !== false) {
    const w = s.window === true ? {} : s.window;
    if (typeof w !== 'object' || Array.isArray(w)) { refuse('SETTINGS_VALUE', `settings.window must be an object {start,end,days} or null`); }
    else {
      const extra = Object.keys(w).filter((k) => !['condition', 'start', 'end', 'days'].includes(k));
      if (extra.length) refuse('SETTINGS_KEY', `settings.window has unknown key(s) [${extra.join(', ')}] — the UI writes only condition/start/end/days`);
      const condition = w.condition ?? 'when';
      if (!WINDOW_CONDITIONS.includes(condition)) refuse('SETTINGS_VALUE', `settings.window.condition must be 'when' (the only value the Settings tab stores; corpus 15/15) — got ${JSON.stringify(condition)}`);
      const start = w.start ?? '08:00', end = w.end ?? '17:00';   // the UI's own defaults when the toggle is switched on
      for (const [k, v] of [['start', start], ['end', end]]) {
        if (typeof v !== 'string' || !HHMM.test(v)) { refuse('SETTINGS_VALUE', `settings.window.${k} must be 24h 'HH:mm' (UI stores e.g. '08:00', '17:00') — got ${JSON.stringify(v)}`); continue; }
        // the Settings tab's time pickers are a 96-option 15-minute grid (pages/workflow/Setting.vue) — :07 is unreachable in the UI
        if (Number(v.slice(3)) % 15 !== 0) refuse('SETTINGS_VALUE', `settings.window.${k} '${v}' is not on the UI's 15-minute grid (the picker offers only :00/:15/:30/:45)`);
      }
      if (HHMM.test(start) && HHMM.test(end) && end <= start) warn(`settings.window: end '${end}' is not after start '${start}' — the UI does not validate this, but no window would ever be open`);
      let days = w.days ?? [1, 2, 3, 4, 5];                        // UI default: Mon–Fri
      if (!Array.isArray(days) || !days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) refuse('SETTINGS_VALUE', `settings.window.days must be a non-empty array of weekday numbers 0 (Sunday) … 6 (Saturday) — got ${JSON.stringify(w.days)}`);
      else days = [...new Set(days)].sort((a, b) => a - b);
      window = { condition, start, end, days };
    }
  }

  // senderAddress — From name / From email (emails), From number (SMS); empty keys are DELETED
  // on save by the UI (updateWorkflowSettingFromState), so only non-empty strings are carried
  let senderAddress = {};
  if (s.senderAddress != null) {
    const sa = s.senderAddress;
    if (typeof sa !== 'object' || Array.isArray(sa)) refuse('SETTINGS_VALUE', `settings.senderAddress must be an object {from_name, from_email, from_number}`);
    else {
      const extra = Object.keys(sa).filter((k) => !SENDER_KEYS.includes(k));
      if (extra.length) refuse('SETTINGS_KEY', `settings.senderAddress has unknown key(s) [${extra.join(', ')}] — the UI stores only ${SENDER_KEYS.join(', ')} (snake_case)`);
      for (const k of SENDER_KEYS) {
        const v = sa[k];
        if (v == null || v === '') continue;
        if (typeof v !== 'string') { refuse('SETTINGS_VALUE', `settings.senderAddress.${k} must be a string`); continue; }
        senderAddress[k] = v;
      }
      // GHL's checkSenderAddress. On an EDIT that does not touch senderAddress (ctx.senderRuleAdvisory)
      // a legacy doc already in this state must not brick an unrelated settings change — the UI's own
      // copy of this rule is dead whenever triggers exist, so such docs exist in the wild.
      if (senderAddress.from_name && !senderAddress.from_email) {
        const msg = `settings.senderAddress: From Name requires From Email (GHL's checkSenderAddress rule: "${ctx.i18n?.['workflow.settings.from_email_required'] ?? 'From email is required when From name is set'}")`;
        if (ctx.senderRuleAdvisory === true) warn(`${msg} — pre-existing on this workflow, left as stored`); else refuse('SETTINGS_VALUE', msg);
      }
      if (senderAddress.from_email && !isMergeTag(senderAddress.from_email) && !EMAIL.test(senderAddress.from_email)) warn(`settings.senderAddress.from_email '${senderAddress.from_email}' does not look like an email address (a {{merge tag}} is fine)`);
      if (senderAddress.from_number && !isMergeTag(senderAddress.from_number) && !E164ISH.test(senderAddress.from_number.replace(/[\s()-]/g, ''))) warn(`settings.senderAddress.from_number '${senderAddress.from_number}' does not look like a phone number (the UI's From number is a dropdown of the account's numbers, stored E.164 e.g. '+15551234567')`);
    }
  }

  // workflowNote — the Notes panel's workflow-level note; a string is promoted to the stored shape
  let workflowNote = null;
  if (s.workflowNote != null && s.workflowNote !== '') {
    const now = (ctx.now ? new Date(ctx.now) : new Date()).toISOString();
    if (typeof s.workflowNote === 'string') {
      workflowNote = { content: s.workflowNote, createdBy: ctx.uid ?? undefined, createdAt: now, updatedBy: ctx.uid ?? undefined, updatedAt: now };
    } else if (typeof s.workflowNote === 'object' && !Array.isArray(s.workflowNote)) {
      const extra = Object.keys(s.workflowNote).filter((k) => !NOTE_KEYS.includes(k));
      if (extra.length) refuse('SETTINGS_KEY', `settings.workflowNote has unknown key(s) [${extra.join(', ')}] — IWorkflowNote is ${NOTE_KEYS.join(', ')}`);
      if (typeof s.workflowNote.content !== 'string') refuse('SETTINGS_VALUE', `settings.workflowNote.content must be a string`);
      workflowNote = { content: String(s.workflowNote.content ?? ''), createdBy: ctx.uid ?? undefined, createdAt: now, updatedBy: ctx.uid ?? undefined, updatedAt: now, ...s.workflowNote };
    } else refuse('SETTINGS_VALUE', `settings.workflowNote must be a string or {content, …}`);
    if (workflowNote) for (const k of Object.keys(workflowNote)) if (workflowNote[k] === undefined) delete workflowNote[k];
    // the Notes panel's workflow note is a PLAIN-TEXT textarea with maxlength 5000 (Setting/Notes page) — longer is unreachable in the UI
    if (workflowNote && workflowNote.content.length > 5000) refuse('SETTINGS_VALUE', `settings.workflowNote.content is ${workflowNote.content.length} chars; the UI's textarea caps it at 5000`);
  }

  let eventStartDate = s.eventStartDate ?? '';
  if (typeof eventStartDate !== 'string') { refuse('SETTINGS_VALUE', `settings.eventStartDate must be a string ('' = unset; deprecated in favour of the event_start_date step)`); eventStartDate = ''; }
  if (eventStartDate) warn(`settings.eventStartDate is deprecated in the builder (the Settings tab no longer shows it) — prefer an event_start_date step`);

  let scheduledPauseDates = s.scheduledPauseDates ?? [];
  if (!Array.isArray(scheduledPauseDates)) { refuse('SETTINGS_VALUE', `settings.scheduledPauseDates must be an array`); scheduledPauseDates = []; }
  else if (scheduledPauseDates.length) warn(`settings.scheduledPauseDates is a DERIVED read-only view (live-proven 2026-08-22): the server computes it from the location's pause configs when the GET carries ?includeScheduledPauseInfo=true, and ignores it on writes. To actually pause, POST /workflow/{loc}/scheduled-pause/config {pauseStartTime, pauseEndTime (epoch ms, window ≥ 24h), isAnnual, workflowIds:[…]} — these ${scheduledPauseDates.length} entr${scheduledPauseDates.length === 1 ? 'y' : 'ies'} will not create a pause`);

  const body = {
    allowMultiple: bool('allowMultiple'),
    allowMultipleOpportunity: bool('allowMultipleOpportunity'),
    stopOnResponse: bool('stopOnResponse'),
    autoMarkAsRead: bool('autoMarkAsRead'),
    removeContactFromLastStep: bool('removeContactFromLastStep'),
    timezone, window, senderAddress, eventStartDate, scheduledPauseDates, workflowNote,
    statsView: bool('statsView'),
  };
  return { body, warnings };
}

/** Human list for error messages / docs: `key — UI label (default)`. */
export function describeSettings() {
  return Object.entries(SETTINGS_SPEC).map(([k, v]) => `${k} — ${v.ui} (default ${JSON.stringify(v.def)})`);
}
