# uxieee — Claude Code plugin marketplace

This repository is a Claude Code **plugin marketplace**. The shippable plugin lives in [`plugins/uxie-ghl-factory/`](plugins/uxie-ghl-factory/); everything else here is development material that is **not** distributed to users.

## Install

```
/plugin marketplace add uxieee/ghl-plugin
/plugin install uxie-ghl-factory@uxieee
```

Then run `/uxie-ghl-factory:setup`. Full plugin docs: [`plugins/uxie-ghl-factory/README.md`](plugins/uxie-ghl-factory/README.md).

## Repository layout

| Path | Ships to users? | What it is |
|------|-----------------|------------|
| `.claude-plugin/marketplace.json` | — | The marketplace catalog (points at `./plugins/ghl`) |
| `plugins/uxie-ghl-factory/` | **yes** | The `uxie-ghl-factory` plugin: its `.claude-plugin/plugin.json`, `.mcp.json`, `skills/`, `commands/`, and operational `docs/` |
| `docs/superpowers/` | no | Design spec + implementation plans (development record) |
| `LICENSE` | — | MIT |

Only `plugins/uxie-ghl-factory/` is fetched when a user installs the plugin, so the design docs and scratch never reach an installed copy.
