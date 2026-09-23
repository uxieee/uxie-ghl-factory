// LIVE: a step that names a workflow the FIRST PAGE of the account's list does not reach still
// resolves (2026-09-23). The engine's workflows list was one page of 200 while the sandbox holds
// over 1,100, so add_to_workflow / remove_from_workflow naming anything past it came back "missing".
// PRECONDITION makes the proof non-vacuous: the target must sort PAST position 200 in the same
// name-ascending order the old single page used. Both workflows are DRAFTS with no trigger and
// never run.
import { fetchEntities } from '../engine/orchestrate.mjs';

export async function runEntityPagingProof({ call, gw, LOCATION, NAME, check, left, log = null }) {
  const subject = (s) => log?.subject?.(s);
  const targetName = NAME('entity-page-target');

  subject('build_workflow');
  const t = await call('build_workflow', { spec: { name: targetName, triggers: [], graph: [
    { ref: 'tg', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['test-conf-entity-page'] } }] } });
  const target = t.data?.wid;
  check(t.ok === true && typeof target === 'string', 'the target draft is built', `${t.code ?? ''} ${String(t.detail ?? '').slice(0, 200)}`);
  if (!target) return;
  left.push(`workflow ${target} (${targetName}, draft, no trigger)`);

  subject(false);
  const ents = await fetchEntities({ call: (m, p, b) => gw.call(m, p, b), loc: LOCATION });
  const pos = ents.workflows.findIndex((w) => w.id === target);
  check(pos >= 200, 'PRECONDITION: the target sorts PAST the first 200 by name — the single page the engine used to read would not have held it',
    `position ${pos} of ${ents.workflows.length}; unreadable ${JSON.stringify(ents.unreadable)}`);

  subject('build_workflow');
  const b = await call('build_workflow', { spec: { name: NAME('entity-page-caller'), triggers: [], graph: [
    { ref: 'aw', kind: 'action', type: 'add_to_workflow', name: 'Hand off', attributes: { workflow: targetName } }] } });
  check(b.ok === true && typeof b.data?.wid === 'string', 'TEST: add_to_workflow naming that target BY NAME builds (it resolved)',
    `${b.code ?? ''} ${String(b.detail ?? b.data?.aborted ?? '').slice(0, 300)}`);
  if (!b.data?.wid) return;
  left.push(`workflow ${b.data.wid} (${NAME('entity-page-caller')}, draft, no trigger)`);

  subject('export_workflow');
  const ex = (await call('export_workflow', { workflowId: b.data.wid })).data?.workflow?.workflowData?.templates ?? [];
  const step = ex.find((s) => s.type === 'add_to_workflow');
  check(step?.attributes?.workflow_id === target, 'READ-BACK: the stored step points at the target\'s id', JSON.stringify(step?.attributes ?? null));
  subject(false);
}
