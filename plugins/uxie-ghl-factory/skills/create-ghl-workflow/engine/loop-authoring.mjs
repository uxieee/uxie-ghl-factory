// w6c-2 (bl-785): GHL's offline refusals for an authored Loop, checked before any emit.
//
// A loop is one step (type loop) whose `next` is its first body step, or its continuation when the body is empty. The body
// steps carry parentContainerId = the loop; the last body step's next = attributes.exitNext, the continuation. The IR key for
// the body is `body`. The refusals below name GHL's own validator keys (console/.superpowers/sdd/release-2026-11-06/router-loop.md,
// section 3), so an author can match the message to the builder's text.
//
// Every check here is about the IR, not the stored document, so it runs before parseIR: a loop that the builder would
// refuse never reaches the emitter. The edit path keeps its own rules in graph-rules.mjs (checkLoopHasBody and the items rules).
import { IRError, walkNodes } from './ir.mjs';

export const LOOP_RANGE_MAX_COUNT = 500;   // LOOP_SYSTEM_MAX_ITERATIONS (Loop.ts:30-38): end - start + 1 may not exceed it
const SINGLE_EXPRESSION = /^\{\{\s*[^{}]+\s*\}\}$/;
const WHOLE_NUMBER = /^-?\d+$/;

// The actions and waits GHL refuses inside a loop body (the catalogue vocab: workflowRules.vocab.actionsUnsupportedInsideLoop and
// waitTypesUnsupportedInsideLoop). Listed here as well so the refusal does not depend on the catalogue being loaded.
const BANNED_ACTIONS = ['loop', 'workflow_goal', 'goto', 'remove_from_workflow', 'remove_from_all_workflows'];
const BANNED_WAITS = ['appointment', 'service_booking', 'rental_booking', 'overdue', 'reply', 'user_replied', 'link_clicked', 'email_event', 'condition'];

const isLoop = (n) => n?.kind === 'loop' || (n?.kind === undefined && n?.type === 'loop');
const nameOf = (n) => n?.name ?? n?.ref ?? n?.type ?? n?.kind ?? 'step';
// The wire type a body step will carry, read from the authored node (a goto is authored by kind).
const typeOf = (n) => n.type ?? (n.kind === 'goto' ? 'goto' : n.kind === 'loop' ? 'loop' : undefined);

function checkItems(loop) {
  const items = String(loop.items ?? '').trim();
  if (!items) throw new IRError('LOOP_ITEMS', `loop_items_required: loop '${nameOf(loop)}' has no items expression — choose the list to loop over.`);
  if (!SINGLE_EXPRESSION.test(items)) {
    throw new IRError('LOOP_ITEMS', `loop_items_single_expression: loop '${nameOf(loop)}' items must be ONE {{expression}} that resolves to a list — `
      + `'${items.slice(0, 60)}' concatenates, which compiles to a string and iterates ZERO times (silently).`);
  }
}

function checkRange(loop) {
  const bounds = { start: loop.startNumber ?? '1', end: loop.endNumber ?? '10' };
  for (const [label, raw] of [['startNumber', bounds.start], ['endNumber', bounds.end]]) {
    const v = String(raw).trim();
    if (!v) throw new IRError('LOOP_RANGE', `loop_range_bound_required: loop '${nameOf(loop)}' has an empty ${label}.`);
    if (SINGLE_EXPRESSION.test(v)) continue;   // an expression bound is truncated at run time, not refused at save
    if (!WHOLE_NUMBER.test(v)) throw new IRError('LOOP_RANGE', `loop_range_bound_invalid: loop '${nameOf(loop)}' ${label} '${v}' is not a whole number or a single expression.`);
    if (v.startsWith('-')) throw new IRError('LOOP_RANGE', `loop_range_bound_negative: loop '${nameOf(loop)}' ${label} '${v}' is negative.`);
  }
  const s = String(bounds.start).trim(), e = String(bounds.end).trim();
  if (WHOLE_NUMBER.test(s) && WHOLE_NUMBER.test(e)) {
    const start = Number(s), end = Number(e);
    if (end < start) throw new IRError('LOOP_RANGE', `loop_range_end_before_start: loop '${nameOf(loop)}' endNumber (${end}) is below its startNumber (${start}).`);
    const count = end - start + 1;
    if (count > LOOP_RANGE_MAX_COUNT) {
      throw new IRError('LOOP_RANGE_TOO_LARGE', `LOOP_RANGE_TOO_LARGE (loop_range_too_large): loop '${nameOf(loop)}' runs ${count} numbers (${start} to ${end}). `
        + `Use ${LOOP_RANGE_MAX_COUNT} numbers or fewer.`);
    }
  }
}

