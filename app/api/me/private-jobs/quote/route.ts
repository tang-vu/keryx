import { accountSessionContext, sessionMutationOrigin } from "@/lib/account-sessions";
import { authJson } from "@/lib/auth-challenge";
import { readPrivateQuoteRequest } from "@/lib/a2a/private-result-request";
import { privateQuoteBootstrap } from "@/lib/a2a/private-quote-bootstrap";

export const runtime = "nodejs";
export async function POST(req: Request) {
  const context = await accountSessionContext();
  if (context instanceof Response) return context;
  const originError = sessionMutationOrigin(req);
  if (originError) return originError;
  let input;
  try { input = await readPrivateQuoteRequest(req); }
  catch { return authJson({ error: "Invalid private quote request." }, 400); }
  try {
    const service = privateQuoteBootstrap(context.db);
    if (!service) return authJson({ error: "Private research quotes are not available yet." }, 503);
    return authJson({ wallet: context.wallet, purchasingAvailable: false, quote: service.quote(input) });
  } catch { return authJson({ error: "Private research quotes are temporarily unavailable." }, 503); }
}
