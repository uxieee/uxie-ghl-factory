import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';

// create_smart_list exists for exactly one reason: `filterSpecs.filters` must be nested TWO levels
// and nothing in any API response says so. A one-level envelope — the shape POST /contacts/search/2
// takes, and the shape any reasonable caller writes — is accepted with a 201, reads back
// byte-identical, returns the correct rows from the search endpoint, and is then discarded by the
// contacts screen, which renders the ENTIRE account to the operator.
//
// So the caller never supplies the envelope. These tests pin that the builder emits the canonical
// shape, that it refuses the inputs which would produce a silently-broken list, and — the one that
// matters most — that whatever it emits, check_smart_lists calls healthy. Two tools holding two
// copies of this rule is how this surface goes wrong twice.

const create = TOOLS.find((t) => t.name === 'create_smart_list');
const audit = TOOLS.find((t) => t.name === 'check_smart_lists');

// Verbatim from the corpus page: a list a human built in the interface, read straight back through
// GET /contacts/smartlist/{id}. The builder's output is compared against this, byte for byte.
const CANONICAL_FILTERS = [{
  group: 'OR',
  filters: [{
    group: 'AND',
    filters: [{ field: 'tags', operator: 'eq', value: ['test-contact'], options: { minimumMatch: 'all' } }],
  }],
}];

const TAG_CONDITION = { field: 'tags', operator: 'eq', value: ['test-contact'], options: { minimumMatch: 'all' } };

/**
 * A gateway that records what was written. `matched`/`total` drive the search differential;
 * `created` captures the POST body so the envelope can be asserted; the detail read replays it,
 * which is what the real store does — it accepts and returns whatever shape it is given.
 */
const gwFor = ({ customFields = [], matched = 25, total = 175, createStatus = 201, storedOverride = null } = {}) => {
  const seen = { created: null, searches: [] };
  const gw = {
    uid: 'USER1',
    seen,
    call: async (method, path, body) => {
      if (method === 'GET' && path.startsWith('/locations/')) {
        return { ok: true, status: 200, json: { customFields } };
      }
      if (method === 'POST' && path === '/contacts/search/2') {
        seen.searches.push(body);
        const isControl = Array.isArray(body.filters) && body.filters.length === 0;
        return { ok: true, status: 200, json: { total: isControl ? total : matched } };
      }
      if (method === 'POST' && path === '/contacts/smartlist/') {
        seen.created = body;
        if (createStatus !== 201) return { ok: false, status: createStatus, json: { message: 'nope' } };
        return { ok: true, status: 201, json: { smartList: { id: 'NEWLIST', userId: 'USER1' } } };
      }
      const m = path.match(/^\/contacts\/smartlist\/([^?]+)$/);
      if (m && method === 'GET') {
        if (!seen.created) return { ok: false, status: 400, json: { message: 'Invalid SmartList id' } };
        return {
          ok: true,
          status: 200,
          json: { smartList: { id: 'NEWLIST', listName: seen.created.listName, filterSpecs: storedOverride ?? seen.created.filterSpecs } },
        };
      }
      throw new Error(`unexpected call ${method} ${path}`);
    },
    readBackUntil: async (fn) => {
      const hit = await fn();
      return { hit, attempts: 1 };
    },
  };
  return gw;
};

const run = (args = {}, opts = {}) => {
  const gw = gwFor(opts);
  return create.handler(
    { locationId: 'LOC', listName: 'Test list', outerMatch: 'OR', ...args },
    { state: {}, makeGw: () => gw },
  ).then((r) => ({ r, gw }));
};

