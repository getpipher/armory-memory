// src/index.d.ts — typed declaration mirroring src/index.ts (dual-condition: types→.d.ts, default→.ts).
export {
  renderMemoryBlock,
  listMemory,
  memoryDirFor,
  toSlug,
  fromSlug,
  importProject,
  importAll,
  discoverCCProjects,
  PI_MEMORY_ROOT,
  CC_PROJECTS_ROOT,
  type MemoryFile,
  type InjectOptions,
  type ImportResult,
} from "./memory-store.ts";