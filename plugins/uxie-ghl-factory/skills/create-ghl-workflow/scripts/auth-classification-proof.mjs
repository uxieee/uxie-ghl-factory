// LIVE: a 401 from ONE endpoint, on a credential that is demonstrably alive, is reported as
// ACCESS_DENIED, not TOKEN_EXPIRED (console bl-059). TOKEN_EXPIRED's remediation sends a human to a
// browser login, which cannot fix an endpoint that refuses this credential class. Fixture: GET
// /locations/search, which answers a bare 401 to a location credential (re-measured 2026-09-23; with a
// companyId it answers 403 'Forbidden resource' instead). CONTROL: a known-good read on either side.
export async function runAuthClassificationProof({ call, check, log = null }) {
  const subject = (s) => log?.subject?.(s);
  subject('list_workflow_folders');
  const before = await call('list_workflow_folders', {});
  subject('raw_request');
  const r = await call('raw_request', { method: 'GET', path: '/locations/search' });
  subject('list_workflow_folders');
  const after = await call('list_workflow_folders', {});
  subject(false);
  check(before.ok === true && after.ok === true, 'CONTROL: the credential is alive on both sides of the refused call', `${before.code ?? 'ok'} / ${after.code ?? 'ok'}`);
  check(r.ok === false && r.code === 'ACCESS_DENIED' && /"statusCode":401/.test(String(r.detail)),
    'a bare 401 from one endpoint on a live credential is ACCESS_DENIED (do not re-capture), not TOKEN_EXPIRED', `${r.code} ${String(r.detail).slice(0, 160)}`);
}
