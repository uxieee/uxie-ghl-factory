// GHL's ROUTER graph, ported verbatim from the builder's own helpers.
//
// A router (`type: 'router'`, shipped 2026-09-11) fans a workflow into branches that ALL evaluate
// — it is not an if/else. Its branches live on `attributes.branches`; its lanes are routers
// stamped with a lane `nodeType`; and a step is "inside a branch" through parentKey/next ancestry,
// at any depth. validateRouterConditions needs every one of those answers, and an approximation
// would disagree with the builder on exactly the workflows a human built by hand.
//
// Ports: utils/router.ts (isRouterLane, isRouterRoot, collectRouterBranchOwners,
// resolveRouterParentId, routerAncestry, isInsideRouterBranch, getRouterNestingDepth,
// canNestRouterAt) and utils/workflow-action-navigation.ts (buildParentMap). The lane stamps and
// limits are VOCABULARY, read from the catalog (extracted from that same source), never retyped.
import { loadCatalog } from './catalog.mjs';

let cachedLanes = null;
const laneTypes = (over) => new Set(over
  ?? (cachedLanes ??= loadCatalog()?.workflowRules?.vocab?.router?.laneNodeTypes)
  // fallback cited: utils/router.ts `ROUTER_LANE_NODE_TYPES`. Only reached when the catalog
  // predates the router vocabulary.
  ?? ['branch-yes', 'branch-no']);

/** utils/router.ts: a lane holds no state of its own; its branch lives on the router. */
export function isRouterLane(node, opts) {
  return Boolean(node && node.type === 'router' && node.nodeType && laneTypes(opts?.laneNodeTypes).has(node.nodeType));
}

/** utils/router.ts: an UNSTAMPED router is still a root — only lanes are excluded. */
export function isRouterRoot(node, opts) {
  return Boolean(node && node.type === 'router' && !isRouterLane(node, opts));
}

/** utils/router.ts: branch id -> owning router id, read from attributes.branches. */
export function collectRouterBranchOwners(templates, opts) {
  const branchToRouter = new Map();
  for (const template of templates ?? []) {
    if (!isRouterRoot(template, opts)) continue;
    for (const branch of (template.attributes?.branches ?? [])) if (branch?.id) branchToRouter.set(branch.id, template.id);
  }
  return branchToRouter;
}

/** utils/workflow-action-navigation.ts: child id -> parent id, from `next` pointers. */
function buildParentMap(templates) {
  const parentMap = new Map();
  for (const template of templates ?? []) {
    const next = template?.next;
    if (typeof next === 'string' && next) parentMap.set(next, template.id);
    else if (Array.isArray(next)) for (const childId of next) if (childId) parentMap.set(childId, template.id);
  }
  return parentMap;
}

/** utils/router.ts: a branch id resolves to its router; parentKey naming a branch wins over `next`. */
function resolveRouterParentId(stepId, templateMap, parentMap, branchToRouter) {
  const branchOwner = branchToRouter.get(stepId);
  if (branchOwner) return branchOwner;
  const template = templateMap.get(stepId);
  const parentKey = (typeof template?.parentKey === 'string' && template.parentKey)
    || (typeof template?.parent === 'string' && template.parent) || '';
  if (parentKey && branchToRouter.has(parentKey)) return parentKey;
  const fromNextPointers = parentMap.get(stepId);
  if (fromNextPointers) return fromNextPointers;
  return parentKey;
}

/** utils/router.ts: walk up, insertion point first; stops on a repeat so a parentKey loop cannot hang. */
function* routerAncestry(startId, templates, branchToRouter) {
  const templateMap = new Map((templates ?? []).map((t) => [t.id, t]));
  const parentMap = buildParentMap(templates);
  const visited = new Set();
  let cursor = startId;
  let isInsertionPoint = true;
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    yield { id: cursor, template: templateMap.get(cursor), isInsertionPoint };
    cursor = resolveRouterParentId(cursor, templateMap, parentMap, branchToRouter);
    isInsertionPoint = false;
  }
}

/** utils/router.ts: would a step parented here land inside a router branch? Any depth counts. */
export function isInsideRouterBranch(parentId, templates, opts) {
  if (!parentId || !templates?.length) return false;
  const branchToRouter = collectRouterBranchOwners(templates, opts);
  for (const { id, template, isInsertionPoint } of routerAncestry(parentId, templates, branchToRouter)) {
    if (branchToRouter.has(id)) return true;
    if (isRouterLane(template, opts)) return true;
    if (isInsertionPoint && isRouterRoot(template, opts)) return true;
  }
  return false;
}

/** utils/router.ts: how many routers sit above this insertion point. */
export function getRouterNestingDepth(parentId, templates, opts) {
  if (!parentId || !templates?.length) return 0;
  const branchToRouter = collectRouterBranchOwners(templates, opts);
  let depth = 0;
  for (const { template, isInsertionPoint } of routerAncestry(parentId, templates, branchToRouter)) {
    if (!isInsertionPoint && isRouterRoot(template, opts)) depth += 1;
  }
  return depth;
}

/** utils/router.ts: may a router be nested here without exceeding the limit? */
export function canNestRouterAt(parentId, templates, maxNesting, opts) {
  return getRouterNestingDepth(parentId, templates, opts) + 1 <= maxNesting;
}

/** WorkflowValidator.getTemplateParentId */
export const templateParentId = (t) => (typeof t?.parent === 'string' && t.parent) || (typeof t?.parentKey === 'string' && t.parentKey) || '';
