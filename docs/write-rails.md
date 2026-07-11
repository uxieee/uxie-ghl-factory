# Write Rails — mandatory gates for every internal-API WRITE

> Applies to: `create-ghl-workflow`, `ghl-funnels-pages`, and any future skill
> that mutates a GHL account via `backend.leadconnectorhq.com`.
> Auth details (header format, capture procedure, token claims, expiry) live
> ONLY in `${CLAUDE_PLUGIN_ROOT}/docs/auth-jwt-capture.md` — this doc never
> repeats them.

Both gates below exist because internal-API writes carry two distinct risks:
writing to an account the user doesn't actually administer, and operating
against an undocumented, off-Terms-of-Service surface. Gate 1 guards the
first risk and runs every write session. Gate 2 guards the second and runs
once per workspace. A write-capable skill must pass both before it issues
its first mutating call.

## Gate 1: OWNED-ACCOUNT CHECK (every write session)

Before any write, verify the user has admin access to the target
sub-account (`locationId`). This check runs at the start of **every** write
session — it is not cached across sessions the way Gate 2 is, because the
account being targeted can change session to session.

### Procedure

1. **Identify the target `locationId`** the write is about to touch.
2. **Confirm the authenticated user is scoped to that location.** The
   captured session (see the canonical auth doc) is tied to a specific
   user. If that user's session isn't associated with the target
   `locationId` at all, refuse immediately — the user isn't even
   authenticated against this sub-account, let alone an admin on it.
3. **Verify admin role on that location.** Use the plugin's bundled MCP
   server (public API) to look up the user's role on the target location
   — e.g. a user-lookup/search action scoped to `locationId`, matched
   against the authenticated user's ID. Accept the check if:
   - the user's role on this location is admin (or an agency-level role
     that grants admin visibility across its locations), **and**
   - the user actually appears in that location's user list.
   Refuse if the user does not appear in the location's user list, or
   appears with a non-admin role.
4. **Refuse + explain on failure.** If the check fails, the skill MUST NOT
   proceed with any write. Surface the reason clearly and stop, e.g.:

   > "Owned-account check failed: I can't confirm admin access to
   > `{locationId}` for the current session. I won't write to an account
   > you don't administer. If this is wrong — e.g. you do have admin
   > access but the check is misreading it — tell me why in your own
   > words and I'll log it as an explicit override before proceeding."

5. **Explicit override, requested and logged.** The skill does not accept
   a bare "yes, proceed" as an override. It must ask the user to state the
   override reason in their own words, then:
   - record the user's message verbatim, together with the target
     `locationId` and a timestamp, to `.ghl/<locationId>/write-overrides.log`
     (append-only; create the file and `.ghl/<locationId>/` if absent).
   - proceed with the write only after the override is logged.
6. **This check is best-effort, not a security boundary.** It prevents
   accidental writes to the wrong account (e.g. a stale session still
   pointed at a client's sub-account). A user who wants to bypass it
   entirely can always do so via the override path above — the point is
   that the bypass is deliberate and on the record, not silent.

## Gate 2: TOS DISCLOSURE (once per workspace)

The internal API (`backend.leadconnectorhq.com`) is undocumented and not
part of GHL's published, supported API surface. Writing to it sits outside
typical SaaS Terms of Service the same way any automated use of
non-public endpoints does. This gate makes sure the user has actually seen
that trade-off — in plain language, not buried in a skill's internals —
before the first internal-API write happens in a given workspace.

### Disclosure text

Before the **first** internal-API write in a workspace, show the user
something to this effect (adapt wording, keep the substance):

> "Heads up: this write goes through GoHighLevel's internal
> workflow-builder API, not their public/documented API. That means:
> - It's undocumented and can change or break without notice — GHL owes
>   no compatibility guarantee here the way they do for the public API.
> - It sits in a gray area of GHL's Terms of Service, which generally
>   restrict automated access to non-public endpoints. You're using your
>   own logged-in session to write to your own account, but this isn't
>   GHL-sanctioned automation.
> - If GHL changes the internal API, this write can fail or behave
>   unexpectedly with no advance warning.
>
> I'll only ask this once per workspace. Reply to confirm you understand
> and want to proceed."

### Recording acknowledgment

Once the user acknowledges:

- Record it at `.ghl/tos-acknowledged` (workspace-root, not per-location —
  this is a once-per-workspace gate, unlike Gate 1). Include the date and
  the disclosure text that was shown (or a reference to this doc's
  version), so there's a record of what the user actually agreed to.
- **Never re-prompt in that workspace.** Every subsequent internal-API
  write session in the same workspace checks for `.ghl/tos-acknowledged`
  first; if present, skip straight to Gate 1 and proceed.
- If `.ghl/tos-acknowledged` is missing (new workspace, or file deleted),
  treat it as never acknowledged and show the disclosure again before the
  next write.

## Read-only note

`get-ghl-workflow-json` performs GET-only internal-API calls — it never
writes. Gate 1 (owned-account check) is **not required** for it. However,
because it still touches the same undocumented, off-ToS internal API
surface, sessions using it must mention the ToS note (a short pointer to
the substance of Gate 2 above) on first use in a workspace — it does not
need the full acknowledgment-and-record flow that write paths require,
since no write is happening.
