// ONE GHL LOGIN SERVES MANY CLIENT SUB-ACCOUNTS. The JWT carries no location claim (spec P5), so
// the credential cannot distinguish them: 39 tools take `locationId` as a free string, 17 declare a
// non-GET capability, and nothing else stands between one client's account and another's. This
// module is that boundary.
//
// It is pure and takes the permitted set as an argument so it can be tested without a server, an
// env var, or a browser.
import { fail, CODES } from './errors.mjs';

// `null` means UNBOUND, which is not the same as "permits nothing" — see checkLocationBinding.
// Empty and whitespace-only strings are unset, not an empty allowlist: a registration that sets
// GHL_LOCATIONS="" has said nothing, not "permit no locations".
export function parseAllowedLocations(raw) {
  if (typeof raw !== 'string') return null;
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

const declaresLocation = (tool) => Object.keys(tool?.inputSchema?.shape ?? {}).includes('locationId');

// A tool that cannot NAME an account cannot target one. Six tools declare no `locationId` and make
// no gateway call; guarding them would lock out `auth_status` and `set_token_file` on an unbound
// registration -- the two tools you need when a credential is broken. `audit-profile.mjs:26`
// exempts `auth_status` for the same reason.
//
// Within the guarded 39, `raw_request` is classified PER CALL. Its `capabilities` array is empty,
// so any rule of the form `capabilities.some(c => c.method !== 'GET')` reads false and would file
// the escape hatch -- any method, any path -- under reads.
export function classifyCall(tool, args) {
  if (!declaresLocation(tool)) return 'unguarded';
  if (tool.name === 'raw_request') return (args?.method ?? 'GET') === 'GET' ? 'read' : 'write';
  return tool.capabilities?.some((c) => c.method !== 'GET') ? 'write' : 'read';
}

const bindCommand = (locationId) =>
  'Bind this registration to the accounts it may touch, then retry:\n'
  + `  claude mcp add --transport stdio --scope local -e GHL_LOCATIONS="${locationId}" ... `
  + '(keep the existing -e GHL_TOK_FILE=... and the same server name)';

export function checkLocationBinding({ tool, args, allowed }) {
  const kind = classifyCall(tool, args);
  if (kind === 'unguarded') return null;

  const declared = args?.locationId;
  // Absence is not a refusal: search_merge_tags declares locationId optional and makes no gateway
  // call without it.
  const hasDeclared = typeof declared === 'string' && declared.length > 0;

  if (allowed === null) {
    if (kind === 'read') return null;
    return fail(
      CODES.LOCATION_UNBOUND,
      'this registration may not write: it declares no permitted locations'
        + (hasDeclared ? ` (the call targeted ${declared})` : ''),
      bindCommand(hasDeclared ? declared : '<locationId>'),
    );
  }

  if (hasDeclared && !allowed.has(declared)) {
    return fail(
      CODES.LOCATION_FORBIDDEN,
      `this registration is not permitted to act on ${declared}`,
      'Target an account this registration is bound to, or rebind it with -e GHL_LOCATIONS=... '
      + 'if it should legitimately serve this one.',
    );
  }
  return null;
}
