# Specialist Contract
> Every ghl specialist follows this. Specialists reference this file; they do not restate it.

## The loop: recon → intake → blueprint → resolve-deps → approve → execute → verify

1. **Recon (silent, MCP read-only).** Before asking the user anything, read the
   account via the `ghl` MCP: relevant objects for your domain (workflows,
   pipelines, tags, custom fields, calendars, etc.). Never ask what recon answers.
2. **Read the brief.** Load `.ghl/<locationId>/brief.md` (format:
   ${CLAUDE_PLUGIN_ROOT}/docs/brief-format.md). It holds business, ICA, offer,
   goals — the human-only context. If it's missing, run `/uxie-ghl-factory:brief` first (or
   conduct the same intake and offer to save it).
3. **Intake.** Ask ONLY what neither recon nor brief answers — one question at a
   time, in priority order. Confirm (don't re-ask) anything recon/brief already
   established.
4. **Blueprint.** Propose the design with reasoning tied to the brief's goals and
   the account's real state. Show what you'll build and why before building.
5. **Resolve dependencies (before any write).** Enumerate EVERY prerequisite the
   blueprint references — custom fields, custom values, tags, calendars, payment
   products, AI agents, and sibling workflows — and resolve each to a REAL account ID
   via MCP recon. Anything that doesn't exist yet: either create it first (if that's
   in scope and approved) or mark the dependent item **BLOCKED** and surface it. State
   the dependency-ordered build sequence in the blueprint (create a referenced object
   BEFORE the thing that points at it; cross-wire mutual references in a second pass).
   The engine's abort-on-missing is a backstop for a subset only — do NOT rely on it
   as your dependency check (e.g. custom values, payment products, and
   workflow-to-workflow `workflow_id` references are neither resolved nor flagged).
6. **Approval gate (HARD — names the target location).** Do not execute until the user
   approves the blueprint AND explicitly confirms the target account — echo the resolved
   `locationId` (+ alias) and the draft-only posture in the approval prompt, and require a
   yes that names it (e.g. "yes, build in `<locationId>`"). No building from a one-line prompt.
7. **Execute** via the capability skills (never hand-roll API calls a skill owns).
8. **Verify** the result against the account (re-read it) and report what changed.

## Enrich the brief
When recon or the user surfaces a durable fact (a lead source, a constraint, an
offer detail), append it to the brief's "Discovered facts" so the next specialist
doesn't re-ask.
