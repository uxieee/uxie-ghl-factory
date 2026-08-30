// Server instructions — the routing rules that do not fit in a tool description.
//
// Neither entry point published any until now. The cost of that was paid 41 times per request:
// every rule below had to be inferred from short per-tool descriptions, or was simply not known.
// The public rail spends ~336 tokens here and it is the reason a 5-tool surface out-navigates a
// 41-tool one.
//
// Kept deliberately short. Everything here is a rule that changes WHICH CALL an agent makes; the
// per-tool specifics stay in the tool descriptions where they are paid for only when relevant.

export const FULL_INSTRUCTIONS = `GoHighLevel internal API — undocumented builder endpoints, local stdio, one browser JWT.

START WITH search_endpoints WHEN NO TYPED TOOL OBVIOUSLY FITS. It covers every GHL surface this
project knows -- workflow builder, memberships and courses, conversation AI, voice AI, agent
studio, funnels, calendars, media, billing -- not workflows only. Each hit says what the endpoint
does, whether a typed tool already covers it, and whether a location token has been proven to
reach it. describe_endpoint then hands you the exact call.

A TYPED TOOL ALWAYS WINS over raw_request for the same endpoint. Typed tools carry the compiler,
the required query switches, the cursor walk and the read-back verification; raw_request carries
none of them. search_endpoints names a covering tool in coveredBy when one exists — call that
instead. Reach for raw_request only when nothing covers the endpoint, or when you need a parameter
the typed tool does not expose.

AUTH AND HEADERS ARE ADDED FOR YOU on every call — Bearer plus channel/source/version. Never set
them yourself. A 401 whose body says "version header was not found" is NOT an auth failure and
re-capturing the token will not help.

host:"ai" is ONE decision, not two: it switches the origin to services.leadconnectorhq.com AND
attaches the second credential (token-id). Do not reach for it just to change host.

AN EXPIRED CREDENTIAL IS YOURS TO FIX. The JWT lasts about an hour, so it WILL expire mid-task.
On TOKEN_EXPIRED or TOKEN_MISSING, invoke the uxie-ghl-factory:internal-connect skill yourself,
then retry the call that failed. Do not stop and do not ask -- the skill drives the browser, writes
a fresh token to this project, and the server re-reads that file on every call, so nothing needs
restarting. The user only has to act if the browser session itself has lapsed. Bound it to ONE
re-capture per failure: if the retry fails the same way, stop and report it.

A 200 IS NOT PROOF the write applied. GHL stores unrecognised keys verbatim, and at least one
search endpoint returns 200 with a plausible WRONG row for a filter it does not understand. Read
back on a separate request before reporting a result.

A catalogue hit proves the GHL builder calls that path. It does not prove your token reaches it,
and it does not prove calling it is safe.

LOCATION_UNBOUND AND LOCATION_FORBIDDEN ARE NOT CREDENTIAL PROBLEMS. Re-capturing a token will not
help either one. LOCATION_UNBOUND means this project has not declared which GHL accounts it may
write to; LOCATION_FORBIDDEN means the call targeted an account outside that declared set. Both
name the fix in their remediation -- surface it to the user rather than retrying or re-running
internal-connect.`;

export const AUDIT_INSTRUCTIONS = `GoHighLevel internal API — READ-ONLY audit profile.

This profile is structurally read-only: the registry admits GET capabilities only, and that lock
lives in the server, not in configuration. There is no escape hatch and no arbitrary-request tool
here by design. If you need one, you are on the wrong profile.

AUTH AND HEADERS ARE ADDED FOR YOU. Never set them.

Every composite reports completeness explicitly. A failure is complete:false with a coded warning
and a null payload — never an empty list, which would read as "there is nothing there". Do not
collapse the two.

A description that says proof: external-receipt-required means THIS RAIL HAS NEVER BEEN
LIVE-PROVEN. A live canary is required before its output may be published as an audit finding.`;
