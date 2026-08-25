# Spec — the internal endpoint catalogue

Status: **proposed, revision 2**. Changes the contract of `catalog/internal-endpoints.json` and the
generator that writes it.

> **Revision 2** incorporates an adversarial review that returned *not ready* on revision 1. Three
> counts were wrong, the central reach claim was too strong, the `kind` rationale confused ranking
> with authorization, and the pipeline violated the repo boundary. Corrections are marked **[r2]**
> and the errata are listed in §9.

---

## 0. What this is, and what it deliberately is not

**This is a data project, not an architecture project.** The internal rail already has a working
executor. What it lacks is a catalogue that tells the agent what to send.

So the whole of this spec is: **make the catalogue correct, complete and self-describing, so
`search_endpoints → describe_endpoint → raw_request` succeeds on the first attempt.**

### 0.1 What `raw_request` actually covers **[r2]**

Revision 1 claimed `raw_request` reaches 100% of the internal surface. **That is false**, and the
correction matters because it changes what the row contract must carry.

`raw_request` handles **JSON REST calls on two fused host/auth modes** (`core/tools.mjs:3717-3831`).
The gateway serialises every ordinary body with `JSON.stringify` and reads every ordinary response
with `res.text()` (`core/gateway.mjs:164-182`). Six already-catalogued call classes fall outside it:

| gap | evidence |
|---|---|
| multipart upload | `PhoneSystemService.ts:19-28`, `states/app.ts:563-570` |
| blob response | `states/app.ts:575-580` |
| endpoint-specific headers — `developer_version`, `x-workflow-id` | `WorkflowMarketplaceService.ts:454-467`, `use-ai-chat-transport.ts:47-59` |
| SSE | `read-ai-stream.ts:27-43` — the gateway has `stream()` at `core/gateway.mjs:261`, and `raw_request` only ever calls `call()` |
| plain-Bearer on the services origin | `mcp-internal/README.md:119-125` documents one, but `host:"ai"` always couples that origin to the dual-credential rail (`core/tools.mjs:3786-3790`) |
| `sourceid` on membership calls | `skills/ghl-memberships/engine/api.mjs:27-32` |

**The consequence for this spec:** a row must say whether it is raw-callable at all, and how. The
contract therefore separates `origin`, `authRail`, `transport`, `responseMode` and `rawCallable`
(§2). A row that is not raw-callable emits **no `callWith`** — better silence than an instruction
that cannot work.

**The no-second-gateway decision is unaffected and stands.** Do not build a second execution path,
a second confirm gate, or a second scrub. If structured execution is ever wanted, it is a thin
validation/assembly adapter over the same raw execution core.

### 0.2 Out of scope, and not to be added later without a new decision

| not building | because |
|---|---|
| `execute_endpoint` / `call_endpoint` | a second execution path doubles the surface that must stay correct — the gate, the scrub, the `partialProgress` contract — and one copy will fall behind. `core/tools.mjs:112-118` stands. |
| a generated write rail | writes go through the compiler. `build_workflow`/`edit_workflow` enforce the GHL validator rules, the type cards, the resolver layer and the fail-closed guards. Nothing generated from a bundle may bypass that. |
| promoting the audit descriptor engine to a second consumer | it is GET-locked *inside* the engine (`core/audit-capabilities.mjs`), and the audit receipts are minted against that being structural rather than conventional. Leave the lock where it is. |
| anything touching `skills/create-ghl-workflow/engine/` | out of scope entirely. |

The catalogue stays **advisory**. It never gates a call, never refuses one, and is never the reason
a valid request fails. Its only job is to raise first-attempt accuracy.

---

## 1. The defects this exists to fix

### 1.0 Provenance of every number **[r2]**

Counts below are marked by how they were established. **Nothing here may be used as a literal gate
threshold** — gates are structural predicates (§5.1), and the implementer re-derives the counts.

- **[measured]** — verified directly against the files in this repo.
- **[review]** — established by the revision-2 reviewer with cited evidence.

### 1.1 Rows that are wrong

