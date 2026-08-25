# Implementation plan — the internal endpoint catalogue

**Revision 2.** Companion to [`endpoint-catalogue-spec.md`](endpoint-catalogue-spec.md). That
document says *what* the catalogue must become; this one says *what to do*.

Revision 1 was reviewed adversarially and returned **not ready**. Every named fix is applied here;
the errata are in spec §9. Tasks changed by that review are marked **[r2]**.

---

## 0. Orientation — read this before task one

### 0.1 Where things are

Repo root: `/Volumes/Xander SSD/Vibe Code/Misc/gohighlevel/`

| path | what |
|---|---|
| `knowledge/` | **no git remote.** Holds `sniffs/` (real identifiers — never copy out) and `corpus/` (account-agnostic). Owns the source extractor. |
| `knowledge/sniffs/bundle-2026-08-21-2/recovered-source/src` | GHL's recovered TypeScript — the mining input, 1,016 `.ts` files |
| `knowledge/scripts/build-endpoint-catalog.mjs` | the current generator (regex; being replaced) |
| `plugin/` | **public remote.** No real location id, contact id, account name, email, phone or token may enter it. |
| `plugin/plugins/uxie-ghl-factory/mcp-internal/` | the MCP server |
| `.../mcp-internal/core/tools.mjs` | all 41 tool definitions (~3900 lines) |
| `.../mcp-internal/core/gateway.mjs` | the single HTTP chokepoint — auth, headers, throttle, `call()` and `stream()` |
| `.../mcp-internal/catalog/internal-endpoints.json` | the artifact being fixed |
| `.../mcp-internal/stdio.mjs`, `stdio-audit.mjs` | the two server entry points |
| `.../mcp-internal/test/` | 37 `node:test` files |

### 0.2 How to run everything

```bash
# MCP server
cd plugin/plugins/uxie-ghl-factory/mcp-internal
npm test                      # node --test "test/**/*.test.mjs"
npm run build                 # esbuild → dist/server.mjs + dist/audit-server.mjs
npm run manifest              # regenerates capability-manifest.json + the audit manifest

# plugin-level gates — NOT part of npm test (see P3)
cd plugin
node scripts/check-privacy.mjs
node scripts/check-manifest-parity.mjs
node scripts/check-mcp-contract.mjs

# knowledge
cd knowledge
npm test                      # privacy-gate unit tests only
npm run indexes               # regenerate corpus index.md routers
npm run links
```

**A task is not done until `npm test` is green in the repo it touched *and* the plugin-level gates
above pass.** They are currently only wired into an opt-in pre-commit hook
(`plugin/.githooks/pre-commit`) — P3 fixes that.

### 0.3 What must not break

| | |
|---|---|
| **the audit profile** | a second server (`stdio-audit.mjs`) whose read-only guarantee is structural: the registry filter at `core/audit-profile.mjs:25-30` plus `AUDIT_WRITE_BLOCKED`. Never relocate either lock. |
| **the esbuild `define` block** | `dist/` ships with no sibling `package.json`; values are inlined at build time (`scripts/esbuild-config.mjs`). |
| **`tool-descriptions.json`** | a **merge**, not a copy. A blind overwrite from the docs catalogue has previously deleted three audit entries. Do not regenerate it wholesale. |
| **both plugin manifests** | `.claude-plugin/` and `.codex-plugin/` must stay version-aligned or the lagging harness reports "already at latest" forever. |
| **the compiler** | nothing in this plan touches `skills/create-ghl-workflow/engine/`. |

### 0.4 Conventions

- **Nothing is deleted.** Superseded code is archived with a note saying what replaced it. Probe
  artifacts on the test account are left named and in place for a human to remove.
- **Anchors are symbols, not line numbers.** Line numbers in these documents were accurate at
  authoring and will drift as tasks land. Locate by function or string.
