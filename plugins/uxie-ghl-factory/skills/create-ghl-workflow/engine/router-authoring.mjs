// w6c-1 (bl-784): the offline refusals for an AUTHORED Router, in GHL's own order (router-rules.ts:223-230 for the branch
// rules, router.ts:249,414 for nesting, Router.ts:75 for the steps a branch may not hold). Each refusal carries our code and
// names GHL's rule so the caller can tell which rule fired. Evidence: console/.superpowers/sdd/release-2026-11-06/router-loop.md §3.
import { IRError } from './ir.mjs';
import { incompleteBranchViolation, duplicatePairViolation } from './router-branches.mjs';

export const MAX_ROUTER_BRANCHES = 10;   // GHL: tooManyBranches above 10
export const MAX_ROUTER_NESTING = 10;    // GHL: "Cannot nest more than 10 routers" (MAX_ROUTER_NESTING)
const NOT_IN_BRANCH = new Set(['workflow_goal', 'goto']); // GHL: stepNotAllowedInBranch

// The IR branch carries `conditions` (+ optional `op`) like an if_else branch, or `segments` as GHL stores them.
// The id is kept distinct per branch (its own id, else its ref, else its position): the duplicate check treats two branches
// with the same id as one, so an id-less shape would hide a real duplicate.
function branchShape(b, i) {
  const segments = Array.isArray(b.segments) ? b.segments
    : (Array.isArray(b.conditions) && b.conditions.length ? [{ operator: b.op ?? 'and', conditions: b.conditions }] : []);
  return { id: b.id ?? b.ref ?? `#${i}`, name: b.name, branchType: b.branchType ?? 'custom', segments };
}

// Children of a branch: the IR key is `then`, as on if_else and split.
const childrenOf = (b) => b.then ?? [];

// Every scope key of a node that holds a child sequence (not a router branch): a router inside any of them counts too.
const CHILD_SCOPES = ['onFound', 'onNotFound', 'onEvent', 'onTimeout', 'onBooked', 'onNotBooked', 'default'];

function refuse(code, message) { throw new IRError(code, message); }

function checkBranches(n) {
  const bs = n.branches ?? [];
  const where = `router '${n.ref ?? n.name ?? 'router'}'`;
  if (bs.length > MAX_ROUTER_BRANCHES)
    refuse('ROUTER_BRANCH_LIMIT', `${where} has ${bs.length} branches: tooManyBranches (GHL allows at most ${MAX_ROUTER_BRANCHES}).`);
  const fallbacks = bs.filter((b) => b.branchType === 'fallback').length;
  if (fallbacks > 1) refuse('ROUTER_FALLBACK_LIMIT', `${where} has ${fallbacks} fallback branches: fallbackExists (GHL allows one).`);
  if (fallbacks === 1 && bs.some((b) => b.branchType === 'always_run'))
    refuse('ROUTER_ALWAYS_RUN_FALLBACK', `${where} has an always-run branch and a fallback: alwaysRunFallbackConflict (GHL does not allow both).`);
  const shapes = bs.map((b, i) => branchShape(b, i));
  const incomplete = incompleteBranchViolation(shapes);
  if (incomplete) refuse('ROUTER_BRANCH_INCOMPLETE', `${where}: branchError (GHL): ${incomplete}`);
  const dup = duplicatePairViolation(shapes);
  if (dup) refuse('ROUTER_DUPLICATE_BRANCH', `${where}: duplicateBranchError (GHL): ${dup}`);
}

/** Walk the authored graph; `routerDepth` counts the routers around a node, `inBranch` says it sits inside a router branch. */
function walk(nodes, routerDepth, inBranch) {
  for (const n of nodes ?? []) {
    if (inBranch && (n.kind === 'goto' || NOT_IN_BRANCH.has(n.type)))
      refuse('ROUTER_STEP_NOT_ALLOWED', `'${n.ref ?? n.name ?? n.type}' cannot sit inside a router branch: stepNotAllowedInBranch (GHL disallows ${[...NOT_IN_BRANCH].join(', ')} there).`);
    if (n.kind === 'router') {
      const depth = routerDepth + 1;
      if (depth > MAX_ROUTER_NESTING)
        refuse('ROUTER_NESTING_LIMIT', `router '${n.ref ?? n.name ?? 'router'}' is nested ${depth} deep: nestingLimit — Cannot nest more than ${MAX_ROUTER_NESTING} routers.`);
      checkBranches(n);
      for (const b of n.branches ?? []) walk(childrenOf(b), depth, true);
      continue;
    }
    for (const b of n.branches ?? []) walk(childrenOf(b), routerDepth, inBranch);
    for (const p of n.paths ?? []) walk(p.then, routerDepth, inBranch);
    for (const k of CHILD_SCOPES) walk(n[k], routerDepth, inBranch);
  }
}

/** Refuse, offline and with GHL's rule named, any authored router GHL would refuse on save. */
export function checkRouters(graph) { walk(graph, 0, false); }
