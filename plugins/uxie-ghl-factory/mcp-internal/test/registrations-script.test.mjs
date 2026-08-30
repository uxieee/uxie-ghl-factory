// These functions own ~/.claude.json, which holds every project's config on this machine. The
// exact-path rule is not style: stale /Users/<user>/Documents/... entries shadow the real ones and
// carry no mcpServers, so a suffix match silently selects the server-less twin. That cost 5 of 11
// registrations on the manual pass this module replaces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listRegistrations, findRegistration, setEnv, backupPath } from '../scripts/registrations.mjs';

const SERVER = 'uxie-ghl-internal-mcp';
const REAL = '/Volumes/Disk/Work/Clients/Example';
const SHADOW = '/Users/someone/Documents/Work/Clients/Example';

const cfg = () => ({
  projects: {
    // the shadow comes FIRST, exactly as it does on the real machine
    [SHADOW]: { allowedTools: [] },
    [REAL]: { mcpServers: { [SERVER]: { env: {
      GHL_INTERNAL_TOK_FILE: '/tok/a.txt',
      GHL_INTERNAL_LOCATIONS: 'LOCONE0000000000001,LOCTWO0000000000002',
    } } } },
    '/Volumes/Disk/Other': { mcpServers: { [SERVER]: { env: { GHL_TOK_FILE: '/tok/b.txt' } } } },
  },
});

test('findRegistration matches the exact path, never the shadow', () => {
  assert.equal(findRegistration(cfg(), SHADOW, SERVER), null, 'the shadow has no server');
  assert.ok(findRegistration(cfg(), REAL, SERVER), 'the real folder resolves');
});

test('findRegistration does not accept a suffix', () => {
  assert.equal(findRegistration(cfg(), 'Work/Clients/Example', SERVER), null);
});

test('listRegistrations reports both env generations without conflating them', () => {
  const rows = listRegistrations(cfg());
  const real = rows.find((r) => r.folder === REAL);
  assert.equal(real.tokenFile, '/tok/a.txt');
  assert.equal(real.legacyTokenFile, false);
  const other = rows.find((r) => r.folder === '/Volumes/Disk/Other');
  assert.equal(other.tokenFile, null, 'a legacy-only registration has no NEW token file');
  assert.equal(other.legacyTokenFile, true, 'and is flagged, because 0.43.0 refuses it');
});

test('listRegistrations skips folders with no server', () => {
  assert.equal(listRegistrations(cfg()).some((r) => r.folder === SHADOW), false);
});

test('setEnv is additive and reports what it changed', () => {
  const c = cfg();
  const { changed } = setEnv(c, REAL, SERVER, { GHL_INTERNAL_LOCATIONS: 'LOCTHREE000000000003' });
  assert.deepEqual(changed, ['GHL_INTERNAL_LOCATIONS']);
  const env = c.projects[REAL].mcpServers[SERVER].env;
  assert.equal(env.GHL_INTERNAL_LOCATIONS, 'LOCTHREE000000000003');
  assert.equal(env.GHL_INTERNAL_TOK_FILE, '/tok/a.txt', 'the sibling key must survive');
});

test('setEnv reports no change when the value already matches', () => {
  const c = cfg();
  const { changed } = setEnv(c, REAL, SERVER, { GHL_INTERNAL_TOK_FILE: '/tok/a.txt' });
  assert.deepEqual(changed, []);
});

test('setEnv refuses a folder it cannot find rather than creating one', () => {
  assert.throws(() => setEnv(cfg(), '/no/such/folder', SERVER, { X: '1' }), /not registered/i);
});

test('backupPath is unique per second and sits beside the original', () => {
  const p = backupPath('/home/u/.claude.json', new Date('2026-08-31T01:02:03Z'));
  assert.match(p, /^\/home\/u\/\.claude\.json\.bak-/);
  assert.notEqual(p, '/home/u/.claude.json');
});
