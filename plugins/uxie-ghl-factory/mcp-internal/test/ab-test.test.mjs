// w6c-6 (plan Task 6, bl-788, tools half): the A/B Test tools. RED first. Mocks sit at the real gateway seam: each handler gets a
// deps.makeGw that returns a gateway whose call(method, path, body) is recorded. Nothing here reaches GHL; live reads are gate G1
// and declaring a winner is gate G2 (prepared, never run from a test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import * as ab from '../core/ab-test.mjs';
import { pathIdsQuery, rollupAbStats, PATH_IDS_FORMS, DECLARE_PREVIEW } from '../core/ab-test.mjs';
import { makeW6cTools } from '../core/workflow-w6c-tools.mjs';
import { CODES } from '../core/errors.mjs';

const describe = (_tool, fallback) => fallback;
const schema = (shape) => z.object(shape).passthrough();
const guard = (fn) => fn();
const tools = makeW6cTools({ describe, schema, guard });
const tool = (name) => tools.find((t) => t.name === name);

// The step's own path definitions (attributes.paths): id and name, as the builder stores them.
const DEFS = [{ id: 'pA', name: 'Path A' }, { id: 'pB', name: 'Path B' }];

// A mock gateway at the real seam: routes by method + path prefix and records every call.
function mockGw(routes) {
  const calls = [];
  const gw = {
    async call(method, path, body) {
      calls.push({ method, path, body });
      const hit = routes.find((r) => r.method === method && path.startsWith(r.path));
      if (!hit) throw new Error(`unrouted ${method} ${path}`);
      return typeof hit.respond === 'function' ? hit.respond(path, body) : hit.respond;
    },
  };
  return { gw, calls, deps: { makeGw: () => gw, state: {} } };
}
const abWorkflow = { _id: 'wid1', name: 'AB', status: 'draft', workflowData: { templates: [
  { id: 'step1', type: 'workflow_ab_test', attributes: { paths: DEFS } },
] } };

test('pathIdsQuery pins all three serialisations: csv, repeated key, and the axios bracket form (AB:88)', () => {
  assert.equal(pathIdsQuery(['a', 'b'], 'csv'), 'pathIds=a,b');
  assert.equal(pathIdsQuery(['a', 'b'], 'repeated'), 'pathIds=a&pathIds=b');
  assert.equal(pathIdsQuery(['a', 'b'], 'bracket'), 'pathIds[]=a&pathIds[]=b');
  assert.deepEqual(PATH_IDS_FORMS, ['csv', 'repeated', 'bracket']);
  assert.throws(() => pathIdsQuery(['a'], 'nope'));
});

test('rollupAbStats returns { status, winnerPathId, paths[{pathId, name, entered?, converted?, rate?}], absent[] }', () => {
  const r = rollupAbStats({ paths: [{ pathId: 'pA', entered: 10, converted: 2 }] }, DEFS, { isStepExecuted: true });
  assert.deepEqual(Object.keys(r).sort(), ['absent', 'paths', 'status', 'winnerPathId']);
  assert.equal(r.paths.length, 1, 'only the reported path is in paths');
  assert.equal(r.paths[0].pathId, 'pA');
  assert.equal(r.paths[0].name, 'Path A', 'the path name comes from the step definition');
  assert.equal(r.paths[0].entered, 10);
  assert.equal(r.paths[0].converted, 2);
});

test('a path missing from stats is in absent[], not counted as 0', () => {
  const r = rollupAbStats({ paths: [{ pathId: 'pA', entered: 10, converted: 2 }] }, DEFS);
  assert.deepEqual(r.absent, ['pB']);
  assert.equal(r.paths.find((p) => p.pathId === 'pB'), undefined, 'an absent path has no row in paths');
});

test('rate = converted / entered, and null when a path entered no contacts', () => {
  const r = rollupAbStats({ paths: [{ pathId: 'pA', entered: 4, converted: 1 }, { pathId: 'pB', entered: 0, converted: 0 }] }, DEFS);
  assert.equal(r.paths.find((p) => p.pathId === 'pA').rate, 0.25);
  assert.equal(r.paths.find((p) => p.pathId === 'pB').rate, null);
});

