// LIVE: edit_workflow deleteBranch removes one if/else branch from a PUBLISHED workflow, and the
// runtime routing changes with it. Proven by DIFFERENTIAL on two identical contacts:
//   A (tagged hot) is enrolled BEFORE the delete and must take the Hot branch — the control that
//     proves the condition matches at all, so B's result cannot be a condition that never fired;
//   B (the same tags) is enrolled AFTER and must fall to None, and must NOT get the Hot tag.
// Fences: no trigger, steps only tag, contacts created here with no email and no phone. A has left
// the workflow (its last step is a tag) before the delete, so nobody is ejected. Unpublished at the
// end. Nothing is deleted from the account.
export async function runDeleteBranchProof({ call, gw, LOCATION, NAME, STAMP, check, left, log = null }) {
  const subject = (s) => log?.subject?.(s);
  const HOT = `test-conf-${STAMP}-db-is-hot`;
  const T_HOT = `test-conf-${STAMP}-db-took-hot`, T_WARM = `test-conf-${STAMP}-db-took-warm`, T_NONE = `test-conf-${STAMP}-db-took-none`;
  const tagStep = (ref, name, tag) => ({ ref, kind: 'action', type: 'add_contact_tag', name, attributes: { tags: [tag] } });

  subject('build_workflow');
  const b = await call('build_workflow', { spec: { name: NAME('delete-branch'), triggers: [], graph: [
    { ref: 'c', kind: 'if_else', name: 'Segment', branches: [
      { ref: 'bh', name: 'Hot', conditions: [{ conditionType: 'contact_detail', tag: HOT }], then: [tagStep('th', 'Took hot', T_HOT)] },
      { ref: 'bw', name: 'Warm', conditions: [{ conditionType: 'contact_detail', tag: `test-conf-${STAMP}-db-is-warm` }], then: [tagStep('tw', 'Took warm', T_WARM)] },
      { ref: 'bn', name: 'None', else: true, then: [tagStep('tn', 'Took none', T_NONE)] }] }] } });
  const wid = b.data?.wid;
  check(b.ok === true && typeof wid === 'string', 'build_workflow creates the trigger-less three-branch if/else probe', `${b.code ?? ''} ${String(b.detail ?? '').slice(0, 200)}`);
  if (!wid) return;
  left.push(`workflow ${wid} (${NAME('delete-branch')}, was PUBLISHED for the run and unpublished after)`);

  subject('publish_workflow');
  const pub = await call('publish_workflow', { workflowId: wid, confirm: true });
  check(pub.ok === true && pub.data?.verify?.status === 'published' && pub.data?.verify?.totalTriggers === 0,
    'the probe is PUBLISHED with zero triggers', `${pub.code ?? ''} ${String(pub.detail ?? '').slice(0, 200)}`);
  if (!pub.ok) return;

  subject(false);
  const mk = async (n) => { const r = await gw.call('POST', '/contacts/', { locationId: LOCATION, firstName: 'TEST-CONF', lastName: `${STAMP}-db-${n} (no email, no phone)`, tags: ['test-conf', HOT] }); return r.json?.contact ?? r.json; };
  const A = await mk('a'), B = await mk('b');
  check([A, B].every((c) => c?.id && !c.email && !c.phone), 'FENCE: two contacts created by this run, both tagged hot, no email, no phone', JSON.stringify([A, B].map((c) => [Boolean(c?.id), c?.email ?? null, c?.phone ?? null])));
  if (!A?.id || !B?.id) return;
  for (const c of [A, B]) left.push(`contact ${c.id} (TEST-CONF ${STAMP} delete-branch, no email, no phone)`);
  const tagsOf = async (id) => { const r = await gw.call('GET', `/contacts/${id}`); return (r.json?.contact ?? r.json)?.tags ?? []; };
  const until = async (fn, { tries = 12, ms = 5000 } = {}) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, ms)); } return null; };
  const landed = async (id) => until(async () => { const t = await tagsOf(id); return [T_HOT, T_WARM, T_NONE].some((x) => t.includes(x)) ? t : null; });

  // CONTROL: before the delete, a hot contact takes Hot.
  await gw.call('POST', `/contacts/${A.id}/workflow/${wid}`, { eventStartTime: '' });
  const ta = await landed(A.id) ?? [];
  check(ta.includes(T_HOT) && !ta.includes(T_NONE), 'CONTROL: before the delete, the hot contact takes the Hot branch — the condition does match', JSON.stringify(ta));

  const doc = (await call('export_workflow', { workflowId: wid })).data?.workflow?.workflowData?.templates ?? [];
  const cond = doc.find((t) => t.nodeType === 'condition-node');

  subject('edit_workflow');
  const pv = await call('edit_workflow', { workflowId: wid, ops: [{ op: 'deleteBranch', containerId: cond?.id, branch: 'Hot' }] });
  const pvs = JSON.stringify(pv.data ?? pv.detail ?? {});
  check(/Took hot|deletedSteps|removed/.test(pvs), 'the preview (no confirm) reports the branch and its step as removed', pvs.slice(0, 200));
  const ed = await call('edit_workflow', { workflowId: wid, confirm: true, ops: [{ op: 'deleteBranch', containerId: cond?.id, branch: 'Hot' }] });
  check(ed.ok === true, 'edit_workflow deleteBranch removes the Hot branch from a PUBLISHED workflow', `${ed.code ?? ''} ${String(ed.detail ?? '').slice(0, 300)}`);

  const after = (await call('export_workflow', { workflowId: wid })).data?.workflow ?? {};
  const tpls = after.workflowData?.templates ?? [];
  const c2 = tpls.find((t) => t.id === cond?.id);
  const names = tpls.map((t) => t.name);
  check(!names.includes('Hot') && !names.includes('Took hot') && names.includes('Warm') && names.includes('Took warm') && names.includes('Took none'),
    'READ-BACK: Hot and its step are gone; Warm, None and their steps are intact', JSON.stringify(names));
  check(Array.isArray(c2?.next) && c2.next.length === 2 && (c2.attributes?.branches ?? []).map((x) => x.name).join() === 'Warm',
    'READ-BACK: the condition node wires exactly Warm + None, and its branch list names only Warm', JSON.stringify({ next: c2?.next?.length, branches: (c2?.attributes?.branches ?? []).map((x) => x.name) }));
  check(after.status === 'published', 'the workflow is still PUBLISHED after the edit', after.status);

  // DIFFERENTIAL: the same contact shape now falls to None.
  subject(false);
  await gw.call('POST', `/contacts/${B.id}/workflow/${wid}`, { eventStartTime: '' });
  const tb = await landed(B.id) ?? [];
  check(tb.includes(T_NONE) && !tb.includes(T_HOT), 'DIFFERENTIAL: after the delete, an identical hot contact falls to None and never gets the Hot tag', JSON.stringify(tb));

  subject('unpublish_workflows');
  const un = await call('unpublish_workflows', { workflowIds: [wid], confirm: true });
  check(un.ok === true, 'the probe is unpublished again', `${un.code ?? ''} ${String(un.detail ?? '').slice(0, 160)}`);
  subject(false);
}
