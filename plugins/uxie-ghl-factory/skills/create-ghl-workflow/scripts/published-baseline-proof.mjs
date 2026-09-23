// LIVE (bl-146): GHL stops checking if_else / router / wait once a workflow is PUBLISHED (its skipHatch),
// so published documents carrying those violations exist. An edit of one that does not touch the
// violating step must go through with a WARNING; the same violation INTRODUCED by an edit must still
// refuse. The broken stored state is made on purpose, on a PUBLISHED workflow with NO trigger whose steps
// only tag and wait — nothing can enter it. Two identical waits, A and B: only A is broken, so the
// differential is the same rule on the same step type, differing only in whether the stored document
// already had it. Unpublished again at the end.
//
// WHICH VIOLATION, measured 2026-09-23. GHL's SERVER now refuses two of validateWaitStep's cases on any
// save, published or not: a stringified window (400 INVALID_FIELD_VALUE "Window: Expected object,
// received string") and a non-branching node with an array next (400 INVALID_STRUCTURE). So those cannot
// be in a stored document. It ACCEPTS a wait marked convertToMultipath whose transitions name a step that
// is not in the workflow (200, stored, still published) — the case staged here.
//
// HOW IT IS STAGED. edit_workflow refuses to write the violation (that is the point), so the setup builds
// the commit body with edit_workflow's own editCommitBody from the freshly read document, changes only
// wait A's attributes, and PUTs it to the route edit_workflow commits to. No body is hand-written.
import { validateDocument } from '../engine/write-validation.mjs';
import { editCommitBody } from '../engine/edit.mjs';

