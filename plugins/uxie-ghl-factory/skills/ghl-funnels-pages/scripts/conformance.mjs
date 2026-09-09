#!/usr/bin/env node
/**
 * LIVE CONFORMANCE SUITE for the GHL funnels / pages / websites internal API.
 *
 *   GHL_LOCATION='<locId>' node conformance.mjs
 *
 * WHY THIS EXISTS
 * ---------------
 * Every defect on this rail returns 2xx. `builder/autosave` is a blind store that accepts an
 * invented element kind with the same 201 as a real one; a domain attach reports `pathsUpdated:
 * true` while silently renaming one step and skipping another; publishing pins the public page so
 * later writes vanish; and a template install leaves embedded references pointing at the SOURCE
 * account. Unit tests prove the code matches my assumptions. Only this proves the assumptions
 * still match GHL.
 *
 * It asserts EFFECTS, never status codes. A script that checks for a 200 would report green on
 * exactly the failures this exists to catch.
 *
 * NOTHING IS DELETED — deliberately, unlike the memberships suite. This project's standing rule is
 * that probe artefacts stay named and in place. It also could not fully tear down if it wanted to:
 * there is no step-delete endpoint on this rail at all. Everything is named TEST-CONF-* and the
 * final report lists what was left behind, by id.
 *
 * COVERAGE HONESTY
 * ----------------
 * Public-URL assertions are SKIPPED and reported as skipped: they need a domain attached to a
 * fresh funnel, which is outward-facing and is not something an unattended suite should do. The
 * publish/freeze behaviour IS covered at the data layer (version pinning), which is where the trap
 * actually lives.
 */
import { randomUUID } from 'node:crypto';
import { makeGatewayFactory, TOOLS } from '../../../mcp-internal/core/tools.mjs';
import { DEFAULT_TOKEN_FILE } from '../../../mcp-internal/core/auth.mjs';
import { makeRenewer, autoRenewEnabled } from '../../../mcp-internal/core/token-renewal.mjs';

const LOCATION = process.env.GHL_LOCATION || process.env.GHL_LOC;
if (!LOCATION) {
  console.error("GHL_LOCATION is required — the sub-account to run against.\n  GHL_LOCATION='<locationId>' node conformance.mjs");
  process.exit(1);
}
const STAMP = Date.now().toString().slice(-6);
const NAME = (s) => `TEST-CONF-${s}-${STAMP}`;

const state = { tokenFile: process.env.GHL_INTERNAL_TOK_FILE ?? DEFAULT_TOKEN_FILE, engineVersion: 'funnels-conformance', allowedLocations: null };
state.renewer = autoRenewEnabled(process.env) ? makeRenewer({ getTokenFile: () => state.tokenFile }) : null;
const deps = { state, makeGw: (o = {}) => makeGatewayFactory({ state })(o) };
const gw = deps.makeGw({ loc: LOCATION });
const j = (r) => r.json?.data ?? r.json ?? {};
const tool = (n) => TOOLS.find((t) => t.name === n);

let passed = 0, failed = 0, skipped = 0;
const left = [];
const ok = (m) => { passed++; console.log(`  PASS  ${m}`); };
const bad = (m, extra) => { failed++; console.log(`  FAIL  ${m}${extra ? `  — ${extra}` : ''}`); };
const skip = (m, why) => { skipped++; console.log(`  SKIP  ${m}  — ${why}`); };
const check = (cond, m, extra) => (cond ? ok(m) : bad(m, extra));

console.log(`funnels conformance — location …${LOCATION.slice(-4)}\n`);

// 1. FUNNEL + STEP -----------------------------------------------------------------------------
const created = await gw.call('POST', '/funnels/funnel/create', { locationId: LOCATION, name: NAME('FUNNEL'), type: 'funnel' });
const funnel = j(created);
const funnelId = funnel._id ?? funnel.id;
check(created.status < 400 && !!funnelId, 'funnel/create returns a funnel id', `http ${created.status}`);
if (!funnelId) { console.log('\n0 passed, 1 failed, 0 skipped'); process.exit(1); }
left.push(`funnel ${funnelId} (${NAME('FUNNEL')})`);

// 🔴 rule 24: omit step.id and the step is minted WITHOUT one — unrepairable and unroutable.
const STEP_ID = randomUUID();
const mk = await gw.call('POST', '/funnels/funnel/create-step', {
  funnelId, locationId: LOCATION,
  step: { id: STEP_ID, name: NAME('STEP'), url: `/${NAME('step').toLowerCase()}`, pages: [], type: 'optin_funnel_page', sequence: '1', split: false, control_traffic: 100 },
});
const doc = j(await gw.call('GET', `/funnels/funnel/fetch/${funnelId}?locationId=${LOCATION}`));
const step = (doc.steps ?? []).find((s) => s.id === STEP_ID);
check(mk.status < 400 && !!step, 'create-step with a client-minted id produces a step that reads back BY THAT ID', `http ${mk.status}`);
const pageId = step?.pages?.[0];
check(!!pageId, 'the step carries the page the server minted');
if (!pageId) { console.log(`\n${passed} passed, ${failed + 1} failed, ${skipped} skipped`); process.exit(1); }

