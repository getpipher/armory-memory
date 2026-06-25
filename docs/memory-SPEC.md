# armory-memory — Design Spec

## Problem

Claude Code gives every session **automatic memory**: a session run at a cwd
passively loads that project's `~/.claude/projects/<cwd-slug>/memory/` into its
context — no skill invoked, nothing to remember. pi has **no equivalent**: files
in `~/.pi/agent/memory/` are inert unless a skill explicitly reads them. So a
CC→Pi migrant loses their memory entirely, and even hand-written pi memory is
invisible until wired up per-skill.

## Solution

`@getpipher/armory-memory` is a pi extension that gives pi a Claude-Code-
compatible, **cwd-keyed** memory system, with one-command CC import.

### Two capabilities

1. **Auto-injection** — on `before_agent_start`, inject the current cwd's memory
   into the system prompt as a `## Memory` block (mirrors CC's passive model).
2. **Import** — `/memory import` copies `~/.claude/projects/<slug>/memory/` →
   `~/.pi/agent/memory/<slug>/` 1:1, idempotent, with a drift-mitigation header.

## Memory model: cwd-keyed (CC drop-in)

```
~/.pi/agent/memory/
  -Users-rector-local-dev-core/        ← cwd = ~/local-dev/core
    playbook.md
    notes.md
  -Users-rector-local-dev-sip-protocol/ ← cwd = ~/local-dev/sip-protocol
    architecture.md
```

**Why cwd-keyed (not named-context):** CC keys by cwd. Mirroring that means:
- CC memory imports 1:1 (pure file copy, no restructuring).
- Muscle memory transfers ("the memory for this repo").
- The cwd → slug encoding is CC's exact scheme (`path` → `-path`, `/` → `-`).

This is the design decision that makes the package a true CC drop-in.

## Injection budget (critical)

Naively inlining the whole memory dir every turn would bloat every prompt (a
rich project's memory can be hundreds of KB). The injection is **budget-aware**:

- Inject a compact **index** of all files (name + size), capped at `indexMax`.
- Inline the **N newest** files' content (default 3), truncated to a `byteCap`
  (default 4 KB).
- Older files appear in the index only; the agent uses the `read` tool for them.

This mirrors CC's surfacing (recent + summary) while keeping the prompt lean.

## API surface

- **`before_agent_start` hook** — passive, runs every turn, injects `## Memory`.
- **`memory` tool** — model-callable; `list` the current cwd's memory.
- **`/memory` command** — human: `list` · `import [--force] [slug|all]` · `path`.

## Drift handling (two sources during migration)

CC originals are copied (not moved) so both hosts work simultaneously. Each
imported file gets a header: CC is canonical until edited in pi; mirror changes
back to CC if using both. Low-tech, matches how `armory-todo`/strategy-rename
handled transitions. The header is stripped from injected content (cosmetic).

## Decisions deferred (out of v0.1)

- Memory **writes** (auto-capture like CC's auto-memory) — v0.1 is read/import
  only; writes stay skill-driven (the migrant's existing workflows).
- Token-budget auto-tuning — v0.1 uses fixed defaults with env overrides.
- Bi-directional sync — v0.1 is import-once; live sync is a future feature.
