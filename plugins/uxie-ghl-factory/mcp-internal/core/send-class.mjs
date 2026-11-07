// The SEND-CLASS tier: internal-rail writes that can make GHL text people on its own, sign SMS
// compliance in the caller's name, or flip a Labs feature that cannot be switched back off.
//
// This is a tier ABOVE confirm, and it is NOT a refusal. raw-request-guards.mjs refuses shapes that
// have no legitimate version, and its header says anything "merely dangerous stays behind the confirm
// gate instead" (raw-request-guards.mjs:4-6). These calls are legitimate — turning an outbound agent
// on is a real operator task — but confirm:true is one boolean, and the measured failure is a caller
// that sets it without ever reading what the call does. So a send-class write needs, in addition:
//   acknowledge: <ackToken>
// where ackToken is a hash of THIS request (method + normalised path + canonical wire body + rule),
// handed out only in the preview next to the consequence in words. A token for a different body is
// refused. The token proves the consequence passed through the caller's context; it does not replace
// asking the human (the skills still require that before any ack is passed).
//
// Classified by EFFECT (W5a Decision 1, review REV-I2): the path is normalised (resolved as fetch
// resolves it — dot-segments, `\`, tab/CR/LF, final review C1 — then case, `//`, one decode, query,
// trailing `/`, a full URL's pathname) and the body is judged AS SENT, so a different
// spelling of the same call lands in the same class. Pure: no gateway, no catalogue, no account
// state — so where the effect depends on state it cannot see (is this agent's outbound armed?), it
// treats unknown as armed.
//
// Evidence: knowledge sniffs/convai-wave-2026-10-29 — live-outbound-runtime-L5-L7.json (the config
// POST stamps the compliance acceptance; an employee PUT {mode:'auto-pilot'} armed the agent),
// live-ai-campaign-L8.json (the campaign body), live-labs-before.json (which cards are one-way),
// UI-WALK-FINDINGS.md §8 (Build with AI saves agents mid-chat).

import { createHash } from 'node:crypto';
import { CODES, fail } from './errors.mjs';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The body AS SENT: the gateway serializes with JSON.stringify, which drops undefined-valued keys
// (the same reasoning as raw-request-guards.mjs onWire). A pre-serialized JSON string is read back.
const onWire = (body) => {
  if (body === undefined) return undefined;
  if (typeof body === 'string') { try { return JSON.parse(body); } catch { return body; } }
  try { return JSON.parse(JSON.stringify(body)); } catch { return body; }
};

const normMethod = (method) => String(method ?? '').trim().toUpperCase();

