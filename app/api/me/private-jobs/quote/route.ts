import { accountSessionContext, sessionMutationOrigin } from "@/lib/account-sessions";
import { authJson } from "@/lib/auth-challenge";
import { readPrivateQuoteRequest } from "@/lib/a2a/private-result-request";
import { privateQuoteBootstrap } from "@/lib/a2a/private-quote-bootstrap";
import { privatePurchaseBootstrap } from "@/lib/a2a/private-purchase-bootstrap";
import { readyPrivatePurchaseService } from "@/lib/a2a/private-purchase-readiness";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const context = await accountSessionContext();
  if (context instanceof Response) return context;
  const originError = sessionMutationOrigin(req);
  if (originError) return originError;
  const limited = await checkRateLimit(`private-quote:${context.wallet}`, "ask");
  if (limited) {
    limited.headers.set("Cache-Control", "no-store"); return limited;
  }
  let input;
  try { input = await readPrivateQuoteRequest(req); }
  catch { return authJson({ error: "Invalid private quote request." }, 400); }
  try {
    const purchase = await readyPrivatePurchaseService(privatePurchaseBootstrap, context.db, req.signal, context.wallet);
    const service = purchase ?? privateQuoteBootstrap(context.db);
    if (!service) return authJson({ error: "Private research quotes are not available yet." }, 503);
    const current = await accountSessionContext();
    if (current instanceof Response) return current;
    if (current.wallet !== context.wallet || current.currentId !== context.currentId)
      return authJson({ error: "Sign in again before requesting a private quote." }, 401);
    if (req.signal.aborted) return authJson({ error: "Private quote request was cancelled." }, 503);
    return authJson({ wallet: context.wallet, purchasingAvailable: purchase !== null, quote: service.quote(input) });
  } catch { return authJson({ error: "Private research quotes are temporarily unavailable." }, 503); }
}