- **Live-fire on the designated test sub-account only, never a client.**
- **A `200` is not proof.** Read back on a separate request.
- **No push without approval.** Pushing the docs repo is publishing (it auto-deploys).

### 0.5 Counts are indicative, not thresholds

Every number in the spec is marked `[measured]` or `[review]`. **Re-derive before using one as a
gate.** Gates are structural predicates ("zero rows matching X"), never "26 → 0".

---

## 1. Dependency graph **[r2]**

```
A0 ─ baseline, FROZEN  (before A3; blocks nothing else)
 │
 ├─► A1..A5   consumer fixes ............ independent
 ├─► P1..P3   packaging defects ......... independent, fix things broken TODAY
 ├─► B1..B4   overlays + plugin compiler  independent (B4 is the merge step)
 └─► C0..C8   extractor ................. the long pole; does NOT wait on a JWT
              │
              ├─► D1..D3   gates
              └─► E1..E3   consumer on real data
                           │
                           └─► F1..F3   live proof   (needs a fresh JWT)
```

**A0 is frozen before A3 only.** Revision 1 let it block everything; it does not need to.
**F1 may run out of order** the moment a token exists — it is the cheapest experiment that could
change C's scope.

---

## Track A — consumer fixes

### A0 · Baseline — **DONE**

Recorded at `test/fixtures/catalogue-acceptance-baseline.json`. Offline half only: ten read-shaped
intents through `search_endpoints`, which reads no account data and needs no token.

Measured: **18 of 30 top-3 slots are writes**; **1 of 10** intents has a clean read-only top 3;
`total` ranges **108–218** of 235. *"Which contacts are sitting at step X"* returns
`remove-stuck-statuses` and `requeue-stuck-statuses` at #1 and #2.

**[r2] Freeze note:** the ten intent strings in that fixture are the frozen prompt set. F3 re-runs
them verbatim. The online half (did the first `raw_request` succeed) needs a JWT and is F3's job.

---

### A1 · Stop the catalogue shadowing hand-written descriptions

`describe(tool, fallback)` is `CATALOG[tool]?.description ?? fallback`, and `CATALOG` has 35
entries — so for 35 of 41 tools the generated line wins and the hand-written one never ships.

Invert it: the hand-written line is the description; the catalogue contributes only `risk`.

```js
// The hand-written fallback IS the description. tool-descriptions.json contributes RISK and
// nothing else: proof/proofFloor/proofRows are maintainer provenance, and they were displacing
// the operational sentence that tells an agent which tool to call.
const describe = (tool, fallback) => {
  const risk = CATALOG[tool]?.risk;
  return risk ? `${fallback} — risk: ${risk}` : fallback;
};
```

**Do not edit `tool-descriptions.json`** (§0.3).

**[r2] This breaks an existing test.** `test/tools.test.mjs` asserts *"capability-bearing
descriptions carry proof labels"* — `assert.match(t.description, /proof:/)`. That test encodes the
behaviour being removed. Replace it with the inverse: **no shipped description contains `proof:`**,
and `get_workflow_logs`'s description contains `executionId`.

**Files:** `core/tools.mjs`, `test/tools.test.mjs`.
**Done when:** both assertions pass and `npm test` is green.

---

### A2 · Give both servers instructions **[r2 — corrected]**

Neither entry point passes instructions: `stdio.mjs` and `stdio-audit.mjs` both construct
`new McpServer({ name, version })`.

**[r2] The SDK signature is `new McpServer(info, { instructions })`**, and instructions are returned
in the **`initialize`** result — *not* in `tools/list`. Revision 1's verification step was wrong.

New `core/instructions.mjs` exporting **two** strings.

*Full profile* — four points, resist adding more:
1. **Precedence.** A typed tool always wins over `raw_request` for the same endpoint; typed tools
   carry the compiler, the required query switches, the cursor walk and the read-back.
   `search_endpoints` names covering tools in `coveredBy` — call those instead.