test('a missing count is unknown (undefined), never 0, and its rate is unknown too', () => {
  const noEntered = rollupAbStats({ paths: [{ pathId: 'pA', converted: 1 }] }, DEFS).paths[0];
  assert.equal(noEntered.entered, undefined, 'entered is unknown, not 0');
  assert.equal(noEntered.rate, undefined, 'a rate with no entered count is unknown, not 0');
  const noConverted = rollupAbStats({ paths: [{ pathId: 'pB', entered: 4 }] }, DEFS).paths[0];
  assert.equal(noConverted.converted, undefined, 'converted is unknown, not 0');
  assert.equal(noConverted.rate, undefined, 'a rate with no converted count is unknown, not 0');
});

test('status: the stats response status when it has one; otherwise from isExecuted (fail closed to not-executed)', () => {
  assert.equal(rollupAbStats({ status: 'running', paths: [] }, DEFS, { isStepExecuted: false }).status, 'running');
  assert.equal(rollupAbStats({ paths: [] }, DEFS, { isStepExecuted: true }).status, 'executed');
  assert.equal(rollupAbStats({ paths: [] }, DEFS, { isStepExecuted: false }).status, 'not-executed');
  assert.equal(rollupAbStats({ paths: [] }, DEFS).status, 'not-executed', 'no isExecuted response fails closed');
});

test('winnerPathId is passed through from the stats response (null when there is none)', () => {
  assert.equal(rollupAbStats({ paths: [], winnerPathId: 'pA' }, DEFS).winnerPathId, 'pA');
  assert.equal(rollupAbStats({ paths: [] }, DEFS).winnerPathId, null);
});

test('declareWinnerRequest builds the POST for the declare-winner route, with an empty body', () => {
  const req = ab.declareWinnerRequest('LOC', 'wid1', 'step1');
  assert.deepEqual(req, {
    method: 'POST',
    path: '/workflow/LOC/split/ab-test/declare-winner',
    query: 'workflowId=wid1&stepId=step1',
    body: {},
  });
});

test('declareWinnerRequest encodes the ids in the query', () => {
  const req = ab.declareWinnerRequest('LOC', 'w/1', 's 1');
  assert.equal(req.query, 'workflowId=w%2F1&stepId=s%201');
});

test('get_ab_test_stats reads the workflow for the path ids, then stats and isExecuted, and rolls the stats up', async () => {
  const { deps, calls } = mockGw([
    { method: 'GET', path: '/workflow/LOC/wid1', respond: { ok: true, status: 200, json: abWorkflow } },
    { method: 'GET', path: '/workflow/LOC/split/stats', respond: { ok: true, status: 200, json: { paths: [{ pathId: 'pA', entered: 6, converted: 3 }] } } },
    { method: 'GET', path: '/workflow/LOC/split/isExecuted', respond: { ok: true, status: 200, json: { isStepExecuted: true } } },
  ]);
  const out = await tool('get_ab_test_stats').handler({ locationId: 'LOC', workflowId: 'wid1', stepId: 'step1' }, deps);
  const body = out.data;
  assert.equal(body.status, 'executed');
  assert.equal('proof' in body, false, 'the data states no proof: the seeded label (describe) is the one proof (QA nit)');
  assert.deepEqual(body.absent, ['pB']);
  assert.equal(body.paths[0].name, 'Path A');
  assert.equal(body.paths[0].rate, 0.5);
  assert.ok(calls.some((c) => c.path.includes('split/stats') && c.path.includes('pathIds=pA&pathIds=pB')), 'the stats call carries both path ids (repeated form, w6c-6b)');
  assert.equal(calls.every((c) => c.method === 'GET'), true, 'reads only');
});

test('declare_ab_test_winner without confirm returns the house CONFIRM_REQUIRED preview and makes NO request', async () => {
  const { deps, calls } = mockGw([]);
  const out = await tool('declare_ab_test_winner').handler({ locationId: 'LOC', workflowId: 'wid1', stepId: 'step1' }, deps);
  assert.equal(calls.length, 0, 'zero gateway calls without confirm');
  assert.equal(out.ok, false);
  assert.equal(out.code, CODES.CONFIRM_REQUIRED);
  assert.equal(out.data.preview, DECLARE_PREVIEW);
  assert.match(out.data.preview, /routes every new contact to the leading path/);
  assert.match(DECLARE_PREVIEW, /cannot be undone in the UI/);
});

