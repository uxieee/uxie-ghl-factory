# The per-tool exercised marker, and writing proof runs from a map

Two small pieces for any lane that runs a live harness and has to say **which tool** a pass proves.

## 1. The marker (`skills/create-ghl-workflow/scripts/exercised-marker.mjs`)

```js
import { createMarker } from './exercised-marker.mjs';
const mk = createMarker();
const call = mk.wrapCall(rawCall);          // rawCall(name, args) -> result; counts a call for `name`
mk.subject('export_workflow');              // the assertions that follow are about export_workflow
mk.check(cond, 'message', detail, report);  // `report` is your existing check(); the marker only adds attribution
mk.subject(false);                          // a raw gw.call read or a control: credits NO tool
mk.subject(null);                           // back to "the most recently called tool"
mk.write();                                 // with GHL_EXERCISED_OUT=<file>: [{tool, calls, passed, failed, failures}]
```

Rules, the same as the conformance suite (`mcp-internal/core/exercise-log.mjs`): an assertion belongs to its `subject`, else to the last wrapped tool called; a step that goes
through a raw gateway call credits no tool; a failure is attributed by assertion id. A runner should set `GHL_EXERCISED_OUT` and keep the written file with its record.

## 2. Proof runs from a map (`scripts/proof-from-map.mjs`)

For tools a QA-accepted, hand-checked map credits. Dry run by default, `--write` writes through `scripts/proof.mjs`'s own writer.

Each run is `{at, result: pass, how: manual, evidence: ["commit:<full 40-hex sha>"]}`. Nothing else may be cited: the guard (`scripts/lib/proof-citation.mjs`) refuses
`sniffs/`, `knowledge/`, `live-`, `-w9-YYYY-MM-DD/` and account names, because `proofs/` is in a public repo. The map and the `citations` file (sha → record path) live on the knowledge side.

Per row the generator refuses unless the sha is listed in citations for that record, is an ancestor of the knowledge main branch, the record's blob at the sha equals main's, and the
tool's code hashes now equal the hashes recorded for the record's plugin commit (`codeAtRecord`). A row stays unproven until an accepted record shows its pass.
