// A shared per-tool "exercised" marker for harnesses that call tool handlers directly (a runner, a proof module) so a record can say WHICH tool each assertion proves.
// Same attribution as the conformance suite (core/exercise-log.mjs): subject(name) says what an assertion is about, subject(false) suppresses it (controls and raw
// reads credit no tool), and with no subject the most recently called wrapped tool gets it.
//   const mk = createMarker();
//   const call = mk.wrapCall(rawCall);      // call(name, args) -> result; counts a call for `name`
//   mk.subject('export_workflow');           // the next assertions prove export_workflow
//   mk.check(cond, 'message', detail, report) // your own check() plus the attribution; `report` is your existing check function
//   mk.write();                              // GHL_EXERCISED_OUT=<file> writes [{tool, calls, passed, failed, failures}]
// A step that goes through a raw gateway call (gw.call) should run under mk.subject(false): it credits no tool.
import { createExerciseLog } from '../../../mcp-internal/core/exercise-log.mjs';

export function createMarker() {
  const log = createExerciseLog();
  return {
    subject: (name) => log.subject(name),
    wrapCall: (call) => async (name, args) => log.wrap({ name, handler: (a) => call(name, a) }).handler(args, undefined),
    check(cond, message, detail, report) { log.result(Boolean(cond), message); return report ? report(cond, message, detail) : undefined; },
    entries: () => log.entries(),
    write: () => log.write(),
  };
}
