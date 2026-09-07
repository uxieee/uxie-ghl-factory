// "Check Errors", run over the API.
//
// GHL's builder validates a workflow client-side; nothing on the API rail does. This replays the
// builder's OWN validator functions — recovered verbatim from its bundle — over a live workflow
// document. Ported from a script another operator wrote and proved over a live account (853 steps,
// 528 validated, zero crashes); the two traps below cost them an hour each and are now tests.
//
// 🔴 WHAT THIS CANNOT DO, and it is the reason to read the `unchecked` list before the findings:
// GHL ships NO validator for a large part of the surface. Of 385 step types only 51 carry one it
// enforces; `if_else`, `task-notification`, `goto`, `transition`, `find_opportunity` and
// `internal_update_opportunity` have none. A task step with a malformed `attributes.type` passes
// every layer here, passes publish, and passes the builder's own Check Errors panel — and then
// fails in the drawer, which runs only when a human opens the step. So this reports those steps as
// UNCHECKED rather than letting a zero finding count imply they are clean.

// The recovered validator bodies, embedded at build time. NEVER sourced from the wire: this is
// evaluated with `new Function`, so it must stay a pinned build artefact.
let VALIDATORS = null;
const validatorSource = (readJson) => {
  if (VALIDATORS) return VALIDATORS;
  if (typeof __HAS_BUILDER_VALIDATORS__ !== 'undefined') { VALIDATORS = __BUILDER_VALIDATORS__; return VALIDATORS; }
  try { VALIDATORS = readJson(); } catch { VALIDATORS = null; }
  return VALIDATORS;
};

// Helpers the recovered validators call. PORTED, not recovered — reimplemented from the recovered
// TypeScript in the bundle capture. Two are faithful transcriptions (`parseHTMLToBody`,
// `contactStandardFields`) and one is a faithful port including its fallback
// (`getMathOperationSourceTypeFromTemplates`, from additional-action-validators.ts:320), and one
// more found by RUNNING it — `isWithinLimits`, a faithful port from utils/validation.ts:157, which
// `waitValidator` calls for the step-name length check. Its absence crashed every wait step that
// carries a name; the original script never hit it because the account it was proved on had none.
// The rest
// are BEHAVIOURAL APPROXIMATIONS, good enough for the truthiness checks the validators do with them
// and no more: `isValidHandleBar` here only counts brace pairs, where the real one delegates to a
// HandlebarValidator that was never recovered. A finding that turns on one of those is a hint, not
// a verdict — which is why `helperFidelity` ships in the result.
const PRE = `
const translate = (k) => k; const t = translate;
const isArray = Array.isArray;
function parseHTMLToBody(html){ let b=String(html||'').replace(/<\\s*p\\s*>/gi,'').replace(/<\\/\\s*p\\s*>/gi,'\\n').replace(/<\\s*br\\s*\\/?>/gi,'\\n').replace(/&amp;/gi,'&').replace(/&nbsp;/gi,' ').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>'); return b.replace(/<[^>]*>/g,'').trim(); }
function cleanHTMLForEmail(text){ return parseHTMLToBody(text); }
function isValidHandleBar(body){ const s=String(body||''); const o=(s.match(/{{/g)||[]).length, c=(s.match(/}}/g)||[]).length; return o===c; }
function isValidEmail(v){ return /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(String(v||'')) || /{{.+}}/.test(String(v||'')); }
function isValidURL(v){ return /^https?:\\/\\//.test(String(v||'')) || /{{.+}}/.test(String(v||'')); }
function isValidNumeric(v){ return v!=='' && v!=null && !isNaN(Number(v)); }
function isValidPhone(v){ return /^[+0-9()\\-\\s]{6,}$/.test(String(v||'')) || /{{.+}}/.test(String(v||'')); }
const contactStandardFields = ['id','firstName','lastName','name','email','phone','dateOfBirth','source','website','type','companyName','address1','country','state','postalCode','dnd','timezone','city'];
const requiresFieldValue = (a) => a === 'update_field_data' || a === 'add_field_data';
const isMissingFieldValue = (value, date) => { if (isArray(value)) return value.length === 0; return value !== false && (value == null || value === '') && date !== 'currentDate' && value !== 0; };
function isWithinLimits(field, low, high, countWords){ low = low ?? 0; high = high ?? 100; if(!field) return false; if(!countWords){ return field.length > low && field.length <= high; } const avgWordLength=7; const totalWords=field.trim().split(/\\s+/).length; const totalWordsByAvgLength=Math.round(field.trim().length/avgWordLength); return totalWords > low && totalWords <= high && totalWordsByAvgLength <= high; }
function getMathOperationSourceTypeFromTemplates(selectField, templates){ const m=String(selectField||'').match(/\\{\\{math_operation\\.(\\d+)\\.result\\}\\}/); if(!m||!templates||!templates.length) return null; const i=parseInt(m[1],10); const ops=templates.filter(x=>x.type==='math_operation'&&x.attributes); const byIdx=ops.find(x=>(x.stepIndex??0)===i); if(byIdx&&byIdx.attributes) return byIdx.attributes.selectFieldtype||'numerical'; const byOrder=ops[i]; if(!byOrder||!byOrder.attributes) return null; return byOrder.attributes.selectFieldtype||'numerical'; }
`;

