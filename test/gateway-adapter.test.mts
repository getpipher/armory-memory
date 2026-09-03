// Gateway-adapter contract tests for armory-memory SPEC-1b-3 (node:test for skip).
// Run: node test/gateway-adapter.test.mts
// Real-module tests need ARMORY_GATEWAY_PATH (private sibling; see README dev setup).

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { linkGateway } from "./helpers/gateway-link.mts";
import { memoryDirFor } from "../src/memory-store.ts";

const tmp = mkdtempSync(join(tmpdir(), "armory-mem-adapter-"));
process.env.ARMORY_MEMORY_ROOT = join(tmp, "pi-memory");
const cwd = join(tmp, "proj");

const { registerGatewayTraceSink } = await import("../src/gateway-adapter.ts");

const fatInput = {
  kind: "mcp_call" as const,
  server: "github",
  tool: "create_issue",
  args: { secret: "NEVER PERSISTED" },
  ok: true,
  durationMs: 7,
  resultSummary: "ok blocks=1 bytes=9",
  ts: 1700000000000,
};

test("injected fake module: registration fires and the sink persists a metadata-only line", async () => {
  let received: ((input: unknown) => Promise<void>) | undefined;
  const fake = { registerTraceSink(fn: (input: unknown) => Promise<void>) { received = fn; } };
  const out = await registerGatewayTraceSink({ cwd, importGateway: async () => fake });
  assert.deepEqual(out, { registered: true });
  assert.equal(typeof received, "function");
  await received!(fatInput);
  // memoryDirFor slugs the FULL cwd (CC-compatible layout — Task 2 adjudication); assert via the real composition.
  const line = JSON.parse(readFileSync(join(memoryDirFor(cwd), "mcp-traces.jsonl"), "utf8").trim());
  assert.equal(line.server, "github");
  assert.ok(!JSON.stringify(line).includes("NEVER PERSISTED"), "args never persisted");
  rmSync(tmp, { recursive: true, force: true });
});

test("import failure → { registered: false }, no throw", async () => {
  const out = await registerGatewayTraceSink({ cwd, importGateway: async () => { throw new Error("module absent"); } });
  assert.deepEqual(out, { registered: false });
});

test("REAL gateway module: registers through the shared symbol store; dup instance sees it", async (t) => {
  const gwPath = linkGateway();
  if (!gwPath) {
    t.skip("ARMORY_GATEWAY_PATH unset — skipping real-module contract tests (set it to the armory-gateway repo)");
    return;
  }
  const out = await registerGatewayTraceSink({ cwd });
  assert.deepEqual(out, { registered: true });
  const sym = Symbol.for("@getpipher/armory-gateway:registry");
  const store = (globalThis as Record<symbol, { trace?: unknown }> | undefined)![sym];
  assert.ok(store?.trace, "symbol-store trace slot truthy after registration");
  // dup-instance convergence (plan V2 pattern, re-pinned from the memory side)
  const resolved = import.meta.resolve("@getpipher/armory-gateway");
  const dup = (await import(resolved + "?dup=1")) as { registeredKinds(): { trace: boolean } };
  assert.equal(dup.registeredKinds().trace, true, "distinct module instance sees the same slot");
});
