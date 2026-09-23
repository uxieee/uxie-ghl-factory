// LIVE: rename_workflow renames through GHL's dedicated route and verifies by read-back; a folder id is
// refused before anything is sent; an AGENT workflow is measured (the proposal's open question).
// Every rename is restored and read back again. Nothing is deleted; only TEST-CONF workflows are touched.
export async function runRenameWorkflowProof({ call, NAME, check, left, log = null }) {
  const subject = (s) => log?.subject?.(s);
  subject('build_workflow');
  const b = await call('build_workflow', { spec: { name: NAME('rename'), triggers: [], graph: [
    { ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['test-conf-rename'] } }] } });
  const wid = b.data?.wid;
  check(b.ok === true && typeof wid === 'string', 'build_workflow creates the rename probe', `${b.code ?? ''} ${String(b.detail ?? '').slice(0, 160)}`);
  if (!wid) return;
  left.push(`workflow ${wid} (${NAME('rename')}, renamed and restored)`);
  const original = NAME('rename'), renamed = `${original} (renamed)`;

  subject('rename_workflow');
  const pv = await call('rename_workflow', { renames: [{ workflowId: wid, name: renamed }] });
  check(pv.code === 'CONFIRM_REQUIRED' && pv.data?.preview?.renames?.[0]?.nameBefore === original,
    'the preview names old -> new and sends nothing', JSON.stringify(pv.data?.preview?.renames?.[0] ?? pv.detail).slice(0, 200));
  const r1 = await call('rename_workflow', { renames: [{ workflowId: wid, name: renamed }], confirm: true });
  check(r1.ok === true && r1.data?.results?.[0]?.nameReadBack === renamed, 'confirmed: the name READS BACK changed', JSON.stringify(r1.data?.results?.[0] ?? r1.detail).slice(0, 240));
  const ex = await call('export_workflow', { workflowId: wid });
  check(ex.data?.workflow?.name === renamed, 'and a separate export agrees', ex.data?.workflow?.name);
  const r2 = await call('rename_workflow', { renames: [{ workflowId: wid, name: original }], confirm: true });
  check(r2.ok === true && r2.data?.results?.[0]?.nameReadBack === original, 'restored, and the restore reads back', JSON.stringify(r2.data?.results?.[0] ?? r2.detail).slice(0, 200));
  console.log(`  NOTE  version across a rename: ${r1.data?.results?.[0]?.versionBefore} -> ${r1.data?.results?.[0]?.versionAfter} (the proposal's unsettled question, recorded not asserted)`);

  // CONTROL: a folder id is refused BEFORE anything is sent.
  subject('list_workflow_folders');
  const fol = await call('list_workflow_folders', {});
  const folderId = (fol.data?.folders ?? [])[0]?.id;
  if (folderId) {
    subject('rename_workflow');
    const rf = await call('rename_workflow', { renames: [{ workflowId: folderId, name: 'must not land' }], confirm: true });
    check(rf.ok === false && /FOLDERS, not workflows/.test(String(rf.detail)), 'CONTROL: a FOLDER id is refused by name before anything is sent', String(rf.detail).slice(0, 160));
  } else check(false, 'CONTROL could not run: no folder on the account', JSON.stringify(Object.keys(fol.data ?? {})));

  // MEASURE: does the route rename an AGENT workflow? Use a TEST-CONF agent probe this suite built earlier.
  subject('list_workflows');
  const lw = await call('list_workflows', {});
  const agent = (lw.data?.workflows ?? []).find((w) => w.workflowType === 'agent' && /^TEST-CONF-/.test(w.name ?? ''));
  if (agent) {
    subject('rename_workflow');
    const ra = await call('rename_workflow', { renames: [{ workflowId: agent.id ?? agent._id, name: `${agent.name} (renamed)` }], confirm: true });
    const landed = ra.data?.results?.[0]?.renamed === true;
    if (landed) await call('rename_workflow', { renames: [{ workflowId: agent.id ?? agent._id, name: agent.name }], confirm: true });
    console.log(`  NOTE  AGENT workflow rename: ${landed ? 'LANDS (read back), and was restored' : `does NOT land: ${ra.code} ${String(ra.detail).slice(0, 120)}`}`);
    check(ra.ok === landed, 'an agent workflow rename is reported truthfully either way (landed = ok)', `${ra.code} renamed=${landed}`);
  }
  subject(false);
}
