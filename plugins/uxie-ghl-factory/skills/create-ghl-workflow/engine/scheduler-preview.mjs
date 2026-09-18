// WHEN WILL THIS SCHEDULER TRIGGER ACTUALLY FIRE? — GHL's own answer, asked before publishing.
//
// A scheduler trigger is authored as interval + days + times, and nothing in the stored document
// says when it fires. GHL computes that server-side: POST /workflow/{loc}/scheduler-trigger/preview
// returns the next execution instants. Read-shaped — it writes nothing (live 2026-09-19).
//
// WHAT THE LIVE PROBE ESTABLISHED, each with its control:
//   • the timezone IS honoured: weekly Monday 09:00 previews as 08:00Z in Europe/London and as
//     23:00Z-the-day-before in Australia/Sydney — shifting to 22:00Z across Sydney's DST change.
//   • 🔴 AN EMPTY `executions` IS A FINDING, NOT A SHRUG. A schedule GHL cannot fire answers
//     200 {"success":true,"executions":[]} — no error. `skip_weekends:true` on a Saturday-only
//     schedule does exactly that: it saves, publishes, validates, and never runs.
//   • `conditions: []` is the one loud refusal (400).
//
// 🔴 THE BUILDER'S PREVIEW USES THE *BROWSER'S* TIMEZONE (Intl…resolvedOptions().timeZone), not the
// account's. So the times a human saw in the UI are in whatever zone their laptop was in. This
// module never borrows a zone silently: it previews in the zone it is GIVEN and says which.
//
// The body mirrors SchedulerPreview.vue exactly: every filter EXCEPT `scheduler.interval`, plus
// stop_at / skip_weekends from the trigger's schedule_config, plus the trigger id.

export const SCHEDULER_TRIGGER_TYPE = 'scheduler_trigger';

/** Pure. The request body the builder sends for one stored trigger, or null when it is not a scheduler. */
export function schedulerPreviewBody(trigger, timezone) {
  if (trigger?.type !== SCHEDULER_TRIGGER_TYPE) return null;
  const conditions = (trigger.conditions ?? [])
    .filter((c) => c && c.field && c.field !== 'scheduler.interval' && c.value !== undefined && c.value !== null && c.value !== '')
    .map((c) => ({ field: c.field, value: c.value }));
  const cfg = trigger.schedule_config ?? {};
  const scheduleConfig = {};
  if (cfg.stop_at) scheduleConfig.stop_at = cfg.stop_at;
  if (cfg.skip_weekends !== undefined) scheduleConfig.skip_weekends = cfg.skip_weekends;
  const id = trigger.id ?? trigger._id;
  return { timezone, conditions, scheduleConfig, ...(id ? { triggerId: id } : {}) };
}

/** Pure. Turn one preview response into an advisory row. Never throws; never blesses. */
export function interpretSchedulerPreview(trigger, timezone, res) {
  const base = { triggerId: trigger.id ?? trigger._id ?? null, name: trigger.name ?? null, timezone };
  if (!res?.ok) {
    return { ...base, checked: false, executions: null,
      detail: `GHL's preview did not answer (${res?.status ?? 'no status'}${res?.json?.error ? `: ${res.json.error}` : ''}) — when this trigger fires is UNKNOWN, not fine.` };
  }
  const executions = Array.isArray(res.json?.executions) ? res.json.executions : null;
  if (executions === null) return { ...base, checked: false, executions: null, detail: 'GHL answered 200 without an `executions` list — unreadable, so unknown.' };
  if (executions.length === 0) {
    return { ...base, checked: true, neverFires: true, executions,
      detail: '🔴 GHL computes NO upcoming executions for this schedule. It will save, validate and publish, and never run. '
        + 'Usual causes: skip_weekends with weekend-only days, a stop_at already in the past, or an interval with no matching day/time rows.' };
  }
  return { ...base, checked: true, neverFires: false, executions,
    detail: `next ${executions.length} execution(s), as UTC instants computed for ${timezone}: ${executions.join(', ')}` };
}
