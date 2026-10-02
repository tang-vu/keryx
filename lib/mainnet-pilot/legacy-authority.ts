import { readRuntimeStorageDeployment } from "../db/runtime-storage-config";

/** CLI, stdio MCP and background callers share this guard before legacy DB/wallet initialization. */
export function assertLegacyRuntimeAuthority(): void {
  if (process.env.KERYX_MAINNET_PILOT_ORIGIN !== undefined) throw new Error("Legacy authority unavailable on pilot deployment");
  if (process.env.KERYX_STORAGE_MANIFEST && readRuntimeStorageDeployment().identity.authorityMode === "mainnet-pilot-real")
    throw new Error("Legacy authority unavailable on pilot deployment");
}
