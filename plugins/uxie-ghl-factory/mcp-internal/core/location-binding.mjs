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

const DEFAULT_BASE = 'https://backend.leadconnectorhq.com';
const AI_BASE = 'https://services.leadconnectorhq.com';
// A `.` or `..` SEGMENT, raw or percent-encoded. Tested against the raw argument, never against
// URL.pathname -- by the time new URL() has resolved, the dot segments are gone and the check
// silently passes the traversal it exists to catch.
const DOT_SEGMENT = /(^|\/)(\.|%2e|\.\.|%2e%2e|\.%2e|%2e\.)(\/|$)/i;

// Locations occupy two shapes in a catalogue template: an explicit {locationId} slot, and a
// {param} slot immediately after a literal `location`/`locations` segment (7 rows, all GET).
// Positions, never id shapes: every GHL object id is 20-24 alphanumerics, so workflow, step and
// location ids are indistinguishable by appearance.
export function locationPositions(templatePath) {
  const segs = templatePath.replace(/\{query\}$/, '').split('/').filter(Boolean);
  const out = [];
  segs.forEach((seg, i) => {
    if (!seg.startsWith('{')) return;
    if (seg === '{locationId}' || /^\{location_?[Ii]d\}$/.test(seg)) out.push(i);
    else if (i > 0 && /^locations?$/i.test(segs[i - 1])) out.push(i);
  });
  return out;
}

// Literal beats parameter. Without it, 13+ fully-literal paths (/locations/search,
// /workflows/statistics, /workflow/oauth2/update-token) unify with a location-bearing template and
// demand that a literal segment be a permitted location.
export function matchTemplates(pathname, method, endpoints) {
  const segs = pathname.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  const scored = [];
  // The best literal count is computed across ALL methods, then only same-method rows that tie it
  // are kept. Scoring within one method first would miss a literal row that exists under another:
  // /workflow/oauth2/update-token is a PUT, so a GET of that path finds no same-method literal
  // match, unifies with GET /workflow/{locationId}/{id}, and demands that `oauth2` be a permitted
  // location. Seven fully-literal paths are wrongly refused that way.
  let globalBest = -1;
  for (const e of endpoints) {
    const t = (e.path ?? '').replace(/\{query\}$/, '').split('/').filter(Boolean);
    if (t.length !== segs.length) continue;
    let literals = 0, ok = true;
    for (let i = 0; i < t.length; i++) {
      if (t[i].startsWith('{')) continue;
      if (t[i] !== segs[i]) { ok = false; break; }
      literals++;
    }
    if (!ok) continue;
    if (literals > globalBest) globalBest = literals;
    if ((e.method ?? 'GET') === method) scored.push({ e, literals });
  }
  return scored.filter((s) => s.literals === globalBest).map((s) => s.e);
}

// Agency-wide writes: they mutate EVERY location under the agency, so no per-location binding can
// sanction them. Matched by method and segment position -- a path-only pattern also matches two
// sibling GETs and would contradict "reads are unaffected". The id in seg[1] is never shape-matched.
const isAgencyWideWrite = (method, segs) =>
  method !== 'GET' && segs[0] === 'workflow' && segs[2] === 'workflow-company-setting';

export function checkLocationBinding({ tool, args, allowed, ...opts }) {
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

  if (tool.name === 'raw_request') {
    const path = String(args?.path ?? '');
    const method = String(args?.method ?? 'GET');
    const base = args?.host === 'ai' ? AI_BASE : (opts.base ?? DEFAULT_BASE);
    if (DOT_SEGMENT.test(path.split('?')[0])) {
      return fail(CODES.LOCATION_PATH_REWRITE,
        'the request path contains a relative segment and would resolve to a different target',
        'Send the fully-resolved path. The guard refuses paths it would have to rewrite.');
    }
    let url;
    try { url = new URL(path, base); } catch {
      return fail(CODES.LOCATION_PATH_REWRITE, 'the request path could not be resolved',
        'Send an absolute internal path beginning with /.');
    }
    if (url.origin !== new URL(base).origin) {
      return fail(CODES.LOCATION_PATH_REWRITE,
        'the request path resolves to a different origin',
        'Send an absolute internal path beginning with /.');
    }
    const segs = url.pathname.split('/').filter(Boolean);
    if (isAgencyWideWrite(method, segs)) {
      return fail(CODES.LOCATION_DENYLISTED,
        'this endpoint writes settings across every location under the agency',
        'No per-location binding can sanction an agency-wide write. Make the change per location.');
    }
    for (const key of ['locationId', 'location_id']) {
      for (const v of url.searchParams.getAll(key)) {
        if (!allowed.has(v)) return fail(CODES.LOCATION_FORBIDDEN,
          `the request targets ${v}, which this registration is not permitted to act on`,
          'Target a permitted account, or rebind the registration.');
      }
    }
    for (const e of matchTemplates(url.pathname, method, opts.endpoints ?? [])) {
      for (const i of locationPositions(e.path ?? '')) {
        const v = segs[i];
        if (v && !allowed.has(v)) return fail(CODES.LOCATION_FORBIDDEN,
          `the request path targets ${v}, which this registration is not permitted to act on`,
          'Target a permitted account, or rebind the registration.');
      }
    }
  }

  return null;
}
