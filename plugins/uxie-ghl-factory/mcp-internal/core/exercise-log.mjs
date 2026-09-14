// Which TOOLS a live conformance suite actually drove, and how each fared. A suite receipt used to say
// only "workflows: 55 passed" — so a proof run could not tell build_workflow from export_workflow, and
// the memberships suite, which never calls a tool handler at all, looked like proof of build_course.
//
// Attribution rule, fix round 1: an assertion belongs to the tool whose handler ran most recently.
//
// Fix round 2: the suites verify by READ-BACK — mutate with one tool, then read with another and
// assert — so "most recently called" alone credits the READING tool for an assertion that actually
// proves the WRITING tool's effect (a repair_workflow read back through export_workflow was crediting
// export_workflow). log.subject(name) lets a section say, explicitly, which tool an assertion is
// actually about; result() prefers that over the last-called fallback. Three subject states:
//   - a string:      every result() until the next subject() call is credited to that tool, even one
//                     never called (calls: 0) — honest: we meant to prove it and could not reach it.
//   - null/omitted:  clears the override; result() falls back to the most recently called tool, same
//                     as round 1. This is also the state before subject() has ever been called.
//   - false:         suppresses attribution entirely — for a control or raw-endpoint assertion that
//                     proves nothing about any one of our tools; crediting the last-called tool would
//                     make it a bystander, which is the exact false confidence this file exists to kill.
import { writeFileSync } from 'node:fs';

export const assertionId = (m) => String(m ?? '').toLowerCase().replace(/\d+/g, '')
  .replace(/[^a-z]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '') || 'unnamed';

const SUPPRESS = Symbol('exercise-log:no-attribution');

export function createExerciseLog() {
  const by = new Map(); let last = null; let subj;
  const entry = (name) => { if (!by.has(name)) by.set(name, { tool: name, calls: 0, passed: 0, failed: 0, failures: [] }); return by.get(name); };
  return {
    wrap(tool) {
      if (!tool) return tool;
      return { ...tool, handler: async (args, deps) => { last = tool.name; entry(tool.name).calls++; return tool.handler(args, deps); } };
    },
    subject(name) {
      if (name === false) { subj = SUPPRESS; return; }
      subj = name ?? undefined;
      if (typeof subj === 'string') entry(subj);
    },
    result(cond, message) {
      if (subj === SUPPRESS) return;
      const target = subj ?? last;
      if (!target) return;
      const e = entry(target);
      if (cond) e.passed++; else { e.failed++; e.failures.push(assertionId(message)); }
    },
    entries: () => [...by.values()],
    write() {
      if (process.env.GHL_EXERCISED_OUT) writeFileSync(process.env.GHL_EXERCISED_OUT, JSON.stringify([...by.values()]));
    },
  };
}