2. **Headers.** Auth and `channel`/`source`/`version` are added to every call. Never set them. A 401
   whose body says `version header was not found` is not an auth failure.
3. **Rails.** `host:"ai"` switches origin **and** attaches `token-id` together.
4. **Proof.** A `200` is not proof the write applied. Read back separately.

*Audit profile* — **its own string**, which must never mention `raw_request` (the profile does not
expose it) and must state that the profile is structurally read-only.

**Files:** `core/instructions.mjs` (new), `stdio.mjs`, `stdio-audit.mjs`, `test/registration.test.mjs`.
**Verify:** drive `initialize` over stdio for **both** entry points **and both committed bundles**;
assert non-empty instructions and that the audit string does not contain `raw_request`.

---

### A3 · A destructive row must never surface for a read-shaped question **[r2 — gate corrected]**

Revision 1's test was self-contradictory: it demanded read precedence for explicitly mutating
intents like *"publish"* and *"remove"*, while disabling the penalty for exactly those intents. It
also used `add` and `set` as mutation verbs when both are already stop-words (`CARD_STOP`).

**Corrected design.** Two independent terms:

```js
// `destructive` is suppressed ALWAYS unless the intent names the destructive act itself.
// `write` is demoted only when the intent carries no mutation verb at all.
const MUTATION_VERBS = new Set([
  'create','make','new','build','update','edit','change','modify','delete','remove','clear','drop',
  'publish','unpublish','install','uninstall','start','stop','pause','resume','enroll','move',
  'restore','send','reset','register','deregister','requeue',
]);   // NOTE: 'add' and 'set' are stripped by CARD_STOP before scoring — do not rely on them.
```

- `destructive` → hard suppression unless a term of the intent appears in the row's own path.
- `write` → `-40` when `!intentIsMutating(terms)`.

Until B1 lands, derive `kind` provisionally from `method` so A3 ships without waiting.

**[r2] The gate is achievable and falsifiable:** across the **ten frozen A0 intents**, no
`destructive` row appears in the top 3, and the count of write slots in the top 3 drops from the
measured baseline of 18. That is a real comparison against a recorded number, not an absolute claim
about ranking.

**Files:** `core/tools.mjs`, new `test/endpoint-search-ranking.test.mjs`.

---

### A4 · Delete the hardcoded count

`core/tools.mjs` says **222** in two places (a comment and the agent-facing description); the file
holds 235. Derive it: `` `Ranked search over ${endpoints().length} internal endpoints…` ``.

**Verify:** a test asserting no shipped description contains a literal count disagreeing with
`endpoints().length`.

---

### A5 · Delete the wrong header advice

`describe_endpoint` tells the caller to send `Version: 2021-04-15`; the gateway already sends
`2021-07-28` on every call, and `raw_request` exposes no header parameter. Replace both branches
with *"Auth and the marketplace headers are added for you. Do not set them."*

**Done when:** no shipped string contains `2021-04-15`.

---

## Track P — packaging defects that exist today **[r2, new track]**

Independent of everything. These are shipping bugs the review found, unrelated to the catalogue
rewrite.

### P1 · The endpoint catalogue is not in the bundle

esbuild inlines only `__MCP_VERSION__` and `__TOOL_CATALOG__`; discovery reads the external
`catalog/internal-endpoints.json`, which `dist/` ships without. **`test/bundle.test.mjs` only calls
`tools/list`, so a bundle with an unusable catalogue passes today.**

Add `__HAS_ENDPOINTS__` / `__ENDPOINT_CATALOG__` defines alongside the existing pair, mirror the
`endpoints()` fallback on `__TOOL_CATALOG__`'s pattern, and extend the bundle test to **call
`search_endpoints` against the committed full bundle and assert rows come back**.

### P2 · The normal capability manifest is stale

Committed `capability-manifest.json` has **137** rows; a fresh `buildCapabilityManifest()` yields
**158**. Only the audit manifest has a committed-parity test. Regenerate, commit, and add the
parity test for the normal manifest.

