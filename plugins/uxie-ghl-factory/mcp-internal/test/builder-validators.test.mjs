import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileValidators, runBuilderValidators, validatorNamesFor, HELPER_FIDELITY } from '../core/builder-validators.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = JSON.parse(readFileSync(resolve(HERE, '../catalog/builder-validators.json'), 'utf8'));
const CARDS = JSON.parse(readFileSync(resolve(HERE, '../../skills/create-ghl-workflow/catalog/type-cards.json'), 'utf8')).cards;

test('every recovered validator compiles into ONE shared scope', () => {
  // They call each other — waitValidator dispatches to validateTimeWait and validateAppointmentWait,
  // which are themselves keys in the same file. Compiled separately, the dispatching ones throw
  // ReferenceError at call time and the workflow reads as unvalidated for no visible reason.
  const bag = compileValidators(SOURCE);
  assert.ok(bag && !bag.error, `compile failed: ${bag?.error}`);
  assert.equal(Object.keys(bag).length, 67);
  assert.equal(typeof bag.waitValidator, 'function');
  assert.equal(typeof bag.validateTimeWait, 'function', 'the dispatch target must share the scope');
});

test('a body that binds a name other than its key is REFUSED, and the whole set with it', () => {
  // The source is a build-time artefact and must never come off the wire, but "must never" is a
  // comment. This is the check: an entry has to bind the identifier it is filed under.
  const bad = compileValidators({ ...SOURCE, evil: 'somethingElse=()=>[]' });
  assert.ok(bad?.error, 'a mismatched binding must be refused');
  assert.match(bad.error, /does not bind the identifier it is filed under/);
});

test('a key that is not a bare identifier is refused', () => {
  const bad = compileValidators({ 'a},{x:1' : 'x=()=>[]' });
  assert.ok(bad?.error);
  assert.match(bad.error, /not a bare identifier/);
});

test('both real body forms are accepted — assignment and function declaration', () => {
  // 59 of the capture are `name=…`; 8 are `function name(…)`. An earlier version of the shape check
  // accepted only the first and refused the real file outright.
  const assignment = Object.entries(SOURCE).filter(([k, v]) => v.trim().startsWith(`${k}=`)).length;
  const declaration = Object.entries(SOURCE).filter(([k, v]) => v.trim().startsWith(`function ${k}`)).length;
  assert.ok(assignment > 0 && declaration > 0, 'the capture uses both forms');
  assert.equal(assignment + declaration, Object.keys(SOURCE).length);
  assert.ok(!compileValidators(SOURCE)?.error);
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// The two traps. Both cost the operator who wrote the original script an hour each.
// ─────────────────────────────────────────────────────────────────────────────────────────

test('TRAP 1: parentNode.next is the FOLLOWING SIBLING, not a child list', () => {
  // gotoValidator's "must be at end of branch" check reads parentNode.next. In the stored document
  // `next` is a single id pointing at the next sibling, so parentNode is the canvas wrapper of the
  // step itself. Passing a real parent flagged all 43 gotos on one live account; passing
  // {next: step.next} gave zero. This asserts the shape the runner builds, which is the fix.
  const bag = compileValidators(SOURCE);
  const seen = [];
  const spy = { gotoValidator: (arg) => { seen.push(arg); return []; } };
  const templates = [
    { id: 's1', type: 'goto', name: 'Jump', next: null },
    { id: 's2', type: 'goto', name: 'Jump mid-branch', next: 's3' },
  ];
  runBuilderValidators(templates, spy, { goto: 'gotoValidator' });
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0].parentNode, { next: null }, 'a goto at the end of a branch has next: null');
  assert.deepEqual(seen[1].parentNode, { next: 's3' }, 'parentNode.next mirrors the STEP\'s own next');
  assert.equal(seen[0].templates.length, 2, 'the validators want the neighbourhood, not the step');
  assert.ok(bag.gotoValidator, 'and the real one exists to receive it');
});

