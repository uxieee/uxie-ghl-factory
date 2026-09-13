// The proof record's schema. VALIDATED BY ALLOWLIST: every field has a declared format and anything
// else is refused. This repo is public, and shape-matching ids is a gate that has already failed here
// (20-24 char ids collide with ordinary words); a schema with no free-text field cannot carry one.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Frozen at `external-receipt-required` by MI/test/tools.test.mjs and governed by core/audit-proof.mjs's
// own expiring receipt chain. No record is written for them and no label is synced onto them.
export const AUDIT_COMPOSITES = Object.freeze(['get_workflow_runtime_window', 'list_workflows_complete', 'get_ai_configuration_bundle']);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOOL = /^[a-z0-9_]+$/;
const SURFACE = /^[a-z0-9-]+$/;
const EVIDENCE = /^(?:receipt:\d{4}-\d{2}-\d{2}-\d{4}|ledger:[a-z0-9-]+#[a-z0-9-]+|corpus:[a-z0-9-]+\/[A-Za-z0-9._/-]+|row:[a-z0-9_-]+|commit:[0-9a-f]{7,40})$/;
const LOCATION = /^…[A-Za-z0-9]{4}$/;
const ASSERTION = /^[a-z0-9-]{1,80}$/;
const SUITE = /^[a-z0-9-]+$/;
const ENDPOINT = /^(?:GET|POST|PUT|PATCH|DELETE) https:\/\/[a-z0-9.-]+ \/\S*$/;
const HEX = /^[0-9a-f]{64}$/;
const APP = /^[A-Za-z0-9_-]+$/;
const BUILD = /^[A-Za-z0-9_./-]{1,80}$/;
const CODEKEY = /^[A-Za-z0-9_./-]+(?:#[a-z0-9_]+)?$/;

const keysOnly = (obj, allowed, where, errs) => {
  for (const k of Object.keys(obj ?? {})) if (!allowed.includes(k)) errs.push(`${where}: unknown key "${k}"`);
};

export function validateRecord(rec) {
  const errs = [];
  if (!rec || typeof rec !== 'object') return ['record is not an object'];
  keysOnly(rec, ['tool', 'surfaces', 'runs', 'depends'], 'record', errs);
  if (!TOOL.test(rec.tool ?? '')) errs.push('tool: not a tool name');
  if (AUDIT_COMPOSITES.includes(rec.tool)) errs.push(`${rec.tool}: an audit composite — governed by core/audit-proof.mjs, never a proof record`);
  if (!Array.isArray(rec.surfaces) || !rec.surfaces.length || !rec.surfaces.every((s) => SURFACE.test(s))) errs.push('surfaces: a non-empty list of surface names');
  if (!Array.isArray(rec.runs) || !rec.runs.length) errs.push('runs: at least one run');
  (rec.runs ?? []).forEach((r, i) => {
    const w = `runs[${i}]`;
    keysOnly(r, ['at', 'result', 'how', 'proofClass', 'suite', 'evidence', 'location', 'failures', 'backfilled'], w, errs);
    if (!DATE.test(r.at ?? '')) errs.push(`${w}.at: YYYY-MM-DD`);
    if (!['pass', 'fail'].includes(r.result)) errs.push(`${w}.result: pass | fail`);
    if (!['suite', 'manual'].includes(r.how)) errs.push(`${w}.how: suite | manual`);
    if (r.proofClass !== undefined && !['live-runtime', 'live-canary'].includes(r.proofClass)) errs.push(`${w}.proofClass: live-runtime | live-canary`);
    if (r.suite !== undefined && !SUITE.test(r.suite)) errs.push(`${w}.suite: a suite name`);
    if (!Array.isArray(r.evidence) || !r.evidence.every((e) => EVIDENCE.test(e))) errs.push(`${w}.evidence: only receipt: ledger: corpus: row: commit: references`);
    if (r.location !== undefined && !LOCATION.test(r.location)) errs.push(`${w}.location: last four characters only, as …abcd`);
    if (r.failures !== undefined && !(Array.isArray(r.failures) && r.failures.every((f) => ASSERTION.test(f)))) errs.push(`${w}.failures: assertion ids`);
    if (r.backfilled !== undefined && r.backfilled !== true) errs.push(`${w}.backfilled: true or absent`);
  });
  const d = rec.depends ?? {};
  keysOnly(d, ['hashedAt', 'endpoints', 'builds', 'code'], 'depends', errs);
  if (!DATE.test(d.hashedAt ?? '')) errs.push('depends.hashedAt: YYYY-MM-DD');
  for (const [k, v] of Object.entries(d.endpoints ?? {})) if (!ENDPOINT.test(k) || !HEX.test(v)) errs.push(`depends.endpoints: bad entry "${k}"`);
  for (const [k, v] of Object.entries(d.builds ?? {})) {
    if (!APP.test(k) || !(v === null || Number.isInteger(v) || (typeof v === 'string' && BUILD.test(v)))) errs.push(`depends.builds: bad entry "${k}"`);
  }
  for (const [k, v] of Object.entries(d.code ?? {})) if (!CODEKEY.test(k) || !HEX.test(v)) errs.push(`depends.code: bad entry "${k}"`);
  return errs;
}

export const latestRun = (rec) => rec.runs.at(-1);
export const latestPass = (rec) => [...rec.runs].reverse().find((r) => r.result === 'pass') ?? null;

export function labelFor(rec) {
  const last = latestRun(rec);
  if (last.result === 'fail') return `failing (${last.at})`;
  return `${last.proofClass ?? 'live-runtime'} (${last.at})`;
}

export function loadRecords(dir) {
  if (!existsSync(dir)) return {};
  return Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))).map((r) => [r.tool, r]));
}

export const failingTools = (dir) => Object.values(loadRecords(dir))
  .filter((r) => latestRun(r).result === 'fail').map((r) => r.tool).sort();
