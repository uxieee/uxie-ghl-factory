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

const HERE = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(HERE, 'package.json'), 'utf8'));

const state = { tokenFile: process.env.GHL_TOK_FILE ?? null, engineVersion: pkg.version };
const makeGw = ({ loc, rail }) => makeGateway({ tokenFile: state.tokenFile, loc, rail });

const server = new McpServer({ name: 'ghl-internal', version: pkg.version });
registerTools(server, { state, makeGw });
await server.connect(new StdioServerTransport());
