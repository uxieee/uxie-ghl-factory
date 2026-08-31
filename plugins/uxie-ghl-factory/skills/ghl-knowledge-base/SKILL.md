---
name: ghl-knowledge-base
description: "Build and manage GoHighLevel knowledge bases — the content that feeds both Conversation AI and Voice AI. Covers rich-text documents, FAQs, web crawling, web search, files, tables and Google Drive/Sheets sources, plus the trigger conditions that tell an agent WHEN to use each knowledge base. Use when the user says 'add a knowledge base', 'train the bot on this', 'the AI isn't using my KB', 'add FAQs', 'crawl my website', 'upload docs for the agent', or asks why an agent answers from the wrong source. Internal API — five of the nine source types have no public equivalent."
---

# GHL Knowledge Base

The shared content layer. Both Voice AI (`knowledgeBaseIds`) and Conversation AI
(`knowledgeBaseIds` + `knowledgeBaseTriggers`) point at the same knowledge bases, so a change
here affects every agent attached to it. Check `GET /knowledge-base/associated-entities`
before editing one.

Base: `services.leadconnectorhq.com/knowledge-base`.

## Why this is an internal-rail skill

Nine source types exist. The public API covers FAQs, the crawler, and the knowledge-base
record itself — **five have no public equivalent**:

```
faq  ·  web_crawler  ·  web_search        ← public reaches these
rich_text  ·  table  ·  google_drive  ·  google_sheet  ·  internal_data  ·  file
                                          ← internal only
```

`rich_text` is the one that matters most in practice: it is how you give an agent authored
prose rather than scraped pages, and there is no way to create one through the public API.

## The endpoints

All 25 are in the endpoint catalogue — `search_endpoints`, then `describe_endpoint`. The corpus
page `ai-agents/20-api/knowledge-base.md` carries the source-type enum, the analytics vocabulary
that reveals the per-plan caps, and the training routes.

The shape worth holding in your head: a knowledge base is a record with **sources attached to it**.
`POST /knowledge-base/` makes the record; `POST /knowledge-base/{id}` (or `/{id}/bulk`) attaches a
source to it. `rich_text` is the exception — it has its own sub-resource,
`POST /knowledge-base/rich-text/`, and creation is **asynchronous**.

**KB-create schema** (captured 2026-08-28, the designated test sub-account): `POST
/knowledge-base/` body `{locationId, name}` → 201 `{success, data: {id, name, nameLowerCase, …}}`.
Read-back list of a KB's rich-text docs: `GET /knowledge-base/rich-text/knowledge-base/{kbId}` →
`{data: [{id, title, content, contentMarkdown, status, …}]}`.

## The traps

**1. Rich-text create is asynchronous.** `POST /knowledge-base/rich-text/` returns before the
document is usable — there is a status poll. Do not attach the KB to an agent and report
success on the create response alone.

**2. Opening the Knowledge Base screen writes.** `POST /knowledge-base/default` fires on page
load and returns 201. If you are replaying captured traffic, that call is expected behaviour,
not something you triggered.

**3. Attaching a KB is not enough — the agent needs to know WHEN to use it.** On Conversation
AI:

```jsonc
"knowledgeBaseTriggers": [
  { "mode": "all",    "knowledgeBaseIds": ["…"], "triggerCondition": "",  "priority": 2 },
  { "mode": "custom", "knowledgeBaseIds": ["…"], "triggerCondition": "<when to use this>", "priority": 1 }
]
```

`mode: custom` **requires** `triggerCondition`, 10–500 characters. The editor labels it
*"When to use this knowledge base"* and enforces it. A KB attached with no trigger condition
and `mode: custom` is a KB the agent will not reach for.

**4. Gaps are a dated log of misses, not an inventory of what is missing now.**
🔴 A row stays `open` after the answering content is added — proven by differential (documents
added, the questions re-asked live and answered from them, the list re-read unchanged, `lastAskedAt`
unmoved) — and a question the KB answers is never logged, so every row looks current until you
read its dates. List: `GET /knowledge-base/gaps?locationId=&knowledgeBaseId=&status=open` (AI rail).
1. **Read the knowledge base first** — content present ⇒ the row is stale; do not change the agent.
2. **Check `lastAskedAt`** against the window you are judging.
3. **Write the knowledge to match `topQueryTexts`** (the customer's own wording).
4. **Never filter by `categories`** — a genuine product question was filed under *Noise / Gibberish / Chitchat*.
The DISMISS write was never captured — clearing a gap is a UI step; do not claim to have automated
it. Fields and counts endpoint: `knowledge/corpus/ai-agents/20-api/knowledge-base.md` → "Gaps".

**5. Editing a rich-text doc is a PUT, not delete-and-recreate.** `PUT
/knowledge-base/rich-text/:id` is a **live-verified full-replace** (2026-08-28, the designated
test sub-account): same body shape as create — `{locationId, knowledgeBaseId, title, content}` —
200, response carries `status: "training"`, and a read-back of the sent `content` came back
**byte-identical**. It re-chunks and re-embeds automatically, exactly like create: poll `GET
/knowledge-base/rich-text/:id/status` until `"trained"` (a full retrain took ~4.6s in the proving
run) — there is no separate retrain call.

Do not delete-and-recreate a doc to edit it, and do not add a second doc alongside the old one
as a workaround: both orphan or duplicate content — a delete drops any id another object
references, and a second doc leaves stale content the agent can still draw from, which is a
worse failure than the one you were trying to fix. PUT the existing id instead.

`content` is HTML; the server derives `contentMarkdown` from it. **A direct `contentMarkdown`
write 200s and changes nothing** — measured in both a contentMarkdown-only body and an
unchanged-content-plus-contentMarkdown body. `kb-compiler.mjs`'s `compileRichTextUpdate(id, doc,
{locationId})` builds this PUT descriptor, and throws rather than silently no-opping if the
caller's IR carries a `contentMarkdown` key — a caller supplying that key believes something
false about this API.

## Limits

Upload ≤10 MB per file · content is capped per document (`characterLimitExceededContent`) ·
documents are capped per plan (`richTextBlockedByLimit` fires when you hit it) · at least one
file must be selected to upload · at least one KB must be selected where a bot requires one.

## Proof status — read before trusting a write

Per `ai-agents/20-api/12-ai-agents-api.md`: **rich-text create AND update are live-proven**
(round-tripped, including the status poll, the full-replace PUT, and delete — see Trap 5).
**Tables and file upload are capture-derived** — best-effort form fields, never live-fired. The
other source types have no live proof recorded. Treat a first write of an unproven type as a
throwaway validation run on a test sub-account.

## Scope

Knowledge bases only. The agents that consume them are `ghl-voice-ai` (internal) and
Conversation AI (**public rail** — see `ghl-orientation`).
