---
name: ghl-knowledge-base
description: "Build and manage GoHighLevel knowledge bases — the content that feeds both Conversation AI and Voice AI. Covers rich-text documents, FAQs, web crawling, files, tables, Google Drive/Sheets and Internal Data (products) sources, plus the trigger conditions that tell an agent WHEN to use each knowledge base. Use when the user says 'add a knowledge base', 'train the bot on this', 'the AI isn't using my KB', 'add FAQs', 'crawl my website', 'upload docs for the agent', or asks why an agent answers from the wrong source. Internal API — six of the nine source types have no public equivalent."
---

# GHL Knowledge Base

The shared content layer. Both Voice AI (`knowledgeBaseIds`) and Conversation AI
(`knowledgeBaseIds` + `knowledgeBaseTriggers`) point at the same knowledge bases, so a change
here affects every agent attached to it. Check `GET /knowledge-base/associated-entities`
before editing one.

Base: `services.leadconnectorhq.com/knowledge-base`.

## Why this is an internal-rail skill

Nine source types exist in the enum; the UI offers five tabs (Web crawler · FAQ · Tables · Rich text · Files,
with Google Drive/Sheets and Internal Data behind flags). **Web search has no screen** at build 683 (hard-coded
off). The public API covers FAQs, the crawler, and the knowledge-base record itself — **six have no public
equivalent**:

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
`POST /knowledge-base/` makes the record (body `{locationId, name, description?}`, name ≤ 50). **Every source
kind has its own sub-resource** — `/faqs`, `/rich-text/`, `/crawler`, `/files`, `/table/…` (a multi-step
upload → schema → select-columns → status pipeline), `/google-sheets/*`, `/google-drive/*`, `/internal-data/*`.
There is **no generic "attach a source" call**: the POST to a bare KB id and its `/bulk` variant that older
notes listed are the translation client's calls, not the KB's. Creation is **asynchronous** — poll each source's
status. 15 knowledge bases per sub-account.

### The record (all live-proven 2026-09-26 on a test sub-account, each read back on a separate request)

| Operation | Call | Notes |
|---|---|---|
| Create | `POST /knowledge-base/` `{locationId, name, description?}` | **keep the trailing slash**. → 201 `{data:{id, name, nameLowerCase, kbMetadata{faqs, urls, richText, webSearches, files, tables, firstQueryAt, lastQueryAt, lastSourceAddedAt}}}`. The editor caps the name at 50 characters and the description at 175; the server stored a 56-character name, so the name cap is client-only |
| Read | `GET /knowledge-base/{id}?locationId=` | carries `description` and the `kbMetadata` source counts |
| List | `GET /knowledge-base/all?locationId=` | → `{data:{knowledgeBases[{id, name, createdAt, updatedAt}], activeCount}}`. `activeCount` is what the editor's "Knowledge base quota n / 15" reads; the 15 is editor-side (not pushed past on the test account) |
| Rename / describe | `PUT /knowledge-base/{id}` `{locationId, knowledgeBaseId, name, description}` | → 200; the editor's header pencil opens "Edit knowledge base" |
| Who uses it | `GET /knowledge-base/associated-entities?locationId=&knowledgeBaseId=` | → `{entities, blockingEntities, advisoryEntities, unverifiedSources, partial}`; an unused KB reads all empty with `partial:false` |
| Delete | `DELETE /knowledge-base/{id}?locationId=` | → `{success}`; afterwards `GET` answers **400 "Knowledge base not found"**. The editor refuses while agents use it: "This knowledge base cannot be deleted … Agents using this knowledge base" lists each agent (Conversation AI / Voice AI) with Open and a **Re-check** button. Read `associated-entities` yourself before deleting through the API, which does not stop you |
| Default KB | `POST /knowledge-base/default` `{locationId, migrateDocs:true}` | → 201 `{data:{id}}`, the same id every time: the location's default KB. The list page fires it on every load |

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

The editor labels the text **"Instructions (Optional)"**, and it is optional: with no text the agent decides by
itself when to use the KB (`mode: "all"`, one such trigger, ≤ 7 KBs); with text the trigger is `mode: "custom"`
(≤ 5 KBs). The editor caps the text at 1000 characters, but the server stored 1001. The **server** allows at most 4
triggers (`"knowledgeBaseTriggers.4.priority must not be greater than 4"`). A trial chat on a bot with a KB answered
from that KB (live-proven 2026-09-26). An older version of this skill said the text was required, 10–500
characters, labelled "When to use this knowledge base": that was wrong.

