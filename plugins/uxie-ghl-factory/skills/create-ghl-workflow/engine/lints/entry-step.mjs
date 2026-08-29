// THE RUNTIME ENTERS AT templates[0], NOT at the parentKey-less step.
//
// Proven live 2026-08-29 by runtime logs (F5-34): a workflow whose root `remove_from_workflow`
// was wired correctly by parentKey/next but APPENDED to the end of workflowData.templates never
// executed that step. The run's log goes straight to the old root at array index 0. The builder
// renders the graph from parentKey/next, so the canvas looked right and the drawer looked right;
// the runtime does not read the graph that way.
//
// Two failure shapes, both silent:
//   ENTRY_NOT_FIRST     the unique parentKey-less step is not templates[0] — everything before it
//                       in the array runs, and the intended entry may never run at all
//   ENTRY_AMBIGUOUS     more than one step has no parentKey, so which one is "the root" is a guess
//
// Branch entries are exempt: a step inside a container carries `parent`, and a transition node is
// scoped by its container rather than by parentKey.
const isRootish = (t) => t
  && (t.parentKey === null || t.parentKey === undefined)
  && (t.parent === null || t.parent === undefined);

export function lintEntryStep(templates) {
  const list = Array.isArray(templates) ? templates.filter(Boolean) : [];
  if (!list.length) return [];
  const roots = list.filter(isRootish);
  if (!roots.length) {
    return [{
      code: 'ENTRY_MISSING', severity: 'error', stepId: null, name: null,
      msg: 'no step has a null/absent parentKey, so the workflow has no entry step at all — the runtime '
        + 'still starts at templates[0], but nothing in the document says that is intentional.',
    }];
  }
  const out = [];
  if (roots.length > 1) {
    out.push({
      code: 'ENTRY_AMBIGUOUS', severity: 'error', stepId: roots[0].id, name: roots[0].name ?? roots[0].id,
      msg: `${roots.length} steps have no parentKey (${roots.map((r) => `'${r.name ?? r.id}'`).join(', ')}) — `
        + 'the builder picks one to draw and the runtime starts at templates[0]; they need not be the same step.',
    });
  }
  const first = list[0];
  const entry = roots[0];
  if (!isRootish(first)) {
    out.push({
      code: 'ENTRY_NOT_FIRST', severity: 'error', stepId: entry.id, name: entry.name ?? entry.id,
      msg: `the entry step '${entry.name ?? entry.id}' is at array index ${list.indexOf(entry)}, but the runtime `
        + `enters at templates[0], which is '${first.name ?? first.id}' (${first.type}). Everything before the `
        + 'entry in the array is skipped — proven live 2026-08-29. Move the entry step to index 0.',
    });
  }
  return out;
}
