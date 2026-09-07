import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Members } from './members.mjs';

// `attach-offer-user` returns 200 {ok:true, msg:"…successfully queued"} for an EMPTY body and for
// fabricated ids — live-proven on the test sub-account 2026-09-07, with a nonexistent sibling path
// answering 404 to show the 200 is that route replying and not a catch-all. So the only thing that
// knows whether a grant landed is the user-progress read-back, and the only read-back that knows
// anything is one that looks for the contacts it granted.

const membersWith = (pages) => {
  let i = 0;
  const calls = [];
  const api = {
    loc: 'LOC',
    M: 'https://services.example/membership/locations/LOC',
    req: async (method, url) => {
      calls.push(`${method} ${url}`);
      const page = pages[Math.min(i, pages.length - 1)];
      i += 1;
      return page;
    },
  };
  return { m: new Members(api), calls };
};

test('the grant body is singular contactId plus source:admin — not contactIds, not locationId', async () => {
  // Another operator sent {locationId, offerId, contactIds:[…]}, got the same cheerful 200, and
  // granted nothing. Undeclared keys fall through; the declared one simply arrives absent.
  const sent = [];
  const api = { loc: 'LOC', M: 'M', req: async (method, url, body) => { sent.push({ method, url, body }); return { ok: true }; } };
  await new Members(api).grantOffer({ contactId: 'C1', offerId: 'O1' });
  assert.equal(sent[0].method, 'POST');
  assert.match(sent[0].url, /\/membership\/smart-list\/attach-offer-user$/);
  assert.deepEqual(sent[0].body, { contactId: 'C1', offerId: 'O1', source: 'admin' });
  assert.ok(!('locationId' in sent[0].body), 'the location comes from the sourceid header, not the body');
});

test('waitForEnrollment with expected ids does NOT accept somebody else’s row', async () => {
  // The bug this closes: a non-empty check passes on a product that already has members, so a
  // grant that never landed reads as confirmed. Here the product has one enrolled member and the
  // contact we granted never appears.
  const { m } = membersWith([[{ userId: 'U9', contactId: 'SOMEONE_ELSE' }]]);
  await assert.rejects(
    () => m.waitForEnrollment('P1', { timeoutMs: 30, intervalMs: 10, expectContactIds: ['C1'] }),
    /1 of 1 contact\(s\) still absent.*C1/,
  );
});

test('…and does not accept a PARTIAL landing as a whole one', async () => {
  // Granting three and seeing one appear satisfied the old check immediately.
  const { m } = membersWith([[{ contactId: 'C1' }]]);
  await assert.rejects(
    () => m.waitForEnrollment('P1', { timeoutMs: 30, intervalMs: 10, expectContactIds: ['C1', 'C2', 'C3'] }),
    /2 of 3 contact\(s\) still absent.*C2, C3/,
  );
});

test('it resolves as soon as every expected contact is present, and returns the rows', async () => {
  const { m, calls } = membersWith([
    [],
    [{ contactId: 'C1' }],
    [{ contactId: 'C1' }, { contactId: 'C2' }, { contactId: 'OTHER' }],
  ]);
  const rows = await m.waitForEnrollment('P1', { timeoutMs: 5000, intervalMs: 1, expectContactIds: ['C1', 'C2'] });
  assert.equal(rows.length, 3, 'the caller gets the whole page, extra members included');
  assert.equal(calls.length, 3, 'it polled until both were there, not until the list was non-empty');
});

test('ids are compared as strings and de-duplicated', async () => {
  const { m } = membersWith([[{ contactId: 'C1' }]]);
  const rows = await m.waitForEnrollment('P1', { timeoutMs: 50, intervalMs: 1, expectContactIds: ['C1', 'C1'] });
  assert.equal(rows.length, 1);
});

test('with no expected ids the old non-empty behaviour is kept', async () => {
  // A caller with no ids to hand has nothing better. It is the weaker check and the doc says so.
  const { m } = membersWith([[{ contactId: 'ANYONE' }]]);
  const rows = await m.waitForEnrollment('P1', { timeoutMs: 50, intervalMs: 1 });
  assert.equal(rows.length, 1);
});

test('a non-array progress response is treated as no rows, not as a crash', async () => {
  const { m } = membersWith([{ error: 'nope' }]);
  await assert.rejects(() => m.waitForEnrollment('P1', { timeoutMs: 30, intervalMs: 10, expectContactIds: ['C1'] }), /still absent/);
});