test('the builder emits the canonical TWO-level envelope, byte for byte', async () => {
  const { r, gw } = await run({ conditions: [TAG_CONDITION], confirm: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(gw.seen.created.filterSpecs.filters, CANONICAL_FILTERS);
  // page and limit ride along exactly as the UI writes them.
  assert.equal(gw.seen.created.filterSpecs.page, 1);
  assert.equal(gw.seen.created.filterSpecs.limit, 20);
});

test('the field is listName — `name` is refused outright by the DTO validator', async () => {
  const { r } = await run({ listName: '   ', conditions: [TAG_CONDITION], confirm: true });
  assert.equal(r.ok, false);
  assert.match(r.remediation, /`listName`, not `name`/);
});

test('an empty filter is refused, and named as "show every contact"', async () => {
  // The screen's Copy/Save-as path produces exactly this, and it is the second most common way a
  // list ends up showing the whole account. It must never be something this tool writes.
  const { r, gw } = await run({ conditions: [], confirm: true });
  assert.equal(r.ok, false);
  assert.match(r.detail, /at least one condition/);
  assert.match(r.remediation, /SHOW EVERY CONTACT/);
  assert.equal(gw.seen.created, null, 'nothing may be written');
});

test('a condition with no field is refused before any write', async () => {
  const { r, gw } = await run({ conditions: [{ operator: 'eq', value: 'x' }], confirm: true });
  assert.equal(r.ok, false);
  assert.match(r.detail, /have no 'field'/);
  assert.equal(gw.seen.created, null);
});

test('a field the account does not offer is REFUSED, not warned about', async () => {
  // The contacts screen drops a filter naming an unknown field and renders the whole account, and
  // the record still reads back perfectly. Creating one would manufacture the exact state
  // check_smart_lists exists to find, so this is a hard refusal.
  const { r, gw } = await run({ conditions: [{ field: 'custom_fields.doesnotexist', operator: 'eq', value: 'x' }], confirm: true });
  assert.equal(r.ok, false);
  assert.match(r.detail, /not in this account's filter-field catalogue/);
  assert.match(r.remediation, /WHOLE account/);
  assert.equal(gw.seen.created, null, 'nothing may be written');
});

test('a custom field that DOES exist on the account is accepted', async () => {
  const { r, gw } = await run(
    { conditions: [{ field: 'custom_fields.CF1', operator: 'eq', value: 'x' }], confirm: true },
    { customFields: [{ id: 'CF1', dataType: 'TEXT' }] },
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(gw.seen.created.filterSpecs.filters[0].filters[0].filters[0].field, 'custom_fields.CF1');
});

test('a FILE_UPLOAD custom field is refused — the builder excludes it, so the screen drops it', async () => {
  const { r } = await run(
    { conditions: [{ field: 'custom_fields.CF2', operator: 'eq', value: 'x' }], confirm: true },
    { customFields: [{ id: 'CF2', dataType: 'FILE_UPLOAD' }] },
  );
  assert.equal(r.ok, false);
  assert.match(r.detail, /custom_fields\.CF2/);
});

test('a TEXTBOX_LIST account degrades to unverified rather than blocking a real create', async () => {
  // A TEXTBOX_LIST field contributes one key per OPTION id and none for itself, and the customFields
  // read returns picklistOptions as bare strings with no ids — so those keys cannot be enumerated.
  // Refusing them would block legitimate filters; it goes through with the doubt stated.
  const { r } = await run(
    { conditions: [{ field: 'custom_fields.UNKNOWNOPT', operator: 'eq', value: 'x' }], confirm: true },
    { customFields: [{ id: 'CF3', dataType: 'TEXTBOX_LIST' }] },
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.data.unverifiedFields, ['custom_fields.UNKNOWNOPT']);
});

test('preview is the default and sends no write', async () => {
  const { r, gw } = await run({ conditions: [TAG_CONDITION] });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'CONFIRM_REQUIRED');
  assert.equal(gw.seen.created, null);
  assert.deepEqual(r.data.preview.creates.filterSpecs.filters, CANONICAL_FILTERS);
  assert.match(r.data.preview.removal, /no delete on this rail/);
});

test('the search differential runs before the write and reports matched against the account total', async () => {
  const { r, gw } = await run({ conditions: [TAG_CONDITION] }, { matched: 25, total: 175 });
  assert.equal(r.data.preview.differential.matched, 25);
  assert.equal(r.data.preview.differential.accountTotal, 175);
  // A control with no filters is what makes the number mean anything.
  assert.equal(gw.seen.searches.length, 2);
  assert.deepEqual(gw.seen.searches[1].filters, []);
  assert.equal(gw.seen.searches[0].pageLimit, 0, 'pageLimit 0 returns the count alone');
  assert.equal(gw.seen.searches[0].includeTotal, true, 'without includeTotal there is no total');
});

test('a filter matching every contact is called out — it is not filtering', async () => {
  const { r } = await run({ conditions: [TAG_CONDITION] }, { matched: 175, total: 175 });
  assert.match(r.data.preview.differential.warning, /matches EVERY contact/);
});

test('the search preflight uses the SEARCH envelope, which is deliberately not the stored one', async () => {
  // One group holding leaves is right for /contacts/search/2 and wrong for a smart list. Carrying
  // one envelope across to the other is the original bug; they are built separately on purpose.
  const { r, gw } = await run({ conditions: [TAG_CONDITION], confirm: true });
  assert.equal(r.ok, true);
  assert.deepEqual(gw.seen.searches[0].filters, [{ group: 'AND', filters: [TAG_CONDITION] }]);
  assert.deepEqual(gw.seen.created.filterSpecs.filters, CANONICAL_FILTERS);
});

test('groups let several conditions be combined without exposing the envelope', async () => {
  const { r, gw } = await run({
    groups: [
      { match: 'AND', conditions: [TAG_CONDITION] },
      { match: 'AND', conditions: [{ field: 'email', operator: 'exists' }] },
    ],
    outerMatch: 'OR',
    confirm: true,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  const built = gw.seen.created.filterSpecs.filters;
  assert.equal(built.length, 1);
  assert.equal(built[0].group, 'OR');
  assert.equal(built[0].filters.length, 2);
  assert.ok(built[0].filters.every((g) => g.group === 'AND' && Array.isArray(g.filters)));
});

test('conditions and groups together are refused rather than one silently winning', async () => {
  const { r } = await run({ conditions: [TAG_CONDITION], groups: [{ conditions: [TAG_CONDITION] }], confirm: true });
  assert.equal(r.ok, false);
  assert.match(r.detail, /not both/);
});

test('columns are {key, value, order} with key and value both the field name', async () => {
  const { r, gw } = await run({ conditions: [TAG_CONDITION], columns: ['name', 'tags'], confirm: true });
  assert.equal(r.ok, true);
  assert.deepEqual(gw.seen.created.columns, [
    { key: 'name', value: 'name', order: 0 },
    { key: 'tags', value: 'tags', order: 1 },
  ]);
});

test('a filter-DSL column spelling is warned about — it is stored and simply never renders', async () => {
  const { r } = await run({ conditions: [TAG_CONDITION], columns: ['contact_name', 'date_added'] });
  assert.match(r.data.preview.columnWarning, /contact_name → name/);
  assert.match(r.data.preview.columnWarning, /date_added → dateAdded/);
  assert.match(r.data.preview.columnWarning, /do not affect filtering/);
});

test('the read-back is judged structurally, and says what it does NOT prove', async () => {
  const { r } = await run({ conditions: [TAG_CONDITION], confirm: true });
  assert.equal(r.data.readBack, true);
  assert.equal(r.data.storedShape, 'ok');
  assert.equal(r.data.filterSpecsIdentical, true);
  assert.match(r.data.verification, /ONLY opening the list in a browser/);
});

test('a server that rewrote the envelope raises an alarm instead of reporting success', async () => {
  // The store returns whatever it is given, so this should never happen — but if it ever did, a
  // read-back that only checked for a 200 would call a broken list healthy.
  const { r } = await run(
    { conditions: [TAG_CONDITION], confirm: true },
    { storedOverride: { filters: [{ group: 'AND', filters: [TAG_CONDITION] }] } },
  );
  assert.equal(r.ok, true);
  assert.equal(r.data.storedShape, 'renders-everything');
  assert.match(r.data.alarm, /BROKEN \(one-level-nesting\)/);
  assert.equal(r.data.filterSpecsIdentical, false);
});

test('a create that returns 2xx without an id refuses to retry — there is no delete', async () => {
  const gw = gwFor();
  gw.call = async (method, path, body) => {
    if (method === 'POST' && path === '/contacts/smartlist/') return { ok: true, status: 201, json: {} };
    if (method === 'GET' && path.startsWith('/locations/')) return { ok: true, status: 200, json: { customFields: [] } };
    if (method === 'POST' && path === '/contacts/search/2') return { ok: true, status: 200, json: { total: 1 } };
    throw new Error(`unexpected ${method} ${path}`);
  };
  const r = await create.handler(
    { locationId: 'LOC', listName: 'X', conditions: [TAG_CONDITION], outerMatch: 'OR', confirm: true },
    { state: {}, makeGw: () => gw },
  );
  assert.equal(r.ok, false);
  assert.match(r.remediation, /a retry would create a second list/);
});

// ---------------------------------------------------------------------------------------------
// The cross-tool invariant. If these two ever disagree, one of them is lying to an operator about
// what the contacts screen will do, and no API response would reveal which.
// ---------------------------------------------------------------------------------------------
test('ROUND TRIP: what create_smart_list writes, check_smart_lists calls healthy', async () => {
  const { gw } = await run({ conditions: [TAG_CONDITION], confirm: true });
  const written = gw.seen.created;
  const auditGw = {
    uid: 'USER1',
    call: async (method, path) => {
      if (path.startsWith('/contacts/smartlist/search')) {
        return { ok: true, status: 200, json: { smartLists: [{ _id: 'NEWLIST', listName: written.listName }] } };
      }
      if (path.startsWith('/locations/')) return { ok: true, status: 200, json: { customFields: [] } };
      return { ok: true, status: 200, json: { smartList: { id: 'NEWLIST', listName: written.listName, filterSpecs: written.filterSpecs } } };
    },
  };
  const a = await audit.handler({ locationId: 'LOC' }, { state: {}, makeGw: () => auditGw });
  assert.equal(a.ok, true);
  assert.equal(a.data.checked, 1);
  assert.equal(a.data.rendersEverything, 0, 'the auditor must not flag what the builder writes');
  assert.equal(a.data.lists[0].verdict, 'ok');
});

test('ROUND TRIP: the multi-group envelope also passes the auditor', async () => {
  const { gw } = await run({
    groups: [{ conditions: [TAG_CONDITION] }, { conditions: [{ field: 'email', operator: 'exists' }] }],
    confirm: true,
  });
  const written = gw.seen.created;
  const auditGw = {
    uid: 'USER1',
    call: async (method, path) => {
      if (path.startsWith('/contacts/smartlist/search')) return { ok: true, status: 200, json: { smartLists: [{ _id: 'N' }] } };
      if (path.startsWith('/locations/')) return { ok: true, status: 200, json: { customFields: [] } };
      return { ok: true, status: 200, json: { smartList: { id: 'N', filterSpecs: written.filterSpecs } } };
    },
  };
  const a = await audit.handler({ locationId: 'LOC' }, { state: {}, makeGw: () => auditGw });
  assert.equal(a.data.rendersEverything, 0);
  assert.equal(a.data.lists[0].conditions, 2);
});
