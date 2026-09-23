// LIVE: edit_workflow inserts a BRANCHING step into a PUBLISHED workflow, and it branches at runtime.
//
// Until 2026-09-23 an insert op carrying a bare find_opportunity (no onFound/onNotFound) compiled
// LINEAR — no cat, no transitions, a scalar `next` — and saved, validated and published clean. The
// contact then walked straight through it as if it were a plain step. A green validation cannot see
// that; only a contact's own record can. So this proof:
//   1. builds a trigger-less two-tag workflow and publishes it;
//   2. inserts find_opportunity BEFORE THE HEAD, old chain onto "Opportunity Found", and a tag on
//      "Opportunity Not Found" authored in the SAME op;
//   3. reads the stored document back (export + digest) and holds it to the engine's container rules;
//   4. enrols one contact this run creates — no email, no phone, so no opportunity — and asserts the
//      Not-Found tag lands and the Found chain's tags DO NOT. A linear finder would do the opposite.
// Fences: the workflow has no trigger, its steps only tag, the contact can be sent nothing. It is
// unpublished again at the end. Nothing is deleted.
import { multipathDefects } from '../engine/document-gate.mjs';

export async function runMultipathInsertProof({ call, gw, LOCATION, NAME, STAMP, check, left, log = null }) {
  const subject = (s) => log?.subject?.(s);
  const TAG_HEAD = `test-conf-${STAMP}-mp-found-head`, TAG_SECOND = `test-conf-${STAMP}-mp-found-second`;
  const TAG_NF = `test-conf-${STAMP}-mp-not-found`;
  const tagStep = (ref, name, tag) => ({ ref, kind: 'action', type: 'add_contact_tag', name, attributes: { tags: [tag] } });

  subject('list_account_entities');
  const ents = await call('list_account_entities', {});
  const pipelines = ents.data?.pipelines?.items ?? ents.data?.pipelines ?? [];
  const pipelineId = (Array.isArray(pipelines) ? pipelines : [])[0]?.id;
  check(typeof pipelineId === 'string', 'PRECONDITION: the sandbox has a pipeline for the finder to filter on', JSON.stringify(Object.keys(ents.data ?? {})).slice(0, 160));
  if (!pipelineId) return;

  subject('build_workflow');
  const b = await call('build_workflow', { spec: { name: NAME('mp-insert'), triggers: [], graph: [
    tagStep('h', 'Head', TAG_HEAD), tagStep('s', 'Second', TAG_SECOND)] } });
  const wid = b.data?.wid;
  check(b.ok === true && typeof wid === 'string', 'build_workflow creates the trigger-less two-tag probe', `${b.code ?? ''} ${String(b.detail ?? '').slice(0, 200)}`);
  if (!wid) return;
  left.push(`workflow ${wid} (${NAME('mp-insert')}, was PUBLISHED for the run and unpublished after)`);

  subject('publish_workflow');
  const pub = await call('publish_workflow', { workflowId: wid, confirm: true });
  check(pub.ok === true && pub.data?.verify?.status === 'published' && pub.data?.verify?.totalTriggers === 0,
    'the probe is PUBLISHED with zero triggers before the insert', `${pub.code ?? ''} ${String(pub.detail ?? '').slice(0, 200)}`);

  const before = (await call('export_workflow', { workflowId: wid })).data?.workflow?.workflowData?.templates ?? [];
  const headId = before.find((t) => t.name === 'Head')?.id;

  subject('edit_workflow');
  const ed = await call('edit_workflow', { workflowId: wid, confirm: true, ops: [
    { op: 'insertBefore', beforeId: headId, attachTailTo: 'Opportunity Found', step: {
      type: 'find_opportunity', name: 'Find Opportunity',
      find: { filters: [{ field: 'pipeline_id', value: pipelineId }], sorting: 'latest' },
      onNotFound: [{ type: 'add_contact_tag', name: 'Not found tag', attributes: { tags: [TAG_NF] } }] } }] });
  check(ed.ok === true, 'edit_workflow inserts find_opportunity BEFORE THE HEAD of a published workflow, branch contents in the same op',
    `${ed.code ?? ''} ${String(ed.detail ?? '').slice(0, 300)}`);

  // READ-BACK on a separate request: the stored document, not what we sent.
  const after = (await call('export_workflow', { workflowId: wid })).data?.workflow ?? {};
  const tpls = after.workflowData?.templates ?? [];
  const byId = new Map(tpls.map((t) => [t.id, t]));
  const fo = tpls.find((t) => t.type === 'find_opportunity');
  const head = tpls.find((t) => t.parentKey == null && t.parent == null && t.type !== 'transition');
  check(Boolean(fo) && multipathDefects(fo, byId).length === 0,
    'READ-BACK: the stored finder is a CONTAINER — cat multi-path, convertToMultipath, two transitions wired as next[] children',
    JSON.stringify(fo ? multipathDefects(fo, byId) : 'no find_opportunity stored'));
  check(head?.id === fo?.id, 'READ-BACK: the finder is the new head', `${head?.type} ${head?.name}`);
  const [found, notFound] = (Array.isArray(fo?.next) ? fo.next : []).map((id) => byId.get(id));
  check(found?.next === headId && byId.get(headId)?.next === before.find((t) => t.name === 'Second')?.id,
    'READ-BACK: the old chain (Head → Second) now opens "Opportunity Found", same ids, re-pointed not copied',
    `${found?.name} → ${byId.get(found?.next)?.name}`);
  check(byId.get(notFound?.next)?.name === 'Not found tag', 'READ-BACK: the tag authored in the same op opens "Opportunity Not Found"', `${notFound?.name} → ${byId.get(notFound?.next)?.name}`);
  check(after.status === 'published', 'the edit left the workflow PUBLISHED (saving a published workflow re-publishes it)', after.status);

  subject('get_workflow_digest');
  const dg = await call('get_workflow_digest', { workflowId: wid });
  const dgs = JSON.stringify(dg.data ?? {});
  check(dg.ok === true && /Opportunity Found/.test(dgs) && /Opportunity Not Found/.test(dgs),
    'get_workflow_digest shows both finder branches', dgs.slice(0, 200));

  // RUNTIME: the only check that separates a container from a linear step with the same name.
  subject(false);
  const mk = await gw.call('POST', '/contacts/', { locationId: LOCATION, firstName: 'TEST-CONF', lastName: `${STAMP}-mp (no email, no phone)`, tags: ['test-conf'] });
  const c = mk.json?.contact ?? mk.json;
  check(Boolean(c?.id) && !c.email && !c.phone, 'FENCE: one contact created by this run, with no email and no phone', JSON.stringify([Boolean(c?.id), c?.email ?? null, c?.phone ?? null]));
  if (!c?.id) return;
  left.push(`contact ${c.id} (TEST-CONF ${STAMP} mp, no email, no phone)`);
  const tagsOf = async (id) => { const r = await gw.call('GET', `/contacts/${id}`); return (r.json?.contact ?? r.json)?.tags ?? []; };
  const until = async (fn, { tries = 12, ms = 5000 } = {}) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, ms)); } return null; };

  if (after.status === 'published') {
    const e = await gw.call('POST', `/contacts/${c.id}/workflow/${wid}`, { eventStartTime: '' });
    check(e.ok === true, 'the enrol call is accepted — which proves nothing yet', `${e.status}`);
    const hit = await until(async () => (await tagsOf(c.id)).includes(TAG_NF));
    await new Promise((r) => setTimeout(r, 5000));   // give a wrong path time to show itself
    const tags = await tagsOf(c.id);
    check(hit === true, 'EFFECT: the contact (no opportunity) gains the NOT-FOUND tag — read off its own record', JSON.stringify(tags));
    check(!tags.includes(TAG_HEAD) && !tags.includes(TAG_SECOND),
      'DIFFERENTIAL: and NOT the Found chain\'s tags — a linear finder would have walked straight into Head', JSON.stringify(tags));

    subject('get_workflow_logs');
    // The logs rail is eventually consistent and not written in step order: on 2026-09-23 the run's
    // removal row was readable while the finder row, logged 1.3 s EARLIER, was not yet. So poll for
    // the rows this asserts instead of reading once.
    let lg = null;
    const rows = await until(async () => {
      lg = await call('get_workflow_logs', { workflowId: wid, limit: 10 });
      const got = lg.data?.logs ?? [];
      return got.some((r) => r?.type === 'find_opportunity') && got.some((r) => r?.type === 'remove_from_workflow') ? got : null;
    });
    const lgs = JSON.stringify(lg?.data ?? {});
    check(lg?.ok === true && Boolean(rows), 'get_workflow_logs traces the enrolment through the finder', lgs.slice(0, 240));
    // The run ends itself, so its removal row carries meta.removedFrom {type:'end_of_workflow'}. Until
    // 2026-09-23 the tool read removedFrom at the top level and labelled every removal 'unknown'.
    const removal = (rows ?? []).find((r) => r?.type === 'remove_from_workflow');
    check(removal?.removalOrigin === 'end-of-workflow', 'get_workflow_logs labels the run\'s own end as removalOrigin end-of-workflow (read off meta.removedFrom)',
      JSON.stringify({ removalOrigin: removal?.removalOrigin, removedFrom: removal?.meta?.removedFrom }));
  }

  subject('unpublish_workflows');
  const un = await call('unpublish_workflows', { workflowIds: [wid], confirm: true });
  check(un.ok === true, 'the probe is unpublished again', `${un.code ?? ''} ${String(un.detail ?? '').slice(0, 160)}`);
  subject(false);
}
