// GHL's SERVER-side validation verdicts, parsed. Discovered 2026-08-22 via the builder's own
// adapter (recovered-source src/utils/server-validation-error-mapper.ts): the workflow
// save/update API returns a UNIFORM machine-readable payload on validation failure —
//
//   { errorMetadata: { validationFailure: true,
//       validationType: 'action'|'trigger'|'structural'|'value'|'asset',
//       errors: [{ message, ruleId?, severity?, stepId?, stepName?, stepType?,
//                  triggerId?, triggerName?, triggerType?, source?, assetType?, assetId? }] } }
//
// (a legacy `steps: [{stepId, errors: [], rule}]` shape still exists; normalized here too).
// The same finding shape comes back from POST /workflow/{loc}/validate-assets
// (ASSET_CALENDAR_NOT_FOUND etc., differentially proven on GROM AU 2026-08-22).
//
// This turns "HTTP 4xx during save" from an opaque failure into named, attributed findings —
// the server is the LAST oracle in the chain (client rules → asset pre-flight → server verdict).

/** Parse a response body for a server validation payload. Returns null when it isn't one. */
export function parseServerValidation(json) {
  const meta = json?.errorMetadata ?? (json?.response?.data?.errorMetadata);
  if (!meta || meta.validationFailure !== true) return null;
  const findings = (meta.errors?.length ? meta.errors
    : (meta.steps ?? []).flatMap((s) => (s.errors ?? []).map((message) => ({ message, ruleId: s.rule, stepId: s.stepId, stepName: s.stepName, stepType: s.stepType, source: s.source }))))
    .map((e) => ({
      message: e.message, ruleId: e.ruleId, severity: e.severity === 'warning' ? 'warning' : 'error',
      where: e.triggerId || e.source === 'trigger' || meta.validationType === 'trigger'
        ? `trigger '${e.triggerName ?? e.stepName ?? e.triggerId ?? e.stepId ?? '?'}' (${e.triggerType ?? e.stepType ?? '?'})`
        : `step '${e.stepName ?? e.stepId ?? '?'}' (${e.stepType ?? '?'})`,
      ...(e.assetType ? { assetType: e.assetType } : {}), ...(e.assetId ? { assetId: e.assetId } : {}),
    }));
  return findings.length ? { validationType: meta.validationType, findings } : null;
}

/** One line per finding, for abort messages and CLI output. */
export function describeServerFindings(parsed) {
  return parsed.findings.map((f) =>
    `${f.severity === 'warning' ? '⚠' : '✖'} ${f.where}: ${f.message}${f.ruleId ? ` [${f.ruleId}]` : ''}${f.assetType ? ` (asset: ${f.assetType}${f.assetId ? ' ' + f.assetId : ''})` : ''}`).join('; ');
}