**4. Gaps are a dated log of misses, not an inventory of what is missing now.**
🔴 A row stays `open` after the answering content is added — proven by differential (documents
added, the questions re-asked live and answered from them, the list re-read unchanged, `lastAskedAt`
unmoved) — and a question the KB answers is never logged, so every row looks current until you
read its dates. List: `GET /knowledge-base/gaps?locationId=&knowledgeBaseId=&status=open` (AI rail).
1. **Read the knowledge base first** — content present ⇒ the row is stale; do not change the agent.
2. **Check `lastAskedAt`** against the window you are judging.
3. **Write the knowledge to match `topQueryTexts`** (the customer's own wording).
4. **Never filter by `categories`** — a genuine product question was filed under *Noise / Gibberish / Chitchat*.
The DISMISS write is **`PATCH /knowledge-base/gaps/{gapId}/state`** `{locationId, state:"archived"}` —
live-proven 2026-09-08, reversible with `state:"active"`. The write says `active`, the read says `open`. Fields and counts endpoint: `knowledge/corpus/ai-agents/20-api/knowledge-base.md` → "Gaps".

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

**6. The retrieval test needs the editor's body.** `POST /knowledge-base/chunks` `{query, knowledgeBaseIds,
locationId, rerankChunks: true, threshold: 0, topK: 5, subCaller}` returns up to 5 chunks with `score` and
`category` (`bulk` = crawled page, `finetuned` = FAQ, `rich_text`, `files`, `table`). Without those parameters it
returned one chunk, which looks like "the KB only knows one thing". The editor's ⌘K "Test retrieval" drawer keeps
a history: `POST /knowledge-base/retrieval-test/conversations/entries` `{locationId, knowledgeBaseId, query,
agentLayer, chunks, totalChunks, latencyMs, idempotencyKey}` → `{conversationId, entryId, isNew, isDuplicate}`;
`GET …/retrieval-test/conversations?locationId=&knowledgeBaseId=` lists them, `GET …/conversations/{id}?locationId=`
reads one, `DELETE` the same removes it (then 404 "Conversation not found").

**7. The crawler judges what the CDN serves, refuses thin pages, and obeys robots.txt.** Status `Restricted` with `error:
"Insufficient content (174 chars)"`. A page you just edited can be judged on its stale cached copy. 🔴 The crawler reads
robots.txt as user agent **`AITrainingBot`**. A blocked page still gets **201 `status: "Processing"`** on the POST, then
`status: "Restricted"`, `error.code: "ROBOTS_TXT_BLOCKED"`, `retryable: false`, and no URL is stored. GHL's own
`app.gohighlevel.com/v2/preview/{pageId}` URLs are blocked this way (proven live 2026-09-29). **A 201 is not a crawl:**
read `GET /knowledge-base/crawler/status?locationId=&knowledgeBaseId=` for `operationDetails.status` and `.error`, and
point the user to Rich Text when robots.txt blocks the page.

## Sources — what ran live (2026-09-26 / 28)

Each was built in an own test KB, read back on separate requests, retrieved through `/chunks`, and deleted by exact
id. Full shapes: corpus `ai-agents/20-api/knowledge-base.md` → "Sources executed live".

| Source | Create | Read | Remove | Traps |
|---|---|---|---|---|
| FAQ | `POST /knowledge-base/faqs` `{locationId, knowledgeBaseId, question, answer, metadata?}` → `{faq{…, id}}` | `GET /knowledge-base/faqs?locationId=&knowledgeBaseIds=&limit=&offset=` → `{faqs, count, hasMore}` | — | a duplicate question → **409** "A FAQ with this question already exists in this knowledge base"; the 1000-character answer cap is client-only (1001 stored) |
| Rich text | `POST /knowledge-base/rich-text/` `{locationId, knowledgeBaseId, title, content (HTML)}` → `status:"training"` | `GET /knowledge-base/rich-text/{id}/status?locationId=` → `{sourceType, status, stages[CHUNKING, EMBEDDING]{state, durationMs}}` | `DELETE /knowledge-base/rich-text/{id}` | trained in ~3 s; the server adds generated questions to the chunk; edit with PUT (Trap 5); the editor also offers bulk delete (`/rich-text/bulk`) and a per-document cancel (`/rich-text/{id}/cancel`), neither executed |
| Web crawler | `POST /knowledge-base/crawler` `{locationId, url, option: "Exact" \| "Path" \| "Domain", knowledgeBaseId}` → `{operationId, status:"Processing"}` | `GET /knowledge-base/crawler?locationId=&knowledgeBaseId=` → `{count, urls[]}`; `GET …/crawler/status` = the **latest** operation only; `GET …/crawler/pages/content?locationId=&urlId=&knowledgeBaseId=` → the scraped text | `DELETE /knowledge-base/crawler` `{locationId, urlIds, deleteAll:false, knowledgeBaseId}` → `{deletedCount}` | Exact mode **trains with no separate train call**; `sitemap-preview` refuses Exact (400); the URL refresh `PUT /knowledge-base/crawler?locationId=&knowledgeBaseId=` `{urlIds, refreshAll, urlIdsToSkip}` answered 200 and changed nothing within 8 s, so its effect is unproven; Path / Domain, cancel and retry are unexercised |
| URL auto-refresh | `POST /knowledge-base/crawler/automation` `{knowledgeBaseId, refreshFrequency: DAILY \| WEEKLY \| MONTHLY}` → an ACTIVE `WEBSITE_RETRAIN` task, first run a week out for WEEKLY | `GET …/crawler/automation/latest?knowledgeBaseId=` | `DELETE …/crawler/automation/{id}` (then `latest` → `data:null`) | the update `PUT …/automation/{id}` needs `taskId` = the automation's own id (422 "taskId must be a string" without it) |
| File | **multipart** `POST /knowledge-base/files` | `GET /knowledge-base/files/{id}`; `…/{id}/status` stages CONVERSION → EXTRACTION → CHUNKING → EMBEDDING | `DELETE /knowledge-base/files/{id}` (then 400 "Invalid file ID") | ≤ 10 MB, `.pdf .doc .docx .md`; trained in ~3 s |
| Table (CSV) | **multipart** `POST /knowledge-base/table/location/{loc}/kb/{kb}/upload`, then `POST …/{fileId}/select-columns` `{selectedColumns[{name, originalType, selectedType, isSelected, sampleValue, displayName, searchable, required}]}` | `GET …/{fileId}`, `…/status` (ANALYZING → PROCESSING → INDEXING), `…/data?page=&limit=` | `DELETE …/{fileId}` (then 404) | ≤ 50 MB; trained in ~48 s |

🔴 **Files and tables are multipart uploads.** `raw_request` sends JSON only, so neither can be created through
this plugin today: point the user to the editor's Files / Tables tab.

The scraped text of a crawled page is edited through View scraped content → Save:
`PUT /knowledge-base/crawler/pages/content?locationId=&urlId=&knowledgeBaseId=` `{content}` → 200 with an empty body. The
row retrains and reads back `status: "Successful"`, **`contentEditedByUser: true`**, and retrieval returns the edited text
(proven live 2026-09-29). Retraining the URL from the website reverts the edit (the editor's warning). The URL list's
`content` field is a storage URL to the text file, not the text itself. The `/conversations-ai/train/chunk/content`
route older notes gave is not called by the Knowledge Base app.

**Gaps**: `GET /knowledge-base/gaps/counts?locationId=` → `{data[{knowledgeBaseId, gapCount}]}` for the whole
location; `GET /knowledge-base/gaps?locationId=&knowledgeBaseId=&status=open&page=&perPage=` →
`{gaps[], stats{openGaps, queriesAffected, resolvedThisMonth, archivedGaps}, total}`. The editor's tabs are Needs
answers · Answered · Archived. `POST /knowledge-base/gaps/{gapId}/fill {title, answer, locationId}` writes into the
KB itself and has not been executed.

## What GHL can do that this plugin cannot reach on the test account

If the user wants one of these, **GHL can do it** — say so and point to the screen.

| Capability | Where in GHL | Why not here |
|---|---|---|
| Import files from Google Drive, daily Drive sync | KB → Files → "Import from Google Drive" (flag `knowledgeBase.googleSheets`) | needs a connected Google account (`GET /knowledge-base/oauth?locationId=&type=google`); the only one on the test account is a person's own, so it was not used |
| Google Sheet as a table, auto / scheduled sync | KB → Tables → "Import from Google Sheets" | same |
| Internal Data (sync the sub-account's Products) | KB source behind flag `knowledgeBase.internalData` | `GET /knowledge-base/internal-data/sources` answered 403 "Forbidden resource" on the test account |
| Web search as a source | no screen: the editor hard-codes it off | the client ships the module, but `GET /knowledge-base/web-search/kb/{id}` answered 404 "Cannot GET" |
| Create with AI (Beta) | KB list → "Create with AI" | it opens the Ask AI copilot ("Create a knowledge base from brand voice") and makes no KB call of its own |
| Open the KB screen at all | AI Agents → Knowledge Base | the page sits behind the `conversation_AI` billing opt-in (`config.optIn`), not `enabled` |

## Limits

Files ≤ 10 MB (`.pdf .doc .docx .md`) · table CSV ≤ 50 MB · rich text ≤ 25,000 characters and 512 KiB of HTML
(`richTextBlockedByLimit` fires on the character cap, not on a document count) · FAQ answer ≤ 1000 (client-only) ·
KB name ≤ 50 (client-only) and description ≤ 175 · ≤ 7,000 crawled pages per KB · 15 KBs per sub-account · ≤ 4
knowledge-base triggers per bot (server) · at least one KB must be selected where a bot requires one.

## Proof status — read before trusting a write

**Live-proven** (executed on a test sub-account and read back on a separate request): the KB record's create, read,
list, rename, delete and associated-entities read; FAQ, rich text (create, full-replace PUT, delete), web crawler
(Exact mode, delete, auto-refresh create/update/delete), file and table sources (uploaded from the editor, then
read and deleted through the API); retrieval and its history; the gap list and the gap archive/restore write.
Also live-proven (2026-09-29): the scraped-text edit, and a robots.txt-blocked crawl's status and error. **Not proven:** the
crawl refresh's effect; Path / Domain crawls; crawl cancel / retry (an Exact crawl of one page finishes in about 2 s, and
anything longer needs a multi-page crawl); gap fill; and everything in the table above. Treat a first write of an unproven operation as a throwaway validation run
on a test sub-account.

## Scope

Knowledge bases only. The agents that consume them are `ghl-voice-ai` (internal) and
Conversation AI (**public rail** — see `ghl-orientation`).
