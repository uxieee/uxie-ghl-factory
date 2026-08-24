# audit-configuration fixtures

Scenario data for `test/audit-configuration.test.mjs` (Task 4 of
`docs/superpowers/plans/2026-07-24-internal-mcp-audit-read-profile.md`, plan lines 503-569).

Every scenario carries a `planBullet` naming the plan bullet it exists to prove and a `why`
sentence stating what would silently break if the scenario were deleted.

| file | concern |
| --- | --- |
| `workflow-roster.json` | `listWorkflowsComplete`'s offset walk over `/workflow/{locationId}/list` |
| `ai-configuration.json` | `getAiConfigurationBundle`'s three-surface discovery-plus-detail sweep |

## The rule that shapes both files: declared totals are INDEPENDENT INPUTS

Task 3's first fake gateway derived the declared enrollment total from the very rows it was
about to serve. Every `complete:true` in every fixture therefore rested on a reconciliation
that could not fail — an oracle the fixture supplied but production could not. Both files
here obey the opposite rule, and `test/audit-configuration.test.mjs` asserts it mechanically
(see the test named "declared totals are independent fixture inputs, never derived from the
served rows"):

- `declaredTotal` on a roster scenario, and `declaredTotal` on an `agent_studio` component,
  are literals written into the JSON. Nothing in the harness computes them.
- Some scenarios declare a total the served rows DO reach (`three-pages`, `reordered-rows`)
  and some declare one they do NOT (`short-page-below-total`, `zero-unique-progress`,
  `empty-intermediate-page`), so the reconciliation is provably load-bearing in BOTH
  directions. A composite that ignored the total entirely would pass the first group and
  fail the second; a composite that only ever reported `complete:false` would fail the
  first.
- Page counts and roster sizes are likewise declared, never derived: the `expect.offsets`,
  `expect.pagesFetched` and `expect.capabilityCounts` values are written down, so a walk
  that silently skipped or repeated a page cannot agree with them by construction.

## The upstream model the harness replays

The fake audit gateway in the test file VALIDATES every call against the real
`core/audit-capabilities.mjs` descriptors before serving a body — required keys, fixed
values, numeric bounds, the location binding, and the per-product `sealedBy` seal on the
three detail routes. A composite that emitted a query the real gateway would have refused
therefore fails here rather than passing against a lenient stub.

### Roster (`workflow-roster.json`)

- The response envelope defaults to the **live-observed** `{ rows: [...], count: N }`.
  shape no captured GHL response has ever carried. The real one is
  `{rows, count, isLocationRateLimited}` with a numeric `count`, per
  `ghl-internal-api-research/docs/03-endpoints.md:167`, `DISCOVERIES.md:121`, the
  `openapi.json` entry stamped `x-proof: live-runtime` (2026-07-21), and the shipped reader
  at `core/tools.mjs:762-763`. Every scenario here agreed with the invented shape, so the one
  envelope that actually matters was the one nothing tested — and against a real account the
  rail matched neither half: rows fell to `ROSTER_PAGE_READ_FAILED` and the walk published
  zero workflows, while the missing total would have left every roster permanently
  `ROSTER_TOTAL_UNAVAILABLE`.
- `envelopeKeys` on a page (or on the scenario) selects a different key pair —
  `legacy-envelope-workflows-total` and `legacy-envelope-data-key` exist to keep the older
  candidates readable, because dropping a candidate key can only ever turn a readable
  envelope into an unreadable one and this rail gets no second attempt at a page it refused.
- `alsoRows` / `alsoTotal` serve a SECOND, literal reading of the same response under a
  different key. Where the two readings disagree the response has contradicted itself and no
  reading of it can be defended, so the walk reports `ROSTER_ENVELOPE_CONFLICT` and reads
  nothing (`envelope-row-keys-disagree`, `envelope-total-keys-disagree`); where they agree it
  reads normally (`envelope-row-keys-agree`, `envelope-total-keys-agree`). Both directions
  are pinned: "more than one candidate key present is a conflict" fails closed and therefore
  looks safe, but would refuse a perfectly readable envelope.
- `expect.envelopeShape` pins the keys the walk actually READ FROM — not every candidate the
  reader accepts and not every key present. The two halves are recorded separately, so a page
  whose rows contradicted themselves but whose total read cleanly reports
  `{rowsKeys: [], totalKeys: ['count']}`.
- `omitTotal` on a page drops the total entirely; a per-page `total` overrides the scenario's
  `declaredTotal` for that page only (used by `changing-reported-total`, and by
  `reported-total-is-a-string` to serve a total that is a STRING rather than a number).
- `body` on a page serves a RAW envelope instead, bypassing the `{workflows, total}`
  construction (`unreadable-page-envelope`). Without it, "a 200 this rail cannot read is not
  an empty roster" — the doctrine the whole module is built on — was untestable on the
  roster, and relaxing `rows === null` to `rowsOf(...) ?? []` survived the entire suite.
- The walk pages by `offset`, and the offset advances by the number of ROWS the previous
  page actually returned — not by `pageSize`. `expect.offsets` pins the emitted sequence.
- `pagesFetched` counts SUCCESSFUL pages only. `first-page-auth-rejected` and
  `conflicting-returned-location` therefore expect `pagesFetched: 0` alongside a
  one-element `offsets`, which is what distinguishes "a page was requested" from "a page
  was read".

### AI bundle (`ai-configuration.json`)

- `conversation_ai` and `voice_ai` discovery are SINGLE-SHOT BY DESCRIPTOR. Their
  descriptors (`/ai-employees/agents`, `/voice-ai/agents/simple`) declare `locationId` as
  their only query key, so there is no page parameter to send and a composite that tried to
  paginate them would be refused with `UNKNOWN_QUERY_KEY` by the real gateway. Only
  `agent_studio` paginates, via `page`/`pageSize`.
- `agent_studio` discovery pages by PAGE NUMBER (1, 2, 3 ...) at the pinned
  `pageSize` of 100, which is the descriptor's declared maximum. `expect.studioPages` pins
  the emitted sequence.
- The discovery envelope defaults to `{ agents: [...], total: N }`, which is what the
  pre-existing scenarios were written against — but it is no longer the only shape reachable,
  and it is not the shape most of these routes actually answer with. Captured 2026-07-27:
  `/agent-studio/agents-with-folders` answers `{items, total, totalAgents, totalFolders}` and
  the `/ai-employees` search routes answer `{employees, totalCount, count}`. The row keys were
  already accepted; **`totalCount` was not**, so an `/ai-employees` surface reporting its own
  size had that size read as absent. `envelopeKeys` selects a shape per page or per component;
  `captured-ai-envelopes` serves a different captured shape on each of the three products so
  no one key family can regress without a named failure.
- `count` is deliberately NOT an accepted AI total key. On `/ai-employees/employees/search` it
  is reported alongside `totalCount` carrying the same value on a single-page response, so
  nothing observed distinguishes "rows on this page" from "rows in the surface" — and a page
  count read as a surface total is a false terminal.
- `/voice-ai/agents/simple` remains UNVERIFIED: only a row excerpt was ever captured, never
  the envelope. Absence reads as "no total", which on a single-shot surface is tolerated
  rather than fatal.
- `alsoRows` / `alsoTotal` work as on the roster; `ai-discovery-envelope-conflict` pins that a
  self-contradictory discovery response yields `AI_DISCOVERY_ENVELOPE_CONFLICT` and an
  `items: null` component rather than a confidently-short agent list.
- A discovery page is terminal on a SHORT page. When the response also carries a `total`
  the walk reconciles against it; when it does not, a short page is terminal on its own.
  This is deliberately WEAKER than the roster's rule, and the asymmetry is a contract
  decision rather than an oversight: the roster descriptor pins `sortBy`/`sortOrder` and its
  upstream is known to report a total, whereas the agent-studio envelope is unproven — so
  requiring a total there would make every Agent Studio read permanently incomplete for a
  reason that is a harness assumption rather than missing evidence.
- Discovery pages carry PER-PAGE totals, exactly as roster pages do: the component's
  `declaredTotal` by default, an explicit per-page `total` override, or `omitTotal` to drop
  the total from that page alone. Before this the one component-level `declaredTotal` was
  written onto every page, so no fixture could express a total that MOVES or DISAPPEARS
  across pages — and the AI walk, which kept no history and reconciled against only the
  terminal page's copy, therefore had no test that could see it. The walk now latches the
  first non-null total for the whole component and refuses a mid-walk change
  (`AI_DISCOVERY_TOTAL_CHANGED`) or a mid-walk retraction (`AI_DISCOVERY_TOTAL_DISAPPEARED`),
  mirroring `ROSTER_TOTAL_CHANGED`. Four scenarios pin it: the two probed defect shapes
  (`agent-studio-total-disappears-mid-walk`, `agent-studio-total-changes-mid-walk`) and two
  whose final row count AGREES with the latched total
  (`agent-studio-total-disappears-after-a-reconcilable-count`,
  `agent-studio-total-changes-but-the-count-still-agrees`) — those two are the ones that fail
  if either guard is deleted, because no count-based check can see them.
- Every component publishes `totalHistory`: one entry per page READ, `null` where that page
  reported no total. It is the roster's field, per component, and it is what makes "the total
  was 500, then nothing" distinguishable from "there was never a total" in a published
  artifact.
- A reported `total` is now reconciled on ALL THREE surfaces, single-shot ones included
  (`single-shot-discovery-reports-a-larger-total`). It used to be read below an early
  `if (!surface.paginated) break;`, so Conversation AI and Voice AI discarded it entirely and
  three rows against a reported fifty published as complete. Whether GHL emits `total` on
  those two envelopes at all is UNVERIFIED and is on the Task 7 canary list.
- Detail bodies default to `{ _id: <id>, locationId: "LOC1", name: <id> }`. A scenario
  overrides one with `details: { "<id>": { "body": ... } }` or forces a gateway-level
  failure with `details: { "<id>": { "gateway": { ... } } }`. `detailDefault` on a component
  fails EVERY detail read on it without naming ids one by one — it exists for the aggregation
  measurement, where the corpus is too large to write out.
- A detail body is checked against THE ID IT WAS REQUESTED FOR
  (`detail-answers-for-another-agent`, one envelope per product). This was the critical
  finding of the adversarial review: the record used to be accepted on the strength of
  carrying SOME id, so a route answering about another agent published that agent's
  configuration under the requested id, with `complete:true` and no warning. The gateway
  cannot cover it — its identity check compares a body field literally named `agentId`, and
  these bodies carry `_id`/`id`.
- Two discovery rows sharing an id but not a content hash are a CONFLICT, retained in full
  (`duplicate-discovery-id-tombstone-shadows-live`,
  `duplicate-discovery-id-two-live-rows`), exactly as on the roster. The walk used to keep
  whichever arrived first, so a tombstone could shadow — and silently classify out — a live
  agent under the same id. An identical re-serve is still dropped without comment.
- `{_id: {"$oid": "..."}}` is a real, readable id shape (`bson-wrapped-discovery-ids`), named
  as such by `core/audit-gateway.mjs`. Stringified without unwrapping, every such row becomes
  `"[object Object]"`: all but one are deduped away and the surviving detail call addresses
  `/voice-ai/agents/%5Bobject%20Object%5D`.
- `applicable` is never derived from an unreconciled read
  (`discovery-contradicts-itself-with-no-rows`). `{agents: [], total: 5}` publishes
  `applicable:'unknown'` with `items: null` — NOT `applicable:false` with `items: []`, which
  is the sentence "this account has no agents" over evidence that says five exist.

## The tombstone rule these fixtures pin at its edges

Plan line 548. A discovery row is a NON-APPLICABLE TOMBSTONE only when the schema-valid row
carries BOTH `isDeleted === true` AND `agentStatus === "INACTIVE"`. Such a row is retained
as discovery evidence, is excluded from the applicable-detail denominator, and receives NO
detail call.

Everything else is graded as follows, and each grade has its own scenario:

| row | verdict | detail call | component |
| --- | --- | --- | --- |
| `isDeleted:true` + `agentStatus:"INACTIVE"` | tombstone | no | may still be complete |
| `isDeleted:true` + `agentStatus:"ACTIVE"` | ambiguous | yes | incomplete |
| `isDeleted:false` + `agentStatus:"INACTIVE"` | ambiguous | yes | incomplete |
| `isDeleted:true`, no `agentStatus` | ambiguous | yes | incomplete |
| `agentStatus:"INACTIVE"`, no `isDeleted` | ambiguous | yes | incomplete |
| `isDeleted:"true"` (string) + `agentStatus:"INACTIVE"` | ambiguous | yes | incomplete |
| `isDeleted:1` / `'1'` / `[1]` + `agentStatus:"INACTIVE"` | ambiguous | yes | incomplete |
| `isDeleted:0` + `agentStatus:"ACTIVE"` | ambiguous | yes | incomplete |
| neither field present | ordinary live row | yes | may still be complete |

The last row matters as much as the first. If an absent deletion field counted as an unknown
deletion signal, EVERY ordinary agent would make its component incomplete and the rule would
be indistinguishable from "this rail can never read Voice AI".

The three `1`-ish rows and the `0` row are the ones that actually defend `===`. The
`isDeleted:"true"` row does NOT: `'true' == true` is false (the string coerces to `NaN`), so
loose equality rejects it exactly as strict does — and swapping `===` for `==` in `signalOf`
survived all 526 tests while that fixture looked like it was guarding the rule. `1 == true`,
`'1' == true` and `[1] == true` are all TRUE, so under `==` each of those rows grades as a
tombstone, loses its detail call, and drops a live agent's configuration while reporting the
surface complete. `0 == false` is the mirror image: under `==` an unknown flag grades as an
explicit "not deleted", which the detail-call table cannot see — only the
`AI_DELETION_SIGNAL_AMBIGUOUS` occurrence count witnesses it.

## Row shorthand

Anywhere a row list is accepted, an entry of the form `{"generate": {...}}` expands to N
rows so a 100-row page does not cost 100 lines of JSON. The expansion is spelled out in
`expandRows` in the test file.
