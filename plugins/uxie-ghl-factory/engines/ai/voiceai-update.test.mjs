import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileVoiceAiPartialUpdate, executeVoiceAiUpdate, readFlat } from './voiceai-update.mjs';
import { serverMessage } from './driver.mjs';

const RECORD = () => ({
  id: 'A', agentName: 'TEST agent', locationId: 'L', llmModel: 'gpt-4.1', timezone: 'Europe/London',
  translation: { enabled: false, language: null },
  sendPostCallNotificationTo: { admins: true, allUsers: false, contactAssignedUser: false, specificUsers: [], customEmails: [] },
  agentSettings: { maxCallDuration: 900, beginMessageDelayMs: 0, voice: { voiceId: 'v1', name: 'Jessica', provider: 'RETELL' },
    language: { code: 'en-US', name: 'English' }, ringDurationMs: 5000, backchannelWords: [], enableBackchannel: false },
});

// A fake server with the measured semantics: top-level merge, flat write → nested read, nested objects whole.
function fakeGw({ record, refuse = null, storeOnRefuse = false, drop = [], collateral = null } = {}) {
  let rec = record; const calls = [];
  const SETTINGS = new Set(Object.keys(rec.agentSettings));
  const apply = (body) => {
    const next = structuredClone(rec);
    for (const [k, v] of Object.entries(body)) {
      if (k === 'locationId' || drop.includes(k)) continue;
      if (k === 'voiceId') next.agentSettings.voice = { ...next.agentSettings.voice, voiceId: v };
      else if (SETTINGS.has(k)) next.agentSettings[k] = v;
      else next[k] = v;
    }
    if (collateral) collateral(next);
    return next;
  };
  return {
    calls,
    call: async (method, path, body) => {
      calls.push({ method, path, body });
      if (method === 'GET') return { ok: true, status: 200, json: structuredClone(rec) };
      if (refuse && refuse(body)) {
        if (storeOnRefuse) rec = apply(body);
        return { ok: false, status: 400, json: { message: '400 request/body/model must be equal to one of the allowed values' } };
      }
      rec = apply(body);
      return { ok: true, status: 200, json: structuredClone(rec) };
    },
  };
}

test('only the spec keys are sent; nested objects are merged over the stored one and sent whole', () => {
  const plan = compileVoiceAiPartialUpdate(RECORD(), { maxCallDuration: 600, sendPostCallNotificationTo: { allUsers: true } }, { agentId: 'A', locationId: 'L' });
  assert.equal(plan.path, '/voice-ai/agents/A');
  assert.deepEqual(Object.keys(plan.body).sort(), ['locationId', 'maxCallDuration', 'sendPostCallNotificationTo']);
  assert.deepEqual(plan.body.sendPostCallNotificationTo, { admins: true, allUsers: true, contactAssignedUser: false, specificUsers: [], customEmails: [] });
});

test('action arrays, numbers, session variables and unknown keys are refused before anything is sent', () => {
  for (const spec of [{ smsActions: [] }, { inboundNumber: 'NUMBER-PLACEHOLDER' }, { agentSettings: {} }, { zzz: 1 }]) {
    assert.throws(() => compileVoiceAiPartialUpdate(RECORD(), spec, { agentId: 'A', locationId: 'L' }), (e) => e.code === 'SPEC_KEY_UNAPPLIED');
  }
});

test('the provider-enforced delay bound is refused early (the provider refuses AFTER GHL stores)', () => {
  assert.throws(() => compileVoiceAiPartialUpdate(RECORD(), { beginMessageDelayMs: 11000 }, { agentId: 'A', locationId: 'L' }), /0–5000/);
  assert.doesNotThrow(() => compileVoiceAiPartialUpdate(RECORD(), { beginMessageDelayMs: 5000 }, { agentId: 'A', locationId: 'L' }));
  assert.throws(() => compileVoiceAiPartialUpdate(RECORD(), { backchannelFrequency: 1.5 }, { agentId: 'A', locationId: 'L' }), /0–1/);
  assert.doesNotThrow(() => compileVoiceAiPartialUpdate(RECORD(), { backchannelFrequency: 1 }, { agentId: 'A', locationId: 'L' }));
});

