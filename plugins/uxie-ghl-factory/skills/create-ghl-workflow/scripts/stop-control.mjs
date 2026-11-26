// Stop control for the d18 live entries (QA X2): once stopped, NO call or gateway request is sent; a signal handler awaits the one in flight, then does its own unguarded clean-up.
export class Stopped extends Error { constructor() { super('stopped by a signal: nothing further was sent'); this.name = 'Stopped'; } }
export function makeStopControl() {
  const inflight = new Set();
  const ctl = {
    stopped: false,
    guard(fn) { if (ctl.stopped) return Promise.reject(new Stopped()); const p = Promise.resolve().then(fn); inflight.add(p); const d = () => inflight.delete(p); p.then(d, d); return p; },
    async stop(timeoutMs = 25000) { ctl.stopped = true; let t; const to = new Promise((r) => { t = setTimeout(() => r('timeout'), timeoutMs); }); const r = await Promise.race([Promise.allSettled([...inflight]).then(() => 'done'), to]); clearTimeout(t); return r === 'done'; },
    pending: () => inflight.size,
  };
  return ctl;
}
