// The builder's per-kind style layer (core/kind-css.mjs + the generated kind-css-spec.mjs), against what the builder's own
// functions make of the same nodes: test/fixtures/kind-css-oracle.json holds, per kind, the node the tool writes plus seeded
// input changes (and, for the order forms, a non-default palette) with the builder's EFFECTIVE DECLARATIONS — the default
// case in full, the others as a count and a sha256 (knowledge sniffs/funnels-wave30-kind-css-2026-09-29 19-gen-kind-fixture.mjs).
// And the drift pin: the spec, the style layer, the factory defaults and the fixture name the same builder chunk, and it is
// still the newest page-builder capture — a builder release fails this test loudly instead of silently changing the rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { kindCss, KIND_CSS_KINDS } from '../core/kind-css.mjs';
import { KIND_CSS_SOURCE } from '../core/kind-css-spec.mjs';
import { STYLE_LAYER_SOURCE } from '../core/style-layer.mjs';
import { FACTORY_SOURCE } from '../core/kind-factory-defaults.mjs';
import { makeLeaf, mergePalette, BUILDER_STYLED_KINDS, builderStylingWarning } from '../core/funnel-pages.mjs';
import { effectiveDecls } from './helpers/effective-decls.mjs';

const FIX = JSON.parse(readFileSync(new URL('./fixtures/kind-css-oracle.json', import.meta.url), 'utf8'));
const setPath = (o, p, v) => { const ks = p.split('.'); let t = o; for (const k of ks.slice(0, -1)) t = t[k] ??= {}; if (v && v.$absent) delete t[ks.at(-1)]; else t[ks.at(-1)] = structuredClone(v); };
const sha = (list) => createHash('sha256').update(list.join('\n')).digest('hex');

test('every ported kind has an oracle fixture, and the other way round', () => {
  assert.deepEqual(Object.keys(FIX.kinds).sort(), [...KIND_CSS_KINDS].sort());
  for (const [k, cases] of Object.entries(FIX.kinds)) assert.ok(cases.length >= 10, `${k}: at least 10 cases (default + 9 seeded combinations)`);
});

for (const [meta, cases] of Object.entries(FIX.kinds)) {
  for (const [n, c] of cases.entries()) {
    test(`${meta} #${n}${c.deltas.length ? ` (${c.deltas.length} inputs changed)` : ' (the node the tool writes)'} = the builder's declarations`, () => {
      const node = JSON.parse(JSON.stringify(makeLeaf({ meta }))); // makeLeaf shares objects between keys; a delta must change one input
      for (const [p, v] of c.deltas) setPath(node, p, v);
      const r = kindCss(node, mergePalette(c.palette));
      assert.equal(r.refused, undefined, `refused: ${r.refused}`);
      const got = effectiveDecls(r.css.split(node.id).join('__ID__'));
      if (c.declarations) assert.deepEqual(got, c.declarations);
      assert.equal(got.length, c.count, 'declaration count');
      assert.equal(sha(got), c.sha256, 'the sorted effective declarations');
    });
  }
}

test('a node outside the measured inputs is refused, never guessed', () => {
  const node = makeLeaf({ meta: 'store-pdp-v2-title' });
  node.extra.someFutureKnob = { value: 1 };
  assert.match(kindCss(node, mergePalette([])).refused, /extra\.someFutureKnob\.value was not measured/);
  assert.equal(kindCss({ meta: 'nav-menu', id: 'x' }, []).refused, 'kind', 'a kind without a spec');
  // a value class nobody measured: an object where every probe wrote a scalar
  const odd = makeLeaf({ meta: 'store-pdp-v2-title' }); odd.styles.textAlign = { value: { nested: true } };
  assert.ok(kindCss(odd, mergePalette([])).css !== undefined || kindCss(odd, mergePalette([])).refused);
});

test('a ported kind leaves BUILDER_STYLED_KINDS; a refused node comes back as builderStyling with its reason', () => {
  for (const k of KIND_CSS_KINDS) assert.ok(!BUILDER_STYLED_KINDS.has(k), `${k} is ported`);
  const bad = makeLeaf({ meta: 'store-pdp-v2-price' }); bad.extra.someFutureKnob = { value: 1 };
  const w = builderStylingWarning({ sections: [{ id: 's1', elements: [makeLeaf({ meta: 'store-pdp-v2-title' }), bad] }] });
  assert.deepEqual(w.nodes.map((n) => n.kind), ['store-pdp-v2-price']);
  assert.match(w.nodes[0].reason, /someFutureKnob/);
});

test('the order forms read the page palette: the same node under two palettes renders two gradients', () => {
  const node = makeLeaf({ meta: 'two-setp-order' });
  const a = kindCss(node, mergePalette([])).css;
  const b = kindCss(node, mergePalette([{ label: 'Primary', value: '#010203' }, { label: 'Secondary', value: '#0a0b0c' }])).css;
  assert.notEqual(a, b);
  assert.match(a, /linear-gradient/);
});

test('drift pin: the spec, the style layer, the factory defaults and the fixture were all measured on the same builder chunk', () => {
  assert.equal(KIND_CSS_SOURCE.chunk, FIX.source.chunk);
  assert.equal(STYLE_LAYER_SOURCE.chunk, FIX.source.chunk);
  assert.equal(FACTORY_SOURCE.chunk, FIX.source.chunk);
  assert.equal(KIND_CSS_SOURCE.sha256, FACTORY_SOURCE.sha256, 'the spec and the factory defaults come from the same bundle bytes');
});

test('drift pin: the pinned chunk is still the newest page-builder capture in knowledge/', (t) => {
  const sniffs = fileURLToPath(new URL('../../../../../knowledge/sniffs/', import.meta.url));
  if (!existsSync(sniffs)) { t.skip('knowledge/ is not beside this checkout — the release pair runs this check'); return; }
  const captures = readdirSync(sniffs).filter((d) => existsSync(join(sniffs, d, 'bundle'))).sort()
    .flatMap((d) => readdirSync(join(sniffs, d, 'bundle')).filter((b) => /^pageBuilder-[0-9a-f]+$/.test(b)).map((b) => ({ dir: d, chunk: `pageBuilder index.${b.slice('pageBuilder-'.length)}.js` })));
  const newest = captures.at(-1);
  assert.ok(newest, 'no page-builder capture found in knowledge/sniffs/*/bundle');
  assert.equal(newest.chunk, KIND_CSS_SOURCE.chunk,
    `the page builder was re-captured (${newest.dir}: ${newest.chunk}) after the per-kind rules were measured on ${KIND_CSS_SOURCE.chunk}: re-run knowledge sniffs/funnels-wave30-kind-css-2026-09-29 15/16/17/18/19 and regenerate core/kind-css-spec.mjs and test/fixtures/kind-css-oracle.json`);
});
