import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCliMembershipsGateway } from './cli-gateway.mjs';

const response = (body = '{}') => ({ status: 200, ok: true, text: async () => body });

test('CLI gateway preserves authenticated memberships calls and sourceid', async () => {
  const calls = [];
  const gw = makeCliMembershipsGateway({
    token: 'fixture.jwt.signature',
    loc: 'LOC1',
    uid: 'USER1',
    fetchImpl: async (url, init) => { calls.push({ url, init }); return response(); },
  });

  await gw.call('POST', '/membership/locations/LOC1/products', { title: 'Course' }, {
    base: 'https://backend.leadconnectorhq.com',
    headers: { sourceid: 'LOC1' },
  });

  assert.equal(calls[0].init.headers.authorization, 'Bearer fixture.jwt.signature');
  assert.equal(calls[0].init.headers.sourceid, 'LOC1');
  assert.equal(calls[0].init.body, '{"title":"Course"}');
});

test('CLI gateway supports the engine raw signed-upload rail without app auth', async () => {
  const calls = [];
  const bytes = Buffer.from('media');
  const gw = makeCliMembershipsGateway({
    token: 'fixture.jwt.signature',
    loc: 'LOC1',
    uid: 'USER1',
    fetchImpl: async (url, init) => { calls.push({ url, init }); return response('uploaded'); },
  });

  await gw.call('PUT', '/signed/path?signature=x', bytes, {
    base: 'https://storage.googleapis.com',
    headers: { 'content-type': 'video/mp4' },
    signedUpload: true,
  });

  assert.equal(gw.capabilities.unauthenticatedRawUpload, true);
  assert.equal(calls[0].init.headers.authorization, undefined);
  assert.deepEqual(calls[0].init.headers, { 'content-type': 'video/mp4' });
  assert.equal(calls[0].init.body, bytes);
});