### P3 · The gates are not in `npm test`

`check-privacy.mjs`, `check-manifest-parity.mjs` and `check-mcp-contract.mjs` run only from an
opt-in pre-commit hook. Wire them into a `pretest`/`posttest` script or a CI step so a clone that
never installed the hook still runs them.

---

## Track B — overlays and the plugin-side compiler

**Overlay key is the wire identity `"METHOD /path"`** (spec §2.5) — stated once, in both documents.
`id` addresses `describe_endpoint`; it is not the overlay key.

**[r2] Accepted consequence:** when C2 corrects the ~24 broken paths, those overlay keys orphan and
G10 names each one. Author overlays now against the rows that are not path-broken.

- **B1 · `catalog/endpoint-kinds.json`** — `kind` per non-GET, `destructive` list from spec §2.3.
  Curated because an inferred model has no prose to read; it is **ranking metadata, not
  authorization** — `raw_request` gates every non-GET regardless.
- **B2 · `catalog/endpoint-notes.json`** — the one trap per endpoint, each traceable to a corpus
  page. Seed with `dateType=custom`, the `POST /contacts/search/2` silent-ignore, `type=directory`
  not `folder`, and the batch move that cannot reach root. The privacy scanner discovers new files
  automatically — no registration needed.
- **B3 · `catalog/endpoint-summaries.json` and `endpoint-reach.json`** **[r2, new]** — without
  these, regeneration erases every hand-written summary and every live reach result.
- **B4 · the plugin-side compiler, v1** **[r2, new — makes B shippable alone]** — a small
  `mcp-internal/scripts/build-endpoint-catalog.mjs` that reads today's catalogue plus the four
  overlays and emits the merged artifact. C7 later swaps its input to the source artifact. Without
  B4 nothing merges overlays until C7, and Track B cannot ship independently.

**Done when:** a search matching `/workflows/logs/v2` returns the `dateType` note inline.

---

## Track C — the extractor rewrite

In `knowledge/`. Emits a **source-only** artifact (spec §2.6) — it must not read anything from
`plugin/`.

### C0 · Harness **[r2 — corrected]**

- **[r2]** Archive the old generator **inside `knowledge/`** — `knowledge/archive/` — not
  `../archive/`. `git mv` across a worktree boundary does not work, and `knowledge/` has no remote.
- `knowledge/` has **zero dependencies** today. Adding `typescript` and `@vue/compiler-sfc` as
  devDependencies changes that property — take it deliberately, pin exact versions, decide the
  lockfile policy.
- Program: `ts.createProgram` with `paths: {'@/*': [SRC/*]}`, `moduleResolution: Bundler`,
  `skipLibCheck`, `strict: false`. No `node_modules` for the recovered tree is needed.

### C1 · Call-site discovery via the AST

Walk `CallExpression` nodes whose callee resolves to an axios or wrapper request method. Fixes D5 —
**74 of 74** generically-typed sites currently dropped.

**[r2] Define the oracle precisely.** The "369 call sites" figure counts property calls on `axios`,
`Axios`, `this.requests` or `requests` with a GET/POST/PUT/PATCH/DELETE method. It **excludes**
callable `axios({...})`, `fetch` and `sendBeacon`. Specify which transports are in scope, handle
aliases and custom wrappers, and prevent double-counting.

### C2 · URL resolution — the hard task **[r2 — redesigned]**

Revision 1 conflated two unrelated classes named `BaseService` and claimed 36 subclasses.
**Measured truth:**

| base class | subclasses | override `endpoint` |
|---|---|---|
| `services/marketplaceServices/BaseService.ts` | **32** | wrapper pattern; `this.baseUrl` from constructor |
| `services/BaseService.ts` | **4** — `WorkflowService`, `TriggerService`, `CustomFieldService`, `AIEmployeeService` | **2** — `WorkflowService`, `TriggerService` |

