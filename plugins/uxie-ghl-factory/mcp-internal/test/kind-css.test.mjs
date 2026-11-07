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
import { kindCss, KIND_CSS_KINDS, transform } from '../core/kind-css.mjs';
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
    // w7-5b: the one case the w7-5b ruling leaves open (featured-product #9, 16 inputs): the checker and this case disagree, so it is
    // a TODO, not a pass. Every other oracle case is strict.
    const OPEN = meta === 'featured-product' && n === 9 ? { todo: 'open on 976028e2: featured-product is verified:false (w7-5b ruling); case #9 disagrees with the builder' } : {};
    test(`${meta} #${n}${c.deltas.length ? ` (${c.deltas.length} inputs changed)` : ' (the node the tool writes)'} = the builder's declarations`, OPEN, () => {
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
  // Two capture layouts: <dir>/bundle/pageBuilder-<hash>/ (recon folders) and bundle-<date>-<hash>/index.<hash>.js (w7-5 follow-up,
  // 976028e2). Ordered by the date in the folder name, so the newest capture is the last one, whatever its layout.
  const dated = (d) => (d.match(/\d{4}-\d{2}-\d{2}/) ?? [''])[0];
  const captures = readdirSync(sniffs).flatMap((d) => {
    const recon = existsSync(join(sniffs, d, 'bundle'))
      ? readdirSync(join(sniffs, d, 'bundle')).filter((b) => /^pageBuilder-[0-9a-f]+$/.test(b)).map((b) => ({ dir: d, date: dated(d), chunk: `pageBuilder index.${b.slice('pageBuilder-'.length)}.js` }))
      : [];
    const direct = /^bundle-\d{4}-\d{2}-\d{2}-[0-9a-f]+$/.test(d)
      ? readdirSync(join(sniffs, d)).filter((f) => /^index\.[0-9a-f]+\.js$/.test(f)).map((f) => ({ dir: d, date: dated(d), chunk: `pageBuilder ${f}` }))
      : [];
    return [...recon, ...direct];
  }).sort((a, b) => a.date.localeCompare(b.date));
  const newest = captures.at(-1);
  assert.ok(newest, 'no page-builder capture found in knowledge/sniffs/*/bundle');
  assert.equal(newest.chunk, KIND_CSS_SOURCE.chunk,
    `the page builder was re-captured (${newest.dir}: ${newest.chunk}) after the per-kind rules were measured on ${KIND_CSS_SOURCE.chunk}: re-run knowledge sniffs/funnels-wave30-kind-css-2026-09-29 15/16/17/18/19 and regenerate core/kind-css-spec.mjs and test/fixtures/kind-css-oracle.json`);
});

// w7-5 (bl-330): under overrideDescriptionStyles a zero or missing description size writes the builder's fallback, not 0.
test('zf and zt: zero and missing write the fallback; "0" stays 0; zt keeps "" empty (tablet)', () => {
  assert.deepEqual([0, '0', '', null, undefined, 5].map((v) => transform('zf:16', v, [])), ['16', '0', '16', '16', '16', '5']);
  assert.deepEqual([0, '0', '', null, undefined, 5].map((v) => transform('zt:16', v, [])), ['0', '0', '', '16', '16', '5']);
});

test('store-product-detail: override on, desktop size 0 writes the 16px fallback (the builder, not 0px)', () => {
  const n = makeLeaf({ meta: 'store-product-detail' });
  n.extra.overrideDescriptionStyles = { value: true };
  n.extra.descriptionDesktopFontSize = { value: 0 };
  const css = kindCss(n, mergePalette([])).css;
  const sized = [...css.matchAll(/#[^ {}]+ \.description\{([^}]*)\}/g)].map((m) => m[1]).filter((b) => /font-size:/.test(b));
  assert.ok(sized.some((b) => /font-size:16px !important/.test(b)), 'the desktop description rule writes the 16px fallback');
  // the 768–1024 rule writes the raw 0px (the builder does too); the fixture pins that case
});

// w7-5 (image-feature, DECISION): a RAW row writes its template verbatim, with the builder's own newlines. A malformed
// declaration (an unterminated string) ends at the newline, so the port must keep the line structure the builder writes.
test('a raw row writes its template verbatim: newlines kept, holes filled, the node id substituted', () => {
  const spec = {
    leaves: [{ path: 'extra.t.value', classes: [{ open: 'string' }] }],
    rows: [['raw', '#__ID__ .x,\n#__ID__ .y\n{\ncontent:"\\\u00000:id\u0000" !important;\ncolor:red\n}']],
  };
  const node = { id: 'n1', meta: 'probe-kind', extra: { t: { value: 'v' } } };
  const css = kindCss(node, [], spec).css;
  assert.equal(css, '#n1 .x,\n#n1 .y\n{\ncontent:"\\v" !important;\ncolor:red\n}');
});

// w7-5 follow-up (the 976028e2 page builder): the builder scopes the price rules to the related-product cards. The product page's
// own price container is no longer hidden by an unscoped rule, and the mobile price rule is scoped under the list item.
test('store-product-detail on 976028e2: the desktop price container is not hidden unscoped; the mobile price rule is scoped to the related-product cards', () => {
  const n = makeLeaf({ meta: 'store-product-detail' });
  const css = kindCss(n, mergePalette([])).css;
  assert.doesNotMatch(css, /#[^ {}]+ \.ecomm-price-desktop-container\{display:none/);
  assert.match(css, /\.hl-product-list-item-details \.ecomm-price-mobile-container\{/);
});

// w7-5b: image-feature is NOT compiled on 976028e2. Its malformed featureText rule is not re-ported (a re-learn on the 976028e2
// builder flags 357 of 500 combinations and the tool node is not exact), so it is left to the builder: named under builderStyling.
test('image-feature is not compiled on 976028e2 (not re-ported): it is named under builderStyling, never written from the e1b163ff rule', () => {
  assert.ok(!KIND_CSS_KINDS.includes('image-feature'));
  const w = builderStylingWarning({ sections: [{ id: 's1', elements: [{ ...makeLeaf({ meta: 'image-feature' }), type: 'element' }] }] });
  assert.deepEqual(w.nodes.map((n) => n.kind), ['image-feature']);
});
