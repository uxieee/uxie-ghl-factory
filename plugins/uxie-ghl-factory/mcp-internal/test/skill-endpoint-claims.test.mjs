import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

// Skills are hand-written prose that tells an agent which endpoint to call. Nothing checked those
// claims against the catalogue the same plugin ships, so a skill could name a path that does not
// exist, or that the corpus has since corrected, and the only symptom would be a 404 in front of
// a user. The catalogue is regenerated from the corpus on every knowledge commit; the skills are
// not. This is the gate that keeps the two from drifting apart.
//
// It is deliberately a plain node:test file next to skill-script-paths.test.mjs: it reads the
// committed catalogue, needs no network and no knowledge/ checkout, and therefore runs under
// `npm test`, inside `pretest`, and inside the release suite for free.

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP = resolve(HERE, '..');
const SKILLS = resolve(MCP, '../skills');
const catalog = JSON.parse(readFileSync(resolve(MCP, 'catalog/internal-endpoints.json'), 'utf8'));

// Param spelling is not the claim. `{id}`, `{workflowId}` and `:id` all mean "one segment", and a
// trailing slash is not a different endpoint. Query strings belong to the call, not the path.
const normalise = (p) => {
  const bare = String(p).split('?')[0].replace(/\{[^}]*\}/g, '{}').replace(/:[A-Za-z0-9_]+/g, '{}');
  return bare.replace(/\/$/, '') || '/';
};
const KNOWN = new Set(catalog.endpoints.map((e) => `${e.method} ${normalise(e.path)}`));

// Every claim below is unmatched TODAY, and each is recorded with the reason it is allowed to be.
// The reason is the point of the list: an entry with no reason is indistinguishable from a typo,
// which is how a silencer grows. Adding one is a review decision — deleting one is the fix.
//
//   PROSE        the text is teaching notation, not naming an endpoint (ellipses, <placeholders>,
//                bracket-optional segments). The RE skill's own corpus contract forbids these in
//                corpus pages for exactly this reason; skills are prose and get the latitude.
//   RELATIVE     a real endpoint written against a base the surrounding section states.
//                Worth expanding to the full path when that page is next edited.
//   PUBLIC_API   a documented rest.gohighlevel.com route. Different rail, not in this catalogue.
//   UNCATALOGUED a claim that looks real and the catalogue does not carry. Each is a corpus gap:
//                either the endpoint gets a page and a row, or the skill is wrong. Do not let
//                this class grow silently — it is the one worth draining.
const ALLOW = new Map(Object.entries({
  'GET /calendars/events...':                  'PROSE — an ellipsis inside the RE skill\'s own "do not write it this way" example',
  'GET /x/{}':                                 'PROSE — a generic stand-in path in the RE skill\'s worked example',
  'PUT /workflow/...':                         'PROSE — an elided tail in the capture playbook',
  'POST /workflow/<LOC':                       'PROSE — a <LOC> placeholder in the fast-forward runbook',
  'PUT /conversations-ai/employeeConfigs[/{}':  'PROSE — bracket-optional notation for "with or without the id"',
  'PUT /rename-workflow/{}':                   'RELATIVE — the catalogue carries PUT /workflow/{locationId}/rename-workflow/{workflowId}',
  'POST /super-agents/build':                  'RELATIVE — the catalogue carries POST /agent-studio/super-agents/build',
  'GET /categories':                           'RELATIVE — memberships, under the /membership/locations/{locationId} base its section states',
  'POST /posts':                               'RELATIVE — memberships community posts, under the same /membership/locations/{locationId} base',
  'GET /workflows':                            'PUBLIC_API — the documented rest.gohighlevel.com list route, not an internal one',
  'DELETE /funnels/funnel/delete/{}':          'UNCATALOGUED — the catalogue carries POST /funnels/funnel/delete with no id segment; one of the two is wrong and neither has been re-probed',
  'PUT /voice-ai/actions/{}':                  'UNCATALOGUED — the catalogue has POST/GET on /voice-ai/actions and its children but no PUT by id',
  'PUT /calendars/events/appointments/{}':     'UNCATALOGUED — no calendars appointment-update row exists at all',
  'POST /contacts/{}/workflow/{}':             'UNCATALOGUED — the add-contact-to-workflow route has no row',
  'POST /knowledge-base':                      'UNCATALOGUED — the create route; the catalogue has only /knowledge-base/{knowledgeBaseId} and /all',
}));

const TOKEN = /\b(GET|POST|PUT|PATCH|DELETE|SSE)\s+(\/[A-Za-z{:][^\s|`)>,;\]]*)/g;

const markdownFiles = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(p));
    else if (entry.name.endsWith('.md')) out.push(p);
  }
  return out;
};

const claims = () => {
  const found = new Map();
  for (const file of markdownFiles(SKILLS)) {
    const rel = relative(resolve(MCP, '..'), file);
    for (const [i, line] of readFileSync(file, 'utf8').split('\n').entries()) {
      for (const m of line.matchAll(TOKEN)) {
        const key = `${m[1]} ${normalise(m[2])}`;
        if (!found.has(key)) found.set(key, []);
        found.get(key).push(`${rel}:${i + 1}`);
      }
    }
  }
  return found;
};

test('every endpoint a skill names exists in the catalogue it ships beside', () => {
  const unknown = [];
  for (const [key, where] of claims()) {
    if (KNOWN.has(key) || ALLOW.has(key)) continue;
    unknown.push(`${key}   ← ${where[0]}${where.length > 1 ? ` (+${where.length - 1} more)` : ''}`);
  }
  assert.deepEqual(unknown, [],
    'a skill names an endpoint the catalogue does not carry. Either the path is wrong, or the '
    + 'corpus owes it a page — add it to ALLOW with a reason only when neither is true.');
});

test('the exception list has not rotted — every entry is still an unmatched claim', () => {
  // An allowance that no longer corresponds to anything is a silencer waiting to hide a real
  // mistake: the next claim to collide with that key would pass unread.
  const found = claims();
  const stale = [...ALLOW.keys()].filter((k) => !found.has(k) || KNOWN.has(k));
  assert.deepEqual(stale, [], 'these allowances no longer match any skill claim, or the catalogue now carries them — delete them');
});

test('every allowance states which kind of exception it is', () => {
  const KINDS = ['PROSE', 'RELATIVE', 'PUBLIC_API', 'UNCATALOGUED'];
  for (const [key, why] of ALLOW) {
    assert.ok(KINDS.some((k) => why.startsWith(k)), `${key} needs one of ${KINDS.join('/')} — an unclassified allowance is a shrug`);
    assert.ok(why.length > 40, `${key} needs a real reason, not a label`);
  }
});

test('the UNCATALOGUED backlog does not grow silently', () => {
  // The class worth draining: each one is either a wrong skill or a missing corpus page. Pinning
  // the count means adding another is a deliberate act with a number to justify.
  const uncatalogued = [...ALLOW.values()].filter((w) => w.startsWith('UNCATALOGUED'));
  assert.ok(uncatalogued.length <= 5,
    `${uncatalogued.length} skill claims have no catalogue row. Chase one into the corpus before adding another.`);
});

test('the scan actually reads the skills — it cannot pass by finding nothing', () => {
  const found = claims();
  assert.ok(found.size > 50, `expected the skills to name dozens of endpoints, found ${found.size}`);
  assert.ok([...found.keys()].some((k) => KNOWN.has(k)), 'no claim matched the catalogue at all — the normaliser is broken');
});
