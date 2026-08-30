#!/usr/bin/env node
// SERVER:stdio-audit.mjs — the structurally read-only entry point.
//
// A SEPARATE entry with a SEPARATE registry, not a flag on the full server. The profile is
// selected once, from a literal, with no environment or argv input: an audit run's whole
// claim is that the process it spoke to could not have written to the account, and a switch
// that could widen the registry at boot would make that claim unverifiable from the outside.
//
// Credentials still come from a file on this machine and nothing is sent anywhere but GHL.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { makeGatewayFactory, processAuditPacing, registerTools } from './core/tools.mjs';
import { toolsForProfile } from './core/audit-profile.mjs';
import { AUDIT_INSTRUCTIONS } from './core/instructions.mjs';
import { readOnlyGateway } from './core/audit-readonly.mjs';
import { makeGateway } from './core/gateway.mjs';
import { DEFAULT_TOKEN_FILE } from './core/auth.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Injected at bundle time via esbuild --define. The bundle has no sibling package.json, so
// the typeof guard keeps the fs read unreachable there.
const pkgVersion = typeof __MCP_VERSION__ !== 'undefined'
  ? __MCP_VERSION__
  : (() => {
      try { return JSON.parse(readFileSync(resolve(HERE, 'package.json'), 'utf8')).version; }
      catch { return '0.0.0-dev'; }
    })();

// Hard rename (0.43.0): GHL_TOK_FILE -> GHL_INTERNAL_TOK_FILE. Only the NEW name is ever read
// as a value. GHL_TOK_FILE's presence is checked (never its value) so a registration still
// setting only the old name is refused loudly by readCredentials() instead of silently falling
// back to DEFAULT_TOKEN_FILE — see core/auth.mjs. Reading the old name's presence here does not
// widen this profile: which tools this entry registers is still selected exactly once, from the
// literal 'audit', below.
const state = {
  tokenFile: process.env.GHL_INTERNAL_TOK_FILE ?? DEFAULT_TOKEN_FILE,
  legacyTokenFileEnv: Boolean(process.env.GHL_TOK_FILE) && !process.env.GHL_INTERNAL_TOK_FILE,
  engineVersion: pkgVersion,
};

// ONE limiter and ONE circuit for the whole process, handed to every composite. Per-call
// pacing would let N surfaces each pace politely while the ACCOUNT sees N times the rate,
// and a per-call circuit would forget a 429 before the next read — which is exactly how a
// throttled run turns into a run that re-hammers the location that just throttled it.
const { limiter, circuit } = processAuditPacing();

// The spreading factory, deliberately: a destructuring lambda here silently dropped the
// composites' `throttleMs: 0, jitterMs: 0` and double-throttled every audit read, while the
// shared limiter was already doing the pacing.
//
// Every gateway is wrapped so only a GET to an approved audit origin can leave this process.
// That is a SECOND lock, independent of the registry filter above: the bundle still contains
// the write handlers as unreachable code, so a filter that published one of them by mistake
// would otherwise have nothing beneath it.
const makeGw = makeGatewayFactory({
  state,
  gatewayImpl: (options) => readOnlyGateway(makeGateway(options)),
});

// Its OWN instructions, not the full profile's: this server exposes no raw_request, and telling
// an agent to prefer a typed tool over a hatch that is not here would be noise at best.
const server = new McpServer({ name: 'uxie-ghl-internal-mcp-audit', version: pkgVersion }, { instructions: AUDIT_INSTRUCTIONS });
registerTools(
  server,
  { state, makeGw, auditLimiter: limiter, auditCircuit: circuit },
  toolsForProfile('audit'),
);
await server.connect(new StdioServerTransport());