| # | defect | count | cause |
|---|---|---|---|
| D1 | path missing a whole base segment | **24 emitted rows / 26 source shapes** [review] **[r2 — was 26]** | `resolveUrl` captures `config.baseServiceUrl` and drops the literal suffix in `new LocationsService(\`${config.baseServiceUrl}/locations\`)` (`build-endpoint-catalog.mjs:91-93,149-155`; `LocationsService.ts:25`). Catalogued `GET /:id` is really `GET /locations/{id}`. The 26→24 gap is one omitted call, two legitimate duplicate pairs, and a false `/links/search` + `/locations/search` collapse. |
| D2 | abstract base-class templates presented as endpoints | **7 emitted rows / 8 call sites** [review] **[r2 — was 8]** | `services/BaseService.ts:16-58` holds eight axios call sites; seven rows cite it. `findAll` (`:16-18`) was dropped because its URL is an expression. |
| D3 | `METHOD-UNKNOWN` | 14 [measured] | **[r2 — cause corrected]** All 14 are `via:"url-literal"`, **not `fetch`**: a URL is declared as a literal and the generator never traces it to a consumer (`build-endpoint-catalog.mjs:187-200`). |
| D4 | no literal path segment | 9 [measured] | consequence of D1/D2. |

### 1.2 Rows that are missing

| # | defect | count |
|---|---|---|
| D5 | generic-syntax call sites dropped | **74 of 74** [review] **[r2 — was 73 of 74]** |
| D6 | call sites dropped for unresolved URLs (`this.baseUrl` from a constructor arg, `this.locationId` instance fields) | 54 [review] |
| D7 | `.vue` handled as text, never parsed for call sites | 8 sources [review] |

D5's cause is one character at `build-endpoint-catalog.mjs:155`: the regex requires `(` immediately
after the method name, so **`axios.get<WorkflowListResponse>(...)` never matches** — and those are
exactly the call sites carrying an explicit response type. **Zero** of the 74 have a catalogue
citation.

The AST sweep counts **369 call sites** [review] — but scoped: property calls on `axios`, `Axios`,
`this.requests` or `requests` with a GET/POST/PUT/PATCH/DELETE method. It **excludes** callable
`axios({...})`, `fetch` and `sendBeacon`, so it is not every HTTP call and must not be used as a
completeness oracle without saying so.

**Most damning:** `/workflow/{loc}/trigger` — the most-used write path in the plugin — has no row.
Neither do `/workflows/logs/v2`, `/workflows/sticky-notes-all`, or
`/workflow/{loc}/validate-assets`. **70 unique `METHOD + path` shapes** that typed tools call have
no row (from 100 unmatched capability entries of 158) [review].

### 1.3 Rows that say nothing

A row is `{method, base, path, sources[], callSites}`. There is **no summary** — the single largest
gap; **no query parameters** (`build-endpoint-catalog.mjs:143` strips them, and 421 call sites pass
them via an axios `params:` object the URL regex never sees); **no body, no response shape**;
`callSites` predicts nothing (211 of 235 are `1` [measured]) yet ships in every stub; and `sources`
is actively misleading, since several degenerate rows point at an abstract base class.

### 1.4 Consumer-side defects

