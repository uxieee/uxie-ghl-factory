// Restoring a workflow to an earlier version, the way the builder's version drawer does it
// (utils/apply-version-to-workflow.ts:18-120 and components/versions/hooks/use-restore-version.ts:66-72, bundle 2026-09-25).
// The sequence: delete every current trigger, recreate the version's triggers as inactive drafts, then save the whole document
// with isRestoreRequest:true. A restore always lands as a DRAFT (forceDraft).
// Create-from-version (use-create-new-from-version.ts:54-69) is a blank create first, then the same trigger
// recreate and PUT on the NEW id (isRestoreToSameWorkflow:false).
// Proven live 2026-09-28 on a trigger-less TEST workflow: tag B restored to v3's tag A, status draft,
// meta.versionRestore set, history gained v5 (knowledge sniffs/workflows-wave1-2026-09-25/live-3BM-versions.json).
// Pure functions only. The tool in tools.mjs does the I/O.

const SETTINGS_KEYS = ['timezone', 'stopOnResponse', 'allowMultiple', 'allowMultipleOpportunity', 'autoMarkAsRead', 'window', 'senderAddress', 'eventStartDate'];

// buildTriggerMainFromVersion (apply-version-to-workflow.ts:18-43). Drop id/_id; bind to the target
// workflow with camelCase workflowId (the create route binds from that key ONLY — R-95); force status
// and active:false; point every action at the target; keep an inbound webhook's URL by predeterminedId
// ONLY when restoring into the same workflow (isRestoreToSameWorkflow). A workflow created from a version
// gets fresh trigger ids, so its inbound webhook gets a NEW URL.
export function triggerFromVersion(src, { workflowId, status = 'draft', locationId, companyId, companyAge, sameWorkflow = true }) {
  const copy = JSON.parse(JSON.stringify(src ?? {}));
  if (sameWorkflow && copy.type === 'inbound_webhook' && !copy.predeterminedId) copy.predeterminedId = copy.id ?? copy._id;
  if (!sameWorkflow) delete copy.predeterminedId;
  const { id: _id1, _id: _id2, workflow_id: _snake, ...rest } = copy;
  const body = { ...rest, workflowId, status, active: false };
  if (Array.isArray(body.actions)) body.actions = body.actions.map((a) => ({ ...a, workflow_id: workflowId }));
  // Model.save() adds these on a create (models/Model.ts:222-229).
  if (locationId) body.location_id = locationId;
  if (companyId) body.company_id = companyId;
  if (companyAge !== undefined && companyAge !== null) body.company_age = companyAge;
  return body;
}

// The document PUT (apply-version-to-workflow.ts:92-119), with the restore always landing as a draft.
// `keep` carries what the version record does not hold and the PUT would otherwise wipe: the document PUT replaces the whole
// document, and a restore that left the current workflow note out reset it to none (measured live 2026-09-30, own draft).
export function restoreBody(version, { name, targetVersion, userId, oldTriggers = [], newTriggers = [], restoredAt = new Date(), keep = {} }) {
  const settings = {};
  for (const k of SETTINGS_KEYS) settings[k] = k === 'eventStartDate' ? (version.startDate ?? version.eventStartDate) : version[k];
  return {
    name,
    isRestoreRequest: true,
    status: 'draft',
    ...settings,
    ...(keep.workflowNote ? { workflowNote: keep.workflowNote } : {}),
    workflowData: version.workflowData,
    updatedBy: userId,
    version: targetVersion,
    oldTriggers,
    newTriggers,
    triggersChanged: true,
    modifiedSteps: [],
    deletedSteps: [],
    createdSteps: [],
    meta: {
      ...(version.meta || {}),
      versionRestore: {
        restoredFromVersion: version._id ?? version.id,
        versionBeforeRestore: targetVersion,
        restoredAt: restoredAt instanceof Date ? restoredAt.toISOString() : restoredAt,
        restoredBy: userId,
      },
    },
  };
}

const stepKey = (t) => JSON.stringify({ type: t?.type, name: t?.name, attributes: t?.attributes ?? null, next: t?.next ?? null, parentKey: t?.parentKey ?? null });
const trigKey = (t) => JSON.stringify({ type: t?.type, name: t?.name ?? null, conditions: t?.conditions ?? [] });

// What the restore will change, for the preview. Steps compare by id; triggers by type+name+conditions
// (ids change on every restore because the builder deletes and recreates them).
export function diffVersion(current, version, currentTriggers = []) {
  const cur = new Map((current?.workflowData?.templates ?? current?.templates ?? []).map((t) => [t.id, t]));
  const ver = new Map((version?.workflowData?.templates ?? []).map((t) => [t.id, t]));
  const line = (t) => ({ id: t.id, type: t.type, name: t.name ?? null });
  const steps = {
    added: [...ver.values()].filter((t) => !cur.has(t.id)).map(line),
    removed: [...cur.values()].filter((t) => !ver.has(t.id)).map(line),
    changed: [...ver.values()].filter((t) => cur.has(t.id) && stepKey(cur.get(t.id)) !== stepKey(t)).map(line),
  };
  const vt = version?.triggersData ?? [];
  const triggers = {
    current: currentTriggers.map((t) => ({ id: t.id ?? t._id, type: t.type, name: t.name ?? null })),
    fromVersion: vt.map((t) => ({ type: t.type, name: t.name ?? null })),
    identical: currentTriggers.length === vt.length
      && JSON.stringify(currentTriggers.map(trigKey).sort()) === JSON.stringify(vt.map(trigKey).sort()),
  };
  const settings = {};
  for (const k of SETTINGS_KEYS) {
    const a = current?.[k] ?? null, b = (k === 'eventStartDate' ? (version?.startDate ?? version?.eventStartDate) : version?.[k]) ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) settings[k] = { from: a, to: b };
  }
  const name = (current?.name ?? null) !== (version?.name ?? null) ? { from: current?.name ?? null, to: version?.name ?? null } : null;
  return { steps, triggers, settings, name };
}