test('declare_ab_test_winner with confirm POSTs the declare-winner route with an empty body', async () => {
  const { deps, calls } = mockGw([
    { method: 'POST', path: '/workflow/LOC/split/ab-test/declare-winner', respond: { ok: true, status: 200, json: { ok: true } } },
  ]);
  await tool('declare_ab_test_winner').handler({ locationId: 'LOC', workflowId: 'wid1', stepId: 'step1', confirm: true }, deps);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].path, /declare-winner\?workflowId=wid1&stepId=step1/);
  assert.deepEqual(calls[0].body, {});
});

test('a 409 from declare-winner maps to WINNER_ALREADY_DECLARED', async () => {
  assert.equal(CODES.WINNER_ALREADY_DECLARED, 'WINNER_ALREADY_DECLARED');
  const { deps } = mockGw([
    { method: 'POST', path: '/workflow/LOC/split/ab-test/declare-winner', respond: { ok: false, status: 409, json: { msg: 'already declared' } } },
  ]);
  const out = await tool('declare_ab_test_winner').handler({ locationId: 'LOC', workflowId: 'wid1', stepId: 'step1', confirm: true }, deps);
  assert.equal(out.ok, false);
  assert.equal(out.code, 'WINNER_ALREADY_DECLARED');
});

test('descriptions are at most 2048 characters and carry the proof and the risk', () => {
  for (const name of ['get_ab_test_stats', 'declare_ab_test_winner']) {
    const d = tool(name).description;
    assert.ok(d.length <= 2048, `${name} is ${d.length} characters`);
    assert.match(d, /proof:/, `${name} carries its proof label`);
  }
  assert.match(tool('declare_ab_test_winner').description, /Risk: destructive/);
  assert.match(tool('get_ab_test_stats').description, /capture-only/);
});

// w6c-6b (DECISIONS, approved): the live G1 read on GROM Sandbox (2026-11-07). The stats call must use the repeated pathIds form (csv
// returned HTTP 500), and rollupAbStats must read the real shape: abTest.perPath counts, the top-level path keys, abTest.status and
// totalContactsEntered. The body is the scrubbed real response in fixtures/ab-stats-real-body.json (path ids are placeholders).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const realFx = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/ab-stats-real-body.json'), 'utf8'));

test('w6c-6b: the real GHL body rolls up to 2/2/2 entered, 0 converted, status running, no winner', () => {
  const r = rollupAbStats(realFx.body, realFx.defs, realFx.isExecuted);
  assert.equal(r.status, 'running');
  assert.equal(r.winnerPathId, null);
  assert.deepEqual(r.absent, []);
  assert.equal(r.paths.length, 3);
  for (const p of r.paths) {
    assert.equal(p.entered, 2, p.pathId);
    assert.equal(p.converted, 0, p.pathId);
    assert.equal(p.rate, 0, p.pathId);
  }
  assert.equal(r.paths.find((p) => p.pathId === 'PATH_B').name, 'Path B');
});

test('w6c-6b: a real body with abTest.perPath but no top-level keys still rolls up (perPath is read)', () => {
  const body = { abTest: { status: 'running', winnerPathId: null, perPath: { PATH_A: { entered: 4, converted: 1 } } } };
  const r = rollupAbStats(body, [{ id: 'PATH_A', name: 'Path A' }], { isStepExecuted: true });
  assert.equal(r.paths[0].entered, 4);
  assert.equal(r.paths[0].converted, 1);
  assert.equal(r.paths[0].rate, 0.25);
});

test('w6c-6b: the shipped handler sends the repeated pathIds form (not csv)', async () => {
  const { deps, calls } = mockGw([
    { method: 'GET', path: '/workflow/LOC/wid1', respond: { ok: true, status: 200, json: abWorkflow } },
    { method: 'GET', path: '/workflow/LOC/split/stats', respond: { ok: true, status: 200, json: realFx.body } },
    { method: 'GET', path: '/workflow/LOC/split/isExecuted', respond: { ok: true, status: 200, json: { isStepExecuted: true } } },
  ]);
  await tool('get_ab_test_stats').handler({ locationId: 'LOC', workflowId: 'wid1', stepId: 'step1' }, deps);
  const statsCall = calls.find((c) => c.path.includes('split/stats'));
  assert.match(statsCall.path, /pathIds=pA&pathIds=pB/, 'the stats call repeats the key, one per path');
  assert.doesNotMatch(statsCall.path, /pathIds=pA,pB/);
});
