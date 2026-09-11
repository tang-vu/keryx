import { z } from "zod";
import { readBoundedRequestJson } from "../read-bounded-request-json";
import { withdrawalIdSchema, withdrawalOwnerSchema } from "./withdrawal-request";
import { withdrawalTransferProgress, type WithdrawalProgressStore } from "./withdrawal-transfer-service";

type Context = { wallet: string; db: WithdrawalProgressStore };
type Authenticate = () => Promise<Context | Response>;
const inputSchema = z.object({ id: withdrawalIdSchema }).strict();
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: {
  "Cache-Control": "no-store", "Vary": "Cookie, Origin", "Referrer-Policy": "no-referrer",
} });

/** Server-only HTTP boundary for a future authenticated recovery route. Bind
 * authenticate to live revocable account sessions, never client-provided identity.
 * A read-only POST keeps selectors out of access-log URLs. No payment capability
 * is accepted; stored transfer evidence does not establish mint completion. */
export function createWithdrawalStatusHandler(authenticate: Authenticate) {
  return async function readStatus(req: Request): Promise<Response> {
    if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
    try {
      if (new URL(req.url).search) return json({ error: "Put the withdrawal selector in the request body." }, 400);
      const origin = req.headers.get("origin");
      if (!origin || new URL(origin).host !== req.headers.get("host")) return json({ error: "Same-origin request required." }, 403);
    } catch { return json({ error: "Invalid request origin." }, 403); }
    let context: Context | Response;
    try { context = await authenticate(); }
    catch { return json({ error: "Withdrawal status is temporarily unavailable." }, 503); }
    if (context instanceof Response) return context;
    let id: string;
    try {
      if (req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new Error();
      id = inputSchema.parse(await readBoundedRequestJson(req, 1024)).id;
    } catch { return json({ error: "Invalid withdrawal status request." }, 400); }
    try {
      const wallet = withdrawalOwnerSchema.parse(context.wallet);
      const progress = await withdrawalTransferProgress(context.db, id, wallet);
      // Revoke/account changes while reading must not release the previous owner's data.
      const fresh = await authenticate();
      if (fresh instanceof Response) return fresh;
      if (withdrawalOwnerSchema.parse(fresh.wallet) !== wallet)
        return json({ error: "Sign in again to access this withdrawal." }, 401);
      if (req.signal.aborted) return json({ error: "Withdrawal status request was cancelled." }, 408);
      return progress ? json({ wallet, ...progress, mintStatus: "not-checked" })
        : json({ error: "Withdrawal request unavailable." }, 404);
    } catch { return json({ error: "Withdrawal status is temporarily unavailable." }, 503); }
  };
}
