#!/usr/bin/env node
// SERVER:stdio.mjs — local entry. Credentials come from a file on this machine
// (set GHL_TOK_FILE or call set_token_file); nothing is sent anywhere but GHL.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { registerTools } from './core/tools.mjs';
import { makeGateway } from './core/gateway.mjs';
import { DEFAULT_TOKEN_FILE } from './core/auth.mjs';

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

const state = { tokenFile: process.env.GHL_TOK_FILE ?? DEFAULT_TOKEN_FILE, engineVersion: pkgVersion };
const makeGw = ({ loc, rail }) => makeGateway({ tokenFile: state.tokenFile, loc, rail });

const server = new McpServer({ name: 'uxie-ghl-internal-mcp', version: pkgVersion });
registerTools(server, { state, makeGw });
await server.connect(new StdioServerTransport());
