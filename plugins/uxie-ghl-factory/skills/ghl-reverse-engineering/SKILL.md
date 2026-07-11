---
name: ghl-reverse-engineering
description: "Reverse-engineer GoHighLevel's internal (browser/backend) APIs to understand and automate configuration the public API doesn't expose — capturing real request payloads from an authenticated session with Playwright, mapping endpoints and object schemas, and documenting them. Use when the user wants to figure out how a GHL feature works under the hood, capture the API call/payload behind a UI action, extend an engine to a new GHL object the public API lacks, or asks to reverse-engineer / sniff / capture / trace a GHL internal endpoint. GHL permits inspecting your own account's traffic."
---

# GHL Reverse-Engineering

Capture and document GoHighLevel's **internal** APIs — the `backend.leadconnectorhq.com` /
`services.leadconnectorhq.com` endpoints the app UI uses — so agents can automate configuration the
public API doesn't reach (AI agents, workflow-builder internals, funnels, etc.). This is legitimate
inspection of the operator's own account traffic.

## When to reach for this
- A UI action does something the public API can't, and you need the exact endpoint + payload.
- You're extending a compiler/engine (like `create-ghl-workflow`) to a new step/object type.
- You need to know an object's real field schema, or how the UI references another object (by id vs literal).

## The method (see `references/capture-playbook.md` for the full procedure)
1. **Authenticated browser.** Use the Playwright MCP against an already-logged-in `app.gohighlevel.com`
   session. Deep links 404 — only `/` is served; reach any screen by **clicking** through the SPA.
2. **Do the action, read the network.** Perform the config action, then
   `browser_network_requests` (filter to the service) → `browser_network_request` on the specific
   call to get method, URL, headers, and the full request/response **body** (the schema is the prize).
3. **Grab the right auth.** Auth is **service-dependent** — see `references/internal-api-map.md`.
   Capture a fresh token from the session's own network history (JWTs expire ~1 hr).
4. **Capture with discipline.** Create → capture → delete. Name throwaway objects `TEST-CAP-*`,
   keep them DRAFT, delete them after. Never publish, never enroll a contact, never place a real call.
5. **Document.** Save raw payloads + write a reference (endpoint map, object schema, merge-vs-replace
   note, auth header) into a research area, e.g. `ghl-workflow-api-docs/research/`.

## Non-negotiables
- **Test on the operator's own / a test sub-account.** Prefer a dedicated test location; if a surface
  is feature-gated (e.g. Voice AI outbound needs KYC enabled), find a location where it's enabled
  rather than enabling compliance features yourself.
- **Reads by default; writes are throwaway.** Any write is a `TEST-CAP-*` draft you delete. Confirm
  cleanup succeeded and report it.
- **Redact tokens.** Never write a captured JWT/token value into a saved file or report.
- **Ground everything.** Record which capture each documented field came from. Don't infer fields you
  didn't see — mark unconfirmed items explicitly.

## Static shortcut
Before (or alongside) live capture, mine already-recovered material: bundle source maps
(`sniffs/bundle/recovered-source/`), microservice route lists (`reference/microservices.md`), and
prior research (`research/`) in the GHL API-docs repo often already contain the endpoint or model.

## Proven output shape
A good reverse-engineering deliverable (see `research/ai-agents-internal/` in the api-docs repo for a
worked example covering Conversation AI, Voice AI, and Agent Studio): an **endpoint map** table, the
**object schema** by section with example values, the **PUT merge-vs-replace** behavior, the **auth
header** used, action/sub-resource schemas, and raw payloads under `captures/`.
