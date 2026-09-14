// Which TOOLS a live conformance suite actually drove, and how each fared. A suite receipt used to say
// only "workflows: 55 passed" — so a proof run could not tell build_workflow from export_workflow, and
// the memberships suite, which never calls a tool handler at all, looked like proof of build_course.
//
// Attribution rule: an assertion belongs to the tool whose handler ran most recently. It is a rule,
// not an inference — suites read a result back right after the call that produced it.
import { writeFileSync } from 'node:fs';

export const assertionId = (m) => String(m ?? '').toLowerCase().replace(/\d+/g, '')
  .replace(/[^a-z]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '') || 'unnamed';

export function createExerciseLog() {
  const by = new Map(); let last = null;
  const entry = (name) => { if (!by.has(name)) by.set(name, { tool: name, calls: 0, passed: 0, failed: 0, failures: [] }); return by.get(name); };
  return {
    wrap(tool) {
      if (!tool) return tool;
      return { ...tool, handler: async (args, deps) => { last = tool.name; entry(tool.name).calls++; return tool.handler(args, deps); } };
    },
    result(cond, message) {
      if (!last) return;
      const e = entry(last);
      if (cond) e.passed++; else { e.failed++; e.failures.push(assertionId(message)); }
    },
    entries: () => [...by.values()],
    write() {
      if (process.env.GHL_EXERCISED_OUT) writeFileSync(process.env.GHL_EXERCISED_OUT, JSON.stringify([...by.values()]));
    },
  };
}
