#!/usr/bin/env node
// PROBE 18 (2026-08-31) — end-to-end AI-rail renewal, using the REAL Firebase key found on the
// wire by probe 17 (probe 16 failed because GHL's own `apiKey` field is NOT the Firebase key).
//   ONE refresh -> {token: firebase custom token, authToken: bearer}
//   -> identitytoolkit:signInWithCustomToken with the real key -> idToken  == the `token-id`
// Writes BOTH renewed credentials to the token file (the actual production action) after backing
// the file up, so an MCP AI-rail tool can prove it for real. Restores on failure.
// Values never printed.
import { readFileSync, writeFileSync, copyFileSync, chmodSync } from 'node:fs';
const TOKFILE='/Volumes/Xander SSD/Vibe Code/Misc/.ghl/uxie-ghl-internal-mcp-tok.txt';
const BACKUP=TOKFILE+'.probe18-backup';
const REFRESH='https://backend.leadconnectorhq.com/oauth/2/login/current';
const FIREBASE_KEY='AIzaSyB_w3vXmsI7WeQtrIOkjR6xTRVN5uOieiE'; // public client-side value, observed on the wire
const dec=(j)=>{try{return JSON.parse(Buffer.from(j.split('.')[1],'base64url').toString());}catch{return null;}};
const raw=readFileSync(TOKFILE,'utf8');
const BEARER=(raw.match(/Bearer\s+(ey[A-Za-z0-9._-]+)/i)||[])[1];
const OLD_TID=(raw.match(/token-id:\s*(\S+)/i)||[])[1];
const oc=dec(OLD_TID);
console.log(`current file: bearer ttl=${Math.round((dec(BEARER).exp-Date.now()/1000)/60)}min, token-id ttl=${Math.round((oc.exp-Date.now()/1000)/60)}min`);
console.log(`current token-id: iss=${oc.iss} aud=${oc.aud} scope=${oc.scope??'?'} role=${oc.role??'?'}`);

console.log('\n=== ONE refresh -> firebase custom token + bearer ===');
const body=await (await fetch(REFRESH,{headers:{authorization:`Bearer ${BEARER}`,channel:'APP',source:'WEB_USER',version:'2021-07-28',accept:'application/json'}})).json();
console.log(`  authToken ttl=${Math.round((dec(body.authToken).exp-Date.now()/1000)/60)}min, custom token present=${!!body.token}`);

console.log('\n=== exchange the custom token with the REAL firebase key ===');
const ex=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_KEY}`,
 {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:body.token,returnSecureToken:true})});
const ej=await ex.json().catch(()=>null);
console.log(`  HTTP ${ex.status}`);
if(ex.status!==200||!ej?.idToken){ console.log(`  error: ${ej?.error?.message??'(none)'}`); console.log('\n>>> AI rail NOT renewable this way. File untouched.'); process.exit(0); }
const NEW_TID=ej.idToken, nc=dec(NEW_TID);
console.log(`  MINTED idToken: expiresIn=${ej.expiresIn}s ttl=${Math.round((nc.exp-Date.now()/1000)/60)}min`);
console.log(`  claims match? iss=${nc.iss===oc.iss} aud=${nc.aud===oc.aud} sub=${nc.sub===oc.sub} scope=${nc.scope===oc.scope} role=${nc.role===oc.role}`);
console.log(`  (new scope=${nc.scope??'?'} role=${nc.role??'?'})`);

console.log('\n=== write BOTH renewed credentials to the token file (backed up first) ===');
copyFileSync(TOKFILE,BACKUP);
writeFileSync(TOKFILE,`Bearer ${body.authToken}\ntoken-id: ${NEW_TID}\n`,{mode:0o600});
chmodSync(TOKFILE,0o600);
console.log(`  backup -> ${BACKUP}`);
console.log('  wrote refreshed bearer + refreshed token-id (0600).');
console.log('\nNEXT: an MCP AI-rail tool call proves it end to end. If that fails, restore with:');
console.log(`  cp "${BACKUP}" "${TOKFILE}"`);
