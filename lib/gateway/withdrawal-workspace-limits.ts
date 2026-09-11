import { withdrawalHttpConfiguration } from "./withdrawal-http-config";

/** Server-only projection: only validated public limits can cross into React props.
 * Disabled or invalid creation configuration still permits a recovery-only page. */
export function withdrawalWorkspaceLimits(env: Parameters<typeof withdrawalHttpConfiguration>[0],
  chain: Parameters<typeof withdrawalHttpConfiguration>[1]) {
  try { return withdrawalHttpConfiguration(env, chain)?.limits ?? null; }
  catch { return null; }
}