export async function runPublishedBaselineProof({ call, gw, LOCATION, NAME, check, left, log = null }) {
  const subject = (s) => log?.subject?.(s);
  const ghost = (n) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, name: `ghost ${n}`, condition: 'timeout', conditionType: 'user-defined',
    isPrimaryBranch: false, description: '', attributes: { type: 'wait_timeout', description: 'TEST-CONF: names no step' } });
  const BROKEN = (n) => ({ convertToMultipath: true, transitions: [ghost(n)] });
  const isBroken = (step) => step?.attributes?.convertToMultipath === true && (step.attributes.transitions ?? []).some((t) => /^ghost/.test(t.name));
  const tag = (ref, name, t) => ({ ref, kind: 'action', type: 'add_contact_tag', name, attributes: { tags: [t] } });

  subject('build_workflow');
  const b = await call('build_workflow', { spec: { name: NAME('published-baseline'), triggers: [], graph: [
    tag('a', 'Tag A', 'test-conf-baseline-a'),
    { ref: 'wa', kind: 'wait', name: 'Hold A', config: { unit: 'days', value: 1, when: 'after' } },
    { ref: 'wb', kind: 'wait', name: 'Hold B', config: { unit: 'days', value: 1, when: 'after' } },
    tag('b', 'Tag B', 'test-conf-baseline-b')] } });
  const wid = b.data?.wid;
  check(b.ok === true && typeof wid === 'string', 'build_workflow creates the probe (two tags, two waits, no trigger)', `${b.code ?? ''} ${String(b.detail ?? '').slice(0, 200)}`);
  if (!wid) return;
  left.push(`workflow ${wid} (${NAME('published-baseline')}, was PUBLISHED with NO trigger and a deliberately broken wait (transition naming no step); unpublished after)`);

  subject('publish_workflow');
  const pub = await call('publish_workflow', { workflowId: wid, confirm: true });
  check(pub.ok === true && pub.data?.verify?.status === 'published' && pub.data?.verify?.totalTriggers === 0,
    'the probe is PUBLISHED with zero triggers', `${pub.code ?? ''} ${String(pub.detail ?? '').slice(0, 200)}`);
  if (!pub.ok) return;

  subject('export_workflow');
  const read = async () => (await call('export_workflow', { workflowId: wid })).data?.workflow ?? {};
  const byName = (doc, n) => (doc.workflowData?.templates ?? []).find((t) => t.name === n);
  const d0 = await read();
  const [wa, wb, ta] = ['Hold A', 'Hold B', 'Tag A'].map((n) => byName(d0, n));
  if (!wa?.id || !wb?.id || !ta?.id) { check(false, 'the probe reads back with its four steps', JSON.stringify((d0.workflowData?.templates ?? []).map((t) => t.name))); return; }

  subject(false);
  const path = `/workflow/${encodeURIComponent(LOCATION)}/${encodeURIComponent(wid)}`;
  const fresh = (await gw.call('GET', `${path}?includeScheduledPauseInfo=true`)).json ?? {};
  const staged = (fresh.workflowData?.templates ?? []).map((t) => (t.id === wa.id ? { ...t, attributes: { ...t.attributes, ...BROKEN(1) } } : t));
  const body = editCommitBody(fresh, staged, { createdSteps: [], deletedSteps: [], modifiedSteps: [wa.id] }, gw.uid, {});
  const stage = await gw.call('PUT', path, body);
  check(stage.ok === true, 'SETUP: the broken stored state is written deliberately (edit_workflow\'s own commit body), on wait A only — GHL accepts it',
    `${stage.status} ${JSON.stringify(stage.json ?? null).slice(0, 300)}`);
  if (stage.ok !== true) return;
  const d1 = await read();
  check(d1.status === 'published' && isBroken(byName(d1, 'Hold A')) && !isBroken(byName(d1, 'Hold B')),
    'READ-BACK: the stored document is PUBLISHED, wait A carries the dangling transition, wait B does not',
    JSON.stringify({ status: d1.status, a: byName(d1, 'Hold A')?.attributes?.transitions ?? null, b: byName(d1, 'Hold B')?.attributes?.transitions ?? null }));

  // PRECONDITION, so the edit below is not a vacuous pass: judged WITHOUT a baseline — the engine as it
  // was before bl-146 — the very same edit of this stored document is refused on the rule.
  subject(false);
  const tpl = (d1.workflowData?.templates ?? []).map((t) => (t.id === ta.id ? { ...t, attributes: { ...t.attributes, tags: ['test-conf-baseline-a2'] } } : t));
  const noBaseline = validateDocument({ intent: 'edit', status: 'published', templates: tpl, triggers: [], skipWorkflowRules: false });
  check(noBaseline.blocked === true && noBaseline.rules.findings.some((f) => f.rule === 'validateWaitStep'),
    'PRECONDITION: without the baseline this edit is REFUSED on validateWaitStep (what bl-146 fixed)', JSON.stringify(noBaseline.rules.findings.map((f) => f.rule)));

  subject('edit_workflow');
  const kept = await call('edit_workflow', { workflowId: wid, confirm: true, ops: [{ op: 'modifyStep', stepId: ta.id, attrPatch: { tags: ['test-conf-baseline-a2'] } }] });
  const warns = kept.data?.warnings ?? [];
  check(kept.ok === true && warns.some((w) => /pre-existing/.test(w) && /validateWaitStep/.test(w)),
    'TEST: an edit that does not touch wait A goes through with NO hatches, and WARNS that the stored document already fails validateWaitStep',
    `${kept.code ?? ''} ${String(kept.detail ?? '').slice(0, 300)} ${JSON.stringify(warns).slice(0, 300)}`);
  const d2 = await read();
  check(JSON.stringify(byName(d2, 'Tag A')?.attributes?.tags) === '["test-conf-baseline-a2"]' && isBroken(byName(d2, 'Hold A')) && d2.status === 'published',
    'READ-BACK: the edit landed, wait A is untouched, the workflow is still published',
    JSON.stringify({ tags: byName(d2, 'Tag A')?.attributes?.tags, a: isBroken(byName(d2, 'Hold A')), status: d2.status }));

  // The DIFFERENTIAL goes through repair_workflow, which writes a whole template list: edit_workflow's
  // modifyStep passes a wait's attrPatch through the drawer normaliser, which drops convertToMultipath
  // and transitions, so an edit CANNOT introduce this violation at all (measured 2026-09-23 — it saved
  // wait B unchanged). The repair sends the stored list as it stands, with wait B broken the same way.
  subject('repair_workflow');
  const stored = d2.workflowData?.templates ?? [];
  const introduced = await call('repair_workflow', { workflowId: wid, confirm: true,
    templates: stored.map((t) => (t.id === wb.id ? { ...t, attributes: { ...t.attributes, ...BROKEN(2) } } : t)) });
  const d3 = await read();
  check(introduced.ok === false && /validateWaitStep/.test(String(introduced.detail)) && /Hold B/.test(String(introduced.detail))
    && !/'Hold A'/.test(String(introduced.detail)) && !isBroken(byName(d3, 'Hold B')),
    'DIFFERENTIAL: the SAME violation introduced on wait B is refused ON validateWaitStep, naming B and not A; wait B reads back unchanged',
    `${introduced.code ?? ''} ${String(introduced.detail ?? '').slice(0, 400)}`);
  const kept2 = await call('repair_workflow', { workflowId: wid, confirm: true, templates: stored });
  check(kept2.ok === true && (kept2.data?.warnings ?? []).some((w) => /pre-existing/.test(w) && /validateWaitStep/.test(w)),
    'CONTROL: the same repair WITHOUT wait B broken goes through, warning on wait A — so the refusal above was B',
    `${kept2.code ?? ''} ${String(kept2.detail ?? '').slice(0, 300)}`);

  subject('unpublish_workflows');
  const un = await call('unpublish_workflows', { workflowIds: [wid], confirm: true });
  check(un.ok === true, 'the probe is unpublished again', `${un.code ?? ''} ${String(un.detail ?? '').slice(0, 160)}`);
  subject(false);
}
