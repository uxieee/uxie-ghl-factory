// w6d-2 (plan Task 2, item 12): richer step cards. Pure: reads the catalogue (type-cards.json, observed-trigger-filters.json) through
// the caller's card and an optional observed map; no network. describe_step_type merges stepCardExtras(card) into its card.
//
//   assetReferences      [{field, assetType, mustExist:true, checkedBy}]: ids that must already exist on the account. checkedBy is one of:
//                        'validate-assets' (a measured catch), 'none' (measured NOT read: validate-assets misses it, bl-140, bl-144),
//                        'unmeasured' (no measurement either way: the card does not assert the server's behaviour there).
//   requiredEnforcement  {field: 'server'|'builder'|'none'|'unknown'}. 'server' ONLY where MEASURED_SERVER records a live refusal;
//                        'none' for a field the card does not require; 'builder' for a required field a builder validator enforces;
//                        'unknown' for a required field with no validator named.
//   hasDynamicOptions    {field: boolean}: true for the account-loaded pickers in DYNAMIC_OPTIONS (calendars, user lists).
//   triggerFilters       (triggers only) {known, observed, complete}: the card's filter rows against the observed ones; complete is false
//                        when fewer were observed than the card reports.
//
// An unknown or malformed card returns {} and never throws (item 13: unknown values are other, never a crash).

import { readFileSync } from 'node:fs';

// The measured server refusals. Each entry names its evidence; add one only with a live refusal on record.
export const MEASURED_SERVER = Object.freeze({
  // A non-integer split weight (33.3) was refused live on a sandbox account (w6c-11b; FINDINGS.md in sniffs/workflows-w6c-2026-11-06).
  'workflow_split.extras': 'live refusal of a non-integer path weight (w6c-11b; sniffs/workflows-w6c-2026-11-06/FINDINGS.md)',
});

// The sites that hold a reference to an account asset. The table is the engine's own evidence, swept from asset-preflight.mjs
// (its confirmed catches and misses) and reference-sites.mjs (the sites the engine checks itself, which GHL's validate-assets does not):
//   'validate-assets'  a measured catch: GHL's validate-assets reports a ghost id at this site
//   'none'             a measured MISS: validate-assets does not read this site (MEASURED_NOT_READ lists them)
//   'unmeasured'       no measurement either way; the card does not assert the server's behaviour here
export const ASSET_REFERENCES = Object.freeze({
  // asset-preflight: ASSET_WORKFLOW_NOT_FOUND on a nonexistent workflow id (confirmed catch).
  add_to_workflow: [{ field: 'workflow_id', assetType: 'workflow', checkedBy: 'validate-assets' }],
  // No recorded check on the remove site.
  remove_from_workflow: [{ field: 'workflow_id', assetType: 'workflow', checkedBy: 'unmeasured' }],
  // asset-preflight: ASSET_CALENDAR_NOT_FOUND on the trigger's calendar.id condition (confirmed catch, the trigger site).
  appointment: [{ field: 'calendar.id', assetType: 'calendar', checkedBy: 'validate-assets' }],
  // No measurement of the custom-field id on update.
  update_contact_field: [{ field: 'fields[].id', assetType: 'custom_field', checkedBy: 'unmeasured' }],
  // asset-preflight: the same ghost calendar is MISSED on an appointment_booking step's calendarId (confirmed miss).
  appointment_booking: [{ field: 'calendarId', assetType: 'calendar', checkedBy: 'none' }],
  // Measured for appointment_booking only; this step has no measurement of its own.
  conversationai_book_appointment: [{ field: 'calendarId', assetType: 'calendar', checkedBy: 'unmeasured' }],
  // asset-preflight: ASSET_USER_NOT_FOUND on user_list (confirmed catch). reference-sites bl-144: the traffic sites are NOT read.
  assign_user: [
    { field: 'user_list', assetType: 'user', checkedBy: 'validate-assets' },
    { field: 'traffic_weightage', assetType: 'user', checkedBy: 'none' },
    { field: 'traffic_index[].id', assetType: 'user', checkedBy: 'none' },
  ],
});

// The measured MISSES: sites with checkedBy 'none'. Each one is a measured fact, by the name in its comment above.
export const MEASURED_NOT_READ = Object.freeze(new Set([
  'appointment_booking.calendarId',
  'assign_user.traffic_weightage',
  'assign_user.traffic_index[].id',
]));

const NO_VALIDATOR = /^`?(none|—|-)`?$/i;
const hasValidator = (card) => {
  const v = card?.meta?.Validator;
  return typeof v === 'string' && v.trim() !== '' && !NO_VALIDATOR.test(v.trim());
};

// Account-loaded pickers: the option list is the account's own calendars or users. Source: the engine reads both from the account for its
// reference checks (engine/reference-sites.mjs: CALENDAR_STEPS, the assign_user user list). The catalogue's DYNAMIC row is a placeholder, not a field.
export const DYNAMIC_OPTIONS = Object.freeze({
  appointment_booking: ['calendarId'],
  conversationai_book_appointment: ['calendarId'],
  assign_user: ['user_list'],
});

const enforcementFor = (card, f) => {
  if (MEASURED_SERVER[`${card.type}.${f.name}`]) return 'server';
  if (!f.required) return 'none';
  return hasValidator(card) ? 'builder' : 'unknown';
};

// The observed trigger filters from the catalogue, loaded once. A missing file reads as {} (every trigger then shows complete:false).
let DEFAULT_OBSERVED;
const defaultObserved = () => {
  if (DEFAULT_OBSERVED === undefined) {
    try { DEFAULT_OBSERVED = JSON.parse(readFileSync(new URL('../../skills/create-ghl-workflow/catalog/observed-trigger-filters.json', import.meta.url), 'utf8')); }
    catch { DEFAULT_OBSERVED = {}; }
  }
  return DEFAULT_OBSERVED;
};

// Triggers carry their filter rows as `filterRows` (115 cards) or as `conditions` (47 cards with no fields list): both are the card's rows.
const isTrigger = (card) => /^triggers/.test(String(card.family ?? ''));
const filterRowsOf = (card) => (Array.isArray(card.filterRows) ? card.filterRows : Array.isArray(card.conditions) ? card.conditions : null);

export function stepCardExtras(card, { observed } = {}) {
  if (!card || typeof card !== 'object' || typeof card.type !== 'string') return {};
  const rows = isTrigger(card) ? filterRowsOf(card) : null;
  if (!Array.isArray(card.fields) && !rows) return {};
  const fields = (Array.isArray(card.fields) ? card.fields : []).filter((f) => f && typeof f.name === 'string' && f.type !== 'DYNAMIC');
  const out = {
    assetReferences: (ASSET_REFERENCES[card.type] ?? []).map((r) => ({ ...r, mustExist: true })),
    requiredEnforcement: {},
    hasDynamicOptions: {},
  };
  for (const f of fields) {
    out.requiredEnforcement[f.name] = enforcementFor(card, f);
    out.hasDynamicOptions[f.name] = (DYNAMIC_OPTIONS[card.type] ?? []).includes(f.name);
  }
  if (isTrigger(card)) {
    const known = rows ? rows.length : 0;
    const obs = observed ?? defaultObserved();
    const seen = Array.isArray(obs?.[card.type]) ? obs[card.type].length : 0;
    out.triggerFilters = { known, observed: seen, complete: seen >= known };
  }
  return out;
}