So "8 rows → ~36 real ones" is false. The generic-base fan-out is 4, of which 2 override.

**The checker alone cannot do this.** It identifies calls, declarations, heritage and types; it does
not evaluate `new LocationsService(config + "/locations") → super(baseUrl) → this.baseUrl + url`.
Build a **symbolic evaluator layered over checker symbols**, handling:

- resolved class identity, and literal-plus-placeholder strings
- explicit production-config selection (`config/index.ts:52-59`)
- constructor / `super` / instance-field propagation
- real virtual dispatch of `this.endpoint` across the 4 generic subclasses
- wrapper overrides with runtime absolute-URL branches (`ValidationService.ts:15-25,33-60`)
- named singleton exports with inherited constructors (`LinksService.ts:13-19,85`)
- runtime placeholders (`AppState.locationId`), slash semantics, `super.endpoint`
- **ambiguity-preserving skips** — multiple instantiations or an unresolvable constructor value
  produce a printed skip, never a guessed row

**[r2] Do not emit every inherited CRUD method for every subclass** — that manufactures false
cross-product endpoints. A method is emitted only where the subclass is proven to use it.

**Verified by named fixtures**, one per resolution class above — not by a count.

**Done when:** the fixtures pass, the D1/D2/D4 predicates are zero, and
`/workflow/{locationId}/trigger` is present.

### C3 · Query extraction

Three sources, unioned per `method`+`path`: axios `params:` object literals; inline URL literals;
the marketplace wrapper's 2nd argument (`get` ⇒ query, `post/put` ⇒ body — settles 97 endpoints).

**[r2] Specify:** identifier-valued params objects, spreads, unions, conditionals,
`URLSearchParams`, repeated keys, and how conflicts between sources resolve. Drop the
`93 of 235` target — the denominator moves once C1/C2 land.

### C4 · Body and response extraction

Declared parameter type of the data argument, **including `axios.delete(url, { data })`** — how the
bulk delete hides its id list. Response from the generic argument or declared return type.

**[r2] Specify:** promise unwrapping, axios envelopes, arrays, unions, generics, index signatures,
alias expansion, recursion depth, and the `erased` vs `open-map` classification. Separate primitives
from object shapes — `getPropertiesOfType(string)` returns 52 `String.prototype` members. Verify by
**fixtures**, not a ±3 tolerance.

### C5 · Resolve the 14 unknown-method rows **[r2 — task corrected]**

Revision 1 said to parse `fetch` options. **Wrong:** all 14 are `via:"url-literal"` — a URL declared
as a literal that the generator never traced to a consumer. The fix is **variable tracing**: follow
the declaration to its use and read the method there. Handle `fetch`'s default GET where a consumer
is found; **skip and print** where none is. `sendBeacon` stays POST.

### C6 · `.vue` **[r2 — corrected]**

The current generator already scans `.vue` as **text** and records 8 sources. The change is
**SFC-aware AST parsing**: `@vue/compiler-sfc`, virtual filenames, `<script setup>`, `lang` handling,
and original-line remapping so citations stay accurate.

### C7 · Emit the source artifact **[r2 — split]**

**Knowledge side** emits `knowledge/catalog/internal-endpoints.source.json` with source-derived
fields only: `id`, `method`, `origin`, `path`, `authRail`, `transport`, `responseMode`,
`extraHeaders`, `operation`, `service`, `pathParams`, `query`, `body`, `returns`, `confidence`,
`sources`. **It reads nothing from `plugin/`.**

- `id` = `{service-slug}--{operation}`; **fail on collision**, never dedupe silently.
- `origin` is scheme+host only; any path prefix is folded into `path` (spec §2.2).
- `authRail`, `transport`, `responseMode`, `extraHeaders` are recorded independently — this is what
  lets the plugin decide `rawCallable` honestly.

**Plugin side** (the B4 compiler, now switched to this input) adds `url`, `kind`, `summary`, `note`,
`reach`, `coveredBy[]` and `rawCallable`.

