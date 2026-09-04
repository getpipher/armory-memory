// Pure, pi-independent MCP call-trace persistence for armory-memory (SPEC-1b-3 D2).
//
// Traces land as JSONL INSIDE the cwd-keyed memory dir but OUTSIDE the .md
// injection surface: listMemory()/renderMemoryBlock() only touch *.md, so
// mcp-traces.jsonl never reaches a system prompt. Line shape is metadata-only —
// the serializer never reads input.args (structural exclusion, not policy).
//
// Kept free of any pi/typebox imports so it can be unit-tested standalone.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { memoryDirFor } from "./memory-store.ts";

/** Structurally mirrors gateway's TraceInput (never imported from gateway).
 *  agent/task are forward-compat: gateway doesn't populate them yet (1b-2 §15.1),
 *  and the serializer omits them while undefined. */
export interface GatewayTraceInput {
  kind: "mcp_call";
  server: string;
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  durationMs: number;
  resultSummary: string;
  ts: number;
  agent?: string;
  task?: string;
}

/** Max trace lines kept after a compact. */
export const TRACE_CAP = 500;
/** Compact triggers when the file exceeds this many lines. */
export const COMPACT_THRESHOLD = 1000;

/** The JSONL trace file for a cwd (inside the memory dir, NOT *.md). */
export function tracesFileFor(cwd: string): string {
  return join(memoryDirFor(cwd), "mcp-traces.jsonl");
}

/** Serialize one trace to a JSONL line. Metadata-only: args are structurally
 *  excluded (this function never touches input.args). */
export function traceToLine(input: GatewayTraceInput): string {
  const line: Record<string, unknown> = {
    ts: input.ts,
    server: input.server,
    tool: input.tool,
    ok: input.ok,
    durationMs: input.durationMs,
    resultSummary: input.resultSummary,
  };
  if (input.agent !== undefined) line.agent = input.agent;
  if (input.task !== undefined) line.task = input.task;
  return JSON.stringify(line);
}

/** Compact an over-threshold trace file to the newest TRACE_CAP VALID lines.
 *  Parse-per-line: torn/invalid lines (partial writes) are dropped, never fatal.
 *  O(file) by design — called from appendTrace only past the threshold check. */
export function compactTraceFile(file: string): void {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return; // nothing to compact
  }
  const lines = raw.split("\n").filter((l) => l.length > 0);
  if (lines.length <= COMPACT_THRESHOLD) return;
  const valid: string[] = [];
  for (const line of lines.slice(-TRACE_CAP)) {
    try {
      JSON.parse(line);
      valid.push(line);
    } catch {
      // torn/invalid line — drop
    }
  }
  writeFileSync(file, valid.join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
}

/** Append one trace. Creates the dir/file on miss (0600). Compact check runs
 *  per append; the read is O(file) but files are bounded (~150B/line, ≤~150KB
 *  at threshold) — negligible against MCP-call latency. Throws propagate to the
 *  pipeline's fail-open catch+warn (SPEC-1b §7.2 — the sink never swallows). */
export function appendTrace(file: string, input: GatewayTraceInput): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, traceToLine(input) + "\n", { encoding: "utf8", mode: 0o600 });
  compactTraceFile(file);
}
