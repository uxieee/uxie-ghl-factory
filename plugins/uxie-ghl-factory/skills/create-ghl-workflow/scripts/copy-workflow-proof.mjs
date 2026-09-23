// LIVE: copy_workflow_to_location (GHL's Copy to Sub-Account) and get_premium_usage (2026-09-23).
// The copy is proven with the SANDBOX AS ITS OWN TARGET, the only account live-fire may write to: a
// cross-account copy lands in whatever account subLocationId names, so it is never pointed anywhere
// else. Controls first: an UNBOUND registration and a target outside the bound set are both refused
// before anything is sent. Then a bound copy of a TEST-CONF draft must APPEAR in the target as a NEW
// id (GHL only queues it) with the source's step count. Everything created is a draft with no trigger.
export async function runCopyWorkflowProof({ tool, deps, LOCATION, NAME, check, left, log = null }) {
  const subject = (s) => log?.subject?.(s);
  const bound = { ...deps, state: { ...deps.state, allowedLocations: new Set([LOCATION]) } };
  const run = (n, a, d = deps) => tool(n).handler({ locationId: LOCATION, ...a }, d);

  subject('build_workflow');
  const srcName = NAME('copy-source');
  const b = await run('build_workflow', { spec: { name: srcName, triggers: [], graph: [
    { ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag one', attributes: { tags: ['test-conf-copy'] } },
    { ref: 'b', kind: 'action', type: 'remove_contact_tag', name: 'Untag', attributes: { tags: ['test-conf-copy'] } }] } });
  const wid = b.data?.wid;
  check(b.ok === true && typeof wid === 'string', 'the source draft is built (two steps, no trigger)', `${b.code ?? ''} ${String(b.detail ?? '').slice(0, 200)}`);
  if (!wid) return;
  left.push(`workflow ${wid} (${srcName}, draft, no trigger)`);

  subject('copy_workflow_to_location');
  const unbound = await run('copy_workflow_to_location', { workflowId: wid, targetLocationId: LOCATION, confirm: true });
  check(unbound.code === 'LOCATION_FORBIDDEN', 'CONTROL: an UNBOUND registration may not copy, even into its own account', `${unbound.code}`);
  const foreign = await run('copy_workflow_to_location', { workflowId: wid, targetLocationId: 'TESTCONFnotBound0001', confirm: true }, bound);
  check(foreign.code === 'LOCATION_FORBIDDEN', 'CONTROL: a target outside the bound set is refused before anything is sent', `${foreign.code}`);

  const pv = await run('copy_workflow_to_location', { workflowId: wid, targetLocationId: LOCATION }, bound);
  check(pv.code === 'CONFIRM_REQUIRED' && pv.data?.preview?.source?.steps === 2 && pv.data?.preview?.target?.existingWithThisName === 1
    && typeof pv.data?.preview?.target?.name === 'string',
    'PREVIEW: source (2 steps), the target\'s real name, and the one same-name workflow already there — nothing sent', JSON.stringify(pv.data?.preview ?? pv.code).slice(0, 300));

  const cp = await run('copy_workflow_to_location', { workflowId: wid, targetLocationId: LOCATION, confirm: true }, bound);
  const copyId = cp.data?.copied?.workflowId;
  check(cp.ok === true && typeof copyId === 'string' && copyId !== wid, 'the copy APPEARS in the target as a NEW workflow id (GHL only queued it)',
    `${cp.code ?? ''} ${String(cp.detail ?? '').slice(0, 200)} ${JSON.stringify(cp.data?.copied ?? null)}`);
  if (copyId) left.push(`workflow ${copyId} (${srcName}, a COPY made by copy_workflow_to_location)`);
  check(cp.data?.stepsMatch === true && cp.data?.copied?.name === srcName, 'READ-BACK: the copy carries the source\'s name and step count',
    JSON.stringify(cp.data?.copied ?? null));

  subject('get_premium_usage');
  const pu = await run('get_premium_usage', {});
  check(pu.ok === true && pu.data?.workflow_premium_actions?.read === true && pu.data?.workflow_ai?.read === true
    && 'usage' in (pu.data.workflow_premium_actions.usage ?? {}),
    'get_premium_usage reads both tiers and returns GHL\'s usage record', JSON.stringify(pu.data ?? pu.code).slice(0, 300));
  subject(false);
}
