// Fast-forward GHL workflow WAIT steps: move contacts parked at a step to the next step.
// Harvested from the builder UI (wait step → Action statistics → "move to next step") and
// live-proven 2026-07-17f: drove a 120h deposit-chase ladder (3h+21h+24h+24h+48h) to
// end_of_workflow in ~3 min, every SMS/email firing.
//
//   GHL_TOK_FILE=/path/to/token.txt node ff.mjs <LOC> <WID> peek [stepId]
//   GHL_TOK_FILE=… node ff.mjs <LOC> <WID> move <stepId> --contact <cid>
//   GHL_TOK_FILE=… node ff.mjs <LOC> <WID> move <stepId> --status <id,id,...>
//   GHL_TOK_FILE=… node ff.mjs <LOC> <WID> move <stepId> --all --confirm
//
// This MUTATES live enrollments — moving a contact fires whatever step comes after the wait
// (real SMS/email/pipeline moves). It is read-only unless you use `move`, and `move --all`
// is a DRY RUN unless you also pass --confirm. `statusIds` are workflow-status ULIDs (from
// details-by-step), NOT contactIds. See SKILL.md for the write gates.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { makeFF as makeEngineFF } from '../engine/ff.mjs';

const BASE = 'https://backend.leadconnectorhq.com';
const IFRAME = 'https://client-app-automation-workflows.leadconnectorhq.com';

function readToken() {
  const f = process.env.GHL_TOK_FILE;
  if (!f) throw new Error('set GHL_TOK_FILE to a file containing the captured "Authorization: Bearer <jwt>" header');
  const tok = (fs.readFileSync(f, 'utf8').match(/Bearer\s+(ey[A-Za-z0-9._-]+)/) || [])[1];
  if (!tok) throw new Error(`no "Bearer ey…" JWT found in ${f}`);
  return tok;
}
function uidFrom(tok) {
  const claims = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString());
  return claims.authClassId || claims.userId || claims.sub;
}
function headers(tok, write) {
  return {
    authorization: 'Bearer ' + tok, channel: 'APP', source: 'WEB_USER', version: '2021-07-28',
    accept: 'application/json, text/plain, */*',
    ...(write ? { 'content-type': 'application/json', origin: IFRAME, referer: IFRAME + '/' } : { referer: IFRAME + '/' }),
  };
}

// The shipped CLI owns its thin fetch adapter. Reusable workflow behavior lives in engine/ff.mjs.
function makeCliGateway({ loc, tok = readToken() }) {
  const uid = uidFrom(tok);
  const call = async (method, path, body) => {
    const r = await fetch(BASE + path, {
      method, headers: headers(tok, method !== 'GET'), body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, ok: r.ok, json };
  };
  return { call, loc, uid };
}

// Compatibility boundary: this shipped module historically exported
// makeFF({ loc, tok }). Keep that import API while also accepting the extracted
// gateway shape for callers that adopted it during the refactor.
export function makeFF(options = {}) {
  if (options.gw) return makeEngineFF({ gw: options.gw });
  return makeEngineFF({ gw: makeCliGateway(options) });
}

// ---- CLI ----------------------------------------------------------------------------
async function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const pos = argv.filter((a) => !a.startsWith('--'));
  const getFlagVal = (name) => { const i = argv.indexOf(name); return i > -1 ? argv[i + 1] : undefined; };
  const [loc, wid, cmd, stepId] = pos;
  if (!loc || !wid || !cmd) {
    console.error('usage: ff.mjs <LOC> <WID> peek [stepId] | move <stepId> (--contact <cid> | --status <id,id> | --all --confirm)');
    process.exit(2);
  }
  const ff = makeFF({ gw: makeCliGateway({ loc }) });

  if (cmd === 'peek') {
    const out = stepId ? await ff.allParked(wid, stepId) : await ff.countPerStep(wid);
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (cmd === 'move') {
    if (!stepId) throw new Error('move needs a <stepId>');
    const contactId = getFlagVal('--contact');
    const statusCsv = getFlagVal('--status');
    if (contactId) { console.log(JSON.stringify(await ff.move(wid, stepId, { contactId }), null, 2)); return; }
    if (statusCsv) { console.log(JSON.stringify(await ff.move(wid, stepId, { statusIds: statusCsv.split(',') }), null, 2)); return; }
    if (flags.has('--all')) {
      const rows = await ff.allParked(wid, stepId);
      if (!flags.has('--confirm')) {
        console.log(JSON.stringify({ dryRun: true, wouldMove: rows.length,
          contacts: rows.map((r) => r.contactId),
          note: 'DRY RUN — re-run with --confirm to actually move these past the wait (fires the next step for each).' }, null, 2));
        return;
      }
      console.log(JSON.stringify(await ff.move(wid, stepId, { all: true }), null, 2));
      return;
    }
    throw new Error('move needs one of --contact <cid>, --status <id,id>, or --all --confirm');
  }
  throw new Error(`unknown command '${cmd}' (expected peek | move)`);
}

// Run as CLI when invoked directly. Compare via pathToFileURL so a plugin path containing
// spaces (e.g. ".../Vibe Code/...") still matches — import.meta.url percent-encodes them,
// a bare `file://${process.argv[1]}` does not, and the mismatch silently skips main().
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => { console.error(String(e.message || e)); process.exit(1); });
}
