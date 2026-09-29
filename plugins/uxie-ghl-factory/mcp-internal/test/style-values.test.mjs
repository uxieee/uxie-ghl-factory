// bl-332: an authored style value is stored in the builder's shape ({value} / {value, unit}), never bare. Each shape, a control that an
// already-shaped value passes untouched, and the refusals by name. Through the tool: a bare-string style on compose / insert / set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStyleValue as n, normalizeStyles, isShaped } from '../core/style-values.mjs';
import { storedMap } from '../core/style-layer.mjs';
import { TOOLS } from '../core/tools.mjs';

test('unit strings split into {value, unit}: px, %, em, rem, negatives and decimals', () => {
  assert.deepEqual(n('paddingTop', '16px'), { value: 16, unit: 'px' });
  assert.deepEqual(n('width', '50%'), { value: 50, unit: '%' });
  assert.deepEqual(n('lineHeight', '1.3em'), { value: 1.3, unit: 'em' });
  assert.deepEqual(n('marginTop', '-2.5rem'), { value: -2.5, unit: 'rem' });
  assert.deepEqual(n('fontSize', ' 18px '), { value: 18, unit: 'px' });
});

test('colours, keywords, functions and shorthands go to {value} whole', () => {
  for (const [k, v] of [['color', '#d00000'], ['backgroundColor', 'rgba(1, 2, 3, .5)'], ['color', 'var(--white)'], ['fontWeight', 'bold'], ['borderStyle', 'solid'],
    ['boxShadow', '0 1px 2px rgba(0,0,0,.1)'], ['fontFamily', "'Roboto', sans-serif"], ['textAlign', 'center'], ['marginLeft', 'auto']]) assert.deepEqual(n(k, v), { value: v }, `${k}: ${v}`);
});

test('numbers: px on a key that carries a unit, plain on one that does not', () => {
  assert.deepEqual(n('paddingTop', 12), { value: 12, unit: 'px' });
  assert.deepEqual(n('borderRadius', 8), { value: 8, unit: 'px' });
  assert.deepEqual(n('opacity', 0.5), { value: 0.5 });
  assert.deepEqual(n('zIndex', 3), { value: 3 });
  assert.deepEqual(n('paddingTop', '12'), { value: 12, unit: 'px' });
});

test('CONTROL: an already-shaped value passes through untouched (same object), including per-device weights', () => {
  for (const v of [{ value: 16, unit: 'px' }, { value: '#fff' }, { value: 'bold', desktop: '400', mobile: '400' }, { unit: 'px', value: 8 }, { desktop: '400' }]) {
    assert.equal(n('x', v), v); assert.ok(isShaped(v));
  }
});

test('refused by name: null, boolean, array, an unshaped object, an empty string, NaN', () => {
  assert.throws(() => n('color', null), /styles\.color: null/);
  assert.throws(() => n('color', true), /styles\.color: boolean/);
  assert.throws(() => n('padding', [1, 2]), /styles\.padding: an array/);
  assert.throws(() => n('padding', { top: 1 }), /styles\.padding: an object with none of/);
  assert.throws(() => n('color', '  '), /styles\.color: an empty string/);
  assert.throws(() => n('width', NaN), /styles\.width: NaN/);
  assert.throws(() => normalizeStyles([1]), /must be an object/);
  assert.throws(() => normalizeStyles({ a: null }, 'edits[2].styles'), /edits\[2\]\.styles\.a/);
});

test('storedMap (wrapper / device maps) splits unit strings the same way; a number stays px', () => {
  assert.deepEqual(storedMap({ marginTop: '16px', marginLeft: 'auto', paddingTop: 10, w: '50%' }),
    { marginTop: { value: 16, unit: 'px' }, marginLeft: { value: 'auto' }, paddingTop: { value: 10, unit: 'px' }, w: { value: 50, unit: '%' } });
  assert.deepEqual(storedMap({ marginTop: { value: 4, unit: 'px' } }), { marginTop: { value: 4, unit: 'px' } });
});

// ---- through the tool ----
const tool = TOOLS.find((t) => t.name === 'build_funnel_page');
const deps = (calls) => ({ state: {}, makeGw: () => ({ uid: 'U', call: async (method, path, body) => {
  calls.push({ method, path, body });
  if (path.startsWith('/funnels/builder/autosave/')) return { ok: true, status: 201, json: {} };
  if (path.startsWith('/funnels/builder/get-versions')) return { ok: true, status: 200, json: [] };
  if (path.startsWith('/funnels/page/')) return { ok: true, status: 200, json: { _id: 'P1', locationId: 'L', funnelId: 'F', meta: {} } };
  if (path.startsWith('/funnels/builder/page/data')) { const s = [...calls].reverse().find((c) => c.path.startsWith('/funnels/builder/autosave/')); return { ok: true, status: 200, json: s.body.pageData }; }
  throw new Error(`unexpected ${method} ${path}`);
} }) });

test('through the tool: compose stores {value} / {value, unit} for bare strings and numbers; the public rule is the same; a bad value is refused before any write', async () => {
  const calls = [];
  const spec = { columns: [{ elements: [{ meta: 'paragraph', html: 'x', styles: { color: '#d00000', paddingTop: '16px', width: '50%', opacity: 0.5 } }] }] };
  const res = await tool.handler({ locationId: 'L', funnelId: 'F', pageId: 'P1', stepId: 'S', sections: [spec], confirm: true }, deps(calls));
  assert.equal(res.ok, true, JSON.stringify(res).slice(0, 400));
  const save = calls.find((c) => c.path.startsWith('/funnels/builder/autosave/')).body.pageData;
  const p = save.sections[0].elements.find((e) => e.meta === 'paragraph');
  assert.deepEqual([p.styles.color, p.styles.paddingTop, p.styles.width, p.styles.opacity], [{ value: '#d00000' }, { value: 16, unit: 'px' }, { value: 50, unit: '%' }, { value: 0.5 }]);
  assert.match(save.sections[0].general.sectionStyles, new RegExp(`\\.${p.id}\\{[^}]*color:#d00000`));
  const bad = []; const r2 = await tool.handler({ locationId: 'L', funnelId: 'F', pageId: 'P1', stepId: 'S', sections: [{ columns: [{ elements: [{ meta: 'paragraph', html: 'x', styles: { color: null } }] }] }], confirm: true }, deps(bad));
  assert.equal(r2.code, 'VALIDATION_FAILED'); assert.match(JSON.stringify(r2), /styles\.color: null/); assert.ok(!bad.some((c) => c.path.startsWith('/funnels/builder/autosave/')));
});
