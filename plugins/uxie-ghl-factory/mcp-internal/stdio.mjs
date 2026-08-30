#!/usr/bin/env node
// SERVER:stdio.mjs — local entry. Credentials come from a file on this machine
// (set GHL_INTERNAL_TOK_FILE or call set_token_file); nothing is sent anywhere but GHL.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { makeGatewayFactory, registerTools } from './core/tools.mjs';
import { FULL_INSTRUCTIONS } from './core/instructions.mjs';
import { DEFAULT_TOKEN_FILE } from './core/auth.mjs';
import { parseAllowedLocations } from './core/location-binding.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// The version is injected at bundle time via esbuild --define (see scripts/build.mjs).
// The un-bundled dev entry has a sibling package.json to read; the bundle (dist/server.mjs)
// does NOT, so the fs read must never be reached there — the typeof guard ensures that.
const pkgVersion = typeof __MCP_VERSION__ !== 'undefined'
  ? __MCP_VERSION__
  : (() => {
      try { return JSON.parse(readFileSync(resolve(HERE, 'package.json'), 'utf8')).version; }
      catch { return '0.0.0-dev'; }
    })();

// Hard rename (0.43.0): GHL_TOK_FILE -> GHL_INTERNAL_TOK_FILE, GHL_LOCATIONS ->
// GHL_INTERNAL_LOCATIONS. Only the NEW names are ever read as values. GHL_TOK_FILE's presence
// is checked (never its value) so a registration still setting only the old name is refused
// loudly by readCredentials() instead of silently falling back to DEFAULT_TOKEN_FILE — see
// core/auth.mjs.
const state = {
  tokenFile: process.env.GHL_INTERNAL_TOK_FILE ?? DEFAULT_TOKEN_FILE,
  legacyTokenFileEnv: Boolean(process.env.GHL_TOK_FILE) && !process.env.GHL_INTERNAL_TOK_FILE,
  engineVersion: pkgVersion,
  allowedLocations: parseAllowedLocations(process.env.GHL_INTERNAL_LOCATIONS),
};
// Forwards EVERY option a tool passes. The previous `({ loc, rail }) => …` destructure
// dropped the audit tools' `throttleMs: 0, jitterMs: 0`, so the gateway kept its own
// 300-450ms delay while the shared audit limiter paced on top of it — the double-throttle
// the Task 2 carry-forward warns about, with the tool's own comment asserting the opposite.
const makeGw = makeGatewayFactory({ state });

// Instructions ride the initialize result, not tools/list.
const server = new McpServer({ name: 'uxie-ghl-internal-mcp', version: pkgVersion }, { instructions: FULL_INSTRUCTIONS });
registerTools(server, { state, makeGw });
await server.connect(new StdioServerTransport());
