// event_start_date `recurring`: the builder writes `value` as a NUMBER (day_week 0-6 = Sun-Sat, day_month 1-31) and
// `recurring_time` as "HH:mm" on a 15-minute grid (models/actions/EventStartDate.ts:79-122). That shape is proven live
// (knowledge sniffs/workflows-wave1-2026-09-25/live-3AR-goal-opp-esd-atw.json: the anchor is today at that time). The API
// accepted and stored `value: "monday"` / `recurring_time: "9:00 AM"` (live-3L-event-start.json) — a shape the builder cannot
// produce and whose runtime is unknown. Advisory (`warning`).
const TIME = /^([01]\d|2[0-3]):(00|15|30|45)$/;

export function lintEventStartRecurring(templates) {
  const out = [];
  for (const t of Array.isArray(templates) ? templates.filter(Boolean) : []) {
    const a = t.attributes ?? {};
    if (t.type !== 'event_start_date' || a.event_start_type !== 'recurring') continue;
    const where = `event_start_date '${t.name ?? t.id}'`;
    const push = (m) => out.push({ code: 'EVENT_START_RECURRING_SHAPE', severity: 'warning', stepId: t.id, msg: `${where}: ${m}` });
    const [lo, hi] = a.recurring_type === 'day_month' ? [1, 31] : [0, 6];
    if (a.recurring_type !== 'day_week' && a.recurring_type !== 'day_month') push(`recurring_type must be "day_week" or "day_month", got ${JSON.stringify(a.recurring_type)}`);
    else if (!Number.isInteger(a.value) || a.value < lo || a.value > hi)
      push(`value must be a number ${lo}-${hi} for ${a.recurring_type}${a.recurring_type === 'day_week' ? ' (0 = Sunday)' : ''}, got ${JSON.stringify(a.value)} — the builder never writes another shape`);
    if (typeof a.recurring_time !== 'string' || !TIME.test(a.recurring_time))
      push(`recurring_time must be "HH:mm" (24-hour, 15-minute steps), got ${JSON.stringify(a.recurring_time)}`);
  }
  return out;
}