**[r2] `coveredBy` is an array**, and the join is **scoped to surfaces the source tree covers** —
AI, memberships, courses and SSE are out of scope and listed, not counted as failures.

### C8 · Reporting **[r2 — join key specified]**

Print every unresolved call site by file, line, method and reason — the rule that already exists,
extended. Add a row-level diff against the previous catalogue by name, never a bare count.

**[r2]** Old rows have **no `id`**, so the diff joins on `METHOD + normalised path` for the first
run and on `id` thereafter. Specify the snapshot location, the canonicalisation, and the exit code.

---

## Track D — gates

### D1 · Generator gates **[r2 — G0 added, G7 scoped]**

G1-G4 (structural predicates for D1-D4) · **G0 — the discovered call-site inventory does not shrink,
and the skip ledger is reviewed** (without it, G1-G4 are satisfiable by emitting nothing) · G5
summary present · G6 kinds complete · **G7 scoped to covered surfaces** · G8 id unique · G9 facet
resolved-or-null · G10 no orphan overlay keys · **G11 catalogue inlined in both bundles** (P1) ·
**G12 manifest fresh** (P2).

### D2 · The first test that reads the catalogue

Nothing in `test/` reads `catalog/internal-endpoints.json` — **that is why the stale `222` shipped**.
Assert count parity between the header and the array, `id` uniqueness, the scoped typed-tool join,
and that no shipped description carries a literal count.

### D3 · Drift **[r2 — mechanism corrected]**

Revision 1 said to pin the chunk hash and prove the gate by pointing at `bundle-2026-08-21-3`.
**Impossible:** `-2` and `-3` have identical chunk and map names, byte sizes and source counts.

Use **whole-capture identity** — `capturedAt` plus a hash of the file inventory — selecting the
newest capture by `capturedAt`. The gate fails on a content change, not a filename change.

---

## Track E — consumer on real data

- **E1** — new stub `{id, method, path, kind, summary, coveredBy, note, reach}`. **[r2]** Search
  already filters to `score > 0`; specify the *new* floor rather than restating the old behaviour.
- **E2** — `describe_endpoint` keyed on `id`, plural `coveredBy`, and `callWith` **only when
  `rawCallable`**. **[r2] Specify** path/query substitution, encoding, optional fields and repeated
  query keys — and that `callWith` is **absent**, not empty, for unsupported transports.
- **E3** — corpus page under `knowledge/corpus/workflows/20-api/`, registered in `meta.json`,
  `surfaces.json`, `SURFACES.md`, plus `npm run indexes`, **in the same commit**. **[r2]** The
  current `workflows/meta.json` does not match the per-page-plus-`pending` shape in
  `PAGE-CONTRACT.md` — decide whether to migrate it or follow the existing shape, and say which.

---

## Track F — live proof

Needs a fresh JWT (~1h). **GROM AU only, never a client.**

- **F1 — the reach differential.** **[r2]** The gateway adds the marketplace headers
  unconditionally, so the "without headers" arm **cannot run through it**. This is a **separate,
  human-gated, allowlisted diagnostic script** — not an MCP tool — with 13 concrete safe GETs, one
  per origin/prefix. Its result **marks reachability**; it does not shrink the source catalogue.
- **F2 — the ledger.** ≥20 endpoints, both rails, GET and non-GET, executed **and read back
  separately**. **[r2] Specify** explicit live authorization, the endpoint/payload allowlist, the
  per-write read-back assertion, partial-progress handling, and the ledger schema.
- **F3 — acceptance.** The **frozen** ten A0 intents, same scoring, against the recorded baseline
  (18 write slots in top 3, 1 clean intent). Publish both sets together.

**Then stop and read the numbers.** If first-attempt accuracy is good, this is done — the rail is
catalogue-driven and no executor was built. If not, the failures are data about what is actually
missing, and that is the input to a decision nobody has made yet.
