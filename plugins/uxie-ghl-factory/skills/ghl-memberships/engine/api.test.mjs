import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GhlMembershipsApi } from './api.mjs';
import { Assessments } from './assessments.mjs';
import { Credentials } from './credentials.mjs';
import { Members } from './members.mjs';
import { Communities } from './communities.mjs';

function stubGateway(responses = []) {
  const calls = [];
  return {
    loc: 'LOC1',
    uid: 'USER1',
    calls,
    async call(method, path, body, options) {
      calls.push({ method, path, body, options });
      return responses.shift() ?? { status: 200, ok: true, json: {} };
    },
  };
}

test('membership API routes backend, courses, services and credential traffic through gw.call', async () => {
  const gw = stubGateway([
    { status: 200, ok: true, json: { products: [] } },
    { status: 200, ok: true, json: { users: [] } },
    { status: 200, ok: true, json: { templates: [] } },
    { status: 200, ok: true, json: { submissions: [] } },
  ]);
  const api = new GhlMembershipsApi({ gw });

  await api.listProducts();
  await new Members(api).listPortalUsers();
  await new Credentials(api).listTemplates();
  await new Assessments(api).listSubmissions();

  assert.deepEqual(gw.calls.map(({ method, path, options }) => ({ method, path, options })), [
    {
      method: 'GET',
      path: '/membership/locations/LOC1/products?doNotIncludeOffers=true&sendCustomizations=true',
      options: { base: 'https://backend.leadconnectorhq.com', headers: { sourceid: 'LOC1' } },
    },
    {
      method: 'GET',
      path: '/clientclub/LOC1/users/search-users?searchText=&pageNo=1&limit=50',
      options: { base: 'https://services.leadconnectorhq.com', headers: { sourceid: 'LOC1' } },
    },
    {
      method: 'GET',
      path: '/certificates/locations/LOC1/templates?skip=0&limit=50&search=',
      options: { base: 'https://backend.leadconnectorhq.com', headers: { sourceid: 'LOC1' } },
    },
    {
      method: 'GET',
      path: '/membership/locations/LOC1/assessments/quiz/assessmentStatus/location/submission?pageNumber=1&pageSize=20&searchText=',
      options: { base: 'https://services.leadconnectorhq.com', headers: { sourceid: 'LOC1' } },
    },
  ]);
});

test('gateway failures preserve CLI throwing behavior and the structured response', async () => {
  const response = { status: 422, ok: false, json: { message: 'bad spec' } };
  const api = new GhlMembershipsApi({ gw: stubGateway([response]) });

  await assert.rejects(api.createProduct({ title: 'bad' }), (error) => {
    assert.match(error.message, /422 on POST/);
    assert.equal(error.gatewayResponse, response);
    return true;
  });
});

test('member community rail uses an injected gateway with PORTAL_USER headers', async () => {
  const adminGw = stubGateway();
  const memberGw = stubGateway([{ status: 200, ok: true, json: [] }]);
  const member = new Communities(new GhlMembershipsApi({ gw: adminGw }))
    .asMember({ gw: memberGw, groupId: 'GROUP1' });

  await member.channels();
  assert.deepEqual(memberGw.calls[0], {
    method: 'GET',
    path: '/clientportal-middleware/communities/LOC1/groups/GROUP1/channels',
    body: undefined,
    options: {
      base: 'https://services.leadconnectorhq.com',
      headers: {
        source: 'PORTAL_USER',
        version: '2023-02-21',
        'x-location-id': 'LOC1',
        'x-group-id': 'GROUP1',
        'x-platform-details': 'web',
        'x-app-version': 'web',
        accept: 'application/json',
        'content-type': 'application/json',
      },
    },
  });
});

test('local media fails closed before filesystem access on a gateway without raw-upload support', async () => {
  const api = new GhlMembershipsApi({ gw: stubGateway() });
  await assert.rejects(
    api.uploadMaterial({ filePath: '/does/not/exist.pdf', postId: 'POST1' }),
    (error) => error.code === 'LOCAL_MEDIA_UNAVAILABLE',
  );
});

// ── w8-7: createOffer refuses a paid offer with no explicit amount and currency (QA review focus 5) ──────────────────────
test('w8-7: a paid offer with no explicit currency is refused, not created as EUR', async () => {
  const gw = stubGateway([{ status: 201, ok: true, json: { id: 'OFFER1' } }]);
  const api = new GhlMembershipsApi({ gw });
  assert.throws(() => api.createOffer({ title: 'Paid', productIds: ['P1'], type: 'onetime', amount: 10 }), /currency/);
  assert.equal(gw.calls.length, 0, 'no account call when refused');
});

test('w8-7: a paid offer with amount 0 or no amount is refused', async () => {
  const gw = stubGateway([{ status: 201, ok: true, json: { id: 'OFFER1' } }]);
  const api = new GhlMembershipsApi({ gw });
  assert.throws(() => api.createOffer({ title: 'Paid', productIds: ['P1'], type: 'onetime', amount: 0, currency: 'EUR' }), /amount/);
  assert.throws(() => api.createOffer({ title: 'Paid', productIds: ['P1'], type: 'onetime', currency: 'EUR' }), /amount/);
  assert.equal(gw.calls.length, 0);
});

test('w8-7: free stays the default, and carries an explicit zero amount and EUR', async () => {
  const gw = stubGateway([{ status: 201, ok: true, json: { id: 'OFFER1' } }]);
  const api = new GhlMembershipsApi({ gw });
  await api.createOffer({ title: 'Free', productIds: ['P1'] });
  assert.equal(gw.calls[0].body.type, 'free');
  assert.equal(gw.calls[0].body.amount, 0);
  assert.equal(gw.calls[0].body.currency, 'EUR');
});

test('w8-7: a subscription carries its interval and an explicit amount and currency', async () => {
  const gw = stubGateway([{ status: 201, ok: true, json: { id: 'OFFER1' } }]);
  const api = new GhlMembershipsApi({ gw });
  await api.createOffer({ title: 'Sub', productIds: ['P1'], type: 'subscription', amount: 10, currency: 'GBP', interval: 'month', intervalCount: 1 });
  assert.equal(gw.calls[0].body.type, 'subscription');
  assert.equal(gw.calls[0].body.interval, 'month');
  assert.equal(gw.calls[0].body.currency, 'GBP');
  assert.equal(gw.calls[0].body.amount, 10);
});
