// w6c-7 (plan Task 7, bl-787, DECISIONS 2026-11-06 "ask, don't default"): the questions an AI Agent step needs answered before it is
// built. The skill asks the operator; the engine never defaults the answer. A step that does not name web search (nativeTools) or a model
// gets an open question, and build_workflow's preview lists it as openQuestions so the agent asks before confirming.
// Answered means: the attribute is present. nativeTools: [] answers "web search off"; a model string answers the model.

const WEB_SEARCH_QUESTION = 'Web search on or off? It costs about 1¢ per search (1.4¢ on Gemini). Answer on: nativeTools '
  + '[{id, toolName: "web_search", description, attributes: {}}]. Answer off: nativeTools [] (no key is written).';
const MODEL_QUESTION = 'Which model should this step use? The engine keeps the current model when none is named. gpt-6-luna is '
  + 'documented, not defaulted, because a cost or behaviour change is the operator\'s call.';

// Every ai_agent step in the spec, at any depth (branches, loops, paths).
function agentSteps(node, out = []) {
  if (Array.isArray(node)) { for (const x of node) agentSteps(x, out); return out; }
  if (node && typeof node === 'object') {
    if (node.type === 'ai_agent') out.push(node);
    for (const v of Object.values(node)) if (v && typeof v === 'object') agentSteps(v, out);
  }
  return out;
}

export function aiAgentOpenQuestions(spec) {
  const questions = [];
  for (const step of agentSteps(spec?.graph ?? [])) {
    const ref = step.ref ?? step.name ?? step.id ?? null;
    const attrs = step.attributes ?? {};
    if (!Object.prototype.hasOwnProperty.call(attrs, 'nativeTools')) questions.push({ step: ref, field: 'webSearch', question: WEB_SEARCH_QUESTION });
    if (attrs.model === undefined) questions.push({ step: ref, field: 'model', question: MODEL_QUESTION });
  }
  return questions;
}
