// Pure sink tests for armory-memory SPEC-1b-3 (run: node test/trace-sink.test.mts).
// Uses ARMORY_MEMORY_ROOT to avoid touching real memory.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "armory-mem-trace-"));
process.env.ARMORY_MEMORY_ROOT = join(tmp, "pi-memory");

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra = ""): void {
  if (cond) passed++;
  else { failed++; console.error(`  ✗ ${name} ${extra}`); }
}
function eq<T>(name: string, got: T, want: T): void {
  ok(name, got === want, `(got ${JSON.stringify(got)} want ${JSON.stringify(want)})`);
}

const { tracesFileFor, appendTrace, TRACE_CAP, COMPACT_THRESHOLD } =
  await import("../src/trace-sink.ts");
const { memoryDirFor } = await import("../src/memory-store.ts");

const cwd = join(tmp, "some-project");
const file = tracesFileFor(cwd);
eq("tracesFileFor lives inside the cwd-keyed memory dir", file, join(memoryDirFor(cwd), "mcp-traces.jsonl"));
ok("file extension is NOT .md (injection-surface invisible)", !file.endsWith(".md"));

const fatInput = {
  kind: "mcp_call" as const,
  server: "github",
  tool: "create_issue",
  args: { title: "SECRET TITLE", body: "SECRET BODY", api_key: "SECRET VALUE" },
  ok: true,
  durationMs: 42,
  resultSummary: "ok blocks=1 bytes=120",
  ts: 1700000000000,
};

// no file yet
appendTrace(file, fatInput);
ok("append creates the memory dir + file", existsSync(file));
eq("fresh file is 0600", statSync(file).mode & 0o777, 0o600);
const line1 = readFileSync(file, "utf8").trim();
const parsed1 = JSON.parse(line1);
eq("line has exactly the locked keys", Object.keys(parsed1).sort().join(","),
  "durationMs,ok,resultSummary,server,tool,ts");
eq("ts persisted", parsed1.ts, 1700000000000);
ok("args NEVER serialized (byte-level)", !line1.includes("SECRET"));
ok("agent/task omitted when undefined", !("agent" in parsed1) && !("task" in parsed1));

const withAgent = { ...fatInput, agent: "agent-x", task: "task-y" };
appendTrace(file, withAgent);
const parsed2 = JSON.parse(readFileSync(file, "utf8").trim().split("\n")[1]);
eq("agent persisted when present", parsed2.agent, "agent-x");
eq("task persisted when present", parsed2.task, "task-y");

// cap + compact: append past the threshold with tiny valid lines
const tiny = { ...fatInput, ts: 1 };
const filler: string[] = [];
for (let i = 0; i < COMPACT_THRESHOLD; i++) filler.push(JSON.stringify({ ts: i, marker: i }));
mkdirSync(join(file, ".."), { recursive: true });
writeFileSync(file, filler.join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
appendTrace(file, { ...tiny, ts: 999999 });
const after = readFileSync(file, "utf8").trim().split("\n");
eq("compact keeps exactly TRACE_CAP newest lines", after.length, TRACE_CAP);
eq("newest line is the appended trace", JSON.parse(after[after.length - 1]!).ts, 999999);
eq("oldest kept line is the first survivor of the cap window", JSON.parse(after[0]!).ts, COMPACT_THRESHOLD - TRACE_CAP + 1);

// torn line tolerated + dropped at compact
appendTrace(file, tiny);
writeFileSync(file, readFileSync(file, "utf8") + '{"ts": torn\n', { encoding: "utf8", mode: 0o600 });
appendTrace(file, { ...tiny, ts: 888888 });
const afterTorn = readFileSync(file, "utf8").trim().split("\n");
eq("append after torn line does not crash", afterTorn[afterTorn.length - 1]!.startsWith("{"), true);
const lastParsed = JSON.parse(afterTorn[afterTorn.length - 1]!);
eq("appended trace intact after torn line", lastParsed.ts, 888888);

// under threshold: no compact rewrite (line count grows freely up to threshold)
const smallFile = join(tmp, "small", "mcp-traces.jsonl");
appendTrace(smallFile, tiny);
appendTrace(smallFile, { ...tiny, ts: 2 });
eq("under threshold: both lines kept", readFileSync(smallFile, "utf8").trim().split("\n").length, 2);

// compact drops invalid lines (parse-per-line sweep over the kept window)
const tornBig: string[] = [];
for (let i = 0; i < COMPACT_THRESHOLD + 50; i++) tornBig.push(JSON.stringify({ ts: i, marker: i }));
tornBig[10] = '{"ts": torn'; // invalid line mid-file
writeFileSync(file, tornBig.join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
appendTrace(file, { ...tiny, ts: 777777 });
const afterTornCompact = readFileSync(file, "utf8").trim().split("\n");
eq("compact drops invalid lines", afterTornCompact.some((l) => l.includes("torn")), false);
ok("compact output is valid JSONL", afterTornCompact.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }));

console.log(`\ntrace-sink: ${passed} passed, ${failed} failed`);
rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
