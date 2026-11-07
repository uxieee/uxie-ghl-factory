#!/usr/bin/env node
// W6 item 2: the lifter over every stored sample workflow — NOT a committed test, because the samples are private
// account data that never enters this repo. Reads ../knowledge/samples/by-location/*/workflows (+ triggers), lifts
// each document, recompiles the lifted spec with ids pinned, and checks invariant 1 per step:
//   overlay(compile(lift(W))) ≡ W
// Every workflow either round-trips or names what it froze; a step that disappears, or comes back different, is a
// failure. Prints aggregate counts only; `--out <file>` writes the same summary as JSON (put it in knowledge/sniffs).
//
//   node scripts/lift-corpus-check.mjs [--samples <dir>] [--out <file>]
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, '../plugins/uxie-ghl-factory/skills/create-ghl-workflow/engine');
const { compile } = await import(join(ENGINE, 'compiler.mjs'));
const { liftWorkflow } = await import(join(ENGINE, 'lift.mjs'));
const { loadCatalog } = await import(join(ENGINE, 'catalog.mjs'));
const { makeSeededIdGen } = await import(join(ENGINE, 'idgen.mjs'));
const { diffPaths } = await import(join(ENGINE, 'stored.mjs'));

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const samples = resolve(arg('--samples') ?? join(HERE, '../../knowledge/samples/by-location'));
if (!existsSync(samples)) {
  console.error(`lift-corpus-check: REFUSED — no samples folder at ${samples}. This check runs only where the private `
    + 'knowledge repo sits beside the plugin; it is not a test and has nothing to check without it.');
  process.exit(2);
}

const catalog = loadCatalog();
const files = [];
for (const loc of readdirSync(samples)) {
  const d = join(samples, loc, 'workflows');
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d)) if (f.endsWith('.json')) files.push({ wf: join(d, f), tr: join(samples, loc, 'triggers', f.replace(/\.workflow\.json$/, '.triggers.json')) });
}
if (!files.length) { console.error(`lift-corpus-check: REFUSED — ${samples} holds no workflow samples.`); process.exit(2); }

const count = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
const sum = { workflows: files.length, roundTrip: 0, roundTripWithFrozen: 0, refused: 0, failed: 0, steps: 0, stepsFrozen: 0, stepsDetached: 0,
  stepsResidual: 0, frozenNodes: 0, acceptedLoops: 0, acceptedOppUnassociated: 0, triggerRefusals: 0, settingRefusals: 0 };
const frozenWhy = new Map(), refusedWhy = new Map(), failWhy = new Map();
for (const { wf, tr } of files) {
  const doc = JSON.parse(readFileSync(wf, 'utf8'));
  const triggers = existsSync(tr) ? JSON.parse(readFileSync(tr, 'utf8')) : [];
  const T = doc.workflowData?.templates ?? [];
  sum.steps += T.length;
  const lifted = liftWorkflow({ doc, triggers: Array.isArray(triggers) ? triggers : [] }, { catalog });
  for (const r of lifted.refusals) { if (r.kind === 'trigger') sum.triggerRefusals++; if (r.kind === 'setting') sum.settingRefusals++; }
  if (!lifted.ir) { sum.refused++; for (const r of lifted.refusals.filter((x) => x.kind === 'workflow')) count(refusedWhy, `${r.code}: ${r.message.replace(/'[^']*'/g, "'…'").slice(0, 120)}`); continue; }
  const rep = lifted.report;
  sum.frozenNodes += rep.frozen.length;
  sum.stepsFrozen += Object.values(lifted.ir.stored.frozen).flat().length;
  sum.stepsDetached += rep.detached.length;
  sum.stepsResidual += rep.residualSteps;
  sum.acceptedLoops += rep.acceptedLoops.length;
  sum.acceptedOppUnassociated += rep.acceptedOppUnassociated.length;
  for (const f of rep.frozen) count(frozenWhy, String(f.reason).replace(/'[^']*'/g, "'…'").replace(/[0-9a-f-]{20,}/gi, '<id>').slice(0, 110));
  let built;
  try {
    built = compile(structuredClone(lifted.ir), { loc: doc.locationId, cid: doc.companyId, uid: doc.updatedBy ?? 'U', companyAge: doc.companyAge ?? 0,
      idGen: makeSeededIdGen('c'), catalog, warn: () => {}, ignoreUnresolved: true, skipObjectRules: true, skipTriggerSeeds: true,
      pinIds: true, pins: lifted.ir.stored.pins });
  } catch (e) { sum.failed++; count(failWhy, `recompile threw ${e.code ?? ''} ${String(e.message).slice(0, 80)}`); continue; }
  const C = new Map(built.autoSaveBody.workflowData.templates.map((t) => [t.id, t]));
  let ok = C.size === T.length;
  if (!ok) count(failWhy, `step count ${T.length} → ${C.size}`);
  for (const s of T) {
    const c = C.get(s.id);
    if (!c) { ok = false; count(failWhy, `${s.type}: dropped`); continue; }
    const d = diffPaths(c, s);     // key order is not a difference: GHL stores a document, not a byte string
    if (d.length) { ok = false; for (const x of d) count(failWhy, `${s.type}: ${x.p.map((k) => (typeof k === 'number' ? '[]' : k)).join('.')} ${'f' in x ? ('t' in x ? 'value' : 'added') : 'dropped'}`); }
  }
  if (!ok) { sum.failed++; continue; }
  if (rep.frozen.length || rep.detached.length) sum.roundTripWithFrozen++; else sum.roundTrip++;
}
const top = (m) => Object.fromEntries([...m].sort((a, b) => b[1] - a[1]).slice(0, 25));
const out = { ...sum, frozenReasons: top(frozenWhy), refusedReasons: top(refusedWhy), failures: top(failWhy) };
console.log(JSON.stringify(out, null, 2));
if (arg('--out')) writeFileSync(arg('--out'), JSON.stringify({ ranAt: new Date().toISOString(), ...out }, null, 2) + '\n');
process.exit(sum.failed ? 1 : 0);
