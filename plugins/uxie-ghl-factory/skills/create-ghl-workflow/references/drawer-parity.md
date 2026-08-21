# Drawer parity — what the builder's config drawers write that the models alone don't tell you

> Distilled 2026-08-22 from the two full drawer surveys over GHL's recovered page layer
> (research repo: `reference/ACTION-DRAWERS.md` + `ACTION-DRAWERS-2.md` — 63+8 drawers, every
> control/stamp/normalization with file:line). This file keeps only the rules an AUTHOR or the
> engine must obey to produce steps byte-faithful to UI-built ones. The engine already handles
> the ones marked ⚙; the rest are author-side cautions the engine warns about where it can.

## Cross-cutting

- ⚙ **`attributes.type` echo is NOT universal.** Some models force-stamp it every save (IVR),
  some stamp at construction only (goto, event_start_date, dnd_contact…), some never write it
  (webhook, custom_webhook, custom_code, send_to_eliza), and for `internal_notification` the
  `type` is the CHANNEL (`email|sms|whatsapp|notification`), not the step type. Copy the
  catalog/step-example shape for the specific type; never blanket-echo.
- **Top-level vs attributes:** `isMarketplaceAction`, `version`, `workflowsActionType`,
  `integrationAccountId`, `testRequest`, `testResponse` are TOP-LEVEL template keys. Putting
  them in `attributes` is silent drift.
- ⚙ **Multipath triple:** `convertToMultipath` + `cat` + `transitions` travel together;
  `convertToMultipath:false` still writes `cat:'multi-path'` + `transitions: []` on hybrid
  types (wait — corpus ×470). The same save path fires for `ivr_gather` and any
  `isHybridAction`.
- **`find_contact` presence trap:** `shouldMoveToBranchingUI` tests `convertToMultipath` by KEY
  PRESENCE, not value — a stored `false` flips to `true` (two branches appear) the next time a
  human opens the step. A legacy single-path find_contact must OMIT the key entirely. ⚙ The
  engine only builds the branching form (`true` + both transitions + `attributes.name` mirroring
  the step name, which the hybrid writer requires).
- ⚙ **Client-minted uuids:** `transitions[].id`, `ai_agent tools[].id`; each transition is also
  a sibling `type:'transition'` template with `parentKey` wiring; `transitions[].meta.__branchKey__`
  must match the branch config key or the branch won't reconcile on reopen.
- ⚙ **`stepIndex` is stateful** (`meta.stepIndexCounter[key]`), and it also DECREMENTS on
  delete — treat it as a high-water mark read from the templates, never accumulate blindly.
- **Constructor replacement, not merge:** several models `cloneDeep(attributes)` wholesale
  (webhook, google_sheets). Omitted keys stay missing forever — emit the full default set.
- **Unguarded `.trim()`s:** `webhook.url` (and three others) crash the drawer's Save when the
  key is absent — always emit the key, at least `''`.

## Per-type rules

| Type | Rule |
|---|---|
| `remove_from_all_workflows` | **One-way legacy type.** The builder rewrites BOTH `type` and `attributes.type` to `remove_from_workflow` on every load (and autosaves it). Author `remove_from_workflow` (+`allWorkflows`/`includeCurrent`) instead; never emit `attributes.includeCurrent` for it. |
| `assign_user` | Four keys agree or the shape is un-producible: `user_list`, `traffic_weightage`, `traffic_index` (1-based contiguous), `total_index` — recomputed together on save. `customValues` mode EMPTIES `user_list`; both populated = unreachable. |
| marketplace (any) | `__customInputs__` written on EVERY save, even `{}`. `__name__` only when multipath; `__labels__`/`__customInputFields__` only with a custom-input-field config. A `dataTransformer` action can rewrite the whole payload (`safeEval`) — its persisted shape is not predictable from `inputFields`. |
| `sms` family | `body` is PLAIN TEXT with real `\n` (`parseHTMLToBody().trim()`); HTML in `body` re-parses differently on next open. `email.html` IS HTML (`cleanHTMLForEmail`'d, `data-cv-defaults` spliced into the first tag). |
| `email` | `attributes.attachments` = `{name,url,size}` entries only (rows without `url` are dropped at save). An email-builder email copy sets `isCloned:true` on the SOURCE (⚙ duplicateStep mirrors this). |
| `add_contact_tag` / `remove_contact_tag` | Tags are NAMES; inline-created ones lower-cased + trimmed; `tags` and `customTags` mutually exclusive at save; `removeAll:true` forces `tags: []`. |
| `create_opportunity` | Field rows carry all five keys `{field,value,title,type,date}`; `DATE` rows need `date ∈ {currentDate,specificDate,customDate}` (`specificDate` = `YYYY-MM-DD`); `SELECT` rows may carry `__customFieldType__`. |
| `webhook` | Always emit `url` (≥ `''`), `method`, `customData: []`, `headers: []` — the constructor replaces the defaults wholesale and Save `.trim()`s `url` unguarded. Query params live in `customData`, never folded into `url`; no `parameters` key. |
| `custom_webhook` | Stamped on construction: `method:'POST'`, `event:'CUSTOM'`, full `body {contentType:'application/json', rawData, keyValueData: []}` (even for GET), `authorization {type:'NONE', data: null}` (explicit null), `webhookResponse {selectedContact:''}`. |
| `custom_code` | **Cannot be authored offline:** `attributes.output` must be the non-empty object a real `POST /custom-code/run-test` returned (snake_case `location_id` in that call), and editing `code` voids it. ⚙ The engine warns when `output` is missing/empty. Defaults are the JS boilerplate + `inputData {number1:'10', number2:'20'}` + `language:'javascript'`. |
| `loop` | The drawer rebuilds `attributes` as exactly `{type, items, limit, mode}` — a stored `exitNext` is DESTROYED on every drawer save and only re-inferred from graph membership. Don't rely on `exitNext` surviving a human edit. |
| `add_to_affiliate_manager` | The drawer writes **no attributes at all** (`attributes = undefined` on save) — anything authored there is erased on the first human save. |
| `remove_assigned_user` | Attributes are the literal `{type:'remove_assigned_user'}`; stored attributes discarded. |
| `update_contact_field` | Constructor guard is `attributes && attributes.fields` — a payload without `fields` is thrown away wholesale and `actionType` reverts to `update_field_data`. Always emit `fields`. |
| `internal_notification` | `attributes.type` = the channel; the nested channel object carries its own echo. `send_notification` is NOT a step type — it's the `notification` channel. |
| `google_sheets` | `attributes.type` stamped only on a FRESH model; a stored step lacking it stays lacking it. Constructor replaces the object wholesale. |
| `ai_agent` | `tools[].id` uuid-minted client-side; `mcpConnections[].selectedTools: []` means **ALL tools**, not none. |
| IVR family | `ivr_say`/`ivr_gather` force-stamp their `attributes.type` on every save (including embedded copies inside the other IVR models); `ivr_connect_call` is the only IVR model with NO `type` echo. |
| `wait` / `find_contact` | Always hybrid: `cat:'multi-path'` + `isHybridAction:true` + `hybridActionType` stamped unconditionally — omitting them routes the save down the plain writer and the branch tree is lost. ⚙ |

## Branch engines

There are **three** branch systems with **two different classes both named `BaseMultiPath`** and
incompatible element shapes (if/else `branches[].segments[]`, internal-multipath `transitions[]`,
marketplace branch configs). Never copy a branch shape across engines; compile each through its
own path (the engine's container emitters do this).
