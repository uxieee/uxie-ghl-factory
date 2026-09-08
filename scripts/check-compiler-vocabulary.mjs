#!/usr/bin/env node
// Did the shapes our compilers emit survive GHL rebuilding the app they were mined from?
//
//   node scripts/check-compiler-vocabulary.mjs
//
// This is NOT a re-mining session. It is a differential over a KNOWN vocabulary: the literal field
// names and enum values our compilers put on the wire, extracted from the compiler source itself.
// For every chunk whose hash moved since our capture, it asks one question per name — was it there
// before, and is it there now? A name that was present and is now absent is the finding.
//
// WHAT A PASS MEANS, EXACTLY. It rules out the loud failure: a contract key that simply
// disappeared. It does NOT prove correctness. A field can survive by name and change meaning, and
// a newly REQUIRED field would never show up in a test that only looks for removals. It also says
// nothing about chunks we never captured. Do not read a green run as "the compilers are correct";
// read it as "nothing we depend on vanished".
//
// Anonymous: public CDN only, no account, no credential. Nothing is written.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE = join(HERE, '..', '..', 'knowledge');
const ENGINES = join(HERE, '..', 'plugins', 'uxie-ghl-factory', 'engines', 'ai');
const MANIFEST = 'https://production.app-manifest.leadconnectorhq.com/latest/manifest.json';

// app -> the capture it was mined into, and the compiler sources that stand on it.
export const WATCHED = {
  aiGrowthApp: { capture: 'voice-ai-2026-08-25/js', key: 'ai-growth',
    sources: ['voiceai-compiler.mjs', 'voiceai-ir.mjs'], tool: 'create_voiceai_agent' },
  aiEmployeesApp: { capture: 'conversation-ai-2026-08-25/js', key: 'ai-employees',
    sources: ['convai-compiler.mjs', 'convai-ir.mjs'], tool: 'create_convai_agent' },
};

// Names that are JavaScript, not vocabulary. A compiler is full of them and they would drown the
// signal — every chunk contains `filter` and `length`.
const NOISE = new Set(['true','false','null','undefined','string','number','boolean','object','array',
  'length','push','join','some','every','filter','includes','concat','startsWith','endsWith','slice',
  'toString','JSON','stringify','parse','Error','Array','Object','isArray','entries','keys','values',
  'from','forEach','trim','split','replace','match','test','const','return','typeof','default','length']);

/** The literal names a compiler puts on the wire, read from its own source. */
export function vocabulary(files) {
  const out = new Set();
  for (const f of files) {
    const p = join(ENGINES, f);
    if (!existsSync(p)) continue;
    // Comments are prose, not vocabulary — a name mentioned in a comment is not a name we emit.
    const s = readFileSync(p, 'utf8').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of s.matchAll(/'([A-Za-z][A-Za-z0-9_]{3,40})'|"([A-Za-z][A-Za-z0-9_]{3,40})"/g)) out.add(m[1] ?? m[2]);
    for (const m of s.matchAll(/^\s*([a-z][A-Za-z0-9_]{3,40})\s*:/gm)) out.add(m[1]);
  }
  for (const n of NOISE) out.delete(n);
  return [...out];
}

/** webpack's chunk table: id -> content hash, plus the filename prefix. */
export function chunkTable(js, key) {
  // The object literal is optionally PARENTHESISED — `+({…})[e]` — the shape whose absence from an
  // earlier parser made this whole check look impossible. See sniffs/check-source-readability.mjs.
  const m = new RegExp(`__webpack_require__\\.u\\s*=\\s*(\\w+)\\s*=>\\s*"([^"]*${key}\\.)"\\s*\\+\\s*\\(?\\{([\\s\\S]*?)\\}\\)?\\s*\\[`).exec(String(js ?? ''));
  if (!m) return null;
  const chunks = new Map();
  for (const p of m[3].matchAll(/(\d+)\s*:\s*"([A-Za-z0-9]{8,32})"/g)) chunks.set(p[1], p[2]);
  return { prefix: m[2], chunks };
}

const invokedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (invokedDirectly) {
  const man = await (await fetch(MANIFEST)).json();
  let failed = false;

  for (const [app, cfg] of Object.entries(WATCHED)) {
    const dir = join(KNOWLEDGE, 'sniffs', cfg.capture);
    console.log(`\n${'='.repeat(74)}\n${app}  —  ${cfg.tool}`);
    if (!existsSync(join(dir, 'remoteEntry.js'))) { console.log(`  no captured remoteEntry at ${cfg.capture} — cannot compare`); continue; }

    const vocab = vocabulary(cfg.sources);
    const url = String(man.federatedApps[app] ?? '').split('?')[0];
    if (!url) { console.log('  not in the manifest any more'); failed = true; continue; }
    const base = url.replace(/\/[^/]*$/, '');
    const entryJs = await (await fetch(url)).text();
    const then = chunkTable(readFileSync(join(dir, 'remoteEntry.js'), 'utf8'), cfg.key);
    const now = chunkTable(entryJs, cfg.key);
    if (!then || !now) { console.log(`  chunk table unreadable (then=${!!then} now=${!!now})`); failed = true; continue; }

    const onDisk = new Set(readdirSync(dir).filter((f) => f.startsWith(`${cfg.key}.`)).map((f) => f.slice(cfg.key.length + 1, -3)));
    const captured = [...then.chunks].filter(([, h]) => onDisk.has(h));
    const rebuilt = captured.filter(([id, h]) => now.chunks.get(id) && now.chunks.get(id) !== h);
    const vanished = captured.filter(([id]) => !now.chunks.has(id));
    console.log(`  ${vocab.length} compiler names · ${captured.length} captured chunks · `
      + `${captured.length - rebuilt.length - vanished.length} identical, ${rebuilt.length} rebuilt, ${vanished.length} id vanished`);

    const lost = new Set();
    for (const [id, oldHash] of rebuilt) {
      const oldJs = readFileSync(join(dir, `${cfg.key}.${oldHash}.js`), 'utf8');
      const r = await fetch(`${base}/${now.prefix}${now.chunks.get(id)}.js`);
      if (!r.ok) { console.log(`    chunk ${id}: new bytes ${r.status} — NOT compared`); failed = true; continue; }
      const newJs = await r.text();
      for (const v of vocab) if (oldJs.includes(v) && !newJs.includes(v)) lost.add(v);
    }

    // A vanished webpack id usually means renumbered, not deleted — so search the whole live app
    // before calling anything missing.
    const wanted = new Set();
    for (const [, h] of vanished) {
      const js = readFileSync(join(dir, `${cfg.key}.${h}.js`), 'utf8');
      for (const v of vocab) if (js.includes(v)) wanted.add(v);
    }
    if (wanted.size) {
      const found = new Set([...wanted].filter((v) => entryJs.includes(v)));
      for (const [, h] of now.chunks) {
        if (found.size === wanted.size) break;
        const r = await fetch(`${base}/${now.prefix}${h}.js`);
        if (!r.ok) continue;
        const js = await r.text();
        for (const v of wanted) if (!found.has(v) && js.includes(v)) found.add(v);
      }
      for (const v of wanted) if (!found.has(v)) lost.add(v);
    }

    if (lost.size) { failed = true; console.log(`  ✗ ${lost.size} name(s) our compiler emits are GONE from the live app:`); for (const v of lost) console.log(`      ${v}`); }
    else console.log(`  ✓ every name ${cfg.tool} emits is still present in the live app`);
  }

  console.log(`\n${failed ? 'FAIL — a compiler name went missing, or an app could not be read.' : 'PASS — nothing we depend on vanished. This is not a proof of correctness; see the header.'}`);
  process.exit(failed ? 2 : 0);
}
