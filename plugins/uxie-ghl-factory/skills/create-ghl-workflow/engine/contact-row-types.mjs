// w6d-3 (plan Task 3, bl-386, bl-418): the row TYPE a contact-field row stores is the builder's, not the author's word.
//
// A row authored as `type: 'text'` (update_contact_field's fields[], find_contact's filter rows) saves and runs, but the drawer shows no
// value box for it: the builder stores `string`. The mapping below is the builder's own, from the recovered source of the 2026-11-06 bundle:
//   - utils/conditions.ts getValueTypeFromCustomFieldType: the custom field's dataType → ValueDataType (TEXT/LARGE_TEXT/PHONE/URL/RICH_TEXT
//     → STRING; NUMERICAL/MONETORY → NUMBER; SINGLE_OPTIONS/RADIO/USER → SELECT; MULTIPLE_OPTIONS/CHECKBOX → MULTI_SELECT; DATE/DATE_TIME →
//     DATE; TIME → TIME; TEXTBOX_LIST → TEXTBOX_LIST);
//   - types/conditions.ts ValueDataType: the string each one stores ('string', 'select', 'numerical', 'multiselect', 'date', 'time_only',
//     'textbox_list').
// The standard Time Zone row (field 'timezone', title 'Timezone') stores 'select' (plan decision, w6d-3; the live drawer check decides).
// A stored row type the builder never uses ('text' among them) is rewritten, and the rewrite is ADVISORY: the step still builds.
//
// The UI-built stored rows this rests on: a text custom field saved from the builder reads back as `type: 'string'` with `date: ''`
// (the W6b UI-candidate captures, sniffs/workflows-w6b-2026-10-30/live-lift-ui-candidate-*.json). Nothing here reads an account.

export const VALUE_TYPE_BY_DATATYPE = Object.freeze({
  TEXT: 'string', LARGE_TEXT: 'string', PHONE: 'string', URL: 'string', RICH_TEXT: 'string',
  NUMERICAL: 'numerical', MONETORY: 'numerical',
  SINGLE_OPTIONS: 'select', RADIO: 'select', USER: 'select',
  MULTIPLE_OPTIONS: 'multiselect', CHECKBOX: 'multiselect',
  DATE: 'date', DATE_TIME: 'date', TIME: 'time_only', TEXTBOX_LIST: 'textbox_list',
});

export const TIMEZONE_FIELD = 'timezone';
export const TIMEZONE_ROW_TYPE = 'select';

const WARN_CODE = 'CONTACT_ROW_TYPE_REWRITTEN';

// The builder's type for one row, or undefined when the row's field is neither the Time Zone nor a custom field the account lists.
const builderTypeFor = (row, customFields) => {
  if (row.field === TIMEZONE_FIELD) return TIMEZONE_ROW_TYPE;
  const custom = customFields.find((c) => c && c.id === row.field);
  return custom ? VALUE_TYPE_BY_DATATYPE[custom.dataType] : undefined;
};

// Returns a NEW array of rows. Rows are copied, never mutated: the caller keeps what it wrote.
//   - no type on a known field        → the builder's type (no warning: the drawer needs it)
//   - type 'text'                     → the builder's type, or 'string' when the field is not listed (warned)
//   - Time Zone authored as anything but 'select' → 'select' (warned)
//   - any other authored type         → kept as written
export function normalizeContactRows(rows, { customFields = [], warn, ref = '?' } = {}) {
  if (!Array.isArray(rows)) return rows;
  const lists = Array.isArray(customFields) ? customFields : [];
  return rows.map((row) => {
    if (!row || typeof row !== 'object' || typeof row.field !== 'string') return row;
    const builder = builderTypeFor(row, lists);
    if (row.type === undefined) return builder === undefined ? row : { ...row, type: builder };
    const timezoneWrong = row.field === TIMEZONE_FIELD && row.type !== TIMEZONE_ROW_TYPE;
    if (row.type !== 'text' && !timezoneWrong) return row;
    const type = builder ?? 'string';
    warn?.(`${WARN_CODE}: ${ref}: the row for '${row.title ?? row.field}' is written as '${row.type}'. The builder stores `
      + `'${type}' for this field, and the drawer shows no value box for '${row.type}'. Written as '${type}' instead; `
      + `the step still builds.`);
    return { ...row, type };
  });
}