test('reads map flat write names to the nested read', () => {
  const r = RECORD();
  assert.equal(readFlat(r, 'voiceId'), 'v1');
  assert.equal(readFlat(r, 'language'), 'en-US');
  assert.equal(readFlat(r, 'ringDurationSeconds'), 5);
  assert.equal(readFlat(r, 'maxCallDuration'), 900);
});

test('a clean update verifies and reports no collateral', async () => {
  const before = RECORD(); const gw = fakeGw({ record: before });
  const plan = compileVoiceAiPartialUpdate(before, { maxCallDuration: 600, voiceId: 'v2' }, { agentId: 'A', locationId: 'L' });
  const r = await executeVoiceAiUpdate({ plan, before, gw, serverMessage });
  assert.equal(r.ok, true);
  assert.deepEqual(r.verification.confirmed.sort(), ['maxCallDuration', 'voiceId']);
  assert.equal(r.collateral.unchanged, true);
});

test('a refusal that STILL STORED the value is detected and the previous value written back', async () => {
  const before = RECORD();
  const gw = fakeGw({ record: before, refuse: (b) => b.llmModel === 'bogus-llm', storeOnRefuse: true });
  const plan = compileVoiceAiPartialUpdate(before, { llmModel: 'bogus-llm' }, { agentId: 'A', locationId: 'L' });
  const r = await executeVoiceAiUpdate({ plan, before, gw, serverMessage });
  assert.equal(r.code, 'PROVIDER_REFUSED_BUT_STORED');
  assert.deepEqual(r.written, ['llmModel']);
  assert.equal(r.restored, true);
  assert.equal(gw.calls.filter((c) => c.method === 'PUT').at(-1).body.llmModel, 'gpt-4.1');
});

test('control: a refusal that wrote nothing is a plain failure and nothing is written back', async () => {
  const before = RECORD();
  const gw = fakeGw({ record: before, refuse: (b) => b.maxCallDuration > 7200, storeOnRefuse: false });
  const plan = compileVoiceAiPartialUpdate(before, { maxCallDuration: 7201 }, { agentId: 'A', locationId: 'L' });
  const r = await executeVoiceAiUpdate({ plan, before, gw, serverMessage });
  assert.equal(r.code, 'AGENT_UPDATE_FAILED');
  assert.equal(gw.calls.filter((c) => c.method === 'PUT').length, 1);
});

test('a key accepted but not stored (backchannelWords while backchannel is off) is a mismatch, not a success', async () => {
  const before = RECORD(); const gw = fakeGw({ record: before, drop: ['backchannelWords'] });
  const plan = compileVoiceAiPartialUpdate(before, { backchannelWords: ['mm-hmm'] }, { agentId: 'A', locationId: 'L' });
  const r = await executeVoiceAiUpdate({ plan, before, gw, serverMessage });
  assert.equal(r.code, 'AGENT_VERIFY_MISMATCH');
});

test('a field the update did not touch moving is reported as collateral', async () => {
  const before = RECORD();
  const gw = fakeGw({ record: before, collateral: (n) => { n.timezone = 'America/New_York'; } });
  const plan = compileVoiceAiPartialUpdate(before, { maxCallDuration: 600 }, { agentId: 'A', locationId: 'L' });
  const r = await executeVoiceAiUpdate({ plan, before, gw, serverMessage });
  assert.equal(r.code, 'AGENT_COLLATERAL_CHANGED');
  assert.deepEqual(r.collateral.changed.map((c) => c.key), ['timezone']);
});

