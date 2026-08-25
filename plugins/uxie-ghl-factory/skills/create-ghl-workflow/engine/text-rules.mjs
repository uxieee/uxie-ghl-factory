// TEXT-CONTENT rules GHL applies to message bodies and prompts — the two of them that can be
// mirrored EXACTLY, and an explicit note about the one that cannot.
//
// ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────────────────────
// GHL's `isValidHandleBar` (utils/validation.ts:188) delegates to
// `HandlebarValidator.isValidHandlebarString`, which runs a REAL Handlebars parser
// (`CustomHandlebars.parse`) inside a try/catch. Reimplementing a template parser with regexes
// would be precisely the hand-written predicate this engine bans for guard translation: it would
// disagree with GHL at the edges, and a validator that is wrong at the edges is worse than none,
// because it teaches people to trust it.
//
// So the parse half is NOT mirrored. Its SECOND half is, because that half is pure string
// scanning with no parser involved and can be ported line for line — see below.
//
// A workflow can therefore still carry a malformed handlebar expression that GHL would reject.
// That gap is real and stated rather than papered over.

/** GHL: HANDLEBARS_EXPRESSION_REGEX, handlebar-validator.ts:59 — verbatim. */
const HANDLEBARS_EXPRESSION = /\{\{(?:(?!\}\}).)*\}\}/g;

/**
 * GHL: hasNestedBracketsInExpressions, handlebar-validator.ts:109-138 — ported line for line.
 *
 * Its own comment explains the defect: a bracket segment containing `[` or `]` PARSES fine and
 * then resolves wrongly at runtime, because `]` closes the segment early and `[` desynchronises
 * the backend's depth tracking in splitPathSegments. So it is a silent-wrong-value bug, not a
 * save failure — exactly the class this engine exists to catch.
 *
 * Valid (returns false):  {{prefix.[key with spaces].id}} · {{prefix.[0].name}}
 */
export function hasNestedBracketsInExpressions(str) {
  const expressions = String(str ?? '').match(HANDLEBARS_EXPRESSION);
  if (!expressions) return false;

  for (const expr of expressions) {
    const inner = expr.slice(2, -2).trim();
    // Block helpers ({{#each}} / {{/each}}) are not path expressions.
    if (inner.startsWith('#') || inner.startsWith('/')) continue;

    let i = 0;
    while (i < inner.length) {
      if (inner[i] === '[') {
        const start = i + 1;
        // Handlebars takes the FIRST closing bracket, so scan to it and no further.
        const end = inner.indexOf(']', start);
        if (end === -1) break;   // unclosed — the parser half would have caught this
        const segment = inner.substring(start, end);
        if (segment.includes('[') || segment.includes(']')) return true;
        i = end + 1;
      } else {
        i++;
      }
    }
  }
  return false;
}

/**
 * GHL: WorkflowValidator.ts:226-241 — the SMS spam-word gate.
 *
 * This one is unusual and worth understanding before judging the false positives. It does not
 * live in `validate()`; it is called separately at SAVE time (hooks/use-save-workflow.ts:212)
 * and it THROWS `SpamSmsBodyError`, aborting the save outright. So a body containing one of these
 * words cannot be saved through the UI at all.
 *
 * The list is GHL's, not ours, and it is blunt: alongside `cannabis` and `thc` it contains `pot`,
 * `joint`, `pipe` and `dab`, so an ordinary sentence like "let's discuss the joint venture" is
 * refused. Mirroring it faithfully is still right — refusing here costs one clear error message,
 * whereas not refusing costs a build that dies at save with GHL's opaque one. The message names
 * the offending word and says whose list it is, so nobody wastes time hunting their own code.
 *
 * Word extraction matches GHL's `words(data, /\b(\w+)\b/g)` over the lowercased body.
 */
export function illegalSmsWords(body, vocab) {
  const list = vocab ?? [];
  if (!body || !list.length) return [];
  const found = String(body).toLowerCase().match(/\b(\w+)\b/g) ?? [];
  const banned = new Set(list.map((w) => String(w).toLowerCase()));
  return [...new Set(found.filter((w) => banned.has(w)))];
}
