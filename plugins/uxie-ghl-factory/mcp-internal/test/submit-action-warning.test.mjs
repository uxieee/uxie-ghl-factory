// An embedded form/survey/calendar with no on-submit action: submissions store, the visitor sees no success state
// and resubmits (knowledge sniffs/funnels-wave23-form-fields-2026-09-29 w16IsoRetry; funnels silent-failures 49).
// build_funnel_page composes such an embed from a bare formId (extra.action {value: ""}), and the builder's own
// fresh-embed value is "none". Both are flagged under submitAction in the preview and the result; nothing is
// refused and the action is never changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { emptySubmitActions, submitActionWarning } from '../core/submit-action.mjs';

const tool = TOOLS.find((t) => t.name === 'build_funnel_page');
const FORM = { meta: 'form', extra: { formId: { value: 'FORM1', text: 'Opt-in' } } };
const section = (...elements) => ({ background: '#fff', columns: [{ widthPct: 100, elements }] });
const base = { locationId: 'LOC', funnelId: 'F1', pageId: 'P1', stepId: 'S1' };

const deps = (calls = []) => ({
  state: {},
  makeGw: () => ({
    uid: 'USER1',
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (path.startsWith('/funnels/builder/autosave/')) return { ok: true, status: 201, json: { ok: true } };
      if (path.startsWith('/funnels/page/')) return { ok: true, status: 200, json: { _id: 'P1', meta: {} } };
      if (path.startsWith('/funnels/builder/page/data')) {
        const save = [...calls].reverse().find((c) => c.path.startsWith('/funnels/builder/autosave/'));
        return { ok: true, status: 200, json: { sections: (save?.body?.pageData?.sections ?? []).map((s) => ({ id: s.id })) } };
      }
      if (path.startsWith('/funnels/builder/get-versions')) return { ok: true, status: 200, json: [] };
      throw new Error(`unexpected call ${method} ${path}`);
    },
  }),
});

test('emptySubmitActions: "", "none" and a missing action are flagged; a set action is not; other kinds are ignored', () => {
  const el = (meta, action) => ({ type: 'element', id: `${meta}-${action}`, meta, extra: action === undefined ? {} : { action: { value: action } } });
  const pd = { sections: [{ elements: [el('form', ''), el('survey', 'none'), el('calendar', undefined), el('form', 'go-to-next-funnel-step'), el('form', 'url'), el('button', '')] }],
    popupsList: [{ elements: [el('form', '')] }] };
  assert.deepEqual(emptySubmitActions(pd).map((n) => n.id), ['form-', 'survey-none', 'calendar-undefined', 'form-']);
  assert.equal(submitActionWarning({ sections: [{ elements: [el('form', 'url')] }] }), null);
});

test('DIFFERENTIAL compose: a bare-formId form is flagged in the PREVIEW (1.17.1 said nothing), and nothing is refused', async () => {
  const r = await tool.handler({ ...base, sections: [section(FORM)] }, deps());
  assert.equal(r.code, 'CONFIRM_REQUIRED');
  const w = r.data.preview.submitAction;
  assert.ok(w, 'the preview carries submitAction');
  assert.equal(w.nodes.length, 1);
  assert.equal(w.nodes[0].kind, 'form');
  assert.equal(w.nodes[0].action, 'none', 'the builder\'s own default spelling (was "" before f6)');
  assert.match(w.warning, /no success state/);
  assert.match(w.warning, /not one that carries the same form/);
});

test('compose RESULT carries the warning and writes the builder\'s default action `none` when the caller named none', async () => {
  const calls = [];
  const r = await tool.handler({ ...base, sections: [section(FORM)], confirm: true }, deps(calls));
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  assert.equal(r.data.submitAction.nodes.length, 1);
  const saved = calls.find((c) => c.path.startsWith('/funnels/builder/autosave/')).body.pageData.sections;
  const form = saved.flatMap((s) => s.elements).find((e) => e.meta === 'form');
  assert.deepEqual(form.extra.action, { value: 'none' }, 'the builder writes none for a fresh embed, not an empty string; still flagged: no success state');
});

test('a form given an action is not flagged', async () => {
  const withAction = { ...FORM, extra: { ...FORM.extra, action: { value: 'go-to-next-funnel-step' } } };
  const r = await tool.handler({ ...base, sections: [section(withAction)] }, deps());
  assert.equal(r.data.preview.submitAction, undefined);
});
