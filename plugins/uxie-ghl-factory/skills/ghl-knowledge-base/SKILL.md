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

**4. Gaps are a real surface, not a counter.** `GET /knowledge-base/gaps/counts` reports
questions the KB could not answer. That is the fastest read on *why* an agent is answering
badly — check it before rewriting a prompt.

## Limits

Upload ≤10 MB per file · content is capped per document (`characterLimitExceededContent`) ·
documents are capped per plan (`richTextBlockedByLimit` fires when you hit it) · at least one
file must be selected to upload · at least one KB must be selected where a bot requires one.

## Proof status — read before trusting a write

Per `ai-agents/20-api/12-ai-agents-api.md`: **rich-text create is live-proven** (round-tripped,
including the status poll and delete). **Tables and file upload are capture-derived** —
best-effort form fields, never live-fired. The other source types have no live proof recorded.
Treat a first write of an unproven type as a throwaway validation run on a test sub-account.

## Scope

Knowledge bases only. The agents that consume them are `ghl-voice-ai` (internal) and
Conversation AI (**public rail** — see `ghl-orientation`).
