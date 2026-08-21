# GoGHL.ai WhatsApp — authoring guide (buttons, lists, spintax, ban discipline)

> The "Whatsapp, iMessage and SMS" marketplace app (MessageSync.ai, appId
> `67fb75c15f402353e5cfaa63`). Harvested 2026-08-22 from a live install's schemas + vendor docs.
> The engine builds its steps through the normal marketplace rail on any location where the app
> is INSTALLED (build aborts "not installed" otherwise — install first).

## The 10 actions / 11 triggers (marketplace keys)

Actions: `send_outbound_whatsapp_message` (Message, Attachments, Connected Whatsapp → output
`data.messageId`), `send_group_message_prod`, `send_text_to_speech_message` (TTS; needs an
`sk_…` voice API key), `send_internal_wa_notification` (+ iMessage/Android-SMS twins:
`send_imessage_action`, `send_android_sms`, `send_internal_imessage_notification`,
`send_internal_android_sms_notification`), **`wait_step`** (Channel whatsapp|imessage|sms,
Timeout seconds [default 7 days] → outputs `message`, `attachments` — the reply!),
`change_whatsapp_group_participants` (add|remove → `results.*`).

Triggers: `whatsapp_inbound_prod` / `whatsapp_outbound_prod` (+ sms_/imessage_ pairs),
`whatsapp_group_inbound`, `whatsapp_group_trigger` (membership changes),
`whatsapp_missed_trigger`, and the two OPS hooks — **`message_failed_prod`**
(`payload.error.{code,type,message}`) and **`whatsapp_disconnected_prod`**. Marketplace trigger
outputs carry no `.N` (`{{<key>.<ref>}}`).

## Interactive flow pattern (the whole point)

```
send_outbound_whatsapp_message  body = one #btn or #list line
→ wait_step (channel: whatsapp, timeout)
→ if/else on {{wait_step.N.message}} — branch per buttonId / list option ID
```

**Buttons:** `#btn|title|subTitle|mediaType*mediaUrl|buttonType*text*value|…` — unused slots =
literal `undefined`; types `quick_reply*Text*id`, `cta_url*Text*https://…`,
`cta_call*Text*+phone`, `cta_copy*Text*textToCopy`; media `image*URL`/`video*URL`. Works from
any WA account (business not required).

**Lists:** `#list|title|description|footer|buttonText|Section*Option*Desc*ID/…` — exactly 6
segments, `description` REQUIRED, rows are 4 `*`-fields joined by `/`, same Section auto-groups,
option IDs unique.

**The engine lints both at compile** (`goghl.mjs`, advisory): a malformed line is sent to the
contact as LITERAL TEXT — the lint names the exact segment. Hatch: `skipGoghlCheck`.

## Ban discipline (vendor's own numbers — treat as hard policy for every GROM WA build)

1. **Residential proxy**: country = where the PHONE physically is, never the number's country.
2. **Drip Mode** (location Settings → Message Queuing, ms): bulk **15000**, daily **3000–5000**,
   warming numbers **10000–20000**, minimum **1000**. Never off for bulk.
3. **Spintax** every bulk/automated message: `{Hi|Hello|Hey}` — 3-4 options per bracket, ≤7,
   no nesting (linted).
4. **Warm-up every new number** (7–14 days): 10-15/day (d1-2) → 20-30 (d3-5) → 50-100 (d6-10)
   → 200-300 (d11-14) → 500-1000+ (d15+). After a temporary ban (24-48h): wait 3-5 days,
   manual-personal only, restart warm-up at phase 1 — **a second ban is often permanent**
   (appeals ~10-20%).
5. **Always ship the monitor workflow** with any WA rollout: triggers `message_failed_prod` +
   `whatsapp_disconnected_prod` → `internal_notification` (and/or Slack) — failures and
   disconnects are the ban early-warning.
6. iMessage channel: warm leads/reminders/support only — never cold outreach or campaigns
   (vendor's own rule; Apple bans hard). Android SMS: the gateway phone must run 24/7 on power.

Full harvest (schemas verbatim, setup flows, proxies, builder embeds + their third-party-JS
caveat): research repo `reference/GOGHL-WHATSAPP.md`.
