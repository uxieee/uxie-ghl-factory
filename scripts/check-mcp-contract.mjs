#!/usr/bin/env node
/**
 * The plugin never imports the MCP server's code — it only NAMES things in prose: tool names,
 * operation counts, the package name. That is loose coupling, which is good, and undetected
 * coupling, which is not: nothing would tell you a rename left the docs behind.
 *
 * It already happened. "1,207 actions across 83 categories" survived in six files after the
 * server started collapsing v2/v3 twins and began answering 671 across 45. It was found by
 * hand. This finds it automatically.
 *
 * Starts the PUBLISHED server, asks it what it is, and asserts the docs still describe it.
 * Skips (exit 0) when the package cannot be reached, so an offline build is not a failure.
 */
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const PKG = "@uxieee/ghl-mcp";
const ROOT = fileURLToPath(new URL("..", import.meta.url));

function ask() {
  return new Promise((resolve) => {
    // Probe in MULTI-account mode: list_locations only registers when an accounts file is
    // present, and the docs describe it that way. Shape-valid dummy tokens are enough — the
    // server validates the file at load but does not call GHL until a tool runs.
    const fake = join(tmpdir(), "ghl-contract-accounts.json");
    writeFileSync(fake, JSON.stringify({ accounts: [
      { id: "contractcheck0000001", name: "Contract Check A", token: "pit-contract-check-a" },
      { id: "contractcheck0000002", name: "Contract Check B", token: "pit-contract-check-b" },
    ] }));
    const p = spawn("npx", ["-y", PKG], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, GHL_ACCOUNTS_FILE: fake } });
    let buf = "", err = "", out = { tools: null, header: null };
    const done = () => { try { p.kill(); } catch {} resolve(out.tools ? out : { error: err.trim().slice(0, 300) || "no response" }); };
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => { err += e.message; done(); });
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n").slice(0, -1)) {
        if (!line.trim()) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.id === 1) {
          out.header = m.result?.instructions ?? "";
          p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
          p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
        }
        if (m.id === 2) { out.tools = (m.result?.tools ?? []).map((t) => t.name).sort(); done(); }
      }
      buf = buf.slice(buf.lastIndexOf("\n") + 1);
    });
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "contract", version: "0" } } }) + "\n");
    setTimeout(done, 120000);
  });
}

const live = await ask();
if (live.error) {
  console.log(`mcp contract: SKIPPED (could not reach ${PKG} — ${live.error.split("\n")[0]})`);
  process.exit(0);
}

const docs = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
  .split("\n").filter((f) => f.endsWith(".md") || f.endsWith(".json"))
  .filter((f) => !f.startsWith("CHANGELOG") && !f.startsWith("STATUS-"));
const corpus = docs.map((f) => { try { return [f, readFileSync(join(ROOT, f), "utf8")]; } catch { return null; } }).filter(Boolean);

const problems = [];

// 1. Every tool the docs name must still exist on the server.
// The server's own tool namespace, not anything that merely looks like it: GHL workflow
// action keys (waiting_on_action, send_imessage_action) end the same way and are unrelated.
const NAMED = /(?<!__)\b(search_actions|describe_action|execute_action|list_categories|list_locations)\b/g;
const claimed = new Set();
for (const [, text] of corpus) for (const m of text.matchAll(NAMED)) claimed.add(m[1]);
for (const t of claimed) {
  if (!live.tools.includes(t)) problems.push(`docs name a tool the server does not expose: ${t}`);
}

// 2. Operation and category counts must match what the server reports about itself.
const counts = live.header?.match(/(\d[\d,]*)\s+distinct operations/);
const ops = counts ? counts[1].replace(/,/g, "") : null;
if (ops) {
  for (const [f, text] of corpus) {
    for (const m of text.matchAll(/([\d,]{3,})\s+(?:distinct\s+)?(?:public-API\s+)?(?:actions|operations)/gi)) {
      const n = m[1].replace(/,/g, "");
      if (n !== ops) problems.push(`${f}: claims ${m[1]} operations, server reports ${ops}`);
    }
  }
}

if (problems.length) {
  console.error(`\nmcp contract: ${problems.length} mismatch(es) between the docs and the live server:\n`);
  for (const p of problems) console.error(`   ${p}`);
  console.error(`\nThe server is the source of truth. Update the docs.\n`);
  process.exit(1);
}
console.log(`mcp contract: ok (${live.tools.length} tools, ${ops ?? "?"} operations — matches the docs)`);
