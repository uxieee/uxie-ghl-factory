// w6d-1 (plan Task 1): compare an engine-built step with a UI-built control, on the stored document and on the rendered drawer.
// Pure: no network, no browser. The live leg (ui/render-check.mjs) produces the two drawer maps and the two stored documents.
//
// What is volatile (not a difference): the step's own id, position, order and timestamps, and the internal version fields.
// What is a difference: the step's graph WIRING, compared by shape. Engine and UI drafts never share ids, so a pointer (next,
// parentKey, parent, parentContainerId) compares by what it names, not by its raw value:
//   none        null, undefined or ''
//   list:N      an array of N pointers (a router root's lanes, for example)
//   successor   next points at a template (the chain goes on)
//   container   the pointer names a container (loop, router, A/B, split)
//   predecessor the pointer names the step whose next is this step (the chain's previous step)
//   step        the pointer names some other step
//   dangling    the pointer names no template in the document
//   ref         no document given: only null-vs-present and list length can be seen
// So a w6c-11b-style wrong continuation (parentKey on the loop instead of the last body step) compares as a difference.
// The W6b semantic path heads (lift.mjs SEMANTIC_PATH_HEADS) name the rest of what counts.
//
// The verdict ranks drawer above stored (Review Focus 1): a drawer that renders differently is a failure, even when the stored
// documents match. A drawer value that is missing, null or '' is one empty value (Review Focus 2).

export const VOLATILE_KEYS = new Set(['id', '_id', 'position', 'order', 'createdAt', 'updatedAt', '__v', 'workflowVersion', 'workflowStatusId']);
export const POINTER_KEYS = new Set(['next', 'parentKey', 'parent', 'parentContainerId']);
const CONTAINER_TYPES = new Set(['loop', 'router', 'workflow_ab_test', 'workflow_split', 'split', 'ab_test']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isEmpty = (v) => v === undefined || v === null || v === '';
const isContainer = (t) => !!t && (CONTAINER_TYPES.has(t.type) || Array.isArray(t.attributes?.branches) || Array.isArray(t.attributes?.paths));

// Deep diff of two stored values, skipping volatile keys. Returns [{path, engine, ui}].
export function storedDiff(a, b, path = '', out = []) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const aa = Array.isArray(a) ? a : [], bb = Array.isArray(b) ? b : [];
    if (!Array.isArray(a) || !Array.isArray(b)) { out.push({ path, engine: a, ui: b }); return out; }
    const n = Math.max(aa.length, bb.length);
    for (let i = 0; i < n; i++) storedDiff(aa[i], bb[i], `${path}[${i}]`, out);
    return out;
  }
  if (isObj(a) || isObj(b)) {
    if (!isObj(a) || !isObj(b)) { out.push({ path, engine: a, ui: b }); return out; }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of [...keys].sort()) {
      if (VOLATILE_KEYS.has(k)) continue;
      storedDiff(a[k], b[k], path ? `${path}.${k}` : k, out);
    }
    return out;
  }
  if (a !== b) out.push({ path, engine: a, ui: b });
  return out;
}

// What a pointer names, relative to the step that holds it. `templates` is the whole stored document on that side (or undefined).
export function pointerShape(key, value, step, templates) {
  if (isEmpty(value)) return 'none';
  if (Array.isArray(value)) return `list:${value.length}`;
  if (!templates) return 'ref';
  const target = templates.find((t) => t && t.id === value);
  if (!target) return 'dangling';
  if (key === 'next') return 'successor';
  if (isContainer(target)) return 'container';
  const isPredecessor = templates.some((t) => t && t.next === step?.id && t.id === target.id);
  return isPredecessor ? 'predecessor' : 'step';
}

// The step's own pointers, by shape. Only the top-level keys of a step are pointers; nested keys are compared as stored.
export function wiringDiff(engineStep = {}, uiStep = {}, engineTemplates, uiTemplates) {
  const out = [];
  for (const k of [...POINTER_KEYS].sort()) {
    const a = pointerShape(k, engineStep?.[k], engineStep, engineTemplates);
    const b = pointerShape(k, uiStep?.[k], uiStep, uiTemplates);
    if (a !== b) out.push({ path: k, engine: a, ui: b });
  }
  return out;
}

const withoutPointers = (s) => Object.fromEntries(Object.entries(s ?? {}).filter(([k]) => !POINTER_KEYS.has(k)));

// Drawer maps are label → rendered value. Missing, null and '' are one empty value; a value that is not empty must match exactly.
export function drawerDiff(engine = {}, ui = {}) {
  const out = [];
  for (const k of [...new Set([...Object.keys(engine), ...Object.keys(ui)])].sort()) {
    const a = engine[k], b = ui[k];
    if (isEmpty(a) && isEmpty(b)) continue;
    if (isEmpty(a) !== isEmpty(b) || a !== b) out.push({ key: k, engine: a ?? null, ui: b ?? null });
  }
  return out;
}

export function compareRender({ engineStep, uiStep, engineTemplates, uiTemplates, engineDrawer = {}, uiDrawer = {} } = {}) {
  const sd = [
    ...storedDiff(withoutPointers(engineStep), withoutPointers(uiStep)),
    ...wiringDiff(engineStep, uiStep, engineTemplates, uiTemplates),
  ];
  const dd = drawerDiff(engineDrawer, uiDrawer);
  const verdict = dd.length ? 'drawer-differs' : sd.length ? 'stored-only' : 'same';
  return { storedDiff: sd, drawerDiff: dd, verdict };
}
