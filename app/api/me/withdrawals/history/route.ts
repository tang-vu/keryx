import { accountSessionContext } from "@/lib/account-sessions";
import { createWithdrawalHistoryHandler } from "@/lib/gateway/withdrawal-history-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Private reads remain available independently of withdrawal creation and relay keys.
export const POST = createWithdrawalHistoryHandler(accountSessionContext);
