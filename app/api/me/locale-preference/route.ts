import { config } from "@/lib/config";
import { createLocalePreferenceRoute, enrolledSqliteLocalePort } from "@/lib/i18n/locale-preference-route";

export const runtime = "nodejs";
const handle = createLocalePreferenceRoute({ origin: config.baseUrl, network: config.networkId,
  session: async () => (await import("@/lib/account-sessions")).accountSessionContext(),
  port: (db, access) => enrolledSqliteLocalePort(db, access, config.networkId),
});
export const GET = handle;
export const PUT = handle;
