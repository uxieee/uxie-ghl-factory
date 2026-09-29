// t24 (2026-09-29): get_agent_session joins managed-agent ratings from /agent-logs/feedback/states (location-wide, sentiment only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../core/tools.mjs';
import { sessionFeedback } from '../core/agent-logs.mjs';

const tool = (n) => TOOLS.find((t) => t.name === n);
const L = 'loc-1'; const S = 'sess-1';
const two = { interactions: [{ traceId: 't1', aiResponses: ['a'] }, { traceId: 't2', aiResponses: ['b'] }], meta: { totalPages: 1 } };
// The real gateway's call() RETURNS {ok:false,status,json} on an HTTP error and THROWS only when the request itself fails.
const deps = (productName, states, calls = [], { statesFail = null } = {}) => ({ state: {}, makeGw: () => ({ call: async (m, p) => {
  calls.push(p);
  if (/\/summary/.test(p)) return { ok: true, status: 200, json: { summary: { productName, totalInteractions: 2 } } };
  if (/\/interactions/.test(p)) return { ok: true, status: 200, json: two };
  if (/feedback\/states/.test(p)) {
    if (statesFail === 'throw') throw new Error('fetch failed');
    if (statesFail) return { ok: false, status: statesFail, json: {} };
    return { ok: true, status: 200, json: { status: 'success', states } };
  }
  return { ok: false, status: 404, json: {} };
} }) });
const STATES = [
  { responseKey: `${S}#1`, sentiment: 'down' }, { responseKey: `${S}#2`, sentiment: 'up' }, { responseKey: S, sentiment: 'up' },
  { responseKey: 'other-session#1', sentiment: 'down' }, { responseKey: `${S}x#1`, sentiment: 'down' }, // other sessions: never joined
];
const run = (d) => tool('get_agent_session').handler({ locationId: L, agentSessionId: S, includeMetrics: false }, d);

test('superagents: each chat-turn rating lands on interaction n, the bare key is the Activity rating, other sessions are dropped', async () => {
  const calls = [];
  const r = await run(deps('superagents', STATES, calls));
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.interactions.map((i) => i.feedback), [{ responseKey: `${S}#1`, sentiment: 'down' }, { responseKey: `${S}#2`, sentiment: 'up' }]);
  assert.deepEqual(r.data.feedback.activity, { sentiment: 'up' });
  assert.deepEqual(r.data.feedback.turns.map((t) => t.turn), [1, 2]);
  assert.equal(r.data.feedback.unplaced, undefined);
  assert.match(r.data.feedback.note, /Sentiment only/);
  const q = new URLSearchParams(calls.find((p) => /feedback\/states/.test(p)).split('?')[1]);
  assert.deepEqual(Object.fromEntries(q), { locationId: L, productType: 'super_agents' }); // the builder's own call: nothing else is honoured
});

test('superagents: an unrated turn is null, and a key past the last interaction is listed as unplaced (never dropped)', async () => {
  const r = await run(deps('superagents', [{ responseKey: `${S}#2`, sentiment: 'up' }, { responseKey: `${S}#5`, sentiment: 'down' }]));
  assert.deepEqual(r.data.interactions.map((i) => i.feedback), [null, { responseKey: `${S}#2`, sentiment: 'up' }]);
  assert.deepEqual(r.data.feedback.unplaced, [{ responseKey: `${S}#5`, turn: 5, sentiment: 'down' }]);
  assert.equal(r.data.feedback.activity, null);
});

test('other products get NO feedback field (not null) and no states read — control: the same session as superagents does get one', async () => {
  for (const p of ['voice_ai', 'conversation_ai', 'agent_studio', 'ask_ai']) {
    const calls = [];
    const r = await run(deps(p, STATES, calls));
    assert.equal(r.ok, true, p);
    assert.equal('feedback' in r.data, false, p);
    assert.equal(r.data.interactions.some((i) => 'feedback' in i), false, p);
    assert.equal(calls.some((c) => /feedback/.test(c)), false, p);
  }
  assert.equal('feedback' in (await run(deps('superagents', STATES))).data, true);
});

test('a failed ratings read never fails the session read: HTTP error and a thrown request both become feedbackError', async () => {
  for (const mode of [500, 'throw']) {
    const r = await run(deps('superagents', STATES, [], { statesFail: mode }));
    assert.equal(r.ok, true, String(mode));
    assert.equal(r.data.interactionCount, 2);
    assert.equal(r.data.feedback, undefined);
    assert.ok(r.data.feedbackError, String(mode));
  }
});

test('sessionFeedback: a malformed turn suffix is unplaced, non-array states are empty', () => {
  const f = sessionFeedback(S, 1, [{ responseKey: `${S}#abc`, sentiment: 'up' }]);
  assert.deepEqual(f.perInteraction, [null]);
  assert.equal(f.unplaced.length, 1);
  assert.deepEqual(sessionFeedback(S, 2, null).perInteraction, [null, null]);
});
