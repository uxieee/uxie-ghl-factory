# Outbound agents and AI Campaigns — when a Conversation AI agent texts first

Since the 2026-09/10 wave a Conversation AI agent can **start** a conversation. Three pieces make it happen:

- an outbound **config** activates a sending channel (SMS only) for the agent;
- outbound **triggers** say which CRM events start a conversation;
- an **AI Campaign** starts one for a chosen set of contacts at once (a bulk action).

Ground truth: corpus `ai-agents/20-api/conversation-ai-outbound.md` (routes),
`ai-agents/30-types/conversation-ai-outbound-trigger.md` (the nine types),
`ai-agents/50-runtime/conversation-ai-outbound-runtime.md` (what a send contains and where it is logged). Evidence: the
sniffs in `knowledge/sniffs/convai-wave-2026-10-29/` named per section below. Everything was measured on a test
sub-account with a reserved fictional destination number: the **attempt** of each send is proven; **delivery is not**
(the sandbox number is not A2P-registered and the carrier refused every message, error 30034).

🔴 **Every write on this page can make GHL text real people or sign compliance in the caller's name.** Each one is on the
confirm-before-live list in `SKILL.md`, and the plugin gates each with a send-class ack token: the preview carries
`sendClass {rule, class, consequence, ackToken}`, and the write needs `confirm:true` **and** `acknowledge:<ackToken>`
(otherwise `SEND_CLASS_ACK_REQUIRED`). Never pass the token on your own: show the human the consequence, ask, and pass
it only after their explicit yes in their own message.

The surface is behind the Lab `conversationsAI.outbound` ("Outbound AI Agents"), which is **one-way**
(`isIrreversibleFeature: true` on its card; `liveAt` 2026-11-17, so GHL turns it on for every account then). What the
routes answer with the Lab off was never measured. No tool flips Labs; do not flip this one.

## When an agent sends — armed vs campaign-eligible

| Leg | Status |
|---|---|
| **Mode gates trigger sends.** Same activated agent, same enabled `contact_tag` trigger, same contact: mode `off` sent nothing within 60 s; mode `auto-pilot` attempted the opener within about 75 s | `[proven-live 2026-10-29, differential]` (`live-outbound-runtime-L5-L7.json` steps 5-7) |
| Mode `suggestive` on an outbound agent: sends, drafts or nothing? | not measured — **treat it as able to send** |
| The config must be enabled for a trigger to send | `[inferred — the Triggers screen's banner "Outbound is off. Turn on a channel to start using your triggers"; no fire was tried with the config off]` |
| The trigger itself must be enabled | `[inferred — the drawer's "Enable trigger" switch; no fire was tried with a disabled trigger]` |
| A campaign can use any agent whose config is enabled, with or without a trigger | `[proven-live 2026-10-29]` (`live-ai-campaign-L8.json`; the campaign ran with the agent in `auto-pilot`; a campaign with mode `off` was not run) |

So, in the plugin's words:

- **armed** = an enabled config **and** an enabled trigger **and** mode `auto-pilot` or `suggestive`. Only the mode leg is
  a measured differential, and only `contact_tag` has ever fired; for the other trigger types the arming rule is
  `[inferred]`.
- **campaign-eligible** = an enabled config, nothing more.

🔴 **A mode change alone arms an agent.** On an agent that already has an enabled config and an enabled trigger, a two-key
PUT `{mode: "auto-pilot", locationId}` was the only step between "silent" and "texting contacts" `[proven-live
2026-10-29]`. That is why `update_convai_agent` reads the outbound state whenever a spec **changes** mode to `auto-pilot` or
`suggestive`, names the legs in `data.preview.arms` (`triggers`, `campaignEligible`, `armingUnknown` when the reads
failed), and then needs the ack token.

Read who is armed before anything else: `get_ai_configuration_bundle` reads each agent's configs and triggers
(`item.outbound`, verbatim) and reports `outboundArmed: true|false|null` with the component floors `outboundEnabled`,
`outboundArmed` and `outboundUnread`. An agent in `outboundUnread` is **unknown**, never "not armed".