function checkBody(loop) {
  const body = loop.body ?? [];
  // Direct body steps are chained by list order. A step that carries an authored `next` points outside the body chain, so
  // it would be disconnected from loop.next (the body's entry).
  for (const b of body) {
    if (b.next !== undefined && b.next !== null) {
      throw new IRError('LOOP_BODY', `loop_disconnected_step_error: '${nameOf(b)}' inside loop '${nameOf(loop)}' carries an authored next. `
        + 'A loop body is a chain linked in list order, entered at the loop and leaving at its continuation; a body step cannot point elsewhere.');
    }
  }
  walkNodes(body, (b) => {
    const t = typeOf(b);
    if (b.kind === 'loop' || t === 'loop' || (t && BANNED_ACTIONS.includes(t))) {
      throw new IRError('LOOP_BODY', `loop_unsupported_action_error: '${nameOf(b)}' (${t ?? b.kind}) cannot sit inside a loop body (GHL refuses ${[...new Set([...BANNED_ACTIONS])].join(', ')} inside a loop).`);
    }
    if (b.kind === 'wait' && BANNED_WAITS.includes(b.waitType)) {
      throw new IRError('LOOP_BODY', `loop_unsupported_wait_error: wait '${nameOf(b)}' of type '${b.waitType}' cannot sit inside a loop body (time-based waits only).`);
    }
  });
  // {{loopCounter}} is the current number of a RANGE loop. A list loop has no counter.
  if ((loop.loopOver ?? 'list') !== 'range' && JSON.stringify(body).includes('{{loopCounter}}')) {
    throw new IRError('LOOP_BODY', `{{loopCounter}} is only set in a range loop; loop '${nameOf(loop)}' is a list loop and has no loopCounter.`);
  }
}

// Refuse what GHL's validator refuses for a loop, before any emit. Called on the raw IR graph, so a node's own keys are still as
// the author wrote them.
export function checkLoops(graph, ctx = {}) {
  walkNodes(graph ?? [], (n) => {
    if (!isLoop(n)) return;
    const over = n.loopOver ?? 'list';
    if (over !== 'list' && over !== 'range') throw new IRError('LOOP_BODY', `loop '${nameOf(n)}' loopOver '${over}' is not 'list' or 'range'.`);
    if (over === 'list') checkItems(n);
    else checkRange(n);
    checkBody(n);
  });
  return ctx;
}

// w6c-3 (ruling 2026-11-07): a Loop with no body steps is refused by build_workflow and edit_workflow, code `loop-body-empty`,
// with the Loop's path. The body of a STORED loop is its chain: a loop whose next is null or equals its exitNext has none. A
// stored workflow that already holds one passes with a warning (round trip, export and repair keep it as stored).
export function isEmptyLoopTemplate(t) {
  return t?.type === 'loop' && (!t.next || t.next === t.attributes?.exitNext);
}

// The path of a stored step, as the names of its containers from the workflow head: 'Router > Branch 1 > Loop'.
export function stepPathOf(templates, id) {
  const byId = new Map(templates.map((t) => [t.id, t]));
  const names = [];
  const seen = new Set();
  for (let cur = byId.get(id); cur && !seen.has(cur.id); cur = byId.get(cur.parentContainerId ?? cur.parent ?? '')) {
    seen.add(cur.id);
    names.unshift(cur.name ?? cur.type);
  }
  return names.join(' > ');
}

// Build side (build_workflow): refuse an authored Loop with an empty body, naming its path, whatever the spec's origin. A spec
// lifted from a stored workflow is refused too: the stored-empty pass-through is for edit and repair (edit.mjs editCommitBody,
// graph-rules checkLoopHasBody), not for a new build.
export function checkEmptyLoopBodies(graph) {
  const walk = (nodes, path) => {
    for (const n of nodes ?? []) {
      if (!n || typeof n !== 'object') continue;
      const here = [...path, n.name ?? n.ref ?? n.type ?? n.kind];
      if (isLoop(n) && (n.body ?? []).length === 0) {
        const label = here.join(' > ');
        const e = new IRError('loop-body-empty', `loop-body-empty: the Loop '${label}' has no actions inside it (GHL's validator refuses this on save). Add a step to its body or drop the loop.`);
        e.path = label;
        throw e;
      }
      for (const b of n.branches ?? []) walk(b.then, [...here, b.name ?? b.ref ?? 'branch']);
      for (const p of n.paths ?? []) walk(p.then, [...here, p.name ?? 'path']);
      for (const k of ['onEvent', 'onTimeout', 'onFound', 'onNotFound', 'onBooked', 'onNotBooked', 'default', 'body']) walk(n[k], here);
    }
  };
  walk(graph, []);
}
