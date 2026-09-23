// LIVE (bl-137): the documents with broken references are PREVIEWABLE, and a modifyTrigger that repairs a
// bad reference is no longer refused for the reference it removes. The broken STORED state is made on
// purpose with our own two hatches (the only way our write path allows it), on a DRAFT whose trigger is
// INACTIVE — nothing can enter or fire it. Then: an unconfirmed edit returns a preview naming what would
// refuse; the repair goes through with NO hatches; the stored trigger reads back with the real calendar.
export async function runTriggerRepairProof({ call, gw, LOCATION, NAME, check, left, log = null }) {
  const subject = (s) => log?.subject?.(s);
  subject(false);
  const cals = await gw.call('GET', `/calendars/?locationId=${LOCATION}`);
  const real = (cals.json?.calendars ?? []).find((c) => c?.isActive === true)?.id;
  check(typeof real === 'string', 'PRECONDITION: an ACTIVE calendar exists for the repair to point at', String(real));
  if (!real) return;
  const GHOST = '00000000-0000-4000-8000-000000000009';
  const cond = (cal) => [
    { field: 'appointment.eventType', operator: '==', value: 'normal', title: 'Event type', type: 'select' },
    { field: 'calendar.id', operator: '==', value: cal, title: 'In calendar', type: 'select' },
    { field: 'contactMode', operator: 'is-any-of', value: ['contact'] },
  ];

  subject('build_workflow');
  const b = await call('build_workflow', { spec: { name: NAME('trigger-repair'), triggers: [], graph: [
    { ref: 'a', kind: 'action', type: 'add_contact_tag', name: 'Tag', attributes: { tags: ['test-conf-trigger-repair'] } }] } });
  const wid = b.data?.wid;
  check(b.ok === true && typeof wid === 'string', 'build_workflow creates the trigger-repair probe (draft)', `${b.code ?? ''} ${String(b.detail ?? '').slice(0, 160)}`);
  if (!wid) return;
  left.push(`workflow ${wid} (${NAME('trigger-repair')}, draft, trigger inactive)`);

  subject('edit_workflow');
  const TNAME = 'TEST-CONF broken appointment trigger';
  const add = await call('edit_workflow', { workflowId: wid, confirm: true, ignoreAssetErrors: true, allowValidationFailure: true, ops: [
    { op: 'addTrigger', trigger: { type: 'appointment', name: TNAME, active: false, conditions: cond(GHOST) } }] });
  check(add.ok === true, 'SETUP: the broken stored state is made deliberately, with both hatches, on an inactive trigger', `${add.code ?? ''} ${String(add.detail ?? '').slice(0, 240)}`);
  if (add.ok !== true) return;

  // An ATTRIBUTE-writing op runs the asset preflight, which judges the stored ghost trigger — so this is
  // the preview that used to come back VALIDATION_FAILED. (A rename would pass vacuously: no preflight.)
  const stepId = (await call('export_workflow', { workflowId: wid })).data?.workflow?.workflowData?.templates?.[0]?.id;
  const pv = await call('edit_workflow', { workflowId: wid, ops: [{ op: 'modifyStep', stepId, attrPatch: { tags: ['test-conf-trigger-repair-2'] } }] });
  const wr = pv.data?.preview?.wouldRefuse ?? [];
  check(pv.code === 'CONFIRM_REQUIRED' && !!pv.data?.preview && wr.some((w) => w.gate === 'asset_preflight' && /calendar/i.test(w.detail)),
    'an UNCONFIRMED edit of the broken document returns a PREVIEW, naming the refusal it WOULD meet (the ghost calendar) instead of refusing',
    `${pv.code} ${JSON.stringify(wr.map((w) => [w.gate, String(w.detail).slice(0, 80)]))} ${String(pv.detail ?? '').slice(0, 160)}`);
  const cf = await call('edit_workflow', { workflowId: wid, confirm: true, ops: [{ op: 'modifyStep', stepId, attrPatch: { tags: ['test-conf-trigger-repair-2'] } }] });
  check(cf.ok === false && /calendar/i.test(String(cf.detail)), 'CONTROL: the same edit CONFIRMED is still refused — the gate is intact, only the preview is freed', `${cf.code} ${String(cf.detail ?? '').slice(0, 160)}`);

  const fix = await call('edit_workflow', { workflowId: wid, confirm: true, ops: [
    { op: 'modifyTrigger', name: TNAME, trigger: { conditions: cond(real) } }] });
  check(fix.ok === true, 'the REPAIR (modifyTrigger to a real calendar) goes through with NO hatches — it is judged on the trigger it writes, not the one it replaces',
    `${fix.code ?? ''} ${String(fix.detail ?? '').slice(0, 300)}`);
  const trigs = await gw.call('GET', `/workflow/${LOCATION}/trigger?workflowId=${wid}`);
  const t = (trigs.json?.triggers ?? trigs.json ?? []).find?.((x) => x.name === TNAME);
  const calNow = (t?.conditions ?? []).find((c) => c.field === 'calendar.id')?.value;
  check(calNow === real && t?.active !== true, 'READ-BACK: the stored trigger now names the real calendar, and is still inactive', `${calNow} active=${t?.active}`);
  subject(false);
}
