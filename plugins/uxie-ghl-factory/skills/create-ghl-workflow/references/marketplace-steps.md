# Marketplace steps — authoring third-party triggers and actions

A third-party app installed on a sub-account (e.g. a WhatsApp/iMessage bridge, a CRM sync)
can publish its own triggers and actions into the builder, alongside the native catalog.
The engine builds these too — you opt in explicitly with `marketplace: true` on the node.

For the underlying endpoint shapes and the reverse-engineering evidence this is built on,
see the research corpus: `docs/marketplace-rail.md` in `ghl-internal-api-research`. This
page is the authoring-syntax half; that one is the wire-shape half.

## Before you author one: confirm the app is installed

A marketplace step resolves against the **target location's own** live index, fetched at
build time — never a baked snapshot. If the referenced app is not installed in that
location, the build fails closed with `MARKETPLACE_APP_NOT_INSTALLED` rather than silently
producing a step that saves and never runs. Confirm what's installed first:

```
list_marketplace_apps(locationId: "<LOC>")           # MCP tool, if the server is registered
```

or read the account's marketplace assets/module responses directly. `list_marketplace_apps`
reports each installed app's triggers and actions with `key`, `version`, `templateId`, and
the full `customVars` / `inputs` schema — everything you need to author against.

## Authoring a marketplace action

```js
{ ref: 'wa1', kind: 'action', marketplace: true,
  type: 'send_outbound_whatsapp_message',
  name: 'Send Whatsapp Message',
  attributes: { message: 'Hi {{contact.first_name}}' } }
```

`marketplace: true` is the opt-in flag. Without it, `type` is checked against the native
catalog only (`STEP_TYPE_UNKNOWN`) and a marketplace key will not resolve. **With** it, the
engine:

- Resolves `type` against the target location's live index (`key -> templateId / version /
  inputs`) — fails closed if the key isn't there at all (`MARKETPLACE_KEY_UNKNOWN`) or is
  known but not installed (`MARKETPLACE_APP_NOT_INSTALLED`).
- Emits `isMarketplaceAction: true` at step level and mirrors `type` inside `attributes`
  — the live-observed shape does this unconditionally; it is not gated on the native
  catalog the way a native step's structural fill is, because there is no native catalog
  entry for a third-party key.
- Fills `attributes.__customInputs__ = {}` when you don't supply one — the live shape
  always carries this envelope key even though no app `inputs` schema ever declares it.
- Enforces the app's own `required` inputs, fail-closed (`MARKETPLACE_REQUIRED_FIELD`).
  Absent and empty both count as missing.
- Fills a schema-declared default for any field you left blank, when the app's own schema
  supplies one — and **warns** (`MARKETPLACE_DEFAULT_FILLED`) every time it does, because
  filling a value into a field a fail-closed check exists to guard is a real, silent risk
  on its own (some defaults are opaque internal ids, not values a human would choose).
- **Warns**, not throws, on an attribute key the app's `inputs` schema doesn't declare —
  some real fields (e.g. a `DYNAMIC` pseudo-field) are accepted by the builder without
  being listed under the name you write. A hard allowlist here would reject shapes the
  builder itself stores.

## Authoring a marketplace trigger

```js
{ marketplace: true, type: 'whatsapp_inbound_prod', name: 'Whatsapp Inbound',
  filters: [
    { field: 'payload.message.text', title: 'Message', type: 'string',
      operator: 'string-contains-any-of', value: ['Book now please'] },
  ] }
