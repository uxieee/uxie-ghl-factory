// The generic style layer (core/style-layer.mjs) against the page builder's own output for the same nodes, pinned as
// DECLARATION SETS (test/fixtures/style-layer-oracle.json, measured offline in knowledge
// sniffs/funnels-wave30-kind-css-2026-09-29/13-gen-style-fixture.mjs — data only): a section, a row with a width, columns
// (current and pre-v2), text kinds, a button, the routed kinds (image, image-feature, the PDP buttons) and the kinds that
// leave keys unwritten, each with wrapper, tablet and mobile overrides. And the drift pin: the layer, the factory defaults
// and the fixture all name the same builder chunk, and that chunk is still the newest page-builder capture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { nodeLayerCss, STYLE_LAYER_SOURCE } from '../core/style-layer.mjs';
import { FACTORY_SOURCE } from '../core/kind-factory-defaults.mjs';

const FIX = JSON.parse(readFileSync(new URL('./fixtures/style-layer-oracle.json', import.meta.url), 'utf8'));
// flatten CSS into "media|selector|prop:value" — whitespace and `!important` spacing normalised, as the fixture was
const decls = (css) => { const out = new Set(); const n = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const walk = (t, m) => { let i = 0; while (i < t.length) { const o = t.indexOf('{', i); if (o < 0) break; let d = 0, j = o; for (; j < t.length; j++) { if (t[j] === '{') d++; else if (t[j] === '}' && --d === 0) break; }
    const pre = t.slice(i, o).replace(/\s+/g, ' ').replace(/:\s+/g, ':').trim(), body = t.slice(o + 1, j);
    if (pre.startsWith('@')) walk(body, pre); else for (const s of pre.split(',')) for (const dcl of body.split(';')) { const c = dcl.indexOf(':'); if (c < 0) continue; const v = dcl.slice(c + 1).replace(/\s+/g, ' ').replace(/\s*!important/, '!important').trim(); out.add(`${m}|${s.trim()}|${dcl.slice(0, c).trim()}:${v}`); }
    i = j + 1; } }; walk(n, ''); return out; };

for (const c of FIX.cases) {
  test(`style layer = the builder's declarations: ${c.name}`, () => {
    const got = [...decls(nodeLayerCss(c.node))].sort();
    assert.deepEqual(got, c.declarations);
  });
}

test('drift pin: the layer, the factory defaults and the fixture were all measured on the same builder chunk', () => {
  assert.equal(STYLE_LAYER_SOURCE.chunk, FIX.source.chunk);
  assert.equal(FACTORY_SOURCE.chunk, FIX.source.chunk);
  assert.equal(FACTORY_SOURCE.sha256, FIX.source.sha256, 'the factory defaults and the fixture come from the same bundle bytes');
});

test('drift pin: the pinned chunk is still the newest page-builder capture in knowledge/', (t) => {
  const sniffs = fileURLToPath(new URL('../../../../../knowledge/sniffs/', import.meta.url));
  if (!existsSync(sniffs)) { t.skip('knowledge/ is not beside this checkout — the release pair runs this check'); return; }
  const captures = readdirSync(sniffs).filter((d) => existsSync(join(sniffs, d, 'bundle'))).sort()
    .flatMap((d) => readdirSync(join(sniffs, d, 'bundle')).filter((b) => /^pageBuilder-[0-9a-f]+$/.test(b)).map((b) => ({ dir: d, chunk: `pageBuilder index.${b.slice('pageBuilder-'.length)}.js` })));
  const newest = captures.at(-1);
  assert.ok(newest, 'no page-builder capture found in knowledge/sniffs/*/bundle');
  assert.equal(newest.chunk, STYLE_LAYER_SOURCE.chunk,
    `the page builder was re-captured (${newest.dir}: ${newest.chunk}) after the style layer and the factory defaults were measured on ${STYLE_LAYER_SOURCE.chunk}: re-run the wave30 probes + 13-gen-style-fixture.mjs and gen-factory-defaults.mjs against it before shipping`);
});
