// GHL's LIVE validator, asked BEFORE a write.
//
// server-validation.mjs parses the verdict the save API returns when a write has already failed.
// This asks the same validator the builder asks — POST /workflow/{loc}/{wid}/validate-workflows,
// which the builder calls debounced on every edit — about a document we have not sent yet. Proven
// on the sandbox 2026-09-11: it writes nothing (the document read back byte-identical after twelve
// calls), a 400 IS the verdict rather than a malformed request, and it names the rule, the step and
// the message.
//
// 🔴 IT IS NOT A SCHEMA CHECK, and must not be sold as one. Measured, same day:
//   caught      a missing required field · a scalar of the wrong type · an invalid enum value ·
//               a referenced asset that exists nowhere (layer `asset`) · every structural defect ·
//               a corrupted step type on a NATIVE workflow
//   NOT caught  an invented attribute key · a wrong inner attributes.type · an extra top-level step
//               key · a number out of range · a corrupted step type on an AGENT flow
// The engine's own guards cover that second row. This is an additional oracle, never a replacement.
//
// Re-measured 2026-09-12, after GHL shipped its publish gate: every verdict above is unchanged, and
// 🔴 this endpoint IGNORES the document's `status`. Draft and published get the same answer, and an
// EMPTY template list is valid:true even as 'published' — so checkEmptyPublish, and every other
// publish-only rule, exists only in the browser. write-validation.mjs replays them.
import { parseServerValidation, describeServerFindings } from './server-validation.mjs';

export const livePath = (loc, wid) => `/workflow/${encodeURIComponent(loc)}/${encodeURIComponent(wid)}/validate-workflows`;

/**
 * Ask the validator about a document.
 *
 * @param call   gateway `call(method, path, body) -> {ok, status, json}`
 * @param loc    location id
 * @param wid    the workflow the document belongs to (the path needs one; the body is what is judged)
 * @param document the stored document to judge, or the base to swap templates into
 * @param templates optional: judge THIS step array instead of the document's own
 * @param triggers  the workflow's triggers. 🔴 Sent as `newTriggers` because the document holds
 *                  none and the server validates triggers ONLY from that key: with it empty the
 *                  trigger layer is skipped and a workflow whose only defect is its trigger comes
 *                  back valid. Measured: action, structural and asset checks still run without it.
 * @returns {ran:false, why} when no verdict came back — a transport failure must not masquerade as
 *   a pass OR a fail; the caller reports it and decides. Otherwise {ran:true, valid, layer,
 *   findings[], warnings[], summary}.
 */
export async function liveValidate(call, loc, wid, { document, templates, triggers } = {}) {
  if (!loc || !wid || !document) return { ran: false, why: 'no location, workflow id or document to validate' };
  const body = { ...document, newTriggers: Array.isArray(triggers) ? triggers : [] };
  if (templates) body.workflowData = { ...(document.workflowData ?? {}), templates };
  let r;
  try { r = await call('POST', livePath(loc, wid), body); }
  catch (e) { return { ran: false, why: `the validator could not be reached: ${e?.message ?? e}` }; }
  const json = r?.json;
  if (!json || typeof json !== 'object' || typeof json.valid !== 'boolean') {
    return { ran: false, why: `the validator answered ${r?.status ?? '?'} with no verdict` };
  }
  const warnings = Array.isArray(json.assetWarnings) ? json.assetWarnings : [];
  if (json.valid) return { ran: true, valid: true, layer: null, findings: [], warnings, summary: 'valid' };
  const parsed = parseServerValidation(json);
  const findings = parsed?.findings ?? [{
    message: json.errorMessage ?? json.message ?? 'validation failed',
    severity: 'error',
    where: 'the workflow',
  }];
  return {
    ran: true,
    valid: false,
    // A failing call reports ONE layer: a structural or action failure is reported IN PLACE OF a
    // trigger failure the same document also has. Fix what it names and ask again.
    layer: parsed?.validationType ?? json.errorMetadata?.validationType ?? null,
    findings,
    warnings,
    summary: parsed ? describeServerFindings(parsed) : findings[0].message,
  };
}

/** Only the errors block a write; a warning is reported and carried. */
export const blocking = (verdict) => verdict?.ran === true && verdict.valid === false
  && verdict.findings.some((f) => f.severity !== 'warning');
