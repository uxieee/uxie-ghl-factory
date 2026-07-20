const BACKEND = 'https://backend.leadconnectorhq.com';

// The shipped CLIs own this thin transport adapter. Reusable memberships
// behavior lives in engine/*.mjs and only talks through gw.call.
export function makeCliMembershipsGateway({ token, loc, uid, fetchImpl = fetch }) {
  if (!token) throw new Error('token required');
  if (!loc) throw new Error('locationId required');

  const call = async (method, path, body, baseOrOptions = BACKEND) => {
    const options = typeof baseOrOptions === 'string'
      ? { base: baseOrOptions }
      : (baseOrOptions ?? {});
    const headers = options.unauthenticated
      ? {}
      : {
          channel: 'APP',
          source: 'WEB_USER',
          version: '2021-07-28',
          accept: 'application/json, text/plain, */*',
        };
    for (const [rawName, value] of Object.entries(options.headers ?? {})) {
      if (value === undefined || value === null) continue;
      const name = rawName.toLowerCase();
      if (name === 'authorization' || name === 'token-id') continue;
      headers[name] = value;
    }
    if (!options.unauthenticated) headers.authorization = `Bearer ${token}`;
    if (body !== undefined && !options.rawBody && headers['content-type'] === undefined) {
      headers['content-type'] = 'application/json';
    }

    const response = await fetchImpl((options.base ?? BACKEND) + path, {
      method,
      headers,
      body: body === undefined ? undefined : (options.rawBody ? body : JSON.stringify(body)),
    });
    const text = await response.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: response.status, ok: response.ok, json };
  };

  return {
    call,
    loc,
    uid,
    capabilities: { unauthenticatedRawUpload: true },
  };
}
