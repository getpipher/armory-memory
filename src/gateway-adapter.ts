// Gateway adapter for armory-memory (SPEC-1b-3 D2): registers a TraceSink against
// @getpipher/armory-gateway's IoC registry. The specifier is NEVER statically
// imported — guarded dynamic import keeps public-npm installs standalone.
// Absent gateway → { registered: false }, silent (the normal public state).

import { tracesFileFor, appendTrace, type GatewayTraceInput } from "./trace-sink.ts";

export interface GatewayModuleLike {
  registerTraceSink(fn: (input: GatewayTraceInput) => Promise<void>): void;
}

export interface GatewayAdapterDeps {
  cwd: string;
  importGateway?: () => Promise<GatewayModuleLike>;
}

export async function registerGatewayTraceSink(deps: GatewayAdapterDeps): Promise<{ registered: boolean }> {
  let gw: GatewayModuleLike;
  try {
    gw = await (deps.importGateway ?? (() => import("@getpipher/armory-gateway")))();
  } catch {
    return { registered: false };
  }
  const file = tracesFileFor(deps.cwd);
  // The sink never swallows: a throw propagates to the pipeline's fail-open
  // catch+warn (SPEC-1b §7.2 — inheritance rule untouched).
  gw.registerTraceSink(async (input) => {
    await appendTrace(file, input);
  });
  return { registered: true };
}
