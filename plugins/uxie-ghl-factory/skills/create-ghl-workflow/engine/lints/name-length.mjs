// STEP AND TRIGGER NAME LENGTH — a cap the BUILDER enforces and the API does not.
//
// Live (R-58, GROM sandbox 2026-09-02): ten cloned steps shipped with names over 100 characters.
// The write path took all ten — 200, read back byte-identical — and the workflow ran. The
// builder's own drawer validator then refuses to save any step whose name falls outside 1..100,
// so the workflow reads perfectly clean by API and cannot be edited by hand: the first person to
// open one of those drawers cannot save it, and nothing tells them why.
//
// That makes this the same class as lints/publish-rules.mjs — a rule describing a SAVE that would
// be refused rather than a document that is already broken — so it is advisory (`warning`), never
// an error. An error here would abort the edit path over a document GHL is happily running.
//
// A MISSING name is deliberately out of scope: required-fields.mjs owns "this step has no name".
// This rule only judges a name that exists.
export const STEP_NAME_MIN = 1;
export const STEP_NAME_MAX = 100;

const judge = (name) => {
  if (typeof name !== 'string') return null;          // absent — not this rule's business
  const len = [...name].length;                        // count characters, not UTF-16 code units
  if (name.trim() === '') {
    return `is empty or whitespace only — the builder requires at least ${STEP_NAME_MIN} character, `
      + 'so the drawer cannot be saved by hand even though the API stored it';
  }
  if (len > STEP_NAME_MAX) {
    return `has a ${len}-character name — the builder caps it at ${STEP_NAME_MAX}. The API accepts the `
      + 'longer name and round-trips it intact, so this reads clean by API and the drawer refuses to '
      + 'save the moment a human opens it. Shorten the name.';
  }
  return null;
};

export function lintNameLength(templates, triggers) {
  const out = [];
  for (const t of Array.isArray(templates) ? templates.filter(Boolean) : []) {
    const bad = judge(t.name);
    if (bad) out.push({ code: 'NAME_LENGTH', severity: 'warning', stepId: t.id, name: t.name, msg: `step '${t.id}' ${bad}` });
  }
  for (const g of Array.isArray(triggers) ? triggers.filter(Boolean) : []) {
    const bad = judge(g.name);
    if (bad) out.push({ code: 'NAME_LENGTH', severity: 'warning', triggerId: g.id, name: g.name, msg: `trigger '${g.id}' ${bad}` });
  }
  return out;
}