// What fetch(base + path) puts on the wire (W5a final review C1). The gateway concatenates an origin-only base with
// the path, and the WHATWG URL parser then resolves `.`/`..` (raw or %2e-encoded), turns `\` into `/` and drops
// tab/CR/LF. Resolving against a dummy origin by CONCATENATION (not `new URL(p, base)`, which would read `//host/x`
// as protocol-relative) reproduces that pathname exactly. null when the text does not parse.
const WIRE_ORIGIN = 'https://wire.invalid';
function wirePathname(p) {
  try { return new URL(WIRE_ORIGIN + (p.startsWith('/') ? p : `/${p}`)).pathname; } catch { return null; }
}
const decodeOnce = (p) => { try { return decodeURIComponent(p); } catch { return p; } };
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * The path the wire will carry, folded for comparison: resolved as fetch resolves it (dot-segments, `\`, tab/CR/LF),
 * one decode (a bad encoding keeps the raw text), resolved AGAIN (a decoded %2e%2e%2f the server might honour is
 * judged as the traversal it spells — the conservative direction), no query/fragment, lowercase, `//` collapsed,
 * no trailing `/`.
 */
export function normalisePath(path) {
  let p = String(path ?? '').trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) {
    try { p = new URL(p).pathname; } catch { /* keep the raw text */ }
  } else {
    p = wirePathname(p) ?? p.split(/[?#]/)[0];
  }
  p = decodeOnce(p).split(/[?#]/)[0];
  p = wirePathname(p) ?? p;
  p = p.toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return p.startsWith('/') ? p : `/${p}`;
}

/**
 * Why this raw path is non-canonical, or null (W5a final review C1). A path whose wire form differs from its text has
 * no legitimate use, and every path-scoped guard (send-class, refuseRawRequest, R-95, the catalogue trap) judges the
 * text — so raw_request refuses these before any of them runs: control characters anywhere, a backslash in the path,
 * a `.`/`..` segment (raw, or once decoded — %2e, %2e%2e%2f), or a path the URL parser rewrites.
 */
export function nonCanonicalPathReason(path) {
  const s = String(path ?? '');
  if (CONTROL.test(s)) return 'it contains a control character (tab, CR, LF or similar), which fetch silently drops';
  const pathPart = s.split(/[?#]/)[0];
  const decoded = decodeOnce(pathPart);
  if (CONTROL.test(decoded)) return 'it contains a percent-encoded control character';
  if (pathPart.includes('\\') || decoded.includes('\\')) return 'it contains a backslash, which fetch reads as `/`';
  const dotSegment = (p) => p.split('/').some((seg) => seg === '.' || seg === '..');
  if (dotSegment(pathPart) || dotSegment(decoded)) return 'it contains a `.` or `..` segment (raw or %2e-encoded), which resolves to a different route';
  const wire = wirePathname(pathPart);
  if (wire === null || decodeOnce(wire) !== decoded) return `it resolves to ${JSON.stringify(wire)} on the wire, not to the path given`;
  return null;
}

// The four Labs cards read isIrreversibleFeature:false among the six flipped on 2026-10-29
// (live-labs-before.json). Every other key — one-way, card-less (conversationsAI.timezone) or
// unknown — is irreversible until a card says otherwise. Lowercase: paths and keys compare folded.
const REVERSIBLE_LABS = new Set([
  'conversationsai.chatbuilder',
  'conversationsai.flowbuilderv2',
  'aiemployeemcpsupport',
  'conversationsai.provider',
]);

// `{a:{b:true}}` and `{"a.b":true}` are the same flag. Leaves are anything that is not a plain object.
function flattenFlags(node, prefix = '', out = []) {
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v)) flattenFlags(v, key, out);
    else out.push([key, v]);
  }
  return out;
}

// Bulk types known NOT to message anyone (corpus + captures, 2026-10-30). Anything else — including a type GHL adds
// tomorrow — is treated as a send: bulk-whatsapp, bulk-review-request and bulk-campaign carry no "message" word.
const NON_MESSAGING_BULK = new Set(['bulk-edit', 'bulk-ops-delete', 'bulk-delete', 'bulk-delete-v2', 'bulk-contact-delete',
  'bulk-delete-contact', 'bulk-contacts-to-company', 'bulk-export', 'bulk-import-v2', 'bulk-email-verification']);
const opTypes = (opSpecs) => (Array.isArray(opSpecs) ? opSpecs : [opSpecs])
  .filter(isPlainObject).map((s) => s.opType).filter((t) => typeof t === 'string');

const CONSEQUENCE = {
  'outbound-config': 'Creating or enabling an outbound config signs SMS compliance in the caller\'s name and lets this agent start conversations on its own.',
  'outbound-trigger': 'Creating or enabling an outbound trigger makes this agent text contacts on its own whenever that CRM event happens.',
  'outbound-write': 'This write changes an agent\'s outbound setup, which decides whether the agent starts conversations with contacts on its own.',
  'bulk-message-send': 'This bulk action sends messages (or starts an AI agent conversation) to every contact it selects, at once.',
  'builder-build': 'Build with AI saves the agent mid-chat and can set its mode and outbound triggers, so one turn can arm it to text contacts.',
  'builder-test': 'The test panel runs this agent against a REAL contact (the location\'s business-email contact), and whether an outbound test sends a message is unmeasured.',
  'employee-mode-on': 'Setting an agent\'s mode to anything but off lets it reply on its own, and if it has an enabled outbound config or trigger it starts texting contacts.',
  // w6c-9 (bl-789): a test run of a workflow runs every step for real against the chosen contact; there is no dry run.
  'test-run': 'This test run runs every step for real against the chosen contact; there is no dry run, so every send and write in the workflow happens.',
};

/**
 * The send class of this call, or null.
 * @returns {null | {rule: string, class: 'send'|'irreversible', consequence: string}}
 */
export function sendClassFor(method, path, wireBody) {
  const m = normMethod(method);
  if (m === 'GET') return null;
  const p = normalisePath(path);
  const wire = onWire(wireBody);
  const send = (rule) => ({ rule, class: 'send', consequence: CONSEQUENCE[rule] });

  // (a) Outbound configs and triggers. Disabling (PATCH/PUT with literal enabled:false) is how an
  // operator stops the agent, so it stays a plain confirm. Every config POST stamps the compliance
  // acceptance in the caller's name — whether a DISABLED create stamps it was never measured.
  if (p.startsWith('/agent-deployment/outbound-')) {
    if ((m === 'PATCH' || m === 'PUT') && isPlainObject(wire) && wire.enabled === false) return null;
    if (p.startsWith('/agent-deployment/outbound-configs')) return send('outbound-config');
    if (p.startsWith('/agent-deployment/outbound-triggers')) return send('outbound-trigger');
    return send('outbound-write');
  }

  // (b) A bulk action unless EVERY type (top-level and in opSpecs) is a known non-messaging one — an AI Campaign is
  // bulkActionType "bulk-conversation-ai" with opSpecs.opType the same (live-ai-campaign-L8.json).
  if (p === '/bulk-actions/request') {
    if (!isPlainObject(wire)) return send('bulk-message-send');
    const types = [wire.bulkActionType, ...opTypes(wire.opSpecs)].filter((t) => typeof t === 'string');
    if (!types.length || types.some((t) => !NON_MESSAGING_BULK.has(t.toLowerCase()))) return send('bulk-message-send');
    return null;
  }

  // (c) Build with AI: until it is measured NOT to arm an agent.
  if (p === '/ai-employees/employees/builder/build') return send('builder-build');

  // (c2) The test panel (final review M7): it runs on a real contact, and its success path — does an outbound test
  // send, is it logged — was never measured (corpus ai-agents/20-api/conversation-ai-builder.md). Unknown = send.
  if (/^\/ai-employees\/employees\/[^/]+\/builder\/test$/.test(p)) return send('builder-test');

  // (c3) w6c-9: a workflow test run (POST /workflow/{loc}/test-workflow/{wf}) runs every step for real. Not run live in this build.
  // Fail closed: every non-GET under test-workflow (the start, test-action, and the run routes) is a send. A GET is a read.
  if (m !== 'GET' && /^\/workflow\/[^/]+\/test-workflow(\/|$)/.test(p)) return send('test-run');

  // (d) The call that armed an agent live (REV-C1): an employee write that sets mode to anything but
  // literal "off". Pure, so it cannot know whether outbound is armed — unknown counts as armed.
  const emp = /^\/ai-employees\/employees\/([^/]+)$/.exec(p);
  if (emp && emp[1] !== 'builder' && isPlainObject(wire) && Object.hasOwn(wire, 'mode') && wire.mode !== 'off') {
    return send('employee-mode-on');
  }

  // (e) Labs: turning ON (anything but literal false) a key not on the reversible list.
  if (/^\/labs\/feature-flags\/location\/[^/]+$/.test(p) && isPlainObject(wire)) {
    // BOTH the featureFlags object and every other top-level key (final review M8): whether GHL honours a key beside
    // featureFlags is unmeasured, so one there is judged too (fail closed: an unknown key counts as one-way).
    // locationId/companyId are request envelope keys only when they hold a plain id; anything else is judged as flags.
    const { featureFlags, ...rest } = wire;
    for (const k of ['locationId', 'companyId']) if (typeof rest[k] === 'string' || typeof rest[k] === 'number') delete rest[k];
    const leaves = isPlainObject(featureFlags)
      ? [...flattenFlags(featureFlags), ...flattenFlags(rest)]
      : flattenFlags(wire);
    const oneWay = leaves
      .filter(([key, value]) => value !== false && !REVERSIBLE_LABS.has(key.toLowerCase()))
      .map(([key]) => key);
    if (oneWay.length) {
      return {
        rule: 'labs-irreversible-on',
        class: 'irreversible',
        consequence: `Turning on ${oneWay.join(', ')} cannot be undone: a one-way (or unknown) Labs feature stays on for this location once set.`,
      };
    }
  }
  return null;
}

// Keys sorted at every depth; arrays keep their order.
const canonical = (v) => {
  if (Array.isArray(v)) return v.map(canonical);
  if (isPlainObject(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  return v;
};

/** sha256 over [METHOD, normalised path, canonical wire body, rule]; the first 16 hex characters. */
export function ackTokenFor(method, path, wireBody, rule) {
  const wire = onWire(wireBody);
  const material = JSON.stringify([normMethod(method), normalisePath(path), wire === undefined ? null : canonical(wire), String(rule)]);
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

/** `{rule, class, consequence, ackToken}` — the one shape every preview and refusal carries. */
export function sendClassWithToken(sendClass, { method, path, wireBody }) {
  if (!sendClass) return null;
  return { rule: sendClass.rule, class: sendClass.class, consequence: sendClass.consequence,
    ackToken: ackTokenFor(method, path, wireBody, sendClass.rule) };
}

/**
 * null when there is nothing to acknowledge or `args.acknowledge` is this request's token; otherwise the
 * SEND_CLASS_ACK_REQUIRED failure (the plugin's {ok, code, detail, remediation} contract, plus data).
 * The token value goes in data only: detail and remediation pass through the credential scrubber.
 */
export function requireSendAck(args, sendClass, { method, path, wireBody }) {
  if (!sendClass) return null;
  const withToken = sendClassWithToken(sendClass, { method, path, wireBody });
  if (args?.acknowledge === withToken.ackToken) return null;
  const given = typeof args?.acknowledge === 'string' && args.acknowledge.length > 0;
  return {
    ...fail(
      CODES.SEND_CLASS_ACK_REQUIRED,
      `${given ? 'The acknowledge value does not match this exact request (method, path and body), so' : 'This is a'} `
        + `${sendClass.class}-class write (${sendClass.rule}) and nothing was sent. ${sendClass.consequence}`,
      'Tell the human what data.sendClass.consequence says and get their yes. Then repeat this exact request with '
        + 'confirm:true and acknowledge set to data.sendClass.ackToken. A changed body needs a fresh preview.',
    ),
    data: { sendClass: withToken },
  };
}
