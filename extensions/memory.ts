/**
 * armory-memory — Claude-Code-compatible memory for pi.
 *
 * Claude Code auto-injects a project's memory (`~/.claude/projects/<cwd-slug>/memory/`)
 * into every session at that cwd. pi has no such mechanism — files in
 * ~/.pi/agent/memory/ are inert unless a skill reads them. This extension gives
 * pi that capability: a `before_agent_start` hook injects the current cwd's
 * memory into the system prompt, exactly like CC does.
 *
 * Plus a one-command import so CC→Pi migrants bring their memory with them.
 *
 * Surface: auto-injection (passive), `memory` tool (list/read), `/mem` slash
 * command (import + list + path; named /mem to avoid omp's native /memory). See docs/memory-SPEC.md for the design.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  renderMemoryBlock,
  listMemory,
  importProject,
  importAll,
  discoverCCProjects,
  memoryDirFor,
  toSlug,
  type ImportResult,
} from "../src/memory-store";

function fmtImport(r: ImportResult): string {
  const s = r.skipped ? `, ${r.skipped} skipped (exists)` : "";
  return `  ${r.project}: ${r.files} imported${s}`;
}

export default function (pi: ExtensionAPI) {
  // ── Auto-inject the cwd's memory (the CC model), per host contract.
  //
  // pi: the before_agent_start event carries cwd + the live systemPrompt, and
  // a returned {systemPrompt} is honored → append the block every turn (the
  // prompt is rebuilt per request, so this never bloats the transcript).
  //
  // omp: the legacy event carries no cwd/prompt, and a {systemPrompt} return
  // REPLACES the host prompt entirely (verified — persona loss). omp's own
  // contract is {message}: a hidden persisted context message. Inject once per
  // session (persisted — per-turn repeats would duplicate in the transcript)
  // and stay quiet on projects without memory.
  let injectedThisSession = false;
  pi.on("before_agent_start", async (event: any) => {
    try {
      const cwd: string | undefined =
        event?.systemPromptOptions?.cwd ?? event?.cwd;
      if (cwd) {
        const block = renderMemoryBlock(cwd);
        const base = (event?.systemPrompt as string | undefined) ?? "";
        return { systemPrompt: base + "\n\n" + block };
      }
      if (injectedThisSession) return undefined;
      injectedThisSession = true;
      if (listMemory(process.cwd()).length === 0) return undefined;
      return {
        message: {
          customType: "armory-memory",
          content: renderMemoryBlock(process.cwd()),
          display: false,
          attribution: "agent",
        },
      };
    } catch {
      return undefined; // never crash the session
    }
  });

  // ── Model-callable tool: inspect memory for the current cwd.
  pi.registerTool({
    name: "memory",
    label: "Memory",
    description:
      "Project memory for the current working directory (Claude-Code-compatible, cwd-keyed, " +
      "auto-injected each turn). Use to list/read the cwd's memory files. " +
      "Import from Claude Code via /mem import. Never put secrets in memory — " +
      "the text reaches the model provider.",
    promptSnippet: "Read the current project's cross-session memory",
    promptGuidelines: [
      "Use memory (action:'list') to list the current cwd's memory files.",
      "Project memory is also auto-injected into your context each turn (## Memory block).",
    ],
    parameters: Type.Object({
      action: Type.Optional(Type.Literal("list")),
    }),
    async execute(_toolCallId, _params, ctx: any) {
      try {
        const cwd = ctx?.cwd ?? process.cwd();
        const files = listMemory(cwd);
        if (files.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No memory for ${cwd} yet. Add *.md to ${memoryDirFor(cwd)}/ or run /mem import.`,
              },
            ],
          };
        }
        const out = files
          .map((f) => `${f.name} (${f.size}B, ${new Date(f.mtime).toISOString().slice(0, 10)})`)
          .join("\n");
        return {
          content: [
            { type: "text" as const, text: `Memory for ${cwd} (${toSlug(cwd)}):\n${out}` },
          ],
        };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }] };
      }
    },
  });

  // ── Human slash command: /mem [import [--force] [slug]|all|list|path]
  pi.registerCommand("mem", {
    description:
      "Project memory. /mem · /mem list · /mem import [--force] [slug|all] · /mem path",
    handler: async (args, ctx) => {
      const a = (args ?? "").trim();
      const [sub, ...rest] = a.split(/\s+/);
      const cwd = ctx?.cwd ?? process.cwd();
      try {
        if (sub === "path") {
          if (ctx.hasUI) ctx.ui.notify(`memory dir: ${memoryDirFor(cwd)}`, "info");
          return;
        }
        if (sub === "list") {
          const files = listMemory(cwd);
          const msg = files.length
            ? files.map((f) => `  ${f.name} (${f.size}B)`).join("\n")
            : `(no memory for ${cwd})`;
          if (ctx.hasUI) ctx.ui.notify(msg, "info");
          return;
        }
        if (sub === "import") {
          const force = rest.includes("--force");
          const targets = rest.filter((x) => x !== "--force");
          let results: ImportResult[];
          if (targets.length === 0 || targets[0] === "all") {
            const projects = discoverCCProjects();
            if (projects.length === 0) {
              if (ctx.hasUI)
                ctx.ui.notify(
                  "No Claude Code projects found at ~/.claude/projects/ — nothing to import.",
                  "warning",
                );
              return;
            }
            results = importAll(force);
          } else {
            results = targets.map((s) => importProject(s, force));
          }
          const total = results.reduce((acc, r) => {
            acc.files += r.files;
            acc.skipped += r.skipped;
            return acc;
          }, { files: 0, skipped: 0 });
          const summary =
            `Imported ${total.files} file(s)${total.skipped ? `, ${total.skipped} skipped` : ""}.\n` +
            results.map(fmtImport).join("\n");
          if (ctx.hasUI) ctx.ui.notify(summary, "info");
          return;
        }
        // default: list
        const files = listMemory(cwd);
        const msg = files.length
          ? files.map((f) => `  ${f.name} (${f.size}B)`).join("\n")
          : `(no memory for ${cwd} — run /mem import to bring in Claude Code memory)`;
        if (ctx.hasUI) ctx.ui.notify(msg, "info");
      } catch (err) {
        if (ctx.hasUI) ctx.ui.notify(`memory error: ${(err as Error).message}`, "warning");
      }
    },
  });

  // SPEC-1b-3: register the gateway trace sink (silent skip when
  // @getpipher/armory-gateway is absent — standalone memory unchanged).
  pi.on("session_start", async (_event, ctx) => {
    try {
      const cwd = (ctx as { cwd?: string } | undefined)?.cwd ?? process.cwd();
      const { registerGatewayTraceSink } = await import("../src/gateway-adapter.ts");
      await registerGatewayTraceSink({ cwd });
    } catch {
      // gateway absent — standalone degradation
    }
  });
}
