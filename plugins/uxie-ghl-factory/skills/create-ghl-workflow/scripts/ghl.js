#!/usr/bin/env node
// Authenticated caller for the GHL internal workflow builder API.
//
// Env:
//   GHL_JWT  the iframe Bearer JWT (DevTools > Network > any backend.leadconnectorhq.com/workflow request > Authorization)
//   GHL_LOC  (optional) location id, for convenience when composing paths in your shell
//
// Usage:
//   GHL_JWT=eyJ... node ghl.js GET  "/workflow/$GHL_LOC/list?type=workflow&limit=5"
//   GHL_JWT=eyJ... node ghl.js POST "/workflow/$GHL_LOC/trigger" ./trigger.json
//   GHL_JWT=eyJ... node ghl.js PUT  "/workflow/$GHL_LOC/$WID/auto-save" ./autosave.json
//
// Body arg may be a file path OR an inline JSON string. Prints HTTP status (stderr) + JSON (stdout).
const fs = require('fs');

const BASE = 'https://backend.leadconnectorhq.com';
const IFRAME = 'https://client-app-automation-workflows.leadconnectorhq.com';

const [, , methodArg = 'GET', path, bodyArg] = process.argv;
const T = process.env.GHL_JWT;

if (!T) { console.error('ERROR: set GHL_JWT to the iframe Bearer JWT'); process.exit(1); }
if (!path) { console.error('Usage: node ghl.js <METHOD> <path> [bodyFileOrInlineJSON]'); process.exit(1); }

const method = methodArg.toUpperCase();
const write = method !== 'GET';
const headers = {
  Authorization: 'Bearer ' + T, // NOT token-id
  channel: 'APP',
  source: 'WEB_USER',
  version: '2021-07-28',
  accept: 'application/json, text/plain, */*',
  ...(write ? { 'content-type': 'application/json', origin: IFRAME, referer: IFRAME + '/' } : {}),
};

let body;
if (bodyArg) body = fs.existsSync(bodyArg) ? fs.readFileSync(bodyArg, 'utf8') : bodyArg;

(async () => {
  const r = await fetch(BASE + path, { method, headers, body });
  const txt = await r.text();
  console.error(`[HTTP ${r.status}]`);
  try { console.log(JSON.stringify(JSON.parse(txt), null, 2)); }
  catch { console.log(txt); }
  if (!r.ok) process.exit(1);
})();
