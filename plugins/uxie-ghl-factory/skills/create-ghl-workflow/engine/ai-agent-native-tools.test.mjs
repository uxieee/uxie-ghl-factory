// w6c-7 (plan Task 7, bl-787): the AI Agent step's web search (nativeTools), its skills gate, and the lift. RED first.
// The engine default is OFF: a step built without nativeTools emits no key. Web search is ON only when the spec asks for it.
// The skills date gate is 2026-10-27T16:00Z (RL: the gate date moved from 2026-10-25): skills before it are REFUSED, after it accepted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compiler.mjs';
import { liftWorkflow } from './lift.mjs';
import { makeSeededIdGen } from './idgen.mjs';
import { loadCatalog } from './catalog.mjs';

const catalog = loadCatalog();
const ctx = (seed = 'ai', extra = {}) => ({ loc: 'LOC', cid: 'CID', uid: 'UID', companyAge: 27, idGen: makeSeededIdGen(seed), catalog, ...extra });
const agentIR = (attrs) => ({ name: 'W', triggers: [{ ref: 't', type: 'contact_tag', name: 'T', filters: [] }], graph: [
  { ref: 'a', kind: 'action', type: 'ai_agent', name: 'Agent', attributes: { prompt: 'Answer {{contact.first_name}}', outputFormat: 'text', ...attrs } }] });
const agentOf = (ir, c = ctx()) => compile(ir, c).autoSaveBody.workflowData.templates.find((s) => s.type === 'ai_agent').attributes;

const WEB = { id: 'web_search', toolName: 'web_search', description: 'Search the web', attributes: {} };
const GATE_BEFORE = Date.parse('2026-10-27T15:59:59.000Z');
const GATE_AFTER = Date.parse('2026-10-27T16:00:00.000Z');

test('no nativeTools key by default: a step built without the spec\'s answer emits no web search', () => {
  const a = agentOf(agentIR({}));
  assert.equal('nativeTools' in a, false);
});

test('web_search is emitted when the spec asks for it, verbatim', () => {
  const a = agentOf(agentIR({ nativeTools: [WEB] }));
  assert.deepEqual(a.nativeTools, [WEB]);
});

test('an empty nativeTools list deletes the key, as the builder does', () => {
  const a = agentOf(agentIR({ nativeTools: [] }));
  assert.equal('nativeTools' in a, false);
});

test('an unknown toolName is refused (AGENT_NATIVE_TOOLS)', () => {
  assert.throws(() => agentOf(agentIR({ nativeTools: [{ ...WEB, toolName: 'browse' }] })), (e) => e.code === 'AGENT_NATIVE_TOOLS' && /browse/.test(e.message));
});

test('a nativeTools entry must be exactly {id, toolName, description, attributes}; a missing id is refused', () => {
  assert.throws(() => agentOf(agentIR({ nativeTools: [{ toolName: 'web_search', description: 'x', attributes: {} }] })), (e) => e.code === 'AGENT_NATIVE_TOOLS');
  assert.throws(() => agentOf(agentIR({ nativeTools: [{ ...WEB, extra: 1 }] })), (e) => e.code === 'AGENT_NATIVE_TOOLS');
});

test('skills before 2026-10-27T16:00Z are REFUSED (AGENT_SKILLS_GATE), after it they are accepted (injected clock)', () => {
  const skills = [{ id: 'builtin:web_search', name: 'Web search' }];
  assert.throws(() => agentOf(agentIR({ skills }), { ...ctx(), now: GATE_BEFORE }), (e) => e.code === 'AGENT_SKILLS_GATE');
  const a = agentOf(agentIR({ skills }), { ...ctx(), now: GATE_AFTER });
  assert.deepEqual(a.skills, skills);
});

test('11 skills are refused (AGENT_SKILLS), after the gate', () => {
  const s = Array.from({ length: 11 }, (_, i) => ({ id: `builtin:k${i}`, name: `K${i}` }));
  assert.throws(() => agentOf(agentIR({ skills: s }), { ...ctx(), now: GATE_AFTER }), (e) => e.code === 'AGENT_SKILLS');
});

test('lift keeps nativeTools verbatim', () => {
  const stored = [{ id: 'a', type: 'ai_agent', name: 'Agent', order: 0, cat: 'action', next: [],
    attributes: { prompt: 'Answer', outputFormat: 'text', nativeTools: [WEB] } }];
  const lifted = liftWorkflow({ doc: { workflowData: { templates: stored } } }, { catalog });
  const found = (o) => {
    if (!o || typeof o !== 'object') return undefined;
    if (Array.isArray(o)) { for (const x of o) { const r = found(x); if (r !== undefined) return r; } return undefined; }
    if ('nativeTools' in o) return o.nativeTools;
    for (const v of Object.values(o)) { const r = found(v); if (r !== undefined) return r; }
    return undefined;
  };
  assert.deepEqual(found(lifted), [WEB]);
});
