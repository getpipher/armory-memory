<!-- Satellite context file — extends the global hub (~/.claude/CLAUDE.md | ~/.pi/agent/AGENTS.md). Host-neutral; project-specific only. Do not duplicate hub standards here. -->

# armory-memory

> Claude-Code-compatible memory for Pi. Every session auto-loads its project's memory — plus a one-command import of your whole Claude Code memory. Zero dependencies. npm: `@getpipher/armory-memory`.

**Org context:** getpipher is the Pi coding-agent ecosystem. See the global hub for cross-repo conventions; no GitLab mirror for getpipher.

## What it solves

pi has no passive, cwd-keyed memory like Claude Code's. Files in `~/.pi/agent/memory/` are inert unless a skill explicitly reads them. `armory-memory` closes that gap: pi gets the same passive, cwd-keyed memory CC has — plus a one-command import so you bring your whole CC memory with you.

| | survives across sessions | auto-surfaced in every session | CC-importable |
|---|:---:|:---:|:---:|
| pi (before) | ❌ | ❌ | — |
| **armory-memory** | ✅ | ✅ | ✅ |

## Install

```bash
pi install npm:@getpipher/armory-memory          # from npm
pi install git:github.com/getpipher/armory-memory # from git
```

Or add to `~/.pi/agent/settings.json` `packages` array, then `/reload` or restart pi.

## Structure

```
extensions/   # pi extension (registers memory loading + /memory import command)
src/          # memory store + cwd-keying logic
test/         # memory-store tests
docs/         # design docs
```

## Common Commands

```bash
node test/memory-store.test.mts   # run tests
```

## Notes

- Zero dependencies. Memory lives under `~/.pi/agent/memory/<cwd-slug>/` (local only, never committed).
- Import path mirrors CC's `~/.claude/projects/<cwd-slug>/memory/` layout for a 1:1 migration.