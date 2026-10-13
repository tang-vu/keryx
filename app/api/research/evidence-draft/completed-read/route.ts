import { accountSessionContext } from "@/lib/account-sessions";
import { config } from "@/lib/config";
import { createCompletedEvidenceDraftRoute } from "@/lib/research/completed-evidence-draft-route";

export const runtime = "nodejs";
/** Private selectors belong only in this bounded authenticated POST body. */
export const POST = createCompletedEvidenceDraftRoute({ baseUrl: config.baseUrl, network: config.networkId, account: accountSessionContext });
