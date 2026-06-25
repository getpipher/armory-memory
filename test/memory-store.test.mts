// Standalone store tests for armory-memory (run: node test/memory-store.test.mts).
// Uses ARMORY_MEMORY_ROOT + CC_PROJECTS_ROOT to avoid touching real memory.

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "armory-mem-"));
const piRoot = join(tmp, "pi-memory");
const ccRoot = join(tmp, "cc-projects");
process.env.ARMORY_MEMORY_ROOT = piRoot;
process.env.CC_PROJECTS_ROOT = ccRoot;

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name} ${extra}`);
  }
}
function eq<T>(name: string, got: T, want: T): void {
  ok(name, got === want, `(got ${JSON.stringify(got)} want ${JSON.stringify(want)})`);
}

// fresh import after env set
const {
  toSlug,
  fromSlug,
  memoryDirFor,
  listMemory,
  renderMemoryBlock,
  importProject,
  importAll,
  discoverCCProjects,
} = await import("../src/memory-store.ts");

// --- toSlug / fromSlug (CC-compatible encoding) ---
eq("slug encodes cwd CC-style", toSlug("/Users/x/local-dev/core"), "--Users-x-local-dev-core");
ok("fromSlug decodes to a path (lossy, display-only)", fromSlug("--Users-x-local-dev-core") === "/Users/x/local/dev/core");
eq("trailing slash stripped in slug", toSlug("/a/b/"), "--a-b");

// --- listMemory on empty ---
ok("listMemory empty when dir missing", listMemory("/nope/here").length === 0);

// --- listMemory + renderMemoryBlock on populated dir ---
const cwd1 = "/Users/r/local-dev/core";
const dir1 = memoryDirFor(cwd1);
mkdirSync(dir1, { recursive: true });
writeFileSync(join(dir1, "playbook.md"), "# Playbook\nDo the thing.\n");
writeFileSync(join(dir1, "notes.md"), "# Notes\nMisc.\n");
eq("listMemory finds 2 files", listMemory(cwd1).length, 2);
ok("listMemory returns .md only", listMemory(cwd1).every((f) => f.name.endsWith(".md")));
ok("listMemory sorted newest-first", listMemory(cwd1)[0].mtime >= listMemory(cwd1)[1].mtime);

const block = renderMemoryBlock(cwd1);
ok("render includes Memory heading", block.startsWith("## Memory"));
ok("render includes file count", block.includes("2 file(s)"));
ok("render inlines recent file content", block.includes("Do the thing."));
ok("render lists index entries", block.includes("playbook.md (") && block.includes("notes.md ("));

// --- render on empty cwd ---
const blockEmpty = renderMemoryBlock("/nope/empty");
ok("render empty has (none)", blockEmpty.includes("(none"));
ok("render empty hints at import", blockEmpty.includes("import"));

// --- byte cap (budget) truncates inlined content ---
writeFileSync(join(dir1, "huge.md"), "x".repeat(10_000));
const capped = renderMemoryBlock(cwd1, { inlineMax: 10, byteCap: 500 });
ok("byte cap truncates", capped.includes("truncated"));

// --- import from CC ---
const slug = toSlug(cwd1); // reuse slug as a fake CC project name
const ccProjectDir = join(ccRoot, slug, "memory");
mkdirSync(ccProjectDir, { recursive: true });
writeFileSync(join(ccProjectDir, "imported.md"), "# Imported\nFrom CC.\n");

const res = importProject(slug);
eq("import copies 1 file", res.files, 1);
ok("import wrote to pi dir", existsSync(join(piRoot, slug, "imported.md")));
const imported = readFileSync(join(piRoot, slug, "imported.md"), "utf8");
ok("import prepends drift header", imported.startsWith("> **pi copy**"));
ok("import body preserved", imported.includes("From CC."));

// --- import idempotent (skip existing) ---
const res2 = importProject(slug);
eq("re-import skips existing", res2.skipped, 1);
eq("re-import copies 0 new", res2.files, 0);

// --- import --force overwrites ---
const res3 = importProject(slug, true);
eq("force re-imports", res3.files, 1);

// --- discover + importAll ---
eq("discover finds the project", discoverCCProjects().length, 1);
const all = importAll(true);
eq("importAll returns 1 result", all.length, 1);
eq("importAll imported file", all[0].files, 1);

// --- import nonexistent project throws ---
try {
  importProject("-does-not-exist");
  ok("import nonexistent throws", false);
} catch {
  ok("import nonexistent throws", true);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
rmSync(tmp, { recursive: true, force: true });