// T1b (2026-09-28): the knowledge-base action and the restore report.
function kbGw(before) {
  let rec = structuredClone(before); const calls = [];
  return { calls, call: async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'GET') return { ok: true, status: 200, json: structuredClone(rec) };
    const next = structuredClone(rec);
    if ('knowledgeBaseIds' in body) {
      next.knowledgeBaseIds = body.knowledgeBaseIds;
      const others = (next.actions ?? []).filter((a) => a.actionType !== 'KNOWLEDGE_BASE');
      const kb = (rec.actions ?? []).find((a) => a.actionType === 'KNOWLEDGE_BASE') ?? { _id: 'kbact', actionType: 'KNOWLEDGE_BASE', actionParameters: {} };
      if (body.knowledgeBaseIds.length) {
        const params = { ...kb.actionParameters, knowledgeBaseId: body.knowledgeBaseIds[0], ...('knowledgeBasePrompt' in body ? { triggerPrompt: body.knowledgeBasePrompt } : {}) };
        next.actions = [...others, { ...kb, actionParameters: params }]; next.actionIds = [...others.map((a) => a._id), kb._id];
      } else { next.actions = others; next.actionIds = others.map((a) => a._id); }
    } // a lone knowledgeBasePrompt is ignored, as measured
    rec = next; return { ok: true, status: 200, json: structuredClone(rec) };
  } };
}

test('T1b: attaching a KB with a prompt verifies the prompt on the minted KNOWLEDGE_BASE action, and the action is not collateral', async () => {
  const before = { ...RECORD(), knowledgeBaseIds: [], actions: [{ _id: 'x1', actionType: 'SMS' }], actionIds: ['x1'] };
  const gw = kbGw(before);
  const plan = compileVoiceAiPartialUpdate(before, { knowledgeBaseIds: ['KB1'], knowledgeBasePrompt: 'use it' }, { agentId: 'A', locationId: 'L' });
  const r = await executeVoiceAiUpdate({ plan, before, gw, serverMessage });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.verification.confirmed.sort(), ['knowledgeBaseIds', 'knowledgeBasePrompt']);
});

test('T1b: a lone knowledgeBasePrompt travels with the stored KB ids (alone it is ignored by the server)', async () => {
  const before = { ...RECORD(), knowledgeBaseIds: ['KB1'], actions: [{ _id: 'kbact', actionType: 'KNOWLEDGE_BASE', actionParameters: { knowledgeBaseId: 'KB1', triggerPrompt: 'old' } }], actionIds: ['kbact'] };
  const plan = compileVoiceAiPartialUpdate(before, { knowledgeBasePrompt: 'new' }, { agentId: 'A', locationId: 'L' });
  assert.deepEqual(plan.body.knowledgeBaseIds, ['KB1']);
  const r = await executeVoiceAiUpdate({ plan, before, gw: kbGw(before), serverMessage });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.throws(() => compileVoiceAiPartialUpdate({ ...before, knowledgeBaseIds: [] }, { knowledgeBasePrompt: 'x' }, { agentId: 'A', locationId: 'L' }), /needs a knowledge base/);
});

test('T1b: control — a real non-KB action appearing during a KB change is still collateral', async () => {
  const before = { ...RECORD(), knowledgeBaseIds: [], actions: [], actionIds: [] };
  const base = kbGw(before);
  const gw = { calls: base.calls, call: async (m, p, b) => { const r = await base.call(m, p, b); if (m === 'GET' && base.calls.length > 1) { r.json.actions = [...(r.json.actions ?? []), { _id: 'rogue', actionType: 'SMS' }]; r.json.actionIds = [...(r.json.actionIds ?? []), 'rogue']; } return r; } };
  const plan = compileVoiceAiPartialUpdate(before, { knowledgeBaseIds: ['KB1'] }, { agentId: 'A', locationId: 'L' });
  const r = await executeVoiceAiUpdate({ plan, before, gw, serverMessage });
  assert.equal(r.code, 'AGENT_COLLATERAL_CHANGED');
});

