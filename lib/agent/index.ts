/**
 * Agent public API. `runAgent` streams trace steps; `collectRun` drains the stream,
 * persists the QueryRun, and returns it (with an optional per-step callback).
 */

import type { QueryRun, TraceStep } from "../types";
import { getAgentDeps, type AgentDeps } from "./deps";
import { runAgent, type RunInput } from "./run-agent";

export { runAgent, type RunInput } from "./run-agent";
export { getAgentDeps, type AgentDeps } from "./deps";

export async function collectRun(
  input: RunInput,
  opts?: { deps?: AgentDeps; onStep?: (s: TraceStep) => void },
): Promise<QueryRun> {
  const deps = opts?.deps ?? (await getAgentDeps());
  const gen = runAgent(input, deps);
  let res = await gen.next();
  while (!res.done) {
    opts?.onStep?.(res.value);
    res = await gen.next();
  }
  const run = res.value;
  await deps.db.saveQueryRun(run);
  return run;
}
