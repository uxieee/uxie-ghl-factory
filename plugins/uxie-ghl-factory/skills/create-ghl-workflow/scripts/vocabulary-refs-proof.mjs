// LIVE: check_workflow reports a trigger that matches a call disposition NAME the account lacks
// (bl-139). DIFFERENTIAL on one trigger: a REAL active disposition name (control) and a ghost name.
// Fences: a DRAFT workflow, never published, trigger inactive — nothing can enter or fire it.
import { fetchDispositionNames } from '../engine/vocabulary-refs.mjs';

export async function runVocabularyRefsProof({ call, gw, LOCATION, NAME, STAMP, check, left, log = null }) {
  const subject = (s) => log?.subject?.(s);
  subject(false);
  const names = await fetchDispositionNames((m, p) => gw.call(m, p), LOCATION);
  check(Array.isArray(names) && names.length > 0, 'PRECONDITION: the account has an active call disposition to use as the positive control', JSON.stringify(names));
  if (!names?.length) return;
  const real = names[0], ghost = `TEST-CONF ghost disposition ${STAMP}`;

  subject('build_workflow');
  const b = await call('build_workflow', { spec: { name: NAME('disposition-names'), triggers: [
    { ref: 't', type: 'call_status', name: 'Call outcome', active: false,
      filters: [{ field: 'custom_disposition', operator: 'contains-any', value: [real, ghost] }] }],
  graph: [{ ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: [`test-conf-${STAMP}-disp`] } }] } });
  const wid = b.data?.wid;
  check(b.ok === true && typeof wid === 'string', 'build_workflow creates a DRAFT with an inactive call_status trigger naming one real and one ghost disposition', `${b.code ?? ''} ${String(b.detail ?? '').slice(0, 240)}`);
  if (!wid) return;
  left.push(`workflow ${wid} (${NAME('disposition-names')}, draft, trigger inactive)`);

  subject('check_workflow');
  const c = await call('check_workflow', { workflowId: wid });
  const v = c.data?.vocabularyReferences;
  check(v?.ran === true && v.valuesChecked === 2, 'check_workflow reads the account\'s dispositions and judges BOTH values on the stored trigger', JSON.stringify(v ?? c.detail ?? null).slice(0, 240));
  check((v?.errors ?? []).map((e) => e.value).join('|') === ghost, 'DIFFERENTIAL: the ghost name is reported and the real one is NOT', JSON.stringify((v?.errors ?? []).map((e) => e.value)));
  check(/trigger names: 1 unmatched of 2/.test(String(c.data?.headline)), 'and the headline says so, so a clean asset scope cannot read as a clean trigger', c.data?.headline);
  check(c.data?.errorCount !== undefined && !(c.data.errors ?? []).some((e) => JSON.stringify(e).includes(ghost)), 'and it is NOT folded into errorCount (separate claim, separate key)', String(c.data?.errorCount));
  subject(false);
}
