import { accountSessionContext } from "@/lib/account-sessions";
import { config } from "@/lib/config";
import { createCompletedEvidenceDraftSelectionRoute } from "@/lib/research/completed-evidence-draft-selection";

export const runtime = "nodejs";
export const POST = createCompletedEvidenceDraftSelectionRoute({
  baseUrl: config.baseUrl, network: config.networkId, account: accountSessionContext,
});