## Outbound configs — activation

One row activates one channel for one agent. **One config per agent per channel** is how the UI treats it `[source-derived — the UI offers one activation per channel; a second create for the same agent and channel was never sent]`.
The UI offers **SMS only** ("Facebook, Instagram, TikTok, Live chat, Email and Chat widget support inbound responses only",
`[proven-live 2026-10-29, UI]`).

| Call (services host, `host:"ai"`) | What it does `[proven-live 2026-10-29, each read back]` |
|---|---|
| `GET /agent-deployment/outbound-configs?locationId=&agentId=` | `{configs:[{id, channel:"SMS", sendingNumber, enabled, complianceSettingsAccepted, complianceConfigurationsAccepted, acceptedBy, acceptedAt}]}`; an agent with none answers `{configs:[]}`, not 404. No `createdAt`/`updatedAt` |
| `POST /agent-deployment/outbound-configs` `{locationId, agentId, channel:"SMS", sendingNumber, enabled:true}` | **activate** → 201. The exact body of the UI's "Activate SMS outbound" modal |
| `PATCH /agent-deployment/outbound-configs/{configId}` `{locationId, enabled:false}` | **switch off** → 200; the acceptance fields stay |
| same PATCH `{locationId, enabled:true}` | **422** `sendingNumber should not be empty` — re-enabling needs the number every time (`live-ai-campaign-L8.json`) |
| same PATCH `{locationId, sendingNumber, enabled:true}` | **re-enable** → 200; `acceptedAt` re-stamped, `acceptedBy` = the caller again |

🔴 **Activation signs compliance in the caller's name.** The body carries no acknowledgement field, yet the stored row has
`complianceSettingsAccepted: true`, `complianceConfigurationsAccepted: true`, `acceptedBy` = the user behind the token,
`acceptedAt` = now. In the UI a human ticks two boxes first (A2P registration, opt-out language, Sender ID and Texas
Safeguard; "the platform records this acknowledgement"). An API activation records the same acceptance with no human
having read anything (`live-outbound-runtime-L5-L7.json` step 1; the older UI-walk note calling the acknowledgement
client-only is wrong). Every re-enable signs it again.

Not measured: a create with `enabled:false` (does it still stamp?), a second create for the same agent and channel, a
`sendingNumber` that is not one of the location's numbers. No removal route was found: switch a config off, never delete.

## Outbound triggers

A trigger is `{type, config, enabled}` on one agent. The UI keys an agent's triggers by `type`, so one trigger per type
per agent `[source-derived]`; whether the server refuses a second of the same type was not measured.

