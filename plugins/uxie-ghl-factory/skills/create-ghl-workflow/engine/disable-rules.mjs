// Which steps may carry GHL's per-action switch-off (`advanceCanvasMeta.isDisabled: true`).
//
// A disabled ACTION is skipped at runtime: the log row reads status "skipped", skippedFor
// {type:"advance-canvas-node-disabled"} (proven-live 2026-09-25 on sms and add_contact_tag).
// A disabled WAIT is not: GHL stores the flag, validates and publishes clean, and the wait still
// holds the contact for its full time (proven-live 2026-09-25). The builder never writes the flag
// on a wait, goto, drip, goal, condition root or multi-path container
// (use-workflow-tree-selection.ts:29-37, use-disable-action-listener.ts:19), so an API write that
// does produces a state no one designed and, for the wait, one that silently does nothing.
// Corpus: workflows/40-rules/disabled-steps.md.
const BUILDER_REFUSES = new Set(['wait', 'goto', 'drip', 'workflow_goal']);

/** Why this template may not be switched off, or null when it may. */
export function disableRefusal(t) {
  if (t?.type === 'wait')
    return `'${t.name ?? t.id}' is a wait: GHL ignores the switch-off on a wait and it still holds the contact for its full time. Delete the wait instead`;
  if (BUILDER_REFUSES.has(t?.type))
    return `'${t.name ?? t.id}' is a ${t.type}: GHL's builder cannot switch it off, and what the flag does to it at runtime is unproven. Delete it instead`;
  if (Array.isArray(t?.next))
    return `'${t.name ?? t.id}' is a branching step (${t.type}): GHL's builder cannot switch off a condition or multi-path container. Switch off the actions inside it instead`;
  return null;
}
