# uxieee — Claude Code plugin marketplace

This repository is a Claude Code **plugin marketplace**. The shippable plugin lives in [`plugins/ghl/`](plugins/ghl/); everything else here is development material that is **not** distributed to users.

## Install

```
/plugin marketplace add uxieee/ghl-plugin
/plugin install ghl@uxieee
```

Then run `/ghl:setup`. Full plugin docs: [`plugins/ghl/README.md`](plugins/ghl/README.md).

## Repository layout

| Path | Ships to users? | What it is |
|------|-----------------|------------|
| `.claude-plugin/marketplace.json` | — | The marketplace catalog (points at `./plugins/ghl`) |
| `plugins/ghl/` | **yes** | The `ghl` plugin: its `.claude-plugin/plugin.json`, `.mcp.json`, `skills/`, `commands/`, and operational `docs/` |
| `docs/superpowers/` | no | Design spec + implementation plans (development record) |
| `LICENSE` | — | MIT |

Only `plugins/ghl/` is fetched when a user installs the plugin, so the design docs and scratch never reach an installed copy.
