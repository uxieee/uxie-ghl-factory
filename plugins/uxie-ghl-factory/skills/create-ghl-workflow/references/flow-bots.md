# Building a FLOW BOT (`FLOW_BUILDER_BOT`)

A flow bot's logic **is a workflow** — `workflowType: "agent"`, entered by a `conv_ai_trigger`.
Everything here is live-proven on 2026-08-26 unless it says otherwise.

## The binding — the one thing that silently broke builds

The flow binds to its agent through a **condition row**, not a top-level key:

```jsonc
"conditions": [{ "operator": "==", "field": "botId", "value": "<AGENT_ID>", "title": "", "type": "input" }]
```

Author it as `convTriggerBotId` on the trigger; the compiler emits the condition row.

🔴 **`convTriggerBotId` is NOT a stored field.** It is only the builder URL's query parameter. The
engine emitted it on the document from 2026-07-15 to 2026-08-26 and **GHL discarded it**: every
flow built in that window had an unbound trigger while the build reported `verify.pass: 1`. If you
see a flow whose trigger has `conditions: []`, that is the bug — re-author it.

Omit `convTriggerBotId` and the compiler warns `FLOW_BINDING:`. Do not ignore it.

## Creation order is workflow-FIRST

`POST /ai-employees/employees` with `botType: FLOW_BUILDER_BOT` **422s** without a non-empty
`objectiveBuilderWorkflowId`. So:

1. build the flow workflow (draft),
2. create the agent pointing at it,
3. set the trigger's `botId` to the new agent.

The UI's order (make the bot, then open its builder) is the reverse and does not apply here.

## Minimal flow

```jsonc
{
  "name": "Booking flow",
  "workflowType": "agent",
  "triggers": [
    { "ref": "t", "type": "conv_ai_trigger", "name": "Chat Initiated", "filters": [],
      "convTriggerBotId": "<AGENT_ID>" }
  ],
  "graph": [
    { "ref": "ask", "kind": "action", "type": "conversationai_objective", "name": "Ask treatment",
      "attributes": { "objective": "Find out which treatment they want", "contactField": "<FIELD_ID>" } },
    { "ref": "book", "kind": "action", "type": "conversationai_book_appointment", "name": "Book",
      "attributes": { "calendarId": "<CAL_ID>" },
      "onBooked":    [ /* … */ ],
      "onNotBooked": [ /* … */ ] }
  ]
}
```

## Custom triggers — jumping into a stage of the flow

`conv_ai_autonomous_trigger` (the UI calls it **"Custom trigger"**) is a **goto** trigger: it does
not start the flow, it **jumps the contact to a named step**. This is how you let a conversation
skip straight to booking when the customer asks for it.

```jsonc
{ "ref": "jump", "type": "conv_ai_autonomous_trigger", "name": "Wants to book",
  "target": "book",                                   // ← a step REF, resolved like goto's target
  "filters": [
    { "field": "customTriggerType",        "value": "book_appointment" },
    { "field": "customTriggerDescription", "value": "The customer wants to book an appointment" },
    { "field": "customTriggerPriority",    "value": "8" },
    { "field": "customTriggerSensitivity", "value": "medium" }
  ] }
```

- `target` takes a **step ref** and the compiler resolves it to the real step id. A dangling ref
  throws `REF_DANGLING` — a goto trigger with no `targetActionId` saves and has nowhere to send
  the contact.
- All four filters are **required by the drawer**. The compiler expands them to the envelope GHL's
  own builder writes, with `operator: "=="` on every row — the same operator `conv_ai_trigger`'s
  `botId` row uses. (`eq` is what the builder wrote before GHL's ~2026-08-27 validator update; the
  save now refuses it with `trigger-condition-invalid`, one error per row. The engine emits `==`
  through `TRIGGER_CORRECTIONS`; a hand-authored complete filter row is passed through untouched, so
  write `==` yourself if you supply `field`+`operator`+`title`+`type`.)
- `customTriggerPriority` is stored as a **number** (a live per-trigger PUT capture, 2026-08-27 —
  the engine coerces an authored string/number filter value to match; proved non-load-bearing,
  a plain string wrote and read back fine too); `customTriggerDescription`'s condition carries its
  text in **both** `value` and `title` (also fidelity, also non-load-bearing);
  `customTriggerSensitivity` is **lower-case** (`low` / `medium` / `high`).
- **Rules, and NONE of them are enforced by the API** — probed 2026-08-26, all accepted and
  persisted: 8 custom triggers on one workflow, a target naming no step, no target at all,
  duplicate targets, `priority: "999"`, `sensitivity: "telepathic"`. The drawer requires a
  `conv_ai_trigger` present, **max 3** custom triggers, priority 1–10, sensitivity
  `low|medium|high`, Conversation AI enabled, and the flow-builder beta
  (`GET /ai-employees/beta/{loc}?feature=flow_builder` → `isAllowed`). **The engine refuses these
  itself (`FLOW_TRIGGER`)** — nothing downstream will.
