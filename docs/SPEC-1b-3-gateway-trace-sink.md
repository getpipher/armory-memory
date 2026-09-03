# SPEC-1b-3 — Gateway trace sink (armory-memory, PR-2 / D2 + D4 + D5)

> Relocated from the SPEC-1b-3 staging spec (`SPEC-1b-3-memory-todo-adapters.md` §2 Q2, §3.2/§3.3, §5, §7) — armory-memory's half of the memory/todo adapter slice.

## Q2 — Locked decision: metadata-only JSONL, invisible to the memory surface

File `~/.pi/agent/memory/<slug>/mcp-traces.jsonl` (non-`.md` → `listMemory`/`renderMemoryBlock` never see it). Per line: `{ts, server, tool, ok, durationMs, resultSummary, agent?, task?}` — `args` NEVER persisted (not even key names; §3.3). `resultSummary` is already content-free at the tap. Bounded: cap 500 entries, compact to newest 500 when file exceeds 1000 lines (append-fast, occasional O(file) rewrite). No new read surface.

## §3.2 — The injection surface makes trace format a prompt-hygiene choice

`renderMemoryBlock` lists all `*.md` newest-first and INLINES the 3 newest (byte-capped) into every system prompt. A `*.md` trace log would pollute every future prompt (the landmine). Non-`.md` files are invisible to `listMemory` — JSONL is outside the injection surface by construction, while remaining openable via the existing `read` tool.

## §3.3 — Memory is a permanent, auto-injected surface — args must be structurally excluded

Persisting `args` (values or key names) would leak tool-call content into a file class that surfaces in prompts indefinitely, and bloat it. The sink's line serializer simply never touches `input.args` — exclusion is structural (impossible, not policy-by-discipline), enforcing the global "never put secrets in memory" rule at the code level.

## §5 — D2: Memory trace sink (as shipped)

- `src/trace-sink.ts` — pure, pi-independent (node:fs + node:path + memory-store only; unit-tested standalone).
- `tracesFileFor(cwd)` = `memoryDirFor(cwd) + "/mcp-traces.jsonl"`.
- `traceToLine(input)`: line shape exactly Q2-A's `{ts, server, tool, ok, durationMs, resultSummary, agent?, task?}` — undefined `agent`/`task` keys omitted; `kind` dropped (constant `"mcp_call"` in v1); **`args` never read by the serializer** (§3.3). `GatewayTraceInput` is a structurally-typed LOCAL interface mirroring gateway's `TraceInput` (structural compatibility — never imported from gateway; the registry contract expects exactly this of suite-locked siblings).
- `compactTraceFile(file)`: parse-per-line over the newest TRACE_CAP lines — torn/invalid lines (partial writes) dropped, never fatal; rewrite at `0600`.
- `appendTrace(file, input)`: mkdir + append `0600`, compact check per append; **throws propagate** to the pipeline's fail-open catch+warn (SPEC-1b §7.2 — the sink never swallows).
- Constants: `TRACE_CAP = 500`, `COMPACT_THRESHOLD = 1000`.
- `src/gateway-adapter.ts` (D2 registration half): `registerGatewayTraceSink({ cwd, importGateway? })` — guarded dynamic import (specifier never statically imported), absent gateway → `{ registered: false }` silent; registered sink closes over `tracesFileFor(cwd)` and propagates throws.

## §7 — D4 + D5: Linkage & release gates (as shipped)

- **D4** — `test/helpers/gateway-link.mts`: `linkGateway(): string | null` reads `ARMORY_GATEWAY_PATH`; unset → `null` (real-module contract test `t.skip`s with a loud notice naming the env var); set → idempotent `node_modules/@getpipher/armory-gateway` symlink → bare-specifier resolution works under plain node 24. No `package.json` dependency changes (Q4-B — public repo, no `file:` devDep).
- **D5** — `.github/workflows/release.yml`: the armory-gateway clone step sits BEFORE `npm install`, and the test step exports `ARMORY_GATEWAY_PATH: ${{ github.workspace }}/../armory-gateway`. No continue-on-error — a failed clone fails the release. `SIBLINGS_PAT` is a per-repo secret on getpipher/armory-memory (RECTOR sets it; least privilege, same as fleet's).

## As-built notes

- V1/V2 proven 2026-09-03: bare-specifier symlink resolution under plain node 24, and `?dup=1` two-instance symbol-store convergence (real-module contract test passes with `ARMORY_GATEWAY_PATH` set, 3/3, no skip).
- Two controller-ratified plan-defect fixes landed in the Task 2 test suite: (1) `memoryDirFor` slugs the FULL cwd CC-style (locked by memory-store.test.mts:40) — path assertions assert via the real composition, not basename joins; (2) the torn-line fixture is newline-terminated (real torn-final-write shape) so the next append lands on its own line.
- Two deferred minors from review: (1) `compactTraceFile` skips silently on read failure (brief-verbatim "nothing to compact"; unreachable in the normal path — a `console.warn` would match repo fail-open style if wanted later); (2) `traceToLine` key order is insertion-ordered — cross-version byte-level line comparison would break on reorder (tests assert parsed keys, not bytes).