| Call | What it does |
|---|---|
| `GET /agent-deployment/outbound-triggers?locationId=&agentId=` | `{triggers:[{id, type, config, enabled, deleted, createdBy, createdAt, updatedAt}]}` `[proven-live 2026-10-30, live-outbound-envelopes.json]` |
| `POST /agent-deployment/outbound-triggers` `{locationId, agentId, type, config, enabled}` | create → 201 (`contact_tag` only, `[proven-live 2026-10-29]`). 🔴 The UI drawer's "Enable trigger" switch **defaults to on** |
| `PUT /agent-deployment/outbound-triggers/{triggerId}` `{locationId, config, enabled}` | edit or disable → 200 `[proven-live 2026-10-29]`. 🔴 A strict whitelist: `agentId` or `type` in the body answers **422** `property … should not exist`. To change the event, create a new trigger and disable the old one |
| `GET /agent-deployment/outbound-triggers/options?locationId=&triggerType=&field=` | the drawer's pickers → `{options:[{id, label}]}`; add `&pipelineId=` for `field=stageIds` `[proven-live 2026-10-29, the UI's own reads]` |

- **There is no PATCH on a trigger**: a PATCH to a trigger id answered `404 Cannot PATCH` `[proven-live 2026-10-29]`.
  Only configs take a PATCH.
- **No removal route was found.** Disable with the PUT. A `deleted` flag is stored, but nothing known sets it.
- Not measured: whether the server validates `config` per type or refuses an unknown type; a PUT without `config`.

### The nine types

🔴 The form slug here is **`form_submitted`**. The workflow trigger for the same event is `form_submission`; the two
vocabularies are not interchangeable.

| `type` | `config` | Status |
|---|---|---|
| `contact_tag` | `{tagFilter: {action: "added", tagNames: [<tag names>]}}` — matched by tag **name**; removing a tag never fires | created, fired, re-fired on a re-added tag, edited, disabled `[proven-live 2026-10-29]` |
| `contact_created` | `{}` | created (disabled) and read back on a separate GET `[proven-live 2026-10-29]`; never fired, fire unmeasured |
| `form_submitted` | `{formIds: [...]}` | created (disabled) and read back on a separate GET `[proven-live 2026-10-29]`; never fired, fire unmeasured |
| `appointment_status_updated` | `{calendarIds: [...], events: ["booked" \| "confirmed"]}` | created (disabled) and read back on a separate GET `[proven-live 2026-10-29]`; never fired, fire unmeasured |
| `opportunity_status_updated` | `{events: ["created" \| "stage_changed"], pipelineIds, stageIds, statuses: ["open" \| "won" \| "lost" \| "abandoned"]}` (empty = any) | created (disabled) and read back on a separate GET `[proven-live 2026-10-29]`; never fired, fire unmeasured |
| `missed_call` | `{callStatuses: ["noanswer" \| "busy"]}` (empty = any unanswered call) | created (disabled) and read back on a separate GET `[proven-live 2026-10-29]`; never fired, fire unmeasured |
| `facebook_lead_form`, `google_lead_form`, `tiktok_lead_form` | unknown — the drawer needs a connected page or form, and the test location has none | **no body captured** |

These five bodies were created disabled through `set_convai_outbound` and read back live on 2026-10-29, so the server stores them.
Whether they fire is unmeasured: only `contact_tag` has fired. Treat a first fire of any of the five as a validation run on a test contact.

**Executable through the plugin:** `contact_tag`, `contact_created`, `form_submitted`, `appointment_status_updated`, `opportunity_status_updated`, `missed_call`.
**Not executable:** `facebook_lead_form`, `google_lead_form`, `tiktok_lead_form` — `set_convai_outbound` refuses them (`UNSUPPORTED_TRIGGER_TYPE`, with the list) until a body is captured.
Working hours on trigger sends were not measured; GHL's changelog says after-hours trigger messages wait for the next
opening and that campaigns ignore working hours (quoted, not measured).

🔴 An armed agent outside its working hours may not fire `[inferred — from the timing of three fires vs the agent's working hours; differential pending]`:
one tag add on an armed agent (config on, trigger on, `auto-pilot`) produced no message and no Agent Logs interaction within 75 seconds, while the two
earlier fires were inside the agent's Mon-Fri 08:00-17:00 hours (time zone mode `contact`, contact without a time zone). When an operator says a trigger
"doesn't work", check the agent's working hours first, and do not re-fire or re-arm to test: it is unknown whether a held fire is released when hours resume,
so a re-fire could send twice.

## `set_convai_outbound` — the typed path for configs and triggers

Use it instead of hand-rolling the calls above.

```
set_convai_outbound {locationId, agentId,
                     activate?: {sendingNumber} | false,
                     triggers?: [{type, config, enabled}],
                     confirm?, acknowledge?}
```

- **Preview** (the default): reads the configs, the triggers, the agent (and the location's numbers when switching on)
  and returns the planned calls (which POST, PATCH or PUT each step is), `armedAfter: true|false|null` (null = could
  not tell), the `consequence` and, when a step enables anything, `data.preview.sendClass` with its `ackToken`. A
  `sendingNumber` that is not one of the location's numbers is refused in the preview.
- **Activate** with no config → POST; **re-enable** → PATCH with the `sendingNumber`; `activate:false` → PATCH
  `{enabled:false}`.
- **Triggers:** a type the agent already has → PUT `{locationId, config, enabled}` (never `agentId`/`type`; `config` may be
  omitted to just switch it); a new type → POST. Unknown `config` keys, the three lead-form types and any unknown type
  are refused before anything is sent.
- **Enabling** (activation, re-enable, any trigger with `enabled:true`) needs `confirm:true` **and**
  `acknowledge:<sendClass.ackToken>`. **Disabling** needs only `confirm:true`. A changed body needs a fresh preview: the
  token is a hash of the exact request.
- Writes run in order, then every config and trigger is read back on separate GETs; a write that does not read back is
  `OUTBOUND_NOT_APPLIED`, and a failure mid-way reports `partialProgress` (say which steps landed).
- It does not change the agent's mode. Whether the agent sends depends on mode too: an activated agent with an enabled
  trigger is armed the moment its mode is `auto-pilot` or `suggestive`.

To switch an agent off completely: disable every trigger, switch the config off (`activate:false`), and set mode `off`
with `update_convai_agent` — then confirm with `get_ai_configuration_bundle` that the agent is not in `outboundArmed`.

## What the message contains

The opener is the agent's `outboundOpeningMessage` (set with `update_convai_agent`), and the platform adds lines. A static
opener with a custom disclaimer, read back from the conversation `[proven-live 2026-10-29]` (`live-outbound-runtime-L5-L7.json`):

```
Hi <first name>, this is <business> checking in. ...   ← the static body, {{contact.first_name}} rendered
Sent by <disclaimer text>                               ← outboundDisclaimer (style "custom")
Reply STOP to unsubscribe.                              ← added by the platform
Thanks, <location name>                                 ← added by the platform
```

- `outboundOpeningMessage {mode: "ai_generated" | "static", body}`. `static` sends the body; `ai_generated` treats the
  body as an instruction to the agent's **primary model**. The editor counts a static body against **200 words** and
  refuses an empty static body `[source-derived]`; `update_convai_agent` applies both checks before writing.
- `outboundDisclaimer {enabled, style: "concise" | "custom", customText}`; `custom` needs `customText`.
- 🔴 **An `ai_generated` opener costs a model call per send** — per contact, per trigger fire, per campaign contact. With a
  Claude primary, the Agent Logs trace named the Claude model on the "Writing reply" step, about 2.2 k input and 93
  output tokens `[proven-live 2026-10-29]` (`live-claude-runtime-L2b.json`). A **static** opener runs no model: 0 tokens,
  2-3 ms. Prefer static for triggers and campaigns unless the copy must vary.
- The one `ai_generated` opener seen ignored the agent's `businessName` ("This is the team here…"). One observation.
- 🔴 **Any UI save stamps outbound defaults** onto an agent that never stored them: `{mode: "ai_generated", body: <the
  default instruction>}` and `{enabled: true, style: "concise"}` `[proven-live 2026-10-29]`. So an agent a human saved
  once will, if armed, open with a model-generated greeting unless someone set a static body.
- Outbound sends are SMS only, and SMS renders no rich elements, so an opener is never rich.

## AI Campaigns — a bulk action that starts conversations

An AI Campaign (Contacts → "AI campaign", or "Start AI campaign" in the bulk bar) is a **job on the bulk-actions
service**, not a route of its own. There is no typed tool: one mass-send door (`raw_request`, send-class gated) is enough
until an operator asks for more.

Recipe (only after the human's explicit yes for **this** campaign — audience, agent and copy named):

1. Check the agent is campaign-eligible and what it will say: `get_ai_configuration_bundle` (`item.outbound`), and the
   agent's `outboundOpeningMessage` / `outboundDisclaimer`.
2. Preview:

   ```
   raw_request {host:"ai", method:"POST", path:"/bulk-actions/request", body:
     {"bulkActionType":"bulk-conversation-ai","title":"<campaign name>","locationId":"{locationId}",
      "documentSource":"search","documentType":"contact","documentIds":["{contactId}", "…"],
      "opSpecs":{"opType":"bulk-conversation-ai","note":"<campaign name>","agentId":"{agentId}",
                 "channel":"SMS","assignOnReply":false},
      "scheduleType":"NOW"}}
   ```

   The preview carries `sendClass` (rule: bulk messaging) with its `ackToken`. Show the human its `consequence` and the
   contact count; ask.
3. On their yes: the same call with `confirm:true, acknowledge:"<ackToken>"` → `201 {bulkRequest:{id, …}}`
   `[proven-live 2026-10-29]` (`live-ai-campaign-L8.json`; the UI's own request is `ui-capture-12-ai-campaign-start.json`).
4. Read the outcome on separate requests: `GET /bulk-actions/request/{bulkRequestId}?locationId=` (`status`, `stats`) and
   `POST /bulk-actions/logs/search {locationId, filters:[{field:"bulkRequestId", operator:"eq", value}], limit}` (one row
   per contact: `{documentId, type, subType, code, message}`).

What the campaign did `[proven-live 2026-10-29]`:

- `status: "complete"` three seconds after the start; `stats: {success: {completed: 1, skipped: 1}, error: {}, processed: 2,
  total: 2}`.
- 🔴 **DND is skipped as a success**: the DND contact's row is `success / skipped / 409 / "This contact has Do Not Disturb
  enabled"`, no conversation created. Count `success.skipped`, not `error`, when reporting who was reached.
- 🔴 **No de-duplication.** A contact that had the agent's opener from a trigger twenty minutes earlier got it again from
  the campaign, disclaimer included. A trigger also re-fires when its tag is re-added. Nothing on the agent stops a
  contact from being opened on twice by triggers, campaigns and any workflow that also texts them.
- Eligibility = an **enabled config**: the wizard lists only those agents ("None of your AI agents can send messages
  yet" otherwise) and sends from that config's number.

**Unmeasured** — say so before proposing any of these: smart-list and prebuilt-segment audiences (16 segments in the
wizard), scheduled and drip modes, the `assignOnReply` default and effect, cancel and pause, whether contacts without a
phone are excluded, a campaign with the agent's mode `off`. Only a send-all-at-once campaign to a two-contact row
selection was executed.

## Where each send is recorded

| Record | What it shows |
|---|---|
| the contact's conversation | an outbound SMS with `status`, carrier `error`, `from` = the config's `sendingNumber`, the full body above `[proven-live 2026-10-29]` |
| Agent Logs interaction (`get_agent_session`) | `userQuery: "[outbound] trigger"` or `"[outbound] bulk_action"`; `aiResponse` = the opener without the platform lines; static: no tokens; `ai_generated`: `lastSpanName: "Writing reply"`, tokens counted `[proven-live 2026-10-29, re-read 2026-10-30]` |
| Agent Logs session | **one session per contact and agent**: two trigger fires and one campaign to one contact were three interactions of one session |
| Conversation AI logs | a row under `direction=outbound` on `GET /ai-employees/employees/{locationId}/conversation-logs` `[proven-live 2026-10-29]`. Use `get_convai_conversation_logs` with `direction:"outbound"` where the tool lists that parameter, else `raw_request` (`host:"ai"`). Whether a read with no `direction` includes outbound rows is unmeasured |
| dashboard | the Outbound view (`fetch-dashboard-data` with `direction:"outbound"`): unique contacts, messages, "Contacts by trigger type" |
| campaign job | `stats` and one log row per contact (above) |

The Agent Logs `channel` filter offers a value `trigger`; that outbound sessions carry it is `[inferred — from the value's
name]`.

## Also unmeasured

Fires with the config or the trigger disabled; mode `suggestive` on an armed agent; the eight other trigger types at
runtime; trigger sends to a DND contact; working hours on trigger sends; whether a snapshot push carries configs and
triggers; the `workflowAction` outbound source the dashboard enum lists (no workflow step that starts an outbound
conversation has been found) `[source-derived]`; the Lab-off behaviour (the Lab is one-way, so it cannot be measured on a
location where it is on).
