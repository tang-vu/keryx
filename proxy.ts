import type { NextRequest } from "next/server";
import { config as runtimeConfig } from "./lib/config";
import { runClaimsEnabled } from "./lib/run-claims/contracts";
import { privateResearchProxy } from "./lib/run-claims/web-proxy";

export function proxy(request: NextRequest) {
  return privateResearchProxy(request, { origin: runtimeConfig.baseUrl, network: runtimeConfig.networkId },
    runtimeConfig.jwtSecret, runClaimsEnabled(process.env));
}
// Public archives, APIs, assets and every other page retain their existing policy.
export const config = { matcher: ["/research/private"] };
