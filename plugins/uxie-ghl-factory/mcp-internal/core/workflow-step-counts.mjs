// W6 item 9: per-step counts over ONE workflow's execution log, grouped the way GHL's public log statistics are
// (status, type, step, removal reason, time bucket in a time zone). GHL's builder has no per-step success/failed/skipped
// route (corpus 50-runtime/overview-and-trigger-analysis.md), so the counts are computed client-side from the COMPLETE
// log walk collectWorkflowRuntimeWindow already does. A window that walk could not finish is refused, never counted
// partially — a partial count reads exactly like a real one.
//
// Row fields (corpus 50-runtime/11-runtime-logs.md): status, type, stepId/stepName (null for enrol/finish rows),
// meta.removedFrom.type, meta.skippedFor.type. An If/Else `condition` row's stepId is the BRANCH taken, so the
// container is added from the definition. Values not seen before are counted as themselves (item 13), never dropped.

export const STEP_COUNT_GROUPS = Object.freeze(['status', 'type', 'stepId', 'removedReason', 'skippedReason']);
export const STEP_COUNT_BUCKETS = Object.freeze(['hour', 'day', 'week']);
export const LOG_RETENTION_DAYS = 60;   // corpus 50-runtime/11-runtime-logs.md: the execution log keeps 60 days

const DAY_MS = 86_400_000;

function bucketFormatter(timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' });
  } catch {
    throw new Error(`timezone '${timezone}' is not an IANA time zone this runtime knows (e.g. "Asia/Manila", "UTC")`);
  }
}

function bucketOf(ms, unit, fmt) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  if (unit === 'day') return day;
  if (unit === 'hour') return `${day}T${p.hour}:00`;
  // week: the local Monday that starts it (ISO weeks)
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday);
  const monday = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) - dow * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

export function retentionRefusal() {
  return { refused: 'RETENTION', reason: `the window starts more than ${LOG_RETENTION_DAYS} days ago; GHL keeps the execution log for ${LOG_RETENTION_DAYS} days, so older rows are gone and a count would be short.` };
}

function containerIndex(definition) {
  const out = new Map();
  for (const t of definition?.workflow?.workflowData?.templates ?? []) {
    if (Array.isArray(t?.next)) for (const id of t.next) out.set(id, t.id);
  }
  return out;
}

/**
 * @param window  the collectWorkflowRuntimeWindow result
 * @param opts    {groupBy:string[], timeBucket?, timezone?, statuses?, types?, now?}
 * @returns {count, statistics[], complete:true} | {refused, reason}
 */
export function rollupStepCounts(window, { groupBy = [], timeBucket = null, timezone = 'UTC', statuses = null, types = null, now = Date.now(), definition = null } = {}) {
  for (const g of groupBy) if (!STEP_COUNT_GROUPS.includes(g)) throw new Error(`groupBy '${g}' is not one of ${STEP_COUNT_GROUPS.join(', ')}`);
  if (timeBucket != null && !STEP_COUNT_BUCKETS.includes(timeBucket)) throw new Error(`timeBucket must be one of ${STEP_COUNT_BUCKETS.join(', ')} (one bucket at most)`);
  const fmt = timeBucket ? bucketFormatter(timezone) : null;

  // Retention first: an old window is short whatever the walk says.
  const from = window?.requestedWindow?.fromDate;
  if (Number.isFinite(from) && from < now - LOG_RETENTION_DAYS * DAY_MS) return retentionRefusal();
  // The EVENTS component decides. The overall `complete` also covers the definition read, which the audit gateway's
  // record cap can fail on a large workflow while every log row was read (live 2026-10-30) — the definition only labels
  // If/Else containers here.
  const eventsComplete = window?.componentCompleteness && 'runtimeEvents' in window.componentCompleteness
    ? window.componentCompleteness.runtimeEvents === true
    : window?.complete === true && window?.truncated !== true;
  // A throttled walk is never complete, whatever a component says — the runtime window keeps the same term.
  if (window?.rateLimit?.limited === true || !eventsComplete || !Array.isArray(window?.runtimeEvents)) {
    return { refused: 'INCOMPLETE_WINDOW', reason: 'the execution-log walk did not finish for this window (see the runtime window\'s warnings); a partial count is not returned. Narrow the window or raise maxLogPages.' };
  }

  const containers = containerIndex(window.workflowDefinition?.workflow?.workflowData ? window.workflowDefinition : definition);
  const wantStatus = statuses?.length ? new Set(statuses) : null;
  const wantType = types?.length ? new Set(types) : null;
  const groups = new Map();
  let count = 0;
  for (const { timestamp, event: e } of window.runtimeEvents) {
    if (wantStatus && !wantStatus.has(e?.status)) continue;
    if (wantType && !wantType.has(e?.type)) continue;
    if (fmt && !Number.isFinite(timestamp)) {
      return { refused: 'INCOMPLETE_WINDOW', reason: 'a log row has no readable time, so it cannot be placed in a time bucket.' };
    }
    const row = {};
    for (const g of groupBy) {
      if (g === 'status') row.status = e?.status ?? null;
      else if (g === 'type') row.type = e?.type ?? null;
      else if (g === 'stepId') { row.stepId = e?.stepId ?? null; row.stepName = e?.stepName ?? null; if (containers.has(row.stepId)) row.containerId = containers.get(row.stepId); }
      else if (g === 'removedReason') row.removedReason = e?.meta?.removedFrom?.type ?? e?.removedFrom?.type ?? null;
      else if (g === 'skippedReason') row.skippedReason = e?.meta?.skippedFor?.type ?? e?.skippedFor?.type ?? null;
    }
    if (fmt) row.bucket = bucketOf(timestamp, timeBucket, fmt);
    const key = JSON.stringify(row);
    const g = groups.get(key) ?? { ...row, count: 0 };
    g.count += 1;
    groups.set(key, g);
    count += 1;
  }
  const statistics = [...groups.values()].sort((a, b) => String(a.bucket ?? '').localeCompare(String(b.bucket ?? '')) || b.count - a.count);
  return { count, statistics, complete: true, ...(fmt ? { timezone } : {}) };
}