- **Runtime, measured 2026-08-27→31** (the drawer's "only after the primary workflow is
  completed" does NOT match what was seen). Proven: the fire jumps — `added_to_workflow`
  carrying `targetActionId`, a qualified `condition`, a `goto success`; the kill signature — a
  `remove_from_workflow` with NO add ~15–18 s after a successful jump, contact stranded; and the
  outcome — 0/11 replies with priorities wrong, 5/5 once the booking trigger held TOP priority,
  strictly above every sibling (eleven reproductions). The mechanism — a higher-priority sibling
  matching STALE conversation context, and a non-atomic remove+add whose add is deduped — is an
  INFERRED model that fits every observation, not a measurement. Config rule that follows: the
  trigger you always want to win holds top priority; siblings stay at LOW sensitivity with
  latest-message-scoped descriptions carrying explicit exclusions for their siblings' intents.
  Benign and distinct: a genuine second inbound message mid-run restarts the flow, and the
  restarted run reads the whole conversation and answers everything so far — a burst is answered
  once, after the burst. Corpus: `knowledge/corpus/workflows/50-runtime/flow-bot-runtime.md`.

⚠️ Adding a custom trigger through the **UI** has been seen to put the workflow into a state where
the builder's own full save 400s with `INVALID_TRIGGER_CONDITION`. The engine's plain workflow PUT
and `PUT /workflow/{loc}/only-triggers/{wid}` both still work. Cause not isolated.

## The nine Conversation-AI nodes

Field tables: `describe_step_type <key>`. What the tool will not tell you:

| | |
|---|---|
| **Terminal** | `conversationai_continue` and `conversationai_end` end their branch — nothing follows. An `end` inserted mid-flow is **silently dropped when the workflow saves**. Author them last. |
| **Containers** | `conversationai_book_appointment`, `conversationai_services_booking` (both `onBooked`/`onNotBooked`) and `conversationai_ai_splitter` (`branches[]` + `default`). |
| **Premium** | `conversationai_objective` carries a `stepIndex`. |
| **Labels ≠ keys** | `end`'s drawer says REACTIVATE AFTER BOT / (VALUE) / (UNIT); the keys are `sleepEnabled` / `sleepDuration` / `sleepUnit`. `continue`'s field is `instructions`, not `prompt`. Four wrong names have come from reading this surface's labels. |
| **Gated** | `conversationai_services_booking` needs a configured commerce service — its options endpoint returns `{"conversationai_services":[]}` on an account without one, and the builder then refuses to save the node. |

## What a flow may otherwise contain

A flow is an ordinary workflow **minus a denylist of 59 native action keys** — not a walled garden.
`wait`, `custom_webhook`, `custom_code`, `add_contact_tag`, `if_else`, `goto` and the opportunity
actions all work, and **third-party marketplace actions are permitted** (proven: a GoGHL
`send_outbound_whatsapp_message` persisted in a flow).

**All 7 native WhatsApp actions ARE blocked**, so a marketplace WhatsApp app is the only route to
WhatsApp from inside a flow. Full list and reasoning:
`knowledge/corpus/workflows/40-rules/flow-bot-action-compatibility.md`.

## Validators — there are none for this surface

**No client-side validator exists for any of the nine nodes, or for either trigger.** Checked
across all 18 of the builder's validator modules. So a flow-bot node's red badge is a
required-field-presence check, not a validator, and the engine's required-field rules were
assembled by hand from captures because there was nothing to read them off.

The real gate is **server-side, on save** — five validation types (`action`, `trigger`,
`structural`, `value`, `asset`) in a uniform `errorMetadata` envelope. **Probed 2026-08-26: the
server validates all nine.** Each node sent with empty attributes returns 400,
`validationType: "action"`, `messageKey: INVALID_FIELD_VALUE`, naming exactly the fields the
marketplace asset marks required — **9 out of 9 agreement**, so the required-field rules in this
engine are confirmed by an independent source.

`ruleId` is `"unspecified"` for all nine, so key off the message, not the id. Two phrasings:
plain text fields say `X is required.`; id/array fields (Calendar, Assigned Employee,
Conversationai Services) say `X is invalid. Please provide a valid value.`

A Custom trigger separately raised `trigger-condition-invalid` and blocked the save entirely. The
client's rule table enumerates 28 ids and includes **neither** that one nor any of the nine — it is
a dedup convenience, not the server's catalogue.

**The server does NOT check graph shape** — tested against every path we know. Dangling `next`,
duplicate node ids, orphan `parentKey`, a step wired after a terminal `end`, a multipath container
with no transitions, an orphaned `transition`, a two-node cycle: all accepted on the auto-save PUT,
on `isAutoSave:false`, with the change manifest (`createdSteps`/`modifiedSteps`), under the **full
publish body**, and by `validate-assets` (0 errors, 0 warnings). Publish is the same endpoint, so
there is no stricter route left for a check to hide in.

The three checks partition cleanly: **attributes** on the PUT, **references** in `validate-assets`
(`ASSET_CALENDAR_NOT_FOUND` is an error; `ASSET_TAG_NOT_FOUND` only a warning, because tags
auto-create), and **graph shape — nobody**. The engine's `REF_DANGLING` throw and parent-key repair
are not redundant with a server check; there is no server check.

It type-checks values but nothing more: `waitForReply: "yes"` is a 400
(`Expected boolean, received string`), while a bad `sleepUnit` enum, a negative `sleepDuration`,
and a `calendarId` that names nothing all save clean. Referential existence is checked separately
by `POST validate-assets`, not by the save.

Two traps if you ever hand-roll the PUT: `next: null` is rejected (omit the key — that is how the
server stores it), and a successful PUT bumps `version`, so re-read before every write or the next
one 422s.

**There IS a validator for these nodes, and it runs in the browser.** The marketplace catalog
carries per-field rules the builder evaluates to produce "Resolve N Errors" — **11 across seven of
the nine**, and the server enforces none of them:

| field | limit |
|---|---|
| `ai_message.message` · `custom_message.message` | 600 chars |
| `ai_splitter.description` · `book_appointment.promptInstructions` · `objective.objective` | 500 |
| `continue.instructions` · `objective.instructions` | 1000 |
| `end.message` · `objective.responseExample` | 300 |
| `objective.maxAttempts` | 1–5 |

`check_workflow` enforces these as of 0.34.0. Exceed one and the flow saves clean while the builder
shows a red badge — `maxAttempts: 99999` was written and stored in a live probe.

Details: `knowledge/corpus/workflows/40-rules/server-side-validation.md`.

## Runtime doctrine — a week of live conversations, 2026-08-26 → 31

Measured against a live flow bot through the real chat widget, verified against the server's
conversation records. Full evidence:
`knowledge/corpus/workflows/70-research/2026-08-31-flow-bot-runtime-certification.md` and the
distilled rules in `knowledge/corpus/workflows/40-rules/flow-bot-runtime-doctrine.md`.

1. **Capability is a property of the NODE, not the prompt.** Only
   `conversationai_book_appointment` (and `services_booking`) can act on the diary; from a
   `continue`/`objective`/`ai_message` node the agent genuinely cannot book, move or cancel, and
   no wording at any level — agent instructions, personality, objectives, branch labels, the node
   text itself — changes that. Instructing a node to claim a capability it lacks orders it to lie.
   If an intent needs an action, ROUTE it to the node that owns the action.
2. **The booking node obeys prompt FORM but owns its empty-result CONTENT.** A diagnostic
   "begin every reply with PINEAPPLE" was obeyed; five strategies to steer its no-appointment
   wording all failed. Never put the node in the position of answering about a booking that may
   not exist: identify the contact first (asking for the email/phone the booking was made under
   merges the anonymous visitor into the real record), and gate the node behind an `if_else` on a
   booking-live tag.
3. **Selection problems ARE prompt problems.** With several appointments the node names one
   already attended, offers past times, and silently picks the soonest of several —
   `promptInstructions` wording fixes all of it. The test: has the node ever done the right
   thing? Yes → selection, wording is the lever. Never → capability, fix the routing.
4. **A node's local scope beats a global prohibition.** A node scoped to a narrow job emitted the
   exact sentences the global prompt banned twice, because the request fell outside its scope and
   nothing local said what to do instead. Behavioural rules must be repeated in EVERY speaking
   node, byte-identically, and must carry the positive half (what to do), not just the ban.
5. **Never lead a splitter branch with a container.** A branch whose first step is a multipath
   container (`book_appointment` included) is never offered to the model, silently; one simple
   step at the branch head fixes it.
6. **In a lane ending at the booking node, every objective proceeds on unmet**
   (`proceedIfNotMet: false` — the attr is name-inverted): a blocking capture sends its closing
   message and ENDS the run on an undecided lead instead of walking on to times.
7. **Trigger priority is the kill switch** — see the custom-trigger section above.

## Known unknowns

- **Wait-on-wait.** A marketplace app's wait-for-reply step (GoGHL's `wait_step`) alongside a
  flow's own `waitForReply` — untested, and the first thing to check before shipping one.
- Flow workflows come back `status: "published"` on creation, engine-built or UI-built. The
  draft-first guarantee does not hold for `workflowType: "agent"`. Unexplained.