// The read that DETECTS an id-less step, per verify-reads.md — funnel/list shows one looking fine.
// 🔴 `offset` is REQUIRED (omitting it 422s, and the 422 body is a LIST of messages), the response
// is a BARE ARRAY, and `limit` is capped at 20. Getting any of the three wrong reads as an empty
// account rather than an error — which is how this assertion failed on its first run.
const pagesRes = await gw.call('GET', `/funnels/page?locationId=${LOCATION}&funnelId=${funnelId}&offset=0&limit=20`);
const pages = Array.isArray(pagesRes.json) ? pagesRes.json : [];
const row = pages.find((p) => (p._id ?? p.id) === pageId);
check(!!row && !!(row.stepId ?? row.step_id), 'GET /funnels/page reports stepId — the only cheap detector for an id-less step');

// 2. AUTHOR A PAGE -----------------------------------------------------------------------------
const MARK = `TESTCONF${STAMP}`;
const sections = [{ background: '#101014', padY: 72, maxWidth: 1080, columns: [{ widthPct: 100, elements: [
  { meta: 'heading', html: MARK, tag: 'h1', styles: { color: '#fff', fontSize: '40px', textAlign: 'center' } },
  { meta: 'paragraph', html: 'Funnels conformance suite.', tag: 'p', styles: { color: '#aaa', textAlign: 'center' } },
] }] }];
const build = (publish) => tool('build_funnel_page').handler(
  { locationId: LOCATION, funnelId, pageId, stepId: STEP_ID, sections, publish, confirm: true }, deps);

const draft = await build(false);
check(draft.ok === true, 'build_funnel_page writes a draft', draft.ok ? '' : `${draft.code}: ${draft.detail}`);
check(draft.data?.stored === true, 'every section sent reads back on a SEPARATE request');
check(draft.data?.publishState?.pinned === false, 'a never-published page reports the draft-FALLBACK regime (rule 27)');

// 3. PUBLISH, AND THE FREEZE IT CAUSES ---------------------------------------------------------
const pub = await build(true);
check(pub.ok === true && pub.data?.published?.verified === true,
  'publish-version reads back as pageType:"live" on a SEPARATE request', pub.ok ? '' : `${pub.code}: ${pub.detail}`);
check(pub.data?.published?.pageType === 'live', 'a published version is stamped "live", not "published"');

const after = await build(false);
check(after.data?.publishState?.pinned === true, 'the page is now PINNED');
check(typeof after.data?.warning === 'string' && /NOT visible/.test(after.data.warning),
  '🔴 a write to a pinned page WARNS that it is invisible in public (rule 27)');
skip('the public URL serves the pinned version, not the newest draft',
  'needs a domain attached to a fresh funnel — outward-facing, not for an unattended suite');

// 4. VERSIONS ----------------------------------------------------------------------------------
const versions = (await gw.call('GET', `/funnels/builder/get-versions?pageId=${pageId}`)).json;
check(Array.isArray(versions), 'get-versions answers a BARE ARRAY');
check(Array.isArray(versions) && versions.every((v) => 'version_id' in v),
  'the id key is snake_case version_id — reading .versionId publishes nothing, with no error');
const secs = (versions ?? []).map((v) => v.updated_at?._seconds ?? 0);
check(secs.every((s, i) => i === 0 || secs[i - 1] >= s), 'versions come back newest-first');

// 5. THE AUDITOR -------------------------------------------------------------------------------
const audit = await tool('audit_site').handler({ locationId: LOCATION, funnelId, maxPages: 10 }, deps);
check(audit.ok === true, 'audit_site runs read-only against a live account', audit.ok ? '' : audit.detail);
check(Array.isArray(audit.data?.coverage) && audit.data.coverage.length > 0, 'it reports COVERAGE, not just findings');
check(Array.isArray(audit.data?.checksNotRun), 'a check that could not run is named, never counted as clean');
const refChecks = (audit.data?.coverage ?? []).filter((c) => c.check.startsWith('dangling-references'));
check(refChecks.some((c) => c.ran), 'at least one reference list loaded, so the reference check is real');

console.log(`\nLEFT IN PLACE (nothing is deleted):`);
for (const l of left) console.log(`  ${l}`);
console.log(`  step ${STEP_ID}, page ${pageId}`);
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed > 0 ? 1 : 0);
