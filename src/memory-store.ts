// Pure, pi-independent memory store for armory-memory.
//
// Gives pi a Claude-Code-compatible, cwd-keyed memory system:
//   ~/.pi/agent/memory/<cwd-slug>/*.md
//
// Claude Code keys memory by cwd (e.g. ~/local-dev/core -> memory at
// ~/.claude/projects/-Users-rector-local-dev-core/memory/). This mirrors that
// model so CC memory imports 1:1 and muscle memory transfers.
//
// Kept free of any pi/typebox imports so it can be unit-tested standalone.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { homedir } from "node:os";

export const PI_MEMORY_ROOT = join(homedir(), ".pi", "agent", "memory");
export const CC_PROJECTS_ROOT = join(homedir(), ".claude", "projects");

/** Memoizable root override for tests. */
function root(): string {
  return process.env.ARMORY_MEMORY_ROOT || PI_MEMORY_ROOT;
}
function ccRoot(): string {
  return process.env.CC_PROJECTS_ROOT || CC_PROJECTS_ROOT;
}

export class MemoryError extends Error {}

/** Encode a filesystem path the Claude-Code way: leading dash + '/' -> '-'. */
export function toSlug(cwd: string): string {
  const clean = cwd.replace(/\/+$/, ""); // strip trailing slash
  return "-" + clean.replace(/\//g, "-");
}

/** Best-effort decode of a CC slug back to a path (for display). */
export function fromSlug(slug: string): string {
  return slug.replace(/^-+/, "/").replace(/-/g, "/");
}

/** The memory dir for a given cwd (does NOT create it). */
export function memoryDirFor(cwd: string): string {
  return join(root(), toSlug(cwd));
}

export interface MemoryFile {
  name: string; // filename, e.g. "playbook.md"
  path: string; // absolute path
  size: number; // bytes
  mtime: number; // ms epoch
}

/** List *.md memory files for a cwd, newest-first. Empty array if none / missing. */
export function listMemory(cwd: string): MemoryFile[] {
  const dir = memoryDirFor(cwd);
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((n) => n.endsWith(".md"))
    .map((name) => {
      const path = join(dir, name);
      const st = statSync(path);
      return { name, path, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime); // newest first
}

export interface InjectOptions {
  /** Max files whose FULL content is inlined (rest go in the index only). */
  inlineMax?: number;
  /** Hard cap on inlined bytes (safety against prompt bloat). */
  byteCap?: number;
  /** Cap the index length (files shown). */
  indexMax?: number;
}

const DEFAULTS: Required<InjectOptions> = {
  inlineMax: 3,
  byteCap: 4000,
  indexMax: 15,
};

/**
 * Render a compact `## Memory` block for the system prompt, mirroring how CC
 * surfaces project memory. Strategy = index + N-recent inlined, with a budget:
 * inject a compact index of all files, then inline the N newest (truncated to a
 * byte budget) so the agent starts aware of stored context without dumping the
 * whole memory dir every turn (which can be hundreds of KB). Use the `read`
 * tool for full content of older files.
 */
export function renderMemoryBlock(cwd: string, opts: InjectOptions = {}): string {
  const o = { ...DEFAULTS, ...opts };
  const files = listMemory(cwd);
  const slug = toSlug(cwd);
  if (files.length === 0) {
    return `## Memory (${slug})\n(none — no project memory yet. Add *.md to \`${memoryDirFor(cwd)}/\` or run \`/memory import\`.)\n`;
  }

  const indexLines = files.slice(0, o.indexMax).map((f) => {
    const kb = f.size > 1024 ? `${(f.size / 1024).toFixed(1)}kB` : `${f.size}B`;
    return `- ${f.name} (${kb})`;
  });
  const overflow = files.length > o.indexMax ? `\n- … +${files.length - o.indexMax} more` : "";
  const index = `## Memory (${slug}) — ${files.length} file(s)\nIndex:\n${indexLines.join("\n")}${overflow}`;

  // Inline the N newest, honoring a byte budget.
  const inline: string[] = [];
  let budget = o.byteCap;
  for (const f of files.slice(0, o.inlineMax)) {
    if (budget <= 0) break;
    let body = readFileSync(f.path, "utf8");
    // strip a leading drift-header blockquote line if present (cosmetic)
    body = body.replace(/^>\s\*\*pi copy\*\*[^\n]*\n(?:>\s[^\n]*\n)*/m, "").trim();
    if (body.length > budget) {
      body = body.slice(0, budget).replace(/\n.*$/s, "") + "\n…(truncated — use `read` for full file)";
    }
    budget -= body.length + 64; // +overhead per file
    inline.push(`### ${f.name}\n${body}`);
  }

  const hint =
    inline.length < files.length
      ? `\n(Older files above are in the index only — use the \`read\` tool to open \`${memoryDirFor(cwd)}/<file>\`.)`
      : "";
  return `${index}\n\nRecent:\n${inline.join("\n\n")}${hint}\n`;
}

// ───────────────────────────── Import (CC → Pi) ─────────────────────────────

export interface ImportResult {
  project: string; // CC slug
  piDir: string;
  files: number;
  bytes: number;
  skipped: number;
}

const DRIFT_HEADER =
  "> **pi copy** — imported from Claude Code memory by `@getpipher/armory-memory` import. " +
  "CC original is canonical until you edit here; mirror changes to CC if you still use both.\n\n";

/**
 * Import a single CC project's memory into pi (1:1, idempotent).
 * Files are COPIED (CC originals untouched) with a drift-mitigation header prepended.
 * Re-running skips files that already exist at the destination (unless --force).
 */
export function importProject(slug: string, force = false): ImportResult {
  const src = join(ccRoot(), slug, "memory");
  const dest = join(root(), slug);
  if (!existsSync(src)) {
    throw new MemoryError(`no CC memory at ${src}`);
  }
  mkdirSync(dest, { recursive: true });

  let files = 0;
  let bytes = 0;
  let skipped = 0;
  const entries = readdirSync(src).filter((n) => n.endsWith(".md"));
  for (const name of entries) {
    const destPath = join(dest, name);
    if (existsSync(destPath) && !force) {
      skipped++;
      continue;
    }
    const srcPath = join(src, name);
    const body = readFileSync(srcPath, "utf8");
    writeWithHeader(destPath, body);
    files++;
    bytes += body.length;
  }
  return { project: slug, piDir: dest, files, bytes, skipped };
}

/** Discover all CC projects that have a memory/ dir. */
export function discoverCCProjects(): string[] {
  if (!existsSync(ccRoot())) return [];
  return readdirSync(ccRoot())
    .filter((d) => existsSync(join(ccRoot(), d, "memory")))
    .filter((d) => statSync(join(ccRoot(), d, "memory")).isDirectory())
    .sort();
}

/** Import every CC project's memory into pi (idempotent). */
export function importAll(force = false): ImportResult[] {
  return discoverCCProjects().map((slug) => importProject(slug, force));
}

function writeWithHeader(destPath: string, body: string): void {
  writeFileSync(destPath, DRIFT_HEADER + body, { encoding: "utf8", mode: 0o600 });
}

export { copyFileSync }; // (kept for symmetry / potential future use)
