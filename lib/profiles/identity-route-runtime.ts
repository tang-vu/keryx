import { accountSessionContext } from "../account-sessions";
import { verifyApiKey } from "../api-keys";
import { config } from "../config";
import { getDb } from "../db";
import { identityProviderConfiguration } from "./identity-flow";
import { createIdentityRoutes } from "./identity-route";

export const identityRoutes = createIdentityRoutes({ session: accountSessionContext, key: verifyApiKey, db: getDb,
  provider: provider => identityProviderConfiguration(provider, process.env), secret: config.jwtSecret });