export const HELPER_FIDELITY = 'The helper functions the validators call are reimplemented, not recovered. '
  + 'parseHTMLToBody, contactStandardFields, isWithinLimits and getMathOperationSourceTypeFromTemplates are faithful; '
  + 'isValidHandleBar, isValidEmail, isValidURL, isValidNumeric and isValidPhone are behavioural '
  + 'approximations — isValidHandleBar only counts brace pairs. Treat a finding that turns on one of '
  + 'those as a hint to check by hand, not a verdict.';

/**
 * Compile every recovered validator into ONE shared scope.
 * They call each other — `waitValidator` dispatches to `validateTimeWait` and
 * `validateAppointmentWait`, which are themselves keys in the same file — so compiling them
 * separately yields a bag whose members throw ReferenceError on the dispatching types.
 */
export function compileValidators(source) {
  if (!source || typeof source !== 'object') return null;
  const names = Object.keys(source);
  if (!names.length) return null;

  // This builds a function body by concatenation, so the shape of every part is checked first
  // rather than trusted. The source is a build-time-embedded artefact and MUST NOT be reachable
  // from a tool argument — but "must not" is a comment, and these are the checks:
  //
  //   * a key has to be a bare identifier, so it cannot close the object literal in the `return`
  //   * a body has to BIND THAT SAME IDENTIFIER and nothing else, in one of the two forms the
  //     capture actually uses — `name=<expr>` (59 of them) or `function name(` (8 of them)
  //
  // What that does and does not buy: it stops an entry from binding a name other than the key it
  // is filed under, and it stops a key from escaping the `return {…}` object literal. It is NOT a
  // JavaScript parse and cannot stop a statement appended inside a body that starts correctly.
  // The real control is provenance — this source is embedded at build time from a pinned capture
  // and is never reachable from a tool argument. These checks exist so that a tampered or
  // truncated artefact fails loudly instead of compiling into something that looks like GHL.
  //
  // A file that fails is refused wholesale rather than partly compiled: a validator set with one
  // bad entry is not a validator set worth running.
  const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
  for (const n of names) {
    if (!IDENT.test(n)) return { error: `validator key ${JSON.stringify(n).slice(0, 40)} is not a bare identifier` };
    const body = source[n];
    if (typeof body !== 'string') return { error: `validator ${n} is not a string` };
    const binds = new RegExp(`^(?:${n}\\s*=|function\\s+${n}\\s*\\()`);
    if (!binds.test(body.trim())) {
      return { error: `validator ${n} does not bind the identifier it is filed under (expected "${n}=" or "function ${n}(")` };
    }
  }
  // eslint-disable-next-line no-new-func
  return new Function(`${PRE}\n${names.map((n) => source[n]).join(';\n')};\nreturn {${names.join(',')}};`)();
}