```

The engine emits `masterType: 'marketplace'` plus the `version` and `templateId` resolved
from the live index, and every condition with `id === field` (a marketplace condition
addresses the event payload by dotted path, not a catalog field id).

**Filter fields come from the app's own `filters[]` schema — read it, don't derive it.**
Look up the trigger's declared filters via `list_marketplace_apps` (or the assets endpoint
directly) rather than guessing from `customVars`; see `docs/marketplace-rail.md` §5 for why
an earlier draft of this feature got that backwards.

**Operator vocabulary is exactly two values, and there is no equals:**

| Label | Wire value |
|---|---|
| Contains phrase | `string-contains-any-of` |
| Is not empty | (not yet captured as a wire literal) |

An operator outside that set (`eq`, or no operator at all) throws
`MARKETPLACE_FILTER_OPERATOR` — GHL's own filter-row component doesn't offer anything else,
so an unsupported operator would compile to a filter that can never match: the silent
dead-branch class this engine exists to prevent.

**Every trigger-level match is therefore a substring match.** If two of your build's
marketplace trigger filter values are substrings of one another (`'Book now'` inside
`'Book now please'`), the engine **warns** but still builds — it cannot know you didn't
intend the overlap, but the shorter value will double-fire alongside the longer one.

## What you get back: stored shapes

Emitted shapes match what GHL itself stores, live-verified round-trip 2026-08-16 against a
real account (12/13 exact-match on stored key sets; the one difference — `next`/`parentKey`
on the step — is a pre-existing engine-wide convention applied to every step type, not
marketplace-specific). See `docs/marketplace-rail.md` §3 for the full annotated JSON.

Two shapes worth knowing before you build:

- **A stored marketplace ACTION carries no `version` and no `templateId` anywhere** — its
  complete stored key set is `id, stepIndex, order, attributes, name, type,
  isMarketplaceAction`. Only the **trigger** stores version/templateId. `check_workflow`'s
  `marketplaceDrift` reporting is therefore **trigger-only** — there is nothing on a stored
  action to compare a schema version against.
- The workflow body carries `meta.stepIndexCounter`, keyed by **action key**, incrementing
  a per-key occurrence counter that the builder renders as the step's `#N` canvas prefix.
  The engine emits this for you; you never author it directly.

## ⚠️ A key collision to know about: `contact_engagement_score`

The live catalog has exactly one key that is **both** an action and a trigger:
`contact_engagement_score` (action: required `operator`/`points`; trigger: no required
inputs). A schema parser that keeps action and trigger entries in **one shared map** keyed
only by `key` lets one silently overwrite the other depending on parse order — and the
losing side's real required-field list disappears with it. Concretely, if the trigger entry
wins, an authored **action** node of that type resolves against a schema with zero required
inputs, so `operator`/`points` go unenforced.

This is not hypothetical — `check_workflow`'s drift path (`action-schema.mjs`) hit exactly
this bug when it briefly shared one map, and was fixed by splitting into two separate maps
(`parseActionSchema` / `parseTriggerSchema`; see `docs/marketplace-rail.md` §6 for the full
account). **The build-time resolver this page documents (`engine/marketplace.mjs`,
`buildMarketplaceIndex` → `parseMarketplaceAssets`) still uses one shared `byKey` map with
triggers parsed after actions** — the same shape of risk, not yet independently verified
fixed on that path as of this writing. If you author a marketplace **action** whose `type`
is `contact_engagement_score` (or any future colliding key), verify the resolved
`entry.inputs` actually reflects the action's schema, not the trigger's, before trusting
the required-field enforcement.

## Discovery and errors, at a glance

| Situation | Code | Fails |
|---|---|---|
| Key resolves in neither assets nor module | `MARKETPLACE_KEY_UNKNOWN` | build (throw) |
| Key resolves, but the app isn't installed in the target location | `MARKETPLACE_APP_NOT_INSTALLED` | build (throw) |
| A `required` input is absent or blank after any schema-default fill | `MARKETPLACE_REQUIRED_FIELD` | build (throw) |
| A schema default filled a blank field | `MARKETPLACE_DEFAULT_FILLED` | warns, still builds |
| An attribute key the app doesn't declare | (unnamed) | warns, still builds |
| A trigger filter's operator isn't `string-contains-any-of` / is-not-empty, or is missing | `MARKETPLACE_FILTER_OPERATOR` | build (throw) |
| Two marketplace trigger filter values are substrings of each other | (unnamed) | warns, still builds |

Full index of every native step/trigger type: `references/capabilities.md`. This page
covers only what's different for the marketplace rail.
