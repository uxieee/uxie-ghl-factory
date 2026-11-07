import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Communities } from './communities.mjs';

// W5b Task 9 (brand-blogs-communities-wave-2026-10-30 §5): the create form gained a Discovery switch (default ON); OFF sends no
// marketplaceLocationId and the group stays off the public marketplace. createGroup always sent it, so it could not make an
// unlisted group.
const fake = () => { const calls = []; return { calls, api: { loc: 'LOC', req: async (m, u, b) => { calls.push({ m, u, b }); return {}; } } }; };

test('createGroup lists the group on the marketplace by default, as the UI does', async () => {
  const { calls, api } = fake();
  await new Communities(api).createGroup({ name: 'G', slug: 'g' });
  assert.ok(calls[0].b.marketplaceLocationId);
});

test('createGroup with discovery:false sends no marketplaceLocationId', async () => {
  const { calls, api } = fake();
  await new Communities(api).createGroup({ name: 'G', slug: 'g', discovery: false });
  assert.equal('marketplaceLocationId' in calls[0].b, false);
});
