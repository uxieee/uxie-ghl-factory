# a3 behaviour-eval drafts (not run)

Drafted 2026-11-09 by w9-agent for W9 task w9-a3 (behaviour evals for workflows, funnels and courses).
NOT RUN. These cases are offline drafts; the board does not show a3 as started.

Before a run:
- Each case needs mock responders for every tool it expects (`evals/mocks/uxie-ghl-internal-mcp/<tool>.md`), and the
  tool names must match the mocked set. The current mock set covers the Conversation AI tools only.
- `tool_used` / `tool_order` graders name real tools from mcp-internal/tool-descriptions.json.
- Run from a dereferenced copy outside the repo, per eval-harness/README.md.
- Fixtures use placeholder ids only. Addresses are *.example.test.
