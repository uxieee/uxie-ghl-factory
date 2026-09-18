// A trigger filter GHL does not understand is stored with the same 200 as one it does. The only
// place the difference is visible is the row model, so the compiler says it there. These tests pin
// both directions: the warning FIRES on an invented field, and stays SILENT on every filter a
// UI-built trigger was seen to store — a warning that also fired on those would be noise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadCatalog } from './catalog.mjs';
import { buildTrigger } from './compiler.mjs';
import { makeSeededIdGen } from './idgen.mjs';

const catalog = loadCatalog();
const mk = (w) => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen('u'), catalog, skipTriggerSeeds: true, warn: (m) => w.push(m) });
const red = (w) => w.filter((m) => m.includes('TRIGGER_FILTER_UNKNOWN'));

test('an invented filter field warns, names the rows the trigger does offer, and is still sent as authored', () => {
  const w = [];
  const body = buildTrigger({ ref: 't', type: 'contact_tag', name: 'T', filters: [{ field: 'add_tag', operator: '==', value: 'vip' }] }, mk(w), 'WID', new Map());
  assert.equal(red(w).length, 1);
  assert.match(red(w)[0], /add_tag/);
  assert.match(red(w)[0], /tagsAdded/);
  assert.deepEqual(body.conditions, [{ field: 'add_tag', operator: '==', value: 'vip' }]);
});

test('control: the real row on the same trigger raises nothing', () => {
  const w = [];
  const body = buildTrigger({ ref: 't', type: 'contact_tag', name: 'T', filters: [{ field: 'tagsAdded', value: 'vip' }] }, mk(w), 'WID', new Map());
  assert.equal(red(w).length, 0);
  assert.ok(body.conditions[0].title && body.conditions[0].type, 'the model row fills title/type');
});

test('a row only the UI-built corpus knows is FILLED, not warned', () => {
  const w = [];
  const body = buildTrigger({ ref: 't', type: 'opportunity_created', name: 'T', filters: [{ field: 'opportunity.pipelineStageId', value: 'S' }] }, mk(w), 'WID', new Map());
  assert.equal(red(w).length, 0);
  assert.deepEqual(body.conditions.find((c) => c.field === 'opportunity.pipelineStageId'),
    { field: 'opportunity.pipelineStageId', value: 'S', operator: '==', title: 'Pipeline stage', type: 'select' });
  assert.ok(w.some((m) => m.includes('TRIGGER_FILTER_OPERATOR_FILLED')), 'a supplied operator is never silent');
});

test('an authored operator always wins over the observed one', () => {
  const w = [];
  const body = buildTrigger({ ref: 't', type: 'opportunity_created', name: 'T', filters: [{ field: 'opportunity.pipelineStageId', operator: '!=', value: 'S' }] }, mk(w), 'WID', new Map());
  assert.equal(body.conditions.find((c) => c.field === 'opportunity.pipelineStageId').operator, '!=');
  assert.equal(w.filter((m) => m.includes('TRIGGER_FILTER_')).length, 0);
});

test('no filter a UI-built trigger stored raises the warning when re-authored lean', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../catalog/trigger-examples');
  let checked = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const trig = j.trigger ?? j;
    const type = trig.type ?? f.replace(/\.json$/, '');
    for (const c of trig.conditions ?? []) {
      if (c.id === 'custom-field') continue;
      const w = [];
      buildTrigger({ ref: 't', type, name: 'T', filters: [{ field: c.field, operator: c.operator, value: c.value }] }, mk(w), 'WID', new Map());
      assert.equal(red(w).length, 0, `${type} :: ${c.field}`);
      checked++;
    }
  }
  assert.ok(checked >= 30, `expected the stored corpus, checked ${checked}`);
});
