// Gateway-driven fast-forward GHL workflow WAIT steps. The caller supplies a
// gateway with { call(method, path, body), loc, uid }; call returns
// { status, ok, json }.
export function makeFF({ gw }) {
  const { call, loc, uid } = gw;
  const callJson = async (method, path, body) => {
    const result = await call(method, path, body);
    if (!result.ok) {
      const detail = typeof result.json === 'string' ? result.json : JSON.stringify(result.json);
      const error = new Error(`${method} ${path} → ${result.status} ${detail.slice(0, 200)}`);
      error.gatewayResponse = result;
      throw error;
    }
    return result.json;
  };

  // Where is everyone right now? → [{ total, currentStepId }]
  const countPerStep = (wid) =>
    callJson('GET', `/workflows/status/search/count-per-step?workflowId=${wid}&locationId=${loc}`);

  // Who is parked at one step? → { totalCount, rows:[{ _id (=statusId), contactId, currentStepId, executeOn }] }
  const parkedAt = (wid, stepId, { skip = 0, limit = 50 } = {}) =>
    callJson('GET', `/workflows/status/search/details-by-step?workflowId=${wid}&locationId=${loc}`
      + `&skip=${skip}&limit=${limit}&currentStepId=${stepId}&showTotalCount=true`);

  // LIVE-PROVEN: details-by-step pages at 50 and must be walked to totalCount.
  const allParked = async (wid, stepId, { pageSize = 50 } = {}) => {
    const rows = [];
    let skip = 0;
    for (;;) {
      const detail = await parkedAt(wid, stepId, { skip, limit: pageSize });
      const batch = Array.isArray(detail.rows) ? detail.rows : [];
      rows.push(...batch);
      const reportedTotal = Number(detail.totalCount);
      const total = Number.isFinite(reportedTotal) && reportedTotal >= 0
        ? reportedTotal
        : rows.length;
      if (rows.length >= total) break;
      if (batch.length === 0) {
        throw new Error(`details-by-step pagination stalled at ${rows.length} of ${total} rows`);
      }
      skip += batch.length;
    }
    return rows;
  };

  // LIVE-PROVEN: statusIds are workflow-status ULIDs from parkedAt, not contactIds.
  const moveToNextStep = (wid, stepId, statusIds) =>
    callJson('POST', `/workflow/${loc}/${wid}/requeue-stuck-statuses/${stepId}`, {
      actionFrom: { userId: uid, channel: 'web_app', source: 'action_stats_page' },
      statusIds,
    });

  // Resolve the status ULIDs to move for a step, then move them. `select` is one of:
  //   { contactId }        → move the parked enrollment(s) for that one contact
  //   { statusIds: [...] } → move exactly these workflow-status ULIDs
  //   { all: true }        → move EVERY parked contact at the step (paginated)
  async function move(wid, stepId, select) {
    let ids;
    if (select.statusIds) {
      ids = select.statusIds;
    } else if (select.contactId) {
      const rows = await allParked(wid, stepId);
      ids = rows.filter((row) => row.contactId === select.contactId).map((row) => row._id);
    } else if (select.all) {
      ids = (await allParked(wid, stepId)).map((row) => row._id);
    } else {
      throw new Error('move needs one of: { contactId }, { statusIds }, { all:true }');
    }
    if (!ids.length) return { moved: 0, note: 'nobody parked matched at that step', statusIds: [] };
    const res = await moveToNextStep(wid, stepId, ids);
    return { moved: ids.length, statusIds: ids, res };
  }

  return { loc, uid, countPerStep, parkedAt, allParked, moveToNextStep, move };
}