| # | defect | evidence |
|---|---|---|
| D8 | `tool-descriptions.json` **shadows** hand-written descriptions | `describe(tool, fb)` is `CATALOG[tool]?.description ?? fb` (`core/tools.mjs:48-55`) [measured]. `get_workflow_logs`'s real line (`:1303`) never ships. 35 catalogue entries [measured] shadow 35 of 41 tools. |
| D9 | **neither** server publishes `instructions` **[r2]** | `stdio.mjs:30-32` **and** `stdio-audit.mjs:52` [measured]. |
| D10 | writes dominate read-shaped results | [measured, A0 baseline] Across ten read-shaped intents: **18 of 30 top-3 slots are writes**; only **1 of 10** intents has a clean read-only top 3. *"which contacts are sitting at step X"* returns `remove-stuck-statuses` and `requeue-stuck-statuses` at #1 and #2. `scoreEndpoint` (`core/tools.mjs:143-166`) has no method term. |
| D11 | stale count shipped in two places | `core/tools.mjs:106` and `:3836` say **222**; the file holds **235** [measured]. |
| D12 | `describe_endpoint` → `raw_request` does not compose | **[r2 — population corrected]** The set needing prefix folding is **150 rows** (105 on `/workflow` + 45 on other prefixes), not the 130 non-`/workflow` rows — 85 of those have a bare origin and need no folding [review]. Gateway base is bare (`core/gateway.mjs:8`). |
| D13 | header advice is wrong and moot | `describe_endpoint` says `Version: 2021-04-15` (`core/tools.mjs:3901-3905`); the gateway already sends `2021-07-28` on every call (`core/gateway.mjs:86-97`) [measured]. |
| D14 | `total:` is noise | 108–218 of 235 across the ten baseline intents [measured]. |
| D15 | **the endpoint catalogue is not in the bundle** **[r2, new]** | esbuild inlines only `__MCP_VERSION__` and `__TOOL_CATALOG__` (`scripts/esbuild-config.mjs:13-32`) [measured]; discovery reads the external JSON at `core/tools.mjs:134-140`. `test/bundle.test.mjs:19-29` only calls `tools/list`, so **a shipped bundle with no usable catalogue passes today.** |
| D16 | **the normal capability manifest is stale** **[r2, new]** | committed `capability-manifest.json` has **137** rows [measured]; a fresh `buildCapabilityManifest()` yields **158** [review]. Parity tests cover only the audit manifest (`test/audit-capabilities.test.mjs:685-690`). |

---

## 2. The row contract

### 2.1 Shape

```json
{
  "id": "workflows-marketplace--register-test-webhook",
  "method": "POST",
  "origin": "https://backend.leadconnectorhq.com",
  "path": "/workflows-marketplace/internal-triggers/register-test-webhook",
  "url": "https://backend.leadconnectorhq.com/workflows-marketplace/internal-triggers/register-test-webhook",
  "authRail": "bearer",
  "transport": "json",
  "responseMode": "json",
  "extraHeaders": [],
  "rawCallable": true,
  "kind": "write",
  "summary": "Registers a test webhook for a marketplace trigger and returns the integration event id to poll.",
  "operation": "registerTestWebhook",
  "service": "WorkflowsMarketplacePlatformService",
  "pathParams": [],
  "query": [{ "name": "locationId", "type": "string", "required": true }],
  "body": {
    "typeName": "TestTriggerParams",
    "properties": [
      { "name": "triggerKey", "type": "string", "optional": false },
      { "name": "triggerValues", "type": "{ [key: string]: any }", "optional": false },
      { "name": "lastProcessedValue", "type": "any", "optional": true,
        "doc": "Backend returns newLastProcessedValue which should be sent back here." }
    ]
  },
  "returns": { "typeName": "RegisterWebhookResponse", "properties": [] },
  "coveredBy": [],
  "note": null,
  "reach": "source-only",
  "confidence": { "path": "resolved", "query": "resolved", "body": "resolved", "returns": "resolved" },
  "sources": ["services/marketplaceServices/WorkflowsMarketplacePlatformService.ts:330"]
}
```

### 2.2 Field semantics

| field | rule |
|---|---|
| `id` | stable `{service-slug}--{operation}`, kebab, unique. The generator **fails** on a collision. This is what `describe_endpoint` addresses; `method`+`path` is a fragile key that already needs a normalising fallback. |
| `method` | GET/POST/PUT/PATCH/DELETE. `METHOD-UNKNOWN` is never emitted. |
| `origin` | **[r2]** scheme + host **only**, e.g. `https://backend.leadconnectorhq.com`. Never carries a path prefix. |
| `path` | full wire path with any prefix folded in — exactly what `raw_request` takes. `{param}` braces, matching the notation typed tools already use in `capabilities[]`. Query lifted into `query[]`. |
| `url` | `origin + path`, pre-joined. Kills D12 at the source. |
| `authRail` | **[r2]** `bearer` \| `bearer+token-id`. **Independent of `origin`** — the services origin is reachable on plain Bearer for at least one documented endpoint, which today's `host:"ai"` coupling cannot express. |
| `transport` | **[r2]** `json` \| `multipart` \| `sse` \| `beacon`. |
| `responseMode` | **[r2]** `json` \| `text` \| `blob` \| `sse`. |
| `extraHeaders` | **[r2]** endpoint-specific headers beyond the standard set (`developer_version`, `x-workflow-id`, `sourceid`). |
| `rawCallable` | **[r2]** whether `raw_request` can actually make this call — `transport === 'json' && responseMode ∈ {json,text} && extraHeaders.length === 0 && authRail` expressible. **When false, `describe_endpoint` emits no `callWith`.** |
| `kind` | `read` \| `write` \| `destructive`. **Ranking metadata only** — see §2.3. |
| `summary` | one sentence, ≤160 chars, on what the call returns or changes. Overlay-persisted (§2.5). |
| `pathParams`, `query`, `body`, `returns` | extracted; each facet `resolved` or `null`, never partial. |
| `coveredBy` | **[r2] an ARRAY.** Several endpoints are covered by up to ten typed tools; a singular field cannot express that. |
| `note` | the one trap, from the overlay. |
| `reach` | `proven` \| `source-only` \| `refused`. Overlay-persisted — it is live evidence and regeneration must not erase it. |
| `confidence` | per-facet `resolved` \| `open-map` \| `unresolved`. |
| `sources` | ≤4 `file:line`. Kept for provenance, **removed from the search stub**. |

