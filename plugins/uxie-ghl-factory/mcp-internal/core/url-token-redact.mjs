// Redacts the token parameter of a signed URL (W10 bl-730, option (a) of the 2026-11-06 ruling).
//
// Only the FILES export_workflow writes (writeTo) and knowledge/sniffs go through this. Tool results keep signed URLs
// whole: a raw_request PUT of a workflow document needs the fileUrl it GOT, so redacting it there would break the
// round trip. A redacted fileUrl in an export file is refused by repair_workflow (refuseRedactedWrite), so it cannot be
// written back by mistake.
// Applied to every string, not only ones that START with http: a signed URL inside an HTML snippet or a longer string
// carries the same token. The parameter must be one of these names and the value 20 or more non-separator characters, the
// same rule as knowledge's redact-url-tokens.mjs; a
// short value in prose ("token=not-a-url") is not rewritten, because the value itself is what makes a token.
const TOKEN_PARAM = /([?&](?:token|access_token|signature|sig|x-amz-signature|x-goog-signature)=)[^&#\s"'<>]{20,}/gi;

export function redactUrlTokens(value) {
  if (typeof value === 'string') return value.replace(TOKEN_PARAM, '$1<redacted>');
  if (Array.isArray(value)) return value.map(redactUrlTokens);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactUrlTokens(v)]));
  }
  return value;
}
