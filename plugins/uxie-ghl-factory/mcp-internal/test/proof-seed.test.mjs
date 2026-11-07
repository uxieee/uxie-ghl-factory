// w12 (2026-11-07): `proof.mjs seed` for a NEW tool. A tool that makes no account call (no capability rows in
// capability-manifest.json) is a pure function: it may be seeded with ZERO proof rows, under a label that says it is not a live
// proof. A tool that makes an account call still needs a proof row, and is refused without one. Fixtures and the real manifest only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seedEntry, PURE_LABEL, RECEIPT_LABEL } from '../../../../scripts/proof.mjs';

const CAPS = JSON.parse(readFileSync(new URL('../capability-manifest.json', import.meta.url), 'utf8'));
const capRows = (tool) => CAPS.filter((r) => r.tool === tool).length;
const base = { summary: 'Compare renders', risk: 'read' };

test('the real manifest: compare_page_renders makes no account call, audit_site does', () => {
  assert.equal(capRows('compare_page_renders'), 0);
  assert.ok(capRows('audit_site') > 0);
});

test('seed accepts a pure tool with ZERO proof rows, labelled as a pure function and not as a live proof', () => {
  const e = seedEntry({ tool: 'compare_page_renders', ...base, rows: [], riskRows: [], capabilityRows: 0 });
  assert.equal(e.proof, PURE_LABEL);
  assert.match(e.description, /pure function: no account call; correctness by unit tests/);
  assert.doesNotMatch(e.description, /live/i, 'a pure tool must never read as a live proof');
  assert.deepEqual(e.rows, []);
  assert.deepEqual(e.proofRows, []);
});

test('seed REFUSES a network-capable tool with zero rows', () => {
  assert.throws(
    () => seedEntry({ tool: 'audit_site', ...base, rows: [], riskRows: [], capabilityRows: capRows('audit_site') }),
    /audit_site makes an account call .* needs a proof row/);
});

test('seed refuses to invent rows for a PURE tool: a pure tool carries none', () => {
  assert.throws(
    () => seedEntry({ tool: 'compare_page_renders', ...base, rows: ['row-x'], riskRows: [], capabilityRows: 0 }),
    /pure .* no proof rows/);
});

test('an UNKNOWN capability count fails closed: it is treated as network-capable and needs a row', () => {
  assert.throws(() => seedEntry({ tool: 'mystery', ...base, rows: [], riskRows: [] }), /needs a proof row/);
});

test('a network-capable tool seeded WITH a row keeps the honest external-receipt-required label', () => {
  const e = seedEntry({ tool: 'audit_site', ...base, rows: ['funnels--page-data'], riskRows: [], capabilityRows: 3 });
  assert.equal(e.proof, RECEIPT_LABEL);
  assert.deepEqual(e.rows, ['funnels--page-data']);
});

test('seed refuses an existing entry, and still requires --summary and --risk', () => {
  assert.throws(() => seedEntry({ tool: 'audit_site', ...base, rows: ['r'], capabilityRows: 3, existing: { proof: 'live-runtime' } }), /already has an entry/);
  assert.throws(() => seedEntry({ tool: 'compare_page_renders', risk: 'read', rows: [], capabilityRows: 0 }), /--summary/);
  assert.throws(() => seedEntry({ tool: 'compare_page_renders', summary: 's', rows: [], capabilityRows: 0 }), /--risk/);
});
