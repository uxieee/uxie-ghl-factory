// F5-01 shipped because a tool named a rail the catalogue disagreed with, and nothing compared
// them: list_marketplace_apps declared the AI rail while its capability rows described endpoints
// the catalogue places on the AI host — and the gateway then sent the call to the backend host,
// throwing AI_RAIL_HOST_INVALID on every invocation for fourteen releases.
//
// This test is the comparison that was missing. It is deliberately narrow: it judges only the
// capability rows whose exact METHOD + PATH the catalogue already knows, so it can never invent a
// verdict about an endpoint nobody has documented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TOOLS } from '../core/tools.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const catalogue = JSON.parse(readFileSync(resolve(HERE, '../catalog/internal-endpoints.json'), 'utf8'));

const BACKEND = 'https://backend.leadconnectorhq.com';
const AI_HOST = 'https://services.leadconnectorhq.com';

// Tools whose handler builds its gateway with rail:'ai'. Read from the source rather than
// maintained by hand, so a new AI-rail tool cannot silently escape this check.
const SOURCE = readFileSync(resolve(HERE, '../core/tools.mjs'), 'utf8');
const AI_RAIL_TOOLS = new Set();
for (const m of SOURCE.matchAll(/name:\s*'([a-z_]+)'([\s\S]{0,6000}?)(?=\n  \{\n    (?:\/\/|name:)|\n\];)/g)) {
  if (/rail:\s*'ai'/.test(m[2])) AI_RAIL_TOOLS.add(m[1]);
}

// A capability path is a template ({loc}, {wid}); the catalogue uses its own placeholder names.
// Compare SHAPE: every {…} segment collapses to {}.
const shape = (p) => String(p).split('?')[0].replace(/\{[^}]*\}/g, '{}').replace(/\/+$/, '');

test('the AI-rail tool set is discovered, not assumed', () => {
  assert.ok(AI_RAIL_TOOLS.size >= 3, `expected several ai-rail tools, found ${[...AI_RAIL_TOOLS].join(', ')}`);
  assert.ok(AI_RAIL_TOOLS.has('create_convai_agent'), [...AI_RAIL_TOOLS].join(', '));
});

// KNOWN DISAGREEMENTS, each reviewed rather than silenced. The catalogue's `origin` comes from
// corpus pages; the tool's host is what has actually been executed. Where a tool is LIVE-PROVEN on
// the host it uses, the tool is the operative truth and the catalogue row is the thing to revisit
// — but a family is only listed here with a reason, and anything NOT listed fails.
//
// The memberships case is the clearest: the corpus contradicts itself. corpus/memberships-courses/
// 20-api/endpoints.md:19 states services.leadconnectorhq.com "(production)", while the bundle's own
// `membershipURL` constant (workflows/70-research/ENDPOINTS.md:28) and the 2026-07-18 recon page
// both say backend.leadconnectorhq.com/membership — and the whole course lifecycle was proven live
// on backend (build -> enrol -> learn -> assess -> grade -> collect -> revoke).
const KNOWN_HOST_DISAGREEMENTS = new Map([
  ['/membership/', 'live-proven on backend end-to-end (full course lifecycle); the corpus page states services and contradicts both the bundle constant and the recon page'],
  ['/certificates/', 'same family and same live proof as /membership/'],
  ['/hooks/inbound-webhook-request/', 'the inbound-webhook reference rail was live-proven on backend 2026-08-22 (server-assigned trigger id, bare-string PUT reply)'],
  ['/voice-ai/agents', 'a best-effort leg of the entity sweep; it answered on the default (backend) rail in a live build 2026-08-29'],
  ['/ai-employees/employees/search', 'as above — the same live sweep resolved agents on the default rail'],
  ['/conversations-ai/employeeConfigs', 'the per-contact ConvAI pair ships as live-proven on its declared rail; the catalogue row is unverified'],
  ['/agent-studio/agents/agents-with-folders', 'get_ai_configuration_bundle calls this on the AI rail deliberately; the catalogue row says backend and is unverified'],
]);
const knownReason = (path) => {
  for (const [needle, why] of KNOWN_HOST_DISAGREEMENTS) if (path.includes(needle)) return why;
  return null;
};

test('every known host disagreement still carries a reason (the ledger cannot rot into a silencer)', () => {
  for (const [needle, why] of KNOWN_HOST_DISAGREEMENTS) {
    assert.ok(why && why.length > 30, `${needle} needs a real reason, not a shrug`);
  }
});

test('every tool capability the catalogue knows agrees with the catalogue on ORIGIN', () => {
  const rows = new Map();
  for (const e of catalogue.endpoints) rows.set(`${e.method} ${shape(e.path)}`, e);

  const bad = [];
  for (const tool of TOOLS) {
    for (const c of tool.capabilities ?? []) {
      const row = rows.get(`${c.method} ${shape(c.path)}`);
      if (!row) continue;                       // the catalogue does not know it — no verdict
      if (row.origin === 'https://rest.gohighlevel.com') continue;   // a different rail entirely
      const declared = c.origin ?? (AI_RAIL_TOOLS.has(tool.name) ? AI_HOST : BACKEND);
      if (row.origin === declared) continue;
      // A reviewed family is recorded, not silenced: anything outside the ledger fails.
      if (knownReason(c.path)) continue;
      bad.push(`${tool.name}: ${c.method} ${c.path} — tool implies ${declared}, catalogue says ${row.origin}`);
    }
  }
  assert.deepEqual(bad, []);
});
