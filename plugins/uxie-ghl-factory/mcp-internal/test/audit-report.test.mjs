// Audit's contract is that it never implies a folder is clean when it could not check it. The
// offline tier runs on config + token claims only; anything needing a live credential is reported
// as unchecked, with the reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditOffline, formatAudit } from '../scripts/audit-report.mjs';

const A = 'LOCAAA0000000000001';
const B = 'LOCBBB0000000000002';
const rows = () => ([
  { folder: '/w/One', server: 'uxie-ghl-internal-mcp', tokenFile: '/tok/1', locationsRaw: `${A},${B}`,
    legacyTokenFile: false, legacyLocations: false },
  { folder: '/w/Two', server: 'uxie-ghl-internal-mcp', tokenFile: '/tok/2', locationsRaw: A,
    legacyTokenFile: false, legacyLocations: false },
  { folder: '/w/Three', server: 'uxie-ghl-internal-mcp', tokenFile: null, locationsRaw: null,
    legacyTokenFile: true, legacyLocations: false },
]);
const claims = () => new Map([
  ['/tok/1', { secondsRemaining: 3000 }],
  ['/tok/2', { secondsRemaining: -7200 }],
]);

test('flags an unbound registration', () => {
  const r = auditOffline({ rows: rows(), tokenClaims: claims() });
  const three = r.folders.find((f) => f.folder === '/w/Three');
  assert.ok(three.flags.includes('unbound'));
});

test('flags an expired credential and reports a live one as live', () => {
  const r = auditOffline({ rows: rows(), tokenClaims: claims() });
  assert.ok(r.folders.find((f) => f.folder === '/w/Two').flags.includes('credential-expired'));
  assert.equal(r.folders.find((f) => f.folder === '/w/One').flags.includes('credential-expired'), false);
});

test('flags a legacy env name that 0.43.0 will refuse', () => {
  const r = auditOffline({ rows: rows(), tokenClaims: claims() });
  assert.ok(r.folders.find((f) => f.folder === '/w/Three').flags.includes('legacy-token-file-env'));
});

test('flags a missing token file distinctly from an expired one', () => {
  const r = auditOffline({ rows: rows(), tokenClaims: new Map() });
  assert.ok(r.folders.find((f) => f.folder === '/w/One').flags.includes('credential-unreadable'));
});

test('reports an account reachable from more than one folder', () => {
  const r = auditOffline({ rows: rows(), tokenClaims: claims() });
  const o = r.overlaps.find((x) => x.id === A);
  assert.deepEqual(o.folders.sort(), ['/w/One', '/w/Two']);
  assert.equal(r.overlaps.some((x) => x.id === B), false, 'a single-folder account is not an overlap');
});

test('every folder is marked as NOT online-checked', () => {
  const r = auditOffline({ rows: rows(), tokenClaims: claims() });
  assert.ok(r.folders.every((f) => f.onlineChecked === false),
    'the offline tier must never imply the agency was consulted');
});

test('formatAudit names what it could not check', () => {
  const text = formatAudit(auditOffline({ rows: rows(), tokenClaims: claims() }));
  assert.match(text, /not checked against/i);
});
