// bl-1021 run hygiene (orchestrator 2026-11-10, after run 5 crashed partway with an uncaught GHL connect timeout and left two TEST-CONF
// workflows published, because a crash skips every finally):
//   1. sweepPublishedTestConf: at the START of a run, unpublish every TEST-CONF workflow that is published, and read each back as draft
//      on a separate GET. Only TEST-CONF names are touched.
//   2. boundaryMeter: read the location AI usage raw at a section boundary, log it, and say whether to stop (past METER_CEILING).
//   3. callSafe: a transport failure (connect timeout, reset) is a reported failure with code TRANSPORT_FAILED, never an uncaught crash.
//      Read-only calls are retried; a write is never retried, because it may have landed.

import { appendFileSync } from 'node:fs';

export const METER_CEILING = 9.38;
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

export async function sweepPublishedTestConf({ call, check, sinceIso }) {
  const listed = await call('list_workflows', { updatedAfter: sinceIso, pageSize: 100, maxPages: 20, limit: 500 });
  const rows = listed?.data?.workflows ?? [];
  const published = rows.filter((w) => /^TEST-CONF/.test(w.name ?? '') && w.status === 'published');
  const targets = published.filter((w) => SUITE_FLOW_NAME.test(w.name));
  const otherPublished = published.filter((w) => !SUITE_FLOW_NAME.test(w.name)).map((w) => ({ id: w.id, name: w.name }));
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

// Boundary read: the raw location AI usage. stop = true when the read fails or the usage is past METER_CEILING.
export async function boundaryMeter({ call, label, logPath = null, loc = '' }) {
  const r = await call('raw_request', { method: 'GET', path: `/ai-wrapper/usage/limits/location?locationId=${loc}` });
  const usage = typeof r?.data?.json?.data?.usage === 'number' ? r.data.json.data.usage : null;
  const stop = usage === null || usage > METER_CEILING;
  const rec = { at: new Date().toISOString(), label, usage, ceiling: METER_CEILING, stop };
  if (logPath) appendFileSync(logPath, JSON.stringify(rec) + '\n');
  return rec;
}
