import { accountSessionContext, sessionMutationOrigin } from "@/lib/account-sessions";
import { authJson } from "@/lib/auth-challenge";
import { readPrivateResultRequest } from "@/lib/a2a/private-result-request";
import { privateResultView } from "@/lib/a2a/private-result-view";

export const runtime = "nodejs";

/** Read-only POST avoids putting private job identifiers in access-log URLs. */
export async function POST(req: Request) {
  const context = await accountSessionContext();
  if (context instanceof Response) return context;
  const originError = sessionMutationOrigin(req);
  if (originError) return originError;
  let input;
  try { input = await readPrivateResultRequest(req); }
  catch { return authJson({ error: "Invalid private job request." }, 400); }
  try {
    const result = await privateResultView(context.db, input.id, context.wallet);
    return result ? authJson(result) : authJson({ error: "Private job unavailable." }, 404);
  } catch { return authJson({ error: "Private job is temporarily unavailable. Please retry." }, 503); }
}