`callSites` is **dropped** — 211 of 235 identical, zero predictive value, present in the most
budget-sensitive payload.

### 2.3 `kind` is ranking metadata, not authorization **[r2 — rationale corrected]**

Revision 1 justified curating `kind` by claiming an inferred model would leave "83 of 113 writes
ungated". **That conflated ranking with authorization and is withdrawn.** `raw_request` gates
**every** non-GET on `confirm` at `core/tools.mjs:3775-3783`, regardless of what the catalogue says.
The catalogue cannot ungate anything, because it never gates anything (§0.2).

`kind` is still curated, for the reason the A0 baseline actually demonstrates: **an inferred model
has no prose to read**, and the measured consequence is that destructive runtime mutations rank #1
and #2 for read-shaped questions. `kind` exists to fix ranking. That is its whole job.

Rows that must be classified `destructive` include:

```
DELETE /workflow/{locationId}/delete                    bulk delete, ids in the axios `data` config
PUT    /workflow/{locationId}/change-status             bulk unpublish
POST   /workflow/{locationId}/{workflowId}/start-workflow          mass enrolment → real sends
POST   /workflow/{locationId}/{workflowId}/remove-stuck-statuses/{stepId}
DELETE /workflow/{locationId}/secret-manager/{secretId}            breaks every custom-webhook action
POST   /workflow/flowguard/rate-limiting/bypass                    disables runaway protection; NO locationId
POST   /workflow/{locationId}/email/send-test-email                real send
POST   /workflow/{locationId}/sms/send-test-sms                    real send
```

### 2.4 Query strings return to the row

The catalogue's current note reads *"query strings are stripped — they belong to the calling tool,
not the endpoint identity."* That is right about **identity** and wrong about **instruction**. The
discarded parameters carry the danger and the correctness: `?userId=` (required on
`remove-stuck-statuses`), `?retryStep=true` (changes semantics), `install?locationId=` (which
account gets the install), and `dateType=custom` + `action=first|next` on `/workflows/logs/v2`,
without which dates are silently ignored behind a `200`.

Identity stays `method`+`path`; the generator dedupes on that and **unions** query keys across call
sites. `required: true` only when the property is non-optional in its declared type — and the row
must record that **TS `?` is a caller-side claim, never a server-side one**.

### 2.5 Overlays, and what must survive regeneration **[r2]**

Revision 1 lost `summary` and `reach` on every regeneration, and disagreed with itself on the
overlay key. Resolved:

**Overlay key is the wire identity `"METHOD /path"`** — what a human recognises and what
`raw_request` takes. `id` addresses `describe_endpoint`; it is not the overlay key.

Four overlay files, all hand-maintained, none ever written by a generator:

| file | holds |
|---|---|
| `endpoint-kinds.json` | `kind` per non-GET |
| `endpoint-notes.json` | the one trap per endpoint |
| `endpoint-summaries.json` | `summary` where none could be generated |
| `endpoint-reach.json` | `reach` + the date it was proven |

**Known consequence, accepted deliberately:** when the extractor corrects the 24 broken paths, those
overlay keys orphan. Gate G10 fails the build and **names each orphan**, because a corrected path is
exactly when a human should re-check its note. Overlays may therefore be authored now against the
211 rows that are not path-broken, with ~24 re-pointed later.

### 2.6 Repo split — extraction is not enrichment **[r2, new]**

Revision 1 had the `knowledge/` generator read `plugin/` overlays and `TOOLS`. **That violates the
one-way rule** (`gohighlevel/CLAUDE.md`: `plugin/` reads from `knowledge/`; `knowledge/` never
depends on `plugin/`).

Two artifacts, two owners:

```
knowledge/scripts/build-endpoint-catalog.mjs
    └── emits  knowledge/catalog/internal-endpoints.source.json
               SOURCE-DERIVED ONLY: id, method, origin, path, authRail, transport,
               responseMode, extraHeaders, operation, service, pathParams, query,
               body, returns, confidence, sources
                     │
                     ▼
plugin/.../mcp-internal/scripts/build-endpoint-catalog.mjs      (NEW, plugin-side)
    └── reads the source artifact + the four overlays + TOOLS[].capabilities
        emits  mcp-internal/catalog/internal-endpoints.json
               adds: kind, summary, note, reach, coveredBy[], rawCallable, url
```

`coveredBy` and `rawCallable` are computed plugin-side because both are facts about *this server*,
not about GHL.

### 2.7 `coveredBy` — the join **[r2 — scope corrected]**

34 of 41 typed tools carry `capabilities: [{method, path}]` — 158 entries. Three notations exist
today (`{loc}` vs `:locationId`; query kept vs stripped; prefix folded vs split), so the exact join
is **17 of 158**, normalised **58 of 158** covering 30 rows [review].

**The residue is NOT an extractor completeness score.** Of the 100 unmatched entries (70 unique
shapes), many are AI, memberships, courses and SSE surfaces that **do not exist in the
workflow-builder source tree** the extractor mines. Requiring all 158 to resolve cannot succeed
from this input. The join is therefore scoped to surfaces the source tree actually covers, and the
out-of-scope surfaces are listed explicitly rather than counted as failures.

---

## 3. The extractor

Rewrite on the **TypeScript compiler API**. Regex has failed twice on this input (D5, D1); it cannot
resolve a type or fold a constant.