test('T1b: the restore report carries the values, and a restore that does not verify is its own loud code', async () => {
  const before = RECORD();
  const ok = fakeGw({ record: before, refuse: (b) => b.llmModel === 'bogus-llm', storeOnRefuse: true });
  const r1 = await executeVoiceAiUpdate({ plan: compileVoiceAiPartialUpdate(before, { llmModel: 'bogus-llm' }, { agentId: 'A', locationId: 'L' }), before, gw: ok, serverMessage });
  assert.deepEqual(r1.values.llmModel, { sent: 'bogus-llm', storedAfterRefusal: 'bogus-llm', restoredTo: 'gpt-4.1', readsNow: 'gpt-4.1' });
  // every PUT is refused and stored, so the write-back is refused too — and here it does not land
  const stuck = fakeGw({ record: before, refuse: () => true, storeOnRefuse: true });
  const origCall = stuck.call; let puts = 0;
  stuck.call = async (m, p, b) => { if (m === 'PUT' && ++puts > 1) return { ok: false, status: 400, json: { message: 'no' } }; return origCall(m, p, b); };
  const r2 = await executeVoiceAiUpdate({ plan: compileVoiceAiPartialUpdate(before, { llmModel: 'bogus-llm' }, { agentId: 'A', locationId: 'L' }), before, gw: stuck, serverMessage });
  assert.equal(r2.code, 'PROVIDER_REFUSED_RESTORE_FAILED');
  assert.deepEqual(r2.diverged, ['llmModel']);
});

test('T1b: a model change reports the provider cascade separately; the same fields moving on another change are collateral', async () => {
  const before = { ...RECORD(), provider: 'RETELL', providerAgentId: 'agent_x', providerAgents: [] };
  const flip = (n) => { n.provider = 'lc'; n.providerAgentId = 'lc_A'; n.providerAgents = [{ provider: 'RETELL' }, { provider: 'lc' }]; n.agentSettings.s2sBehaviour = { voiceId: 'marin' }; };
  const r = await executeVoiceAiUpdate({ plan: compileVoiceAiPartialUpdate(before, { llmModel: 'gpt-realtime-2.1' }, { agentId: 'A', locationId: 'L' }), before, gw: fakeGw({ record: before, collateral: flip }), serverMessage });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.collateral.cascade.map((c) => c.key).sort(), ['agentSettings.s2sBehaviour', 'provider', 'providerAgentId', 'providerAgents']);
  const r2 = await executeVoiceAiUpdate({ plan: compileVoiceAiPartialUpdate(before, { maxCallDuration: 600 }, { agentId: 'A', locationId: 'L' }), before, gw: fakeGw({ record: before, collateral: flip }), serverMessage });
  assert.equal(r2.code, 'AGENT_COLLATERAL_CHANGED');
});

test('aiDisclaimerConfiguration: the read-only isGreetingMessageDynamic the read carries is not echoed, and the change verifies', async () => {
  const before = RECORD();
  before.aiDisclaimerConfiguration = { disclaimerEnabled: true, outboundDisclaimerType: 'concise', outboundDisclaimerMessage: 'm', outboundIntentMessage: '', isGreetingMessageDynamic: null, playDisclaimerOnEveryCall: true };
  // measured: echoing the key answers 422 "property isGreetingMessageDynamic should not exist" and writes nothing
  const gw = fakeGw({ record: before, refuse: (b) => b.aiDisclaimerConfiguration && 'isGreetingMessageDynamic' in b.aiDisclaimerConfiguration });
  gw.call = ((inner) => async (m, p, b) => {
    const r = await inner(m, p, b);
    if (m === 'PUT' && r.ok) r.json.aiDisclaimerConfiguration = { ...r.json.aiDisclaimerConfiguration, isGreetingMessageDynamic: null };
    return r;
  })(gw.call);
  const plan = compileVoiceAiPartialUpdate(before, { aiDisclaimerConfiguration: { playDisclaimerOnEveryCall: false } }, { agentId: 'A', locationId: 'L' });
  assert.equal('isGreetingMessageDynamic' in plan.body.aiDisclaimerConfiguration, false);
  assert.equal(plan.body.aiDisclaimerConfiguration.outboundDisclaimerType, 'concise');
  const r = await executeVoiceAiUpdate({ plan, before, gw, serverMessage });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.verification.confirmed, ['aiDisclaimerConfiguration']);
});

