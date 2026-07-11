// Canonical build entry for the create-ghl-workflow skill. Run:
//   node scripts/build.mjs <ir.json> <LOC> [--publish] [--ignore-unresolved]
//
// Reads the Bearer JWT from ../.playwright-mcp/tok.txt (or $GHL_TOK_FILE), then
// routes the IR through the dependency-aware orchestrator — which pre-creates
// tags + email templates, resolves every human name to the account's real ID,
// ABORTS if an account dependency is missing, builds a DRAFT, and round-trip
// verifies. Publish only with --publish (and only after user confirmation).
//
// The agent MUST use this instead of hand-assembling API calls, so dependency
// pre-creation and name resolution can never be skipped.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));
const ENG = resolve(HERE, '../engine');
const { orchestrate } = await import(ENG + '/orchestrate.mjs');

const [irPath, LOC] = process.argv.slice(2);
const publish = process.argv.includes('--publish');
const ignoreUnresolved = process.argv.includes('--ignore-unresolved');
if (!irPath || !LOC) { console.error('usage: node build.mjs <ir.json> <LOC> [--publish] [--ignore-unresolved]'); process.exit(1); }

const tokFile = process.env.GHL_TOK_FILE || resolve(HERE, '../../../../.playwright-mcp/tok.txt');
const T = (readFileSync(tokFile, 'utf8').match(/Bearer (ey[A-Za-z0-9._-]+)/) || [])[1];
if (!T) { console.error('no Bearer token in', tokFile); process.exit(1); }
const decoded = JSON.parse(Buffer.from(T.split('.')[1], 'base64url').toString());
if (decoded.exp < Math.floor(Date.now() / 1000)) { console.error('token EXPIRED — recapture per auth-jwt-capture.md'); process.exit(1); }
const UID = decoded.authClassId;

const BASE = 'https://backend.leadconnectorhq.com';
const IFRAME = 'https://client-app-automation-workflows.leadconnectorhq.com';
const H = (w) => ({ authorization: 'Bearer ' + T, channel: 'APP', source: 'WEB_USER', version: '2021-07-28',
  accept: 'application/json, text/plain, */*', ...(w ? { 'content-type': 'application/json', origin: IFRAME, referer: IFRAME + '/' } : {}) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (m, p, b) => { await sleep(300); const r = await fetch(BASE + p, { method: m, headers: H(m !== 'GET'), body: b ? JSON.stringify(b) : undefined });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = txt; } return { status: r.status, ok: r.ok, json: j }; };

const ir = JSON.parse(readFileSync(irPath, 'utf8'));
const report = await orchestrate(ir, { call, loc: LOC, uid: UID }, { publish, ignoreUnresolved });

console.log('\n=== BUILD REPORT ===');
if (report.aborted) { console.log('ABORTED:', report.aborted); process.exit(2); }
console.log('workflow:', report.wid, '| steps:', report.steps, '| status:', report.published ? 'PUBLISHED' : 'draft');
console.log('created tags:', report.createdTags.length ? report.createdTags.join(', ') : '(none needed)');
console.log('created email templates:', report.createdTemplates.length ? report.createdTemplates.map((t) => t.title).join(', ') : '(none)');
console.log('resolved from account:', JSON.stringify(report.resolvedFrom));
console.log('round-trip:', report.verify.pass, 'clean', report.verify.issues.length ? '| ISSUES: ' + JSON.stringify(report.verify.issues) : '');
if (report.unresolved.length) console.log('UNRESOLVED (built anyway):', JSON.stringify(report.unresolved));
console.log('URL:', `https://app.gohighlevel.com/v2/location/${LOC}/automation/workflow/${report.wid}`);
