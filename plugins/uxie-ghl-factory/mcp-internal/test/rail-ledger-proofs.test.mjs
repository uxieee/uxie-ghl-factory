import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// W4 (2026-10-29): knowledge checks the ledger's proof:/receipt: refs for form only — it must not read the plugin. This
// resolves them by console/lib/gate.mjs's rules: a proof record whose LATEST run passed, a receipt whose results all
// passed. And every internal tool the ledger names is one this server ships.
const HERE = dirname(fileURLToPath(import.meta.url));
const MCP = resolve(HERE, '..');
const REPO = resolve(MCP, '../../..');
const ledger = JSON.parse(readFileSync(join(MCP, 'catalog/rail-ledger.json'), 'utf8'));
const read = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

function resolves(ref) {
  const [form, ...rest] = ref.split(':'); const value = rest.join(':');
  if (form === 'proof') {
    if (!/^[a-z0-9_]+$/.test(value)) return `proof:${value} is not a tool name`;
    const data = read(join(REPO, 'proofs', `${value}.json`));
    if (!data) return `no proof record for ${value}`;
    const last = Array.isArray(data.runs) ? data.runs.at(-1) : null;
    return last?.result === 'pass' ? null : `${value}: latest run is ${last?.result ?? 'absent'}`;
  }
  if (form === 'receipt') {
    if (!/^\d{4}-\d{2}-\d{2}-\d{4}$/.test(value)) return `receipt:${value} is not a receipt timestamp`;
    const file = join(REPO, 'audits', 'live-proofs', `${value}.json`);
    if (!existsSync(file)) return null; // gate: "no receipt on this machine" — receipts are local, not shipped
    const results = read(file)?.results ?? [];
    return results.length && results.every((r) => r?.ok === true) ? null : `receipt ${value} did not pass`;
  }
  return null; // sniff: refs are resolved by knowledge's own validator
}

test('every proof:/receipt: ref in the ledger resolves by gate rules', () => {
  const problems = [];
  for (const r of ledger.rows) for (const side of ['internal', 'public']) for (const ref of r[side].proof ?? []) {
    const why = resolves(ref); if (why) problems.push(`${r.product}/${r.job}: ${why}`);
  }
  assert.deepEqual(problems, []);
});

test('every internal tool named in the ledger is in capability-manifest.json', () => {
  const tools = new Set(JSON.parse(readFileSync(join(MCP, 'capability-manifest.json'), 'utf8')).map((r) => r.tool));
  const missing = [...new Set(ledger.rows.flatMap((r) => r.internal.tools).filter((t) => !t.startsWith('raw_request:')))].filter((t) => !tools.has(t));
  assert.deepEqual(missing, []);
});