test('aiDisclaimerConfiguration: a spec that sends isGreetingMessageDynamic is refused before sending', () => {
  assert.throws(() => compileVoiceAiPartialUpdate(RECORD(), { aiDisclaimerConfiguration: { isGreetingMessageDynamic: true } }, { agentId: 'A', locationId: 'L' }),
    (e) => e.code === 'SPEC_KEY_UNAPPLIED' && /read-only/.test(e.message));
});

test('sessionVariables: merged into the stored list by name — nothing stored is dropped unless removed by name', () => {
  const rec = RECORD();
  rec.sessionVariables = [{ name: 'session.a', label: 'A', dataType: 'string', defaultValue: '' }, { name: 'session.b', label: 'B', dataType: 'number', defaultValue: '0' }];
  const add = compileVoiceAiPartialUpdate(rec, { sessionVariables: [{ name: 'session.c', label: 'C' }] }, { agentId: 'A', locationId: 'L' });
  assert.deepEqual(add.body.sessionVariables.map((v) => v.name), ['session.a', 'session.b', 'session.c']);
  assert.deepEqual(add.body.sessionVariables[2], { name: 'session.c', label: 'C', dataType: 'string', defaultValue: '' });
  const upd = compileVoiceAiPartialUpdate(rec, { sessionVariables: [{ name: 'session.b', defaultValue: '5' }] }, { agentId: 'A', locationId: 'L' });
  assert.deepEqual(upd.body.sessionVariables[1], { name: 'session.b', label: 'B', dataType: 'number', defaultValue: '5' });
  assert.equal(upd.body.sessionVariables.length, 2);
  const rm = compileVoiceAiPartialUpdate(rec, { sessionVariables: [{ name: 'session.a', remove: true }] }, { agentId: 'A', locationId: 'L' });
  assert.deepEqual(rm.body.sessionVariables.map((v) => v.name), ['session.b']);
});

test('sessionVariables: the server rules are refused before sending', () => {
  const rec = RECORD(); rec.sessionVariables = [{ name: 'session.a', label: 'A', dataType: 'string', defaultValue: '' }];
  const bad = [[{ name: 'ticket_id' }], [{ name: 'session.' + 'x'.repeat(60) }], [{ name: 'session.c', dataType: 'date' }],
    [{ name: 'session.c' }, { name: 'session.c' }], [{ name: 'session.zz', remove: true }], []];
  for (const sessionVariables of bad) {
    assert.throws(() => compileVoiceAiPartialUpdate(rec, { sessionVariables }, { agentId: 'A', locationId: 'L' }), (e) => e.code === 'SCHEMA', JSON.stringify(sessionVariables));
  }
});

test('sessionVariables: a merged write verifies by value', async () => {
  const before = RECORD(); before.sessionVariables = [{ name: 'session.a', label: 'A', dataType: 'string', defaultValue: '' }];
  const gw = fakeGw({ record: before });
  const plan = compileVoiceAiPartialUpdate(before, { sessionVariables: [{ name: 'session.b', label: 'B' }] }, { agentId: 'A', locationId: 'L' });
  const r = await executeVoiceAiUpdate({ plan, before, gw, serverMessage });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.verification.confirmed, ['sessionVariables']);
});

