# Eval harness: behaviour evals for the uxie-ghl-factory skills

`uxie-ghl-factory-eval/` is an EVAL-ONLY plugin. It loads the real skills (`skills` is a symlink to
`../../plugins/uxie-ghl-factory/skills`) and replaces the `uxie-ghl-internal-mcp` server with mocks, so
`claude plugin eval` can check what an agent DOES with a skill without any call reaching GoHighLevel.
Do not install it, and do not ship it.

The shipped plugin cannot be evaluated this way: its `.mcp.json` is empty (the server is registered per
project or per user), so an eval run of it sees no GHL tools and there is nothing to mock.

## Safety rules

1. **Never pass `--mocks off` or `--allow-real-servers`.** Leave `--mocks` at its default (`record`).
2. **`.mcp.json` never points at the real server.** Its command is `node -e "...process.exit(1)"`. The mock
   only shadows the server, so if a mock directory were missing or misnamed, the most the plugin could start
   is that stub, which exits at once.
3. **Every tool a case can reach has a responder** in `evals/mocks/uxie-ghl-internal-mcp/` (and, for the skill suite,
   `evals-skill/mocks/uxie-ghl-internal-mcp/`; every write responder there keeps the same `abort_when`). Tools without
   one are not offered to the model at all (verified below).
4. **No `Bash` or `WebFetch` in a case's `allowed_tools`.** With only Skill/Read/Glob/Grep and the mocks,
   the model has no route to the network even if it found a token.
5. Run from a directory outside `Misc/` (e.g. the scratchpad), and pass `--output-dir`, `--report` and
   `--no-publish` so results, transcripts and the HTML report stay out of this repo and off claude.ai.
6. Fixtures use placeholders only (`loc_1`, `agent_1`, `sending_number_1`, `user_1`). `node
   scripts/check-privacy.mjs` must stay clean.

## Two suites

| eval dir | tag | mocks | measures |
|---|---|---|---|
| `evals/` | `e2e` (`convai-*`) | the REAL tool descriptions and preview prose (`_tools.json` from the real `TOOLS` table) | what a user's session does end to end: tool text + skill together |
| `evals-skill/` | `skill` (`skill-convai-*`) | NEUTRAL: shapes only — one-line tool descriptions, schemas with every `description` stripped, previews with no consequence/arming/send-class prose, refusals as a bare `{"code":"REFUSED","field":…}` | what only the SKILL can supply. Graders are positive. A case is valid only if it passes on the current skills and FAILS on the pre-W5a skills (`44feaf66`); `RESULTS-2026-10-30.md` |

Both suites run against the same plugin (`uxie-ghl-factory-eval`), so tool names are the same; the skill suite is
selected with `--eval-dir evals-skill` (mocks then come from `evals-skill/mocks/`).

## Run

🔴 **Run a dereferenced copy, never the symlinked harness.** The run grants Read on the harness's `skills/**`, and a Read
through the `skills` symlink resolves outside it and is DENIED: every `references/*.md` is unreadable and the model sees
SKILL.md only (2026-10-30: a run said "I couldn't read the reference file"; the same case on a `rsync -aL` copy read
`references/outbound-and-campaigns.md`). The e2e `convai-*` scores and the first vacuity differential in
`RESULTS-2026-10-30.md` were measured that way.

```sh
cd "$SCRATCH"   # outside Misc/
rsync -aL --delete "<repo>/eval-harness/uxie-ghl-factory-eval/" "$SCRATCH/h/uxie-ghl-factory-eval/"
claude plugin eval "$SCRATCH/h/uxie-ghl-factory-eval" --ablation none --tag e2e \
  --runs 1 --max-cost-usd 2 --trust-plugin --no-publish \
  --output-dir "$SCRATCH/out" --report "$SCRATCH/report.html" --json "$SCRATCH/result.json"
# skill suite: add --eval-dir evals-skill and use --tag skill
```

Differential against older skills (how each skill case was accepted): extract them with
`git -C <repo> archive <sha> plugins/uxie-ghl-factory/skills | tar -x -C <tmp>/src`, build a second harness copy whose
`skills/` is a real copy of `<tmp>/src/plugins/uxie-ghl-factory/skills` (not a symlink) beside `.claude-plugin/`,
`.mcp.json` and `evals-skill/`, and run the same command against it.

- `--case` takes ONE glob. Repeating it keeps only the last one. Only `*` works: `convai-{a,b}` and `convai-[rs]*`
  matched nothing (2026-10-30), so run two cases as two invocations.
- **Load check at zero cost:** `--case '*' --max-cost-usd 0`. Every case file is parsed, a broken one prints a `✗ <dir>:
  invalid case.yaml: …` line and `N case file(s) failed to load`, and the ceiling stops the suite before the first run
  ($0.00). Proven both ways on 2026-10-30: the old routing-eval frontmatter printed 16 `✗` lines, the fixed one none.
  🔴 Do NOT check loading with a filter that matches nothing: "No eval cases found matching --case" is printed INSTEAD of
  the load errors, so a broken case passes that check (it hid a broken `tool_order` grader here).
