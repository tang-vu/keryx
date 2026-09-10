import { accountSessionContext, sessionMutationOrigin } from "@/lib/account-sessions";
import { authJson } from "@/lib/auth-challenge";
import { readPrivateHistoryRequest } from "@/lib/a2a/private-result-request";
import { privateHistoryPage } from "@/lib/a2a/private-history";

export const runtime = "nodejs";
export async function POST(req: Request) {
  const context = await accountSessionContext();
  if (context instanceof Response) return context;
  const originError = sessionMutationOrigin(req);
  if (originError) return originError;
  let input;
  try { input = await readPrivateHistoryRequest(req); }
  catch { return authJson({ error: "Invalid private history request." }, 400); }
  try {
    return authJson({ wallet: context.wallet, ...await privateHistoryPage(context.db, context.wallet, input.cursor ?? undefined) });
  } catch { return authJson({ error: "Private history is temporarily unavailable. Please retry." }, 503); }
}
