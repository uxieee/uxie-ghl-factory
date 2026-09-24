// LIVE: the Documents & Contracts trigger's Template filter takes a template NAME and stores its id
// (2026-09-23). GHL's own Template dropdown is the oracle: its option values ARE the /proposals/templates
// ids (proven by differential the day the fixture was made: {options:[]} before, that one id after).
// The fixture is one template made in the sandbox UI (Payments -> Documents & Contracts -> Templates ->
// New Template), named TEST-CONF-doc-template-trigger-option. The workflow is a DRAFT, so its trigger is
// inactive and nothing can fire it. Control: a template name that does not exist is refused, by name.
export async function runDocumentTemplateTriggerProof({ call, gw, LOCATION, NAME, check, left, log = null }) {
  const subject = (s) => log?.subject?.(s);
  const FIXTURE = 'TEST-CONF-doc-template-trigger-option';
  subject(false);
  const list = await gw.call('GET', `/proposals/templates?${new URLSearchParams({ locationId: LOCATION, limit: '21', skip: '0' })}`);
  const tpl = (list.json?.data ?? []).find((t) => t.name === FIXTURE);
  const tplId = tpl?._id ?? tpl?.id;
  check(typeof tplId === 'string', `PRECONDITION: the fixture template '${FIXTURE}' exists on the account`, `${list.status} ${JSON.stringify((list.json?.data ?? []).map((t) => t.name))}`);
  if (!tplId) return;
  const opts = await gw.call('GET', `/workflows-marketplace/triggers/options/proposal_estimate_update/documentCreatedByTemplateId?locationId=${encodeURIComponent(LOCATION)}`);
  check((opts.json?.options ?? []).some((o) => o.value === tplId && o.label === FIXTURE),
    'ORACLE: GHL\'s own Template dropdown offers that template, its value the /proposals/templates id', JSON.stringify(opts.json?.options ?? opts.status).slice(0, 300));

  const spec = (name, value) => ({ spec: { name, graph: [
    { ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['test-conf-doc-template'] } }],
  triggers: [{ ref: 'dc', type: 'proposal_estimate_update', name: 'TEST-CONF document from template (draft, inactive)',
    filters: [{ field: 'documentCreatedByTemplateId', value }] }] } });

  subject('build_workflow');
  const b = await call('build_workflow', spec(NAME('doc-template-trigger'), FIXTURE));
  const wid = b.data?.wid;
  check(b.ok === true && typeof wid === 'string', 'build_workflow builds a Documents & Contracts trigger that names the template BY NAME', `${b.code ?? ''} ${String(b.detail ?? '').slice(0, 300)}`);
  if (!wid) return;
  left.push(`workflow ${wid} (${NAME('doc-template-trigger')}, draft, trigger inactive)`);

  subject(false);
  const trig = await gw.call('GET', `/workflow/${encodeURIComponent(LOCATION)}/trigger?workflowId=${encodeURIComponent(wid)}`);
  const stored = (trig.json?.triggers ?? trig.json ?? []).find?.((t) => t.type === 'proposal_estimate_update');
  const cond = (stored?.conditions ?? []).find((c) => c.field === 'documentCreatedByTemplateId');
  check(cond?.value === tplId && stored?.active !== true, 'READ-BACK: the stored condition carries the template ID (the dropdown\'s value), and the trigger is inactive',
    JSON.stringify({ cond: cond ?? null, active: stored?.active ?? null }));

  subject('build_workflow');
  const ghost = await call('build_workflow', spec(NAME('doc-template-ghost'), 'TEST-CONF no such document template'));
  if (ghost.data?.wid) left.push(`workflow ${ghost.data.wid} (${NAME('doc-template-ghost')}, should not exist — the ghost control built)`);
  check(ghost.ok !== true && !ghost.data?.wid && /no such document template/.test(String(ghost.detail ?? '') + JSON.stringify(ghost.data ?? {})),
    'CONTROL: a template name that does not exist is refused, naming it — never stored as the word', `${ghost.code ?? ''} ${String(ghost.detail ?? '').slice(0, 300)}`);
  subject(false);
}
