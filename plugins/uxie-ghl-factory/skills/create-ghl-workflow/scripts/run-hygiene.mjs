// bl-1021 run hygiene (orchestrator 2026-11-10, after run 5 crashed partway with an uncaught GHL connect timeout and left two TEST-CONF
// workflows published, because a crash skips every finally):
//   1. sweepPublishedTestConf: at the START of a run, unpublish every TEST-CONF workflow that is published, and read each back as draft
//      on a separate GET. Only TEST-CONF names are touched.
//   2. boundaryMeter: read the location AI usage raw at a section boundary, log it, and say whether to stop (more than METER_DELTA over the run's own first reading).
//   3. callSafe: a transport failure (connect timeout, reset) is a reported failure with code TRANSPORT_FAILED, never an uncaught crash.
//      Read-only calls are retried; a write is never retried, because it may have landed.

import { appendFileSync } from 'node:fs';

// 2026-11-21 (orchestrator, bl-1034): the absolute ceiling (9.38) was passed on 11-10 by a charge from outside W9. The meter is a delta on the
// run's own first reading: stop when usage rises more than METER_DELTA over it, or when the read fails.
export const METER_DELTA = 0.05;
const READ_PREFIX = /^(get_|list_|export_|validate_|check_|preview_)/;

export function isReadCall(name, args) {
  return READ_PREFIX.test(name) || (name === 'raw_request' && String(args?.method ?? '').toUpperCase() === 'GET');
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Run a call; a thrown transport error becomes a reported failure. Reads are retried (with a short backoff); writes are not.
export async function callSafe(fn, name, args, { retries = 2, sleep = defaultSleep } = {}) {
  const attempts = isReadCall(name, args) ? retries + 1 : 1;
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(name, args);
    } catch (error) {
      lastError = error;
      if (i + 1 < attempts) await sleep(500 * (i + 1));
    }
  }
  return { ok: false, code: 'TRANSPORT_FAILED', detail: `${name} did not complete: ${String(lastError?.cause?.message ?? lastError?.message ?? lastError).slice(0, 200)}` };
}

// Sweep: unpublish every TEST-CONF workflow still published (updated since sinceIso), and read each back as draft on a separate GET.
// The suite names its own flows TEST-CONF-<lowercase stem>-<six-digit run stamp> (conformance.mjs NAME). Only those are swept.
export const SUITE_FLOW_NAME = /^TEST-CONF-[a-z][a-z0-9-]*-\d{6}$/;

// ownStamp (w9-d18, QA batch-1 limit): when set, only a workflow whose name ends in `-<ownStamp>` is touched — this run's own drafts. Any
// other published TEST-CONF flow is reported in otherPublished and never touched.
export async function sweepPublishedTestConf({ call, check, sinceIso, ownStamp = null }) {
  const listed = await call('list_workflows', { updatedAfter: sinceIso, pageSize: 100, maxPages: 20, limit: 500 });
  const rows = listed?.data?.workflows ?? [];
  const published = rows.filter((w) => /^TEST-CONF/.test(w.name ?? '') && w.status === 'published');
  const mine = (w) => SUITE_FLOW_NAME.test(w.name) && (ownStamp === null || String(w.name).endsWith(`-${ownStamp}`));
  const targets = published.filter(mine);
  const otherPublished = published.filter((w) => !mine(w)).map((w) => ({ id: w.id, name: w.name }));
  const cleared = [], residualPublished = [];
  for (const w of targets) {
    const un = await call('unpublish_workflows', { workflowIds: [w.id], confirm: true });
    check(un?.ok === true, `start sweep: unpublish_workflows takes ${w.name} back down`, un?.detail);
    const back = await call('get_workflow', { workflowId: w.id });
    const status = back?.data?.status ?? null;
    if (status === 'draft') cleared.push({ id: w.id, name: w.name });
    else residualPublished.push({ id: w.id, name: w.name, status });
  }
  check(residualPublished.length === 0, 'start sweep: every published TEST-CONF workflow reads back as draft on a separate GET',
    residualPublished.length ? JSON.stringify(residualPublished).slice(0, 300) : `${cleared.length} cleared`);
  return { found: targets.length, cleared, residualPublished, otherPublished };
}

// Boundary read: the raw location AI usage. baseline = the run's own first reading (null on that first read, which never stops on its size).
// stop = true when the read fails, or when usage is more than METER_DELTA over the baseline.
export async function boundaryMeter({ call, label, logPath = null, loc = '', baseline = null }) {
  const r = await call('raw_request', { method: 'GET', path: `/ai-wrapper/usage/limits/location?locationId=${loc}` });
  const usage = typeof r?.data?.json?.data?.usage === 'number' ? r.data.json.data.usage : null;
  const stop = usage === null || (baseline !== null && usage - baseline > METER_DELTA + 1e-9);
  const rec = { at: new Date().toISOString(), label, usage, baseline, delta: METER_DELTA, stop };
  if (logPath) appendFileSync(logPath, JSON.stringify(rec) + '\n');
  return rec;
}

// A URL for the log with the query string and fragment dropped: a signed file URL carries its credentials in the query. Host + path only.
export function safeUrl(u) {
  try { const x = new URL(String(u)); return `${x.host}${x.pathname}`; } catch { return '(unparseable url)'; }
}
