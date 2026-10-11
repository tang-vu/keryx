import { accountSessionContext } from "../account-sessions";
import { verifyApiKey } from "../api-keys";
import { config } from "../config";
import { getDb } from "../db";
import { runClaimBindingSchema, runClaimsEnabled } from "./contracts";
import { createRunClaimRoutes } from "./http";

// Server configuration, never proxy/request Host or a user-selected origin.
const binding = runClaimBindingSchema.safeParse({ network: config.networkId, origin: config.baseUrl });
export const runClaimHttp = createRunClaimRoutes({ enabled: runClaimsEnabled(process.env), binding: binding.success ? binding.data : null,
  session: accountSessionContext, key: verifyApiKey, db: getDb });
