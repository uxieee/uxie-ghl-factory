// IR (intermediate representation) parser + invariant validator.
// See docs/superpowers/specs/2026-07-10-create-ghl-workflow-v2-design.md §4.
export class IRError extends Error {
  constructor(code, message) { super(message); this.name = 'IRError'; this.code = code; }
}

// Walk every node (graph + nested then[]) and every trigger, collecting refs.
export function collectRefs(ir) {
  const refs = [];
  for (const t of ir.triggers ?? []) refs.push(t.ref);
  const walk = (nodes) => {
    for (const n of nodes ?? []) {
      refs.push(n.ref);
      for (const b of n.branches ?? []) { refs.push(b.ref); walk(b.then); }
      for (const p of n.paths ?? []) { refs.push(p.ref); walk(p.then); }
    }
  };
  walk(ir.graph);
  return refs;
}

function walkNodes(nodes, visit) {
  for (let i = 0; i < (nodes ?? []).length; i++) {
    const n = nodes[i];
    visit(n, i, nodes);
    for (const b of n.branches ?? []) walkNodes(b.then, visit);
    for (const p of n.paths ?? []) walkNodes(p.then, visit);
  }
}

export function parseIR(ir) {
  if (!ir || typeof ir !== 'object' || !Array.isArray(ir.triggers) || !Array.isArray(ir.graph))
    throw new IRError('SCHEMA', 'IR must have triggers[] and graph[]');
  if (ir.triggers.length < 1) throw new IRError('SCHEMA', 'at least one trigger required');

  const refs = collectRefs(ir);
  const seen = new Set();
  for (const r of refs) {
    if (seen.has(r)) throw new IRError('DUP_REF', `duplicate ref: ${r}`);
    seen.add(r);
  }

  walkNodes(ir.graph, (n, idx, siblings) => {
    if (n.kind === 'goto') {
      if (!seen.has(n.target)) throw new IRError('GOTO_UNRESOLVED', `goto target not found: ${n.target}`);
      if (idx !== siblings.length - 1) throw new IRError('GOTO_NOT_TERMINAL', `goto '${n.ref}' must be last in its branch`);
    }
    if (n.kind === 'if_else') {
      if ((n.branches ?? []).length < 2) throw new IRError('IFELSE_ARITY', `if_else '${n.ref}' needs >=2 branches`);
      const elses = n.branches.filter((b) => b.else === true);
      if (elses.length > 1) throw new IRError('IFELSE_ELSE', `if_else '${n.ref}' has >1 else branch`);
      for (const b of n.branches) {
        const hasCond = Array.isArray(b.conditions) && b.conditions.length > 0;
        if (b.else === true && hasCond) throw new IRError('BRANCH_SHAPE', `branch '${b.ref}' has both else and conditions`);
        if (b.else !== true && !hasCond) throw new IRError('BRANCH_SHAPE', `branch '${b.ref}' has neither else nor conditions`);
      }
    }
    if (n.kind === 'split') {
      if ((n.paths ?? []).length < 2) throw new IRError('SPLIT_ARITY', `split '${n.ref}' needs >=2 paths`);
      if ((n.mode === 'weighted' || n.mode === 'random') && n.paths.some((p) => typeof p.weight !== 'number'))
        throw new IRError('SPLIT_WEIGHT', `split '${n.ref}' ${n.mode} requires weight per path`);
    }
  });

  const triggers = ir.triggers.map((t) => ({ active: true, ...t }));
  return { ...ir, triggers };
}
