#!/usr/bin/env node
// Plugin counts, computed from the tree (W10 w10-1). A README states a number only inside a span this script owns:
//   <!-- doc-counts:KEY -->VALUE<!-- /doc-counts -->
//
//   node scripts/doc-counts.mjs           print the counts
//   node scripts/doc-counts.mjs --write   rewrite the spans in the READMEs
//   node scripts/doc-counts.mjs --check   exit 1 if a span disagrees with the tree, or a required span is missing
//
// Definitions (one each):
//   tools                 TOOLS.length in mcp-internal/core/tools.mjs
//   publicOperations      entries of mcp-internal/catalog/public-ops.json without deprecated: true
//   categories            distinct category among those public operations
//   internalEndpoints     the count in mcp-internal/catalog/internal-endpoints.json
//
// This file reads only plugin/. The knowledge repo has its own counts (its scripts/doc-counts.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MCP = join(PLUGIN, 'plugins/uxie-ghl-factory/mcp-internal');
const OPEN = (k) => `<!-- doc-counts:${k} -->`;
const CLOSE = '<!-- /doc-counts -->';

// The READMEs that carry spans, and the keys each one must carry.
export const READMES = [
  { file: join(PLUGIN, 'README.md'), keys: ['publicOperations', 'categories', 'internalEndpoints', 'asof'] },
  { file: join(MCP, 'README.md'), keys: ['tools', 'asof'] },
];

export async function countPlugin(root = PLUGIN) {
  const mcp = join(root, 'plugins/uxie-ghl-factory/mcp-internal');
  const { TOOLS } = await import(pathToFileURL(join(mcp, 'core/tools.mjs')).href);
  const pub = JSON.parse(readFileSync(join(mcp, 'catalog/public-ops.json'), 'utf8')).ops;
  const live = pub.filter((o) => o.deprecated !== true);
  const intl = JSON.parse(readFileSync(join(mcp, 'catalog/internal-endpoints.json'), 'utf8'));
  return {
    asof: new Date().toISOString().slice(0, 10),
    tools: TOOLS.length,
    publicOperations: live.length,
    categories: new Set(live.map((o) => o.category)).size,
    internalEndpoints: intl.count ?? intl.endpoints.length,
  };
}

export function applySpans(text, values, keys) {
  let out = text;
  for (const k of keys) {
    out = out.replace(new RegExp(`(${escape(OPEN(k))})([^<]*)(${escape(CLOSE)})`, 'g'), `$1${values[k]}$3`);
  }
  return out;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function checkSpans(text, values, keys, label = 'README') {
  const problems = [];
  for (const k of keys) {
    const m = [...text.matchAll(new RegExp(`${escape(OPEN(k))}([^<]*)${escape(CLOSE)}`, 'g'))];
    if (m.length === 0) { problems.push(`${label}: no doc-counts span for ${k}`); continue; }
    for (const x of m) {
      // The date is a visible "as of" stamp that --write sets; --check requires its form, not today's value.
      if (k === 'asof') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(x[1].trim())) problems.push(`${label}: the as-of date is not YYYY-MM-DD`);
        continue;
      }
      if (x[1].trim() !== String(values[k])) problems.push(`${label}: ${k} states ${x[1].trim()}, the tree says ${values[k]}`);
    }
  }
  return problems;
}

const main = async () => {
  const values = await countPlugin();
  console.log(`as of ${values.asof} · tools ${values.tools} · public operations ${values.publicOperations} · categories ${values.categories} · internal endpoints ${values.internalEndpoints}`);
  if (process.argv.includes('--write')) {
    for (const { file, keys } of READMES) {
      const text = readFileSync(file, 'utf8');
      writeFileSync(file, applySpans(text, values, keys));
    }
    console.log('doc-counts: spans written');
  }
  if (process.argv.includes('--check')) {
    const problems = READMES.flatMap(({ file, keys }) => checkSpans(readFileSync(file, 'utf8'), values, keys, file.replace(`${PLUGIN}/`, '')));
    if (problems.length) {
      for (const p of problems) console.error(`doc-counts: ${p}`);
      process.exit(1);
    }
    console.log('doc-counts: READMEs agree with the tree');
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
