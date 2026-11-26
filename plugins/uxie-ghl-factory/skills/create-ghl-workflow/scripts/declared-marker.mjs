// A per-tool exercised marker that can credit ONLY the tools a proof declares (QA d18-wf W13: the map may credit only the nine declared tools).
// Any subject outside the declared set, and the null "last called tool" fallback, become subject(false): the assertion credits nobody. Entries for
// undeclared tools (their calls were still counted) are dropped from entries() and from the file write().
import { writeFileSync } from 'node:fs';
import { createMarker } from './exercised-marker.mjs';

export function createDeclaredMarker(declared) {
  const set = new Set(declared); const mk = createMarker();
  mk.subject(false);
  return {
    declared: [...set],
    subject: (n) => mk.subject(typeof n === 'string' && set.has(n) ? n : false),
    wrapCall: mk.wrapCall,
    check: mk.check,
    entries: () => mk.entries().filter((e) => set.has(e.tool)),
    write: () => { if (process.env.GHL_EXERCISED_OUT) writeFileSync(process.env.GHL_EXERCISED_OUT, JSON.stringify(mk.entries().filter((e) => set.has(e.tool)))); },
  };
}