- Add `--keep-temp` to inspect a run. The kept directory is `/private/tmp/e-XXXXXX/` with `config/`
  (the run's own `CLAUDE_CONFIG_DIR`), `out/trace.jsonl`, `out/mock-calls.jsonl`, and `sealed/` (the
  run's HOME and TMP, mode 000; `chmod 700` the kept dir and `sealed/` to read them; never run git there).
- `--verbose` needs the global `--debug-file`, placed BEFORE the subcommand:
  `claude --debug-file x.log plugin eval ...`. As an option of `plugin eval` it is rejected.
- `--tag e2e` / `--tag skill` select a suite (case frontmatter `tags: [...]`). A tag that matches nothing prints "No eval
  cases found", like `--case`.
- After changing which tools are mocked, regenerate the listings: `node eval-harness/scripts/gen-tools-json.mjs` writes
  both `_tools.json` files (saved tools/list responses built from the real `TOOLS` table: the real descriptions and
  input schemas for `evals/`; the neutral descriptions from its `NEUTRAL` map and the schemas with every `description`
  stripped for `evals-skill/`). It imports the table only; it never starts the server.
- `harness-abort-probe` is a self-test. Its expected result is an ABORTED run with score 0, so leave it out
  of `--threshold` runs (`--tag e2e`).
- Behaviour cases are `convai-*` (`--ablation none`). `set-up-a-missed-call-text-back` is a ROUTING case: run it on its
  own with `--ablation with-without`. Results of 2026-10-30: `RESULTS-2026-10-30.md`.

## Verified mechanics (CLI 2.1.312, pilot of 2026-10-30)

Each item below was observed in a pilot run, or comes from the CLI's own load-time error.

- **Mock directory name = the `.mcp.json` server key.** `evals/mocks/uxie-ghl-internal-mcp/` shadowed the
  plugin's `uxie-ghl-internal-mcp` (result: `mocks.servers[].kind: "shadow"`). The run started
  `claude --eval-mock-server …` instead of any server command. Session init listed exactly one MCP server,
  `plugin:uxie-ghl-factory-eval:uxie-ghl-internal-mcp`, with `source: dynamic`.
- **Tool names the model sees:** `mcp__plugin_<plugin>_<server>__<tool>`, for example
  `mcp__plugin_uxie-ghl-factory-eval_uxie-ghl-internal-mcp__update_convai_agent`. Graders must use the full
  name. The harness adds every mocked tool to `--allowed-tools` itself. They come as deferred tools that the
  model loads through ToolSearch.
- **Unmocked tools are not offered.** The model listed exactly the 7 mocked tools, and
  `mocks.calls.unmocked` stayed `[]`. No `_server.md` is needed for this.
- **Isolation:** the child runs `-p --permission-mode dontAsk --setting-sources user` with a fresh
  `CLAUDE_CONFIG_DIR`. Its `.claude.json` has no `mcpServers` and no `projects`, so the project-scoped
  real registrations are not loaded. HOME is a temp dir, and the cwd is `<temp>/home/cwd`. Read/Glob/Grep
  are granted only on the temp HOME/TMP and the harness's `.claude-plugin/**`, `skills/**` and `.mcp.json`.
  Everything else is denied under `dontAsk`, including the `.ghl/` token files. The kept `config/` and
  `out/` are denied explicitly. 🔴 A Read of a skill's `references/` file through the `skills` symlink is DENIED (it resolves outside the grant);
  run a dereferenced copy (Run, above).
  A `ps` watch over all pilot runs found no real-server process started by an eval. The one new
  `launch.mjs` in that window belonged to an interactive session opened in another terminal.
- **`expect:` (fixed `<tool>.md` responders) is a POSITIVE guard.** Each key is a dotted input path. Its
  value is a list of allowed literals, a `/regex/` (flags `i` and `s` only, no groups or lookaround), a type
  name (`string|number|bool|boolean|object|array`) or a nested map. Up to 32 guards. A MISSING key fails
  every guard, so `expect:` cannot say "absent" or "absent or false". `confirm: ["false"]` aborted a
  legitimate preview that simply omitted `confirm` (it defaults to false). A violation stops the run:
  `aborted: {server, tool, reason}` (JSON: `cases[].arms.with[i].aborted`), score 0, and NO graders are run.
- **"Abort on confirm:true or any `acknowledge`" needs an agent responder:** `type: agent` with
  `abort_when:` (plain-language condition), and the body describes the server it plays. `expect:` can stay
  on it for the literal ids. Verified both ways: the probe's `confirm:true` call aborted (`reason: "confirm
  is set to true…"`), and the real case's preview (no `confirm`) was answered. Each call costs one
  model call (observed $0.00015-0.0003, under `mocks.calls.costUsd`). A new answer is saved under `<output-dir>/mock-recordings/`. Copy it into
  `evals/mocks/.replay/uxie-ghl-internal-mcp/` (check the printed sha256) to replay it without a model call.
- **Fixed bodies template the input:** `{{input.a.b}}` (and `{{file:…}}`). A missing value renders as "".
- **Grader `type:` is REQUIRED.** There is no default: "frontmatter must include "type:" (regex | tool_order
  | tool_used | file_exists | llm | baseline)". `with-only: true` is rejected as an unknown key; the key is
  `arm: with-only` (or `both`). The 16 routing evals in `plugins/uxie-ghl-factory/evals/` failed to load for both
  reasons until 2026-10-30; they now carry `type: llm`, `arm: with-only` and `focus: trace` (the judge has to see the
  Skill call, which `last_message` does not show).