```js
ts.createProgram(files, {
  paths: { '@/*': [`${SRC}/*`] },
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  skipLibCheck: true, strict: false, allowJs: true, noEmit: true,
});
```

No `node_modules` for the recovered tree is needed — `axios` resolves to `any`, and schemas come
from the declared return type / generic argument.

### 3.1 The hierarchy, corrected **[r2]**

Revision 1 said `services/BaseService.ts` has **36 subclasses** and that fixing it turns 8 rows into
~36. **Both are wrong.** Measured:

| base class | subclasses | override `endpoint`? |
|---|---|---|
| `services/marketplaceServices/BaseService.ts` | **32** | wrapper pattern, `this.baseUrl` from constructor |
| `services/BaseService.ts` (the generic one) | **4** — `WorkflowService`, `TriggerService`, `CustomFieldService`, `AIEmployeeService` | **only 2**: `WorkflowService`, `TriggerService` |

So the generic-base fan-out is **4, of which 2 override** — not 36. `TriggerService.ts:5-8`
overrides to `${locationId}/trigger`, which is how `/workflow/{loc}/trigger` finally appears.

**And a hazard the plan must avoid:** emitting every inherited CRUD method for every subclass
creates **false cross-product endpoints**. A method is emitted only when the subclass is proven to
use it.

### 3.2 What the checker cannot do on its own **[r2]**

The compiler API identifies call expressions, declarations, heritage, types, optionality and JSDoc.
It does **not** evaluate this runtime flow:

```
new LocationsService(config value + "/locations")
  → constructor argument → super(baseUrl) → this.baseUrl → this.baseUrl + request URL
```

(`LocationsService.ts:5-8,25`; `marketplaceServices/BaseService.ts:3-8,19-47`.)

C2 therefore needs a **symbolic evaluator layered over checker symbols**, handling: resolved class
identity; literal-plus-placeholder strings; explicit production-config selection
(`config/index.ts:52-59`); constructor/`super`/field propagation; real virtual dispatch of
`this.endpoint`; wrapper overrides with runtime absolute-URL branches (`ValidationService.ts:15-25,
33-60`); named singleton exports with inherited constructors (`LinksService.ts:13-19,85`); and
**ambiguity-preserving skips** — multiple instantiations or an unresolvable constructor value
produce a printed skip, never a guessed row.

### 3.3 Free disambiguation worth exploiting

`services/marketplaceServices/BaseService.ts:19-48`: `requests.get(url, query)` — 2nd arg is
**always** query; `requests.post/put(url, body)` — 2nd arg is **always** body. Settles 97 endpoints
with no inference. The same file pins `Channel: APP`, `Source: WEB_USER`, `Version: 2021-04-15`
(`:11-17`) — extractable as constants.

### 3.4 Fidelity, and how it is verified **[r2]**

Indicative only: body resolved on ~57 of 80 write endpoints, query on ~93 of 235, response object
shapes on ~49. **These are not acceptance thresholds.** A deterministic extractor is verified by
**named fixtures** — one per resolution class in §3.2 — not by a ±3 tolerance against a count.

### 3.5 `METHOD-UNKNOWN` **[r2 — task corrected]**

All 14 are `via:"url-literal"`: a URL declared as a literal that the generator never traced to a
consumer. The fix is **variable tracing** — follow the declaration to its use — not fetch-options
parsing. Handle `fetch`'s default GET where a consumer is found; where none is, **skip and print**.
`sendBeacon` stays POST.

---

## 4. The MCP surface

No new tools. Three existing ones change shape.

**`search_endpoints`** — stub becomes `{id, method, path, kind, summary, coveredBy, note, reach}`,
dropping `base`, `callSites`, `sources`. Ranking gains a method-safety term (§2.3). The hardcoded
`222` goes.

**`describe_endpoint`** — keyed on `id`, emitting object-form `coveredBy[]` and, **only when
`rawCallable`**, a `callWith` carrying a copy-pasteable `raw_request` path with the prefix folded
in. The header paragraph is deleted; the gateway already sends them.

**Server instructions** — `describe()` inverted so the hand-written line is the description and the
catalogue contributes only `risk`; and `instructions` passed to **both** servers. Note the SDK
signature is `new McpServer(info, { instructions })`, and instructions arrive in the **`initialize`
result**, not `tools/list` — so the test must read `initialize`. The audit profile needs its **own**
string that never mentions `raw_request`, which it does not expose.

---

## 5. Verification

### 5.1 Build gates **[r2 — three replaced]**

| gate | condition |
|---|---|
| G1-G4 | zero rows with an unresolved base prefix / from an unoverridden abstract base / `METHOD-UNKNOWN` / with no literal path segment |
| **G0** | **[r2, new]** the **discovered call-site inventory** does not shrink, and the skip ledger is reviewed. Without this, G1-G4 are satisfiable by emitting nothing. |
| G5 | every row has a non-empty `summary` (generated or overlay) |
| G6 | every non-GET row appears in `endpoint-kinds.json` |
| **G7** | **[r2 — scoped]** every typed-tool capability **on a surface the source tree covers** resolves to a row. Out-of-scope surfaces (AI, memberships, courses, SSE) are listed, not counted as failures. |
| G8 | `id` unique |
| G9 | a facet is `resolved` or `null` — never partial |
| G10 | every overlay key matches a row; orphans named |
| **G11** | **[r2, new]** the endpoint catalogue is inlined into **both** bundles, and a committed-bundle test calls `search_endpoints` and gets rows (D15) |
| **G12** | **[r2, new]** `capability-manifest.json` is fresh — regenerate and diff (D16) |

### 5.2 Drift **[r2 — mechanism corrected]**

Revision 1 said to pin the bundle chunk hash and prove the gate by pointing at
`bundle-2026-08-21-3`. **That cannot work:** captures `-2` and `-3` have identical chunk and map
names, byte sizes and source counts (`CAPTURE.json:2-8` in both) [review].

Use **whole-capture identity** — `capturedAt` plus a hash of the file inventory — and select the
newest capture by `capturedAt`. The gate fails on a *content* change, not a filename change.

### 5.3 Live proof

Designated test sub-account only, never a client. ≥20 endpoints, executed **and read back on a
separate request**; results stamp `reach`.

**The reach differential needs its own script [r2].** The gateway adds the marketplace headers
unconditionally (`core/gateway.mjs:86-111`), so the "without headers" arm **cannot be run through
it**. This is a separate, human-gated, allowlisted diagnostic — not an MCP tool.

### 5.4 Acceptance

The A0 baseline is recorded at `test/fixtures/catalogue-acceptance-baseline.json` (offline half —
ranking only; it needs no token). Re-run identically at the end. The model, prompt and scoring must
be **frozen** at A0 or the comparison is meaningless.

---

## 6. What remains impossible

1. **22 named types whose modules were erased.** TypeScript strips type-only modules at compile
   time; they emit no runtime JS and can never appear in a sourcemap.
2. **16 write endpoints typed as open maps** — `services/BaseService.ts:35`. The frontend genuinely
   does not know.
3. **Server-side validation** — enum sets not written as unions, min/max, formats, cross-field
   conditionals, defaults.
4. **Error response shapes.** No call site declares one.
5. **Query keys the server accepts but the builder never sends.**
6. **Auth, status codes, rate limits.** Not in this source, and auth differs per surface — must be
   A/B proven live.

Every one surfaces as `confidence: "unresolved"` or `"open-map"`, never a confident schema. **A
wrong schema is worse than no schema:** it converts a loud 404 into a silent wrong call.

---

## 7. Implementation plan

[`endpoint-catalogue-implementation.md`](endpoint-catalogue-implementation.md) — task-level, with
the dependency graph and the command that proves each task done.

---

## 8. Decisions recorded

| decision | why |
|---|---|
| No `execute_endpoint`, no second gateway. | One execution path. `core/tools.mjs:112-118` stands. |
| The reach claim is narrowed to JSON REST. **[r2]** | Six call classes are outside `raw_request` (§0.1). |
| Writes never become catalogue-driven. | The compiler owns them. |
| The catalogue is advisory and never gates a call. | Source-mined from a rotating bundle. |
| Query strings return to the row. | The discarded parameters carry the danger. |
| `kind` is curated **ranking** metadata. **[r2]** | Not authorization — `raw_request` gates every non-GET regardless. |
| A facet is resolved or null. | A wrong schema turns a loud 404 into a silent wrong call. |
| Extraction and enrichment are separate artifacts in separate repos. **[r2]** | The one-way rule. |
| The old generator is archived, not deleted. | Project rule. |

---

## 9. Errata against revision 1 **[r2]**

| claim in r1 | corrected |
|---|---|
| `raw_request` reaches 100% of the surface | JSON REST only; six classes outside it (§0.1) |
| 26 rows missing a base segment | 24 emitted rows / 26 source shapes |
| 8 abstract base-class rows | 7 emitted rows / 8 call sites |
| 73 of 74 generic call sites dropped | **74 of 74** |
| `METHOD-UNKNOWN` caused by unparsed `fetch` options | all 14 are `url-literal` declarations never traced to a consumer |
| `services/BaseService.ts` has 36 subclasses; 8 rows → ~36 | **4** subclasses, **2** overriding; the 32 belong to the *marketplace* base |
| 130 rows need prefix folding | **150** (105 `/workflow` + 45 other); 85 have a bare origin |
| an inferred `kind` would leave 83 writes ungated | ranking ≠ authorization; withdrawn (§2.3) |
| `coveredBy` is a single tool | an array — up to ten tools cover one endpoint |
| overlays keyed by `id` (spec) / by path (plan) | wire identity `"METHOD /path"`, stated once |
| `knowledge/` generator merges plugin overlays | split into two artifacts, two owners (§2.6) |
| drift proven by pointing at `bundle-2026-08-21-3` | impossible — identical chunk names/sizes; use whole-capture identity |
| G7 as an extractor completeness gate | cannot succeed; scoped to covered surfaces |
| G1-G4 sufficient | add G0 — they are satisfiable by emitting nothing |
| — | D15 (catalogue not bundled) and D16 (stale manifest) were missed entirely |