const S2S = () => { const r = RECORD(); r.provider = 'lc'; r.agentSettings.s2sBehaviour = { totalTokens: 1187, voiceId: 'marin', llmModel: 'gpt-realtime-2.1', responseDepth: 'high', vadEagerness: 'low', languages: ['es'] }; return r; };
// the measured server: s2sBehaviour merges into agentSettings.s2sBehaviour, languages replace + normalise, totalTokens recomputed
function s2sGw(record) {
  const gw = fakeGw({ record });
  const inner = gw.call;
  gw.call = async (m, p, b) => {
    if (m === 'PUT' && b?.s2sBehaviour) {
      const { s2sBehaviour, ...rest } = b;
      const r = await inner(m, p, rest);
      const cur = r.json.agentSettings.s2sBehaviour;
      const inc = { ...s2sBehaviour, ...(s2sBehaviour.languages ? { languages: s2sBehaviour.languages.map((x) => x.split('-')[0]) } : {}) };
      r.json.agentSettings.s2sBehaviour = { ...cur, ...inc, totalTokens: cur.totalTokens + 1 };
      await inner('PUT', p, { agentSettings: r.json.agentSettings });
      return r;
    }
    return inner(m, p, b);
  };
  return gw;
}

test('s2sBehaviour: a non-s2s agent is refused before anything is sent (the stored provider decides)', () => {
  assert.throws(() => compileVoiceAiPartialUpdate(RECORD(), { s2sBehaviour: { vadEagerness: 'high' } }, { agentId: 'A', locationId: 'L' }),
    (e) => e.code === 'SPEC_KEY_UNAPPLIED' && /llmModel/.test(e.message));
  // a spec that also switches the model is still judged by the STORED provider
  assert.throws(() => compileVoiceAiPartialUpdate(RECORD(), { llmModel: 'gpt-realtime-2.1', s2sBehaviour: { vadEagerness: 'high' } }, { agentId: 'A', locationId: 'L' }),
    (e) => e.code === 'SPEC_KEY_UNAPPLIED');
});

test('s2sBehaviour: enums are this tool\'s rule and the error lists the allowed values; unknown inner keys refused', () => {
  assert.throws(() => compileVoiceAiPartialUpdate(S2S(), { s2sBehaviour: { responseDepth: 'extreme' } }, { agentId: 'A', locationId: 'L' }),
    (e) => /minimal, low, medium, high, xhigh/.test(e.message) && /GHL stores any string/.test(e.message));
  assert.throws(() => compileVoiceAiPartialUpdate(S2S(), { s2sBehaviour: { vadEagerness: 'sometimes' } }, { agentId: 'A', locationId: 'L' }), /auto, low, medium, high/);
  assert.throws(() => compileVoiceAiPartialUpdate(S2S(), { s2sBehaviour: { voiceId: 'cedar' } }, { agentId: 'A', locationId: 'L' }), (e) => e.code === 'SPEC_KEY_UNAPPLIED');
});

test('s2sBehaviour: only the sent keys go out; languages are sent as base codes (what the server stores)', () => {
  const plan = compileVoiceAiPartialUpdate(S2S(), { s2sBehaviour: { vadEagerness: 'medium', languages: ['en-US', 'fr', 'en-GB'] } }, { agentId: 'A', locationId: 'L' });
  assert.deepEqual(plan.body.s2sBehaviour, { vadEagerness: 'medium', languages: ['en', 'fr'] });
});

test('s2sBehaviour: a merged write verifies the sent keys and the others are untouched (totalTokens ignored)', async () => {
  const before = S2S(); const gw = s2sGw(before);
  const plan = compileVoiceAiPartialUpdate(before, { s2sBehaviour: { vadEagerness: 'medium' } }, { agentId: 'A', locationId: 'L' });
  const r = await executeVoiceAiUpdate({ plan, before, gw, serverMessage });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.verification.confirmed, ['s2sBehaviour']);
});
