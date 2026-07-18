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

// A GHL client bound to one location + token. Pure-ish: all I/O funnels through fetch.
export function makeFF({ loc, tok = readToken() }) {
  const uid = uidFrom(tok);
  const call = async (method, path, body) => {
    const r = await fetch(BASE + path, {
      method, headers: headers(tok, method !== 'GET'), body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 200)}`);
    try { return JSON.parse(text); } catch { return text; }
  };

  // Where is everyone right now? → [{ total, currentStepId }]
  const countPerStep = (wid) =>
    call('GET', `/workflows/status/search/count-per-step?workflowId=${wid}&locationId=${loc}`);

  // Who is parked at one step? → { totalCount, rows:[{ _id (=statusId), contactId, currentStepId, executeOn }] }
  const parkedAt = (wid, stepId, { skip = 0, limit = 50 } = {}) =>
    call('GET', `/workflows/status/search/details-by-step?workflowId=${wid}&locationId=${loc}`
      + `&skip=${skip}&limit=${limit}&currentStepId=${stepId}&showTotalCount=true`);

  // Page through EVERY parked enrollment at a step (details-by-step caps the page size).
  const allParked = async (wid, stepId, { pageSize = 50 } = {}) => {
    const rows = [];
    for (let skip = 0; ; skip += pageSize) {
      const d = await parkedAt(wid, stepId, { skip, limit: pageSize });
      const batch = d.rows || [];
      rows.push(...batch);
      const total = d.totalCount ?? rows.length;
      if (batch.length < pageSize || rows.length >= total) break;
    }
    return rows;
  };

  // THE move. statusIds are the `_id`s from parkedAt — NOT contactIds.
  const moveToNextStep = (wid, stepId, statusIds) =>
    call('POST', `/workflow/${loc}/${wid}/requeue-stuck-statuses/${stepId}`, {
      actionFrom: { userId: uid, channel: 'web_app', source: 'action_stats_page' },
      statusIds,
    });

  // Resolve the status ULIDs to move for a step, then move them. `select` is one of:
  //   { contactId }        → move the parked enrollment(s) for that one contact
  //   { statusIds: [...] } → move exactly these workflow-status ULIDs
  //   { all: true }        → move EVERY parked contact at the step (paginated)
  async function move(wid, stepId, select) {
    let ids;
    if (select.statusIds) {
      ids = select.statusIds;
    } else if (select.contactId) {
      const rows = await allParked(wid, stepId);
      ids = rows.filter((r) => r.contactId === select.contactId).map((r) => r._id);
    } else if (select.all) {
      ids = (await allParked(wid, stepId)).map((r) => r._id);
    } else {
      throw new Error('move needs one of: { contactId }, { statusIds }, { all:true }');
    }
    if (!ids.length) return { moved: 0, note: 'nobody parked matched at that step', statusIds: [] };
    const res = await moveToNextStep(wid, stepId, ids);
    return { moved: ids.length, statusIds: ids, res };
  }

  return { loc, uid, countPerStep, parkedAt, allParked, moveToNextStep, move };
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
  const ff = makeFF({ loc });

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

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((e) => { console.error(String(e.message || e)); process.exit(1); });
}