- **`tool_order`:** fields are `before` and `after` (one tool name each). `sequence:` is rejected as an unknown key.
- **`arm: with-only` under `--ablation with-without`:** the with arm scores the grader and the without arm runs with no
  plugin. The case aggregate then reports `score` (with), `scoreWithout` and `delta`.
- **`tool_used`:** fields are `tool`, `input_match` (a regex tested on the call's input JSON), `min`
  (default **1**) and `max`. To assert absence, set BOTH `min: 0` and `max: 0`. With `max: 0` alone the
  grader can never pass ("expected 1..0").
- **`regex`:** fields are `target` (`last_message` default | `trace` | `mock_calls` | `files` |
  `{source: file, path}`), `pattern`, `flags`, `match` (`contains` default | `not_contains` | `count:N`).
  `mock_calls` renders one JSON line per mocked call: `{tool, input, output, isError?, verdict}`. `trace`
  renders one JSON line per stream-json event. The event `type` values are `system` (subtypes `init` and
  `thinking_tokens`), `assistant`, `user`, `rate_limit_event` and `result`. Tool calls are
  `message.content[]` items `{type: "tool_use", id, name, input}`; results are `{type: "tool_result",
  tool_use_id, content}`.
- **`llm`:** fields are `focus` (same targets, default `last_message`) and the body as criteria. The default
  judge is haiku with 3 votes and the majority wins (`judge votes: PASS PASS PASS`).
- **`disallowed_tools` does NOT take MCP names.** The case fails to load: "MCP tools are not accepted"
  (built-in bare names only). To withhold an MCP tool, give it no responder.
- **Skills load through the symlink.** The Skill tool fired `uxie-ghl-factory-eval:ghl-conversation-ai`.
  The base dir was the symlinked path, and all 21 skills were listed under the `uxie-ghl-factory-eval:`
  prefix.
- `--runs` overrides the case's runs. The JSON still prints `runsPerCase: 3` from the case default.

## Fixtures (shared by every case)

Both mock directories serve the same fixture data (the neutral set drops only prose), so the fixture account is one location (`loc_1`) with four Conversation AI agents.
`get_ai_configuration_bundle` publishes them in the real item shape (`id, row, detail, routing, outbound, outboundArmed`);
`raw_request GET /ai-employees/employees/<id>` returns the same records.

| agent | botType | mode | llm | outbound | used by |
|---|---|---|---|---|---|
| `agent_1` Front Desk Bot | PROMPT_BASED_BOT | off | gpt-4.1 / gpt-4.1-mini | enabled config + enabled `contact_tag` trigger (armed by a mode change) | turn-bot-on, abort probe |
| `agent_2` Booking Flow | FLOW_BUILDER_BOT_V2 | auto-pilot | (graph) | none | v2-flow-edit |
| `agent_3` Sales Assistant | PROMPT_BASED_BOT | auto-pilot | gpt-4.1 / gpt-4.1-mini | enabled config, no trigger (campaign-eligible) | missed-call, reactivate, lead-form, switch-to-claude |
| `agent_4` Support Bot | PROMPT_BASED_BOT | auto-pilot | gpt-5 / gpt-5-mini | none | gpt5-retired |

`get_ai_agent_options` returns the 22-model Conversation AI roster captured on 2026-10-29 (`ui-capture-03-model-save.json`),
mapped to the tool's output shape, with gpt-5 / gpt-5-mini carrying their `deprecation {replacement, effectiveAt}`.
`update_convai_agent`, `set_convai_outbound`, `raw_request` and `create_convai_agent` are model-played: each `.md` states the
real tool's refusals (V2_KEY_REFUSED, UNSUPPORTED_TRIGGER_TYPE for the lead-form types, the bulk-messaging send class)
and preview shapes, and each aborts the run on `confirm:true` or any `acknowledge`. `build_workflow` is a fixed responder
that exists only so a case can assert it was NOT called.

## Known fidelity gaps

- The real server's instructions block (`core/instructions.mjs`) is not sent by the mock server.
- `${CLAUDE_PLUGIN_ROOT}` in a skill resolves to the harness, so `docs/…` paths the skills cite are missing.
- `raw_request` answers only the agent GET and the write previews; any other GET (e.g. the routing table) returns
  `EVAL_MOCK_NO_DATA`.
- `get_ai_agent_options` is a fixed responder: it returns the Conversation AI roster even when `product` is omitted (the
  real tool would return the workflow step's roster). The cases grade `product:"conversation_ai"` explicitly. The skill suite's
  neutral responder is model-played and answers a workflow-step roster (no Claude) unless `product` is `conversation_ai`.
- Model-played responders follow their rules closely but not byte-exactly (e.g. a computed `consequence` sentence).
