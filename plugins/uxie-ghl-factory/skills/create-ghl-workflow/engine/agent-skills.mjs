// w6c-7 (plan Task 7, QA follow-up 2): an AI Agent step's skill ids are checked against the library read when the build has a gateway.
// GET /workflow/agent/{loc}/skills/resolve?ids=a,b (at most ten ids a call; corpus agent-skills.md) answers {skills[], libraryTotal}.
// An id the library does not return is UNRESOLVED and refuses the build, naming it. A service that answers success:false or a non-2xx is
// UNAVAILABLE: the build cannot verify the ids, so it is refused too, and the report says so. Offline, skills are checked for shape only
// (compiler.mjs checkAiAgentAttrs), so this check runs only where a gateway exists.

const RESOLVE_BATCH = 10;

// Every skill id on every ai_agent step, at any depth, each once.
export function collectSkillIds(ir) {
  const ids = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) { for (const x of node) walk(x); return; }
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ai_agent' && Array.isArray(node.attributes?.skills)) {
      for (const s of node.attributes.skills) if (s && typeof s.id === 'string') ids.add(s.id);
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
  };
  walk(ir?.graph ?? []);
  return [...ids];
}

// -> { checked, unresolved: [id], unavailable: string | null }. A spec with no skills makes no call.
export async function resolveAgentSkills(ir, call, loc) {
  const ids = collectSkillIds(ir);
  const out = { checked: ids.length, unresolved: [], unavailable: null };
  for (let i = 0; i < ids.length; i += RESOLVE_BATCH) {
    const batch = ids.slice(i, i + RESOLVE_BATCH);
    const r = await call('GET', `/workflow/agent/${encodeURIComponent(loc)}/skills/resolve?ids=${batch.map((x) => encodeURIComponent(x)).join(',')}`);
    if (!r || !r.ok) { out.unavailable = `the skills library answered ${r?.status ?? 'no response'} for ${batch.join(', ')}`; return out; }
    const body = r.json ?? {};
    if (body.success === false) { out.unavailable = `the skills library answered success:false (${body.message ?? 'no message'})`; return out; }
    const data = 'data' in body ? body.data : body;
    const found = new Set((data?.skills ?? []).map((s) => s.id));
    out.unresolved.push(...batch.filter((id) => !found.has(id)));
  }
  return out;
}
