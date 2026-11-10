// bl-1021 (w9-wf2, orchestrator 2026-11-10): every publish probe ends with its own read-back. The unpublish is accepted, and a
// SEPARATE GET (get_workflow) reads the workflow back as a draft. A probe that leaves a workflow published fails here, not later.
export async function unpublishAndAssertDraft(call, check, workflowId, label = 'probe') {
  const un = await call('unpublish_workflows', { workflowIds: [workflowId], confirm: true });
  check(un.ok === true, `${label}: unpublish_workflows takes it back down`, un.detail);
  const after = await call('get_workflow', { workflowId });
  const status = after.data?.status ?? null;
  check(status === 'draft', `${label}: a separate GET reads it as a draft after the unpublish`, `status=${status}`);
  return un;
}