test('TRAP 2: entries with `resource` and no `message` are lookups, not findings', () => {
  // sendEmailActionValidator emits one per linked template, createOpportunityActionValidator emits
  // pipeline plus pipeline_stage, updateContactFieldValidator one per custom field. On one
  // 51-workflow account that is 178 entries and every one is normal. Counting them as problems is
  // the first mistake anyone makes with these.
  const spy = {
    v: () => [
      { message: 'this one is a real finding', field: 'body' },
      { resource: 'pipeline', value: 'PIPE1' },
      { resource: 'email_template', value: 'TPL1' },
    ],
  };
  const r = runBuilderValidators([{ id: 'a', type: 'x', name: 'Step' }], spy, { x: 'v' });
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].message, 'this one is a real finding');
  assert.equal(r.lookups.length, 2);
  assert.deepEqual(r.lookups.map((l) => l.resource), ['pipeline', 'email_template']);
});

test('a step type with no validator is UNCHECKED, never counted as clean', () => {
  // The whole reason the port exists. if_else and task-notification have no GHL validator, so a
  // zero finding count over a workflow full of them means nothing.
  const spy = { v: () => [] };
  const r = runBuilderValidators([
    { id: 'a', type: 'x', name: 'Checked' },
    { id: 'b', type: 'if_else', name: 'Branch' },
    { id: 'c', type: 'if_else', name: 'Branch 2' },
    { id: 'd', type: 'task-notification', name: 'Task' },
  ], spy, { x: 'v' });
  assert.equal(r.validated, 1);
  assert.equal(r.findings.length, 0);
  assert.deepEqual(Object.keys(r.unchecked).sort(), ['if_else', 'task-notification']);
  assert.equal(r.unchecked.if_else.length, 2);
});

test('a validator that throws is recorded as crashed, not silently skipped', () => {
  const spy = { v: () => { throw new Error('helper missing'); } };
  const r = runBuilderValidators([{ id: 'a', type: 'x', name: 'S' }], spy, { x: 'v' });
  assert.equal(r.findings.length, 0);
  assert.equal(r.crashed.length, 1);
  assert.match(r.crashed[0].error, /helper missing/);
});

test('the type-to-validator map covers 61 types, and the shortfall is named not hidden', () => {
  // 136 cards carry a Validator meta line and 118 name one, but only 61 have a body in the
  // capture. The other 57 are mostly TRIGGER validators, which this capture does not include.
  // Reporting "136 mapped" would overstate coverage by more than double.
  const bag = compileValidators(SOURCE);
  const vname = validatorNamesFor(CARDS, bag);
  assert.equal(Object.keys(vname).length, 61,
    'if this moves, the capture or the cards changed — read which, do not re-baseline');
  const named = CARDS.filter((c) => {
    const line = c.meta?.Validator;
    return line && !/^none\b|null/i.test(String(line).trim()) && /`([A-Za-z0-9_]+)`/.test(String(line));
  }).length;
  assert.ok(named > Object.keys(vname).length,
    'more types name a validator than have a captured body; that gap is the honest coverage number');
});

test('the helper-fidelity caveat travels with the result', () => {
  // The helpers are reimplemented, not recovered. isValidHandleBar only counts brace pairs. A
  // finding that turns on one of them is a hint, and the result has to say so.
  assert.match(HELPER_FIDELITY, /reimplemented, not recovered/);
  assert.match(HELPER_FIDELITY, /isValidHandleBar only counts brace pairs/);
});

test('the parse of the card\'s Validator line takes the first backticked identifier', () => {
  const bag = { fooValidator: () => [], barValidator: () => [] };
  const vname = validatorNamesFor([
    { type: 'a', meta: { Validator: '`fooValidator` (per `sniffs/bundle/validators-summary.json`)' } },
    { type: 'b', meta: { Validator: '`barValidator` (shared with `something_else`)' } },
    { type: 'c', meta: { Validator: 'none' } },
    { type: 'd', meta: { Validator: 'null' } },
    { type: 'e', meta: { Validator: '`notInTheBag`' } },
    { type: 'f' },
  ], bag);
  assert.deepEqual(vname, { a: 'fooValidator', b: 'barValidator' },
    'none/null are skipped, a name with no body is skipped, and the SUMMARY path in the prose is not mistaken for the name');
});
