// What the pause-restore proof does when the runner kills it (SIGTERM on the first 401/403, or SIGINT). The take-down is NEVER claimed unless it was PROVEN:
//   - no workflow id yet (a signal during the build) -> UNKNOWN, naming the flow; nothing is ever bound by name;
//   - an id: wait (bounded) for every in-flight call to settle FIRST, so a late publish cannot land after the unpublish; send the unpublish; then a SEPARATE
//     read-back. "draft" is printed only if the in-flight calls settled AND that read-back says draft. Anything else is UNKNOWN with the id and name, exit 3.
// Pure over injected call/print/exit so a suite can drive it with a fake world.
// Once a stop has begun (st.stopped), NOTHING new may start through a tracked call or gateway request: it is refused with Stopped. Only handleStop uses the raw call.
export class Stopped extends Error { constructor() { super('Stopped'); this.name = 'Stopped'; } }
export const trackInflight = (st, fn) => (...a) => { if (st.stopped) return Promise.reject(new Stopped()); const p = Promise.resolve().then(() => fn(...a)); st.inflight.add(p); const done = () => st.inflight.delete(p); p.then(done, done); return p; };

export async function handleStop({ sig, st, call, print = console.log, exit = process.exit, settleMs = 20000, downMs = 15000 }) {
  if (st.stopped) return; // a second signal is a no-op: one handler, one exit
  st.stopped = true;      // BEFORE anything is awaited: from here no tracked call starts
  const timer = (ms) => new Promise((r) => setTimeout(() => r('timeout'), ms));
  if (!st.wid) { print(`STOPPED by ${sig}: UNKNOWN. The signal came before the build returned an id; a flow named ${st.name} may exist (nothing was bound by name, nothing was unpublished)`); return exit(3); }
  const settled = (await Promise.race([Promise.allSettled([...st.inflight]).then(() => 'settled'), timer(settleMs)])) === 'settled';
  let sent = false;
  try { sent = (await Promise.race([call('unpublish_workflows', { workflowIds: [st.wid], confirm: true }).then(() => 'ok', () => 'err'), timer(downMs)])) === 'ok'; } catch { sent = false; }
  let status = null;
  try { const g = await Promise.race([call('get_workflow', { workflowId: st.wid }), timer(downMs)]); status = g && g !== 'timeout' ? (g.data?.status ?? null) : null; } catch { status = null; }
  if (settled && status === 'draft') { print(`STOPPED by ${sig}: workflow ${st.wid} (${st.name}) read back as a draft on a separate read after in-flight calls settled (unpublish sent: ${sent})`); return exit(143); }
  print(`STOPPED by ${sig}: UNKNOWN. workflow ${st.wid} (${st.name}); in-flight calls settled: ${settled}; unpublish sent: ${sent}; last read-back status: ${status ?? 'unreadable'}. Treat it as possibly published and check it by hand`);
  return exit(3);
}
