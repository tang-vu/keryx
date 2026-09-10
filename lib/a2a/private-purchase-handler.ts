import { accountSessionContext, sessionMutationOrigin } from "../account-sessions";
import { authJson } from "../auth-challenge";
import { readBoundedRequestJson } from "../read-bounded-request-json";
import { readyPrivatePurchaseService, type PrivatePurchaseBootstrap } from "./private-purchase-readiness";

/** HTTP boundary prepared for a future worker-ready bootstrap. No public route
 * currently mounts this handler. The limiter and service bootstrap must be supplied
 * by server code, never selected from request data. */
export function privatePurchaseHandler(options: {
  bootstrap: PrivatePurchaseBootstrap;
  limit: (wallet: string) => Promise<Response | null>;
}) {
  const { bootstrap, limit } = options;
  return async (req: Request) => {
    const context = await accountSessionContext();
    if (context instanceof Response) return context;
    const originError = sessionMutationOrigin(req);
    if (originError) return originError;
    try {
      const limited = await limit(context.wallet);
      if (limited) {
        const headers = new Headers(limited.headers); headers.set("Cache-Control", "no-store");
        return new Response(limited.body, { status: limited.status, headers });
      }
      const service = await readyPrivatePurchaseService(bootstrap, context.db, req.signal);
      if (!service) return authJson({ error: "Private checkout is not available yet." }, 503);
      let input: unknown;
      try { input = await readBoundedRequestJson(req); }
      catch { return authJson({ error: "Invalid private purchase request." }, 400); }
      if (req.signal.aborted) return authJson({ error: "Private checkout request was cancelled." }, 503);
      const result = await service.submit(input, context.wallet);
      if (result.recoveryConfirmation) {
        // Retry only evidence persistence, never verification/settlement. If storage
        // remains unavailable, the durable attempt stays pending for reconciliation.
        try { await context.db.confirmPrivatePayment(result.response.id, context.wallet, result.recoveryConfirmation); }
        catch { /* No private proof or exception is logged or returned. */ }
      }
      return authJson({ id: result.response.id, paymentStatus: result.response.paymentStatus }, 202);
    } catch {
      return authJson({ error: "Private checkout outcome unavailable. Recover the existing journal; do not resubmit payment." }, 503);
    }
  };
}
