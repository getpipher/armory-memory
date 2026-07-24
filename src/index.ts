// src/index.ts — public stable surface for @getpipher/armory-memory.
// src/memory-store.ts remains the implementation; this file is the typed seam
// consumers (e.g. @getpipher/armory-fleet) depend on.
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