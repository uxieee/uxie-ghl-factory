// Canonical build entry for the create-ghl-workflow skill. Run:
//   node scripts/build.mjs <ir.json> <LOC> [--publish] [--ignore-unresolved]
//
// Reads the Bearer JWT from $GHL_INTERNAL_TOK_FILE, else ~/.uxie-ghl-internal-mcp/tok.txt
// (the same default capture-token.mjs and the MCP server use), then
// routes the IR through the dependency-aware orchestrator — which pre-creates
// tags + email templates, resolves every human name to the account's real ID,
// ABORTS if an account dependency is missing, builds a DRAFT, and round-trip
// verifies. Publish only with --publish (and only after user confirmation).
//
// The agent MUST use this instead of hand-assembling API calls, so dependency
// pre-creation and name resolution can never be skipped.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
const HERE = dirname(fileURLToPath(import.meta.url));

// MUST match DEFAULT_TOKEN_FILE in mcp-internal/core/auth.mjs:12 — capture-token.mjs writes
// there when no env var is set, so this script has to read the same path or a "fresh" capture
// still 401s here (the exact defect this constant fixed: edit/build used to default to a
// .playwright-mcp path that capture never wrote). Re-typed rather than imported because the
// skills tree is consumed without mcp-internal beside it (Codex manifest, skill installers),
// so a cross-tree import would break standalone copies.
const DEFAULT_TOKEN_FILE = join(homedir(), '.uxie-ghl-internal-mcp', 'tok.txt');
// 0.43.0 hard-renamed GHL_TOK_FILE -> GHL_INTERNAL_TOK_FILE. Only the NEW name is read as a
// value; the OLD name's PRESENCE alone (never its value) is refused loudly — same discipline
// and wording as mcp-internal/core/auth.mjs readCredentials.
if (Boolean(process.env.GHL_TOK_FILE) && !process.env.GHL_INTERNAL_TOK_FILE) {
  console.error('ABORTED (LEGACY_TOKEN_FILE_ENV): GHL_TOK_FILE is set but GHL_INTERNAL_TOK_FILE '
    + 'is not. GHL_TOK_FILE no longer does anything (renamed in 0.43.0), so this run would '
    + 'silently fall back to the shared default token file and could authenticate as the wrong '
    + 'account.\nRename the env var, then retry — same value, new name: '
    + 'export GHL_INTERNAL_TOK_FILE="<same path you had in GHL_TOK_FILE>"');
  process.exit(2);
}
const tokFile = process.env.GHL_INTERNAL_TOK_FILE || DEFAULT_TOKEN_FILE;
// Test seam: print the resolved token-file path and exit, so the suite can assert that capture
// and build resolve the SAME file. Checked AFTER the legacy guard, BEFORE the usage check.
if (process.argv.includes('--print-token-file')) { console.log(tokFile); process.exit(0); }

const ENG = resolve(HERE, '../engine');
const { orchestrate } = await import(ENG + '/orchestrate.mjs');

const [irPath, LOC] = process.argv.slice(2);
const publish = process.argv.includes('--publish');
const ignoreUnresolved = process.argv.includes('--ignore-unresolved');
if (!irPath || !LOC) { console.error('usage: node build.mjs <ir.json> <LOC> [--publish] [--ignore-unresolved]'); process.exit(1); }

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
if (report.stickyNotes?.planned) console.log('sticky notes:', `${report.stickyNotes.posted}/${report.stickyNotes.planned} placed` + (report.stickyNotes.failed.length ? ` | FAILED: ${JSON.stringify(report.stickyNotes.failed)}` : ''));
for (const c of report.readiness ?? []) {
  const mark = c.ok === true ? '✓' : c.ok === false ? '✗' : '·';
  console.log(`readiness ${mark} ${c.key}: ${c.detail}`);
}
console.log('created email templates:', report.createdTemplates.length ? report.createdTemplates.map((t) => t.title).join(', ') : '(none)');
console.log('resolved from account:', JSON.stringify(report.resolvedFrom));
console.log('round-trip:', report.verify.pass, 'clean', report.verify.issues.length ? '| ISSUES: ' + JSON.stringify(report.verify.issues) : '');
// The asset pre-flight is fail-open by design, so its SILENCE is ambiguous: "checked, nothing
// wrong" and "skipped, nothing was validated" look identical unless the report says which.
// Print it every time. (A build that proceeded on a skipped check was indistinguishable from a
// clean one until this line existed — found running the loop gate probe, 2026-08-21.)
{
  const ap = report.assetPreflight;
  console.log('asset pre-flight:', !ap ? '(not run)'
    : ap.checked ? `checked by GHL — ${ap.errors.length} error(s), ${ap.warnings.length} warning(s)`
    : `SKIPPED (${ap.skipped}) — fail-open; NOTHING was validated`);
}
// engine warnings (ENFORCEMENT_SOFT value-checks, contact/opp field-shape advisories, asset
// notes) — collected by orchestrate into report.warnings since the warn tier shipped, but this
// report never PRINTED them: the 2026-08-22 live acceptance built a webhook with an empty header
// row and the warning fired into a field nobody rendered. The MCP path always surfaced them.
for (const w of report.warnings ?? []) console.log('⚠ WARN:', w);
if (report.unresolved.length) console.log('UNRESOLVED (built anyway):', JSON.stringify(report.unresolved));
for (const t of report.customCodeTests ?? []) console.log(`custom_code '${t.name ?? t.id}': sandbox ${t.passed ? 'PASSED' : 'FAILED'}${t.passed ? ` — output keys ${t.outputKeys.join(',')}${t.replacedOutput ? ' (saved as the step output)' : ''}` : ` — ${t.errorMessage ?? 'invalid output'}`}`);
for (const pn of report.webhookPins ?? []) console.log(`webhook pin ${pn.triggerId}: ${pn.error ? 'FAILED — ' + pn.error : `reference ${pn.referenceId}, ${pn.tagCount} merge tags`}`);
for (const w of report.webhookUrls ?? []) console.log(`inbound webhook '${w.name ?? w.triggerId}' receives POSTs at: ${w.url}  (pin a sample with the MCP tool pin_webhook_sample, triggerId ${w.triggerId})`);
console.log('URL:', `https://app.gohighlevel.com/v2/location/${LOC}/automation/workflow/${report.wid}`);
