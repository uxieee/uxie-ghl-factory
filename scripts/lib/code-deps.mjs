// The code a tool's proof rests on, computed — never a hand-written list, which a reviewer rightly
// predicted would rot. Three layers:
//   1. the tool's own block in core/tools.mjs, WITHOUT its description (writing a proof label must
//      never stale the proof it describes)
//   2. every top-level preamble helper the block names, followed transitively
//   3. every local module those identifiers are imported from, and that module's static imports
//
// Known limit, stated in SPEC.md: dynamic dispatch and data files are invisible to this. The block
// hash still catches any change to the tool itself.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { sha256 } from './proof-deps.mjs';

const NAME = /^    name: '([a-z0-9_]+)',\s*$/;

export function toolBlocks(src) {
  const lines = src.split('\n');
  const starts = [];
  lines.forEach((l, i) => { const m = NAME.exec(l); if (m) starts.push([m[1], i]); });
  const lastStart = starts.at(-1)?.[1] ?? 0;
  const arrayEnd = lines.findIndex((l, i) => i > lastStart && /^\];/.test(l));
  const out = new Map();
  starts.forEach(([name, i], k) => {
    const stop = k + 1 < starts.length ? starts[k + 1][1] : (arrayEnd < 0 ? lines.length : arrayEnd);
    out.set(name, lines.slice(i, stop).join('\n'));
  });
  return out;
}

export function withoutDescription(block) {
  const out = []; let skipping = false;
  for (const l of block.split('\n')) {
    if (/^    description:/.test(l)) { skipping = true; continue; }
    if (skipping && (/^    [A-Za-z_$][\w$]*:/.test(l) || /^  [}\]]/.test(l))) skipping = false;
    if (!skipping) out.push(l);
  }
  return out.join('\n');
}

const DECL = /^(?:export\s+)?(?:async\s+)?(?:function\*?\s+([A-Za-z_$][\w$]*)|(?:const|let|var|class)\s+([A-Za-z_$][\w$]*))/;

function topLevelDecls(preamble) {
  const lines = preamble.split('\n');
  const starts = [];
  lines.forEach((l, i) => {
    const m = DECL.exec(l);
    if (m) starts.push([m[1] ?? m[2], i]);
    else if (/^(?:import|export)\b/.test(l)) starts.push([null, i]);
  });
  const out = new Map();
  starts.forEach(([name, i], k) => {
    if (!name) return;
    const stop = k + 1 < starts.length ? starts[k + 1][1] : lines.length;
    out.set(name, lines.slice(i, stop).join('\n'));
  });
  return out;
}

function importBindings(src, fromFile) {
  const map = new Map();
  for (const m of src.matchAll(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/gm)) {
    if (!m[2].startsWith('.')) continue;
    const file = resolve(dirname(fromFile), m[2]);
    const clause = m[1];
    const names = [];
    const def = /^([A-Za-z_$][\w$]*)/.exec(clause); if (def) names.push(def[1]);
    const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause); if (ns) names.push(ns[1]);
    const braces = /\{([\s\S]*)\}/.exec(clause);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const p = part.trim(); if (!p) continue;
        const as = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(p);
        names.push(as ? as[1] : p.split(/\s+/)[0]);
      }
    }
    for (const n of names) map.set(n, file);
  }
  return map;
}

function localImports(file, read) {
  const src = read(file);
  const out = [];
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]|(?:^|\n)\s*import\s+['"](\.[^'"]+)['"]/g)) {
    out.push(resolve(dirname(file), m[1] ?? m[2]));
  }
  return out;
}

const escapeRe = (s) => s.replace(/[$]/g, '\\$');

export function codeDeps({ toolsFile, tool, root, read = (f) => readFileSync(f, 'utf8') }) {
  const src = read(toolsFile);
  const block = toolBlocks(src).get(tool);
  if (!block) throw new Error(`no tool block for ${tool}`);
  const cut = src.indexOf('\nexport const TOOLS = [');
  const helpers = topLevelDecls(cut < 0 ? src : src.slice(0, cut));
  const bindings = importBindings(src, toolsFile);
  const names = [...new Set([...helpers.keys(), ...bindings.keys()])];
  const refs = (text) => names.filter((n) => new RegExp(`(?<![\\w$.])${escapeRe(n)}(?![\\w$])`).test(text));

  const usedHelpers = new Set(); const modules = new Set();
  const queue = [withoutDescription(block)];
  while (queue.length) {
    for (const n of refs(queue.pop())) {
      if (helpers.has(n)) { if (!usedHelpers.has(n)) { usedHelpers.add(n); queue.push(helpers.get(n)); } }
      else if (bindings.has(n)) modules.add(bindings.get(n));
    }
  }
  const seen = new Set(); const stack = [...modules];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f) || !existsSync(f)) continue;
    seen.add(f); stack.push(...localImports(f, read));
  }
  const rel = (f) => relative(root, f).split('\\').join('/');
  const self = [withoutDescription(block), ...[...usedHelpers].sort().map((h) => helpers.get(h))].join('\n\u0000\n');
  const out = { [`${rel(toolsFile)}#${tool}`]: sha256(self) };
  for (const f of [...seen].sort()) out[rel(f)] = sha256(read(f));
  return out;
}
