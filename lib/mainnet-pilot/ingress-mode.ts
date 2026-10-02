import { readRuntimeStorageDeployment } from "../db/runtime-storage-config";
import { pilotIngressDenied } from "./ingress";

/** Deployment identity chooses the domain. Host/Origin never chooses the legacy authority. */
export function deploymentIngressDenied(request: Request): boolean {
  const configured = process.env.KERYX_MAINNET_PILOT_ORIGIN;
  if (!process.env.KERYX_STORAGE_MANIFEST) return configured !== undefined;
  try {
    const deployment = readRuntimeStorageDeployment();
    if (deployment.identity.authorityMode !== "mainnet-pilot-real") return configured !== undefined;
    if (!configured) return true;
    return pilotIngressDenied(request, configured);
  } catch { return true; }
}