/**
 * type -> validator name, read off each type card's `Validator` meta line.
 * ⚠️ This parses PROSE. The line reads like "`addNotesValidator` (per `…summary.json`)", so the
 * first backticked identifier is the name. It will drift if that wording changes, which is why
 * `mappedTypes` is reported and pinned by a test rather than trusted silently.
 */
export function validatorNamesFor(cards, bag) {
  const NONE = /^none\b|null/i;
  const out = {};
  for (const c of (cards ?? [])) {
    const line = c?.meta?.Validator;
    if (!line || NONE.test(String(line).trim())) continue;
    const m = String(line).match(/`([A-Za-z0-9_]+)`/);
    if (m && bag?.[m[1]]) out[c.type] = m[1];
  }
  return out;
}

/**
 * Run the validators over a workflow's steps.
 *
 * 🔴 The validators want the step's NEIGHBOURHOOD, not the step. `gotoValidator` reads `parentNode`
 * and `templates`; `mathOperationValidator` reads `templates`. And `parentNode.next` does NOT mean
 * the parent's children — in the stored document `next` is a single id pointing at the FOLLOWING
 * SIBLING, so `parentNode` is the canvas wrapper of the step itself. Passing a real parent flagged
 * all 43 gotos on one live account as `goto_must_be_at_end_of_branch`; passing `{next: step.next}`
 * gave zero.
 *
 * 🔴 Validators return TWO kinds of entry. One carrying `message` is a finding the error panel
 * shows. One carrying `resource` and `value` and NO message is a deferred existence lookup the
 * builder posts to the server — "does this pipeline / email template / custom field still exist?".
 * Conflating them produced 178 phantom problems on a 51-workflow account. Split on `message`.
 */
/**
 * 🔴 TRAP 3: a validator can read a field the STORED document keeps somewhere else.
 *
 * `waitValidator` checks `attributes.name` for length. In a stored workflow document the display
 * name lives on the STEP ROW as `name`, and `attributes.name` is absent — so replaying the
 * validator against the document as-is short-circuits and that rule never fires. It is not dead in
 * the product: the builder loads a wait through `models/conditions/Wait.ts`, whose constructor
 * reads `attributes.name || name` and whose serialiser writes `this.attributes.name = this.name`
 * back. By the time the validator runs on the canvas, the row name IS in attributes.
 *
 * So the harness has to reproduce that merge or it under-tests. `wait` is the ONLY type that does
 * it with the row name: the other models that touch `attributes.name`
 * (`InteractiveMessenger`, the custom-object actions) set a DERIVED label instead, so copying the
 * row name onto them would feed the validators something the builder never sees.
 */
function canvasAttributes(step) {
  if (step?.type !== 'wait') return {};
  const attrs = step.attributes ?? {};
  if (attrs.name != null || step.name == null) return {};
  return { attributes: { ...attrs, name: step.name } };
}

export function runBuilderValidators(templates, bag, vname) {
  const findings = []; const lookups = []; const unchecked = {}; const crashed = [];
  let validated = 0;
  for (const s of (templates ?? [])) {
    const vn = vname?.[s.type];
    if (!vn) { (unchecked[s.type] ??= []).push(s.name ?? s.id ?? null); continue; }
    validated += 1;
    const arg = { ...s, templates, parentNode: { next: s.next }, ...canvasAttributes(s) };
    let out;
    try { out = bag[vn](arg); }
    catch (e) { crashed.push({ step: s.name ?? s.id ?? null, type: s.type, validator: vn, error: String(e?.message ?? e).slice(0, 160) }); continue; }
    for (const r of (out ?? [])) {
      const row = { step: s.name ?? s.id ?? null, type: s.type, ...r };
      (r?.message ? findings : lookups).push(row);
    }
  }
  return { validated, findings, lookups, unchecked, crashed };
}

export { validatorSource };
