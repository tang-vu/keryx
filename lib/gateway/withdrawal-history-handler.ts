import { z } from "zod";
import type { KeryxDB } from "../db/keryx-db";
import { readBoundedRequestJson } from "../read-bounded-request-json";
import { withdrawalHistoryCursorSchema, withdrawalHistoryPageSchema } from "./withdrawal-history-types";
import { withdrawalOwnerSchema } from "./withdrawal-request";
import { checkWithdrawalRateLimit } from "./withdrawal-rate-limit";

type Context = { wallet: string; currentId: string; db: Pick<KeryxDB, "listCreatorWithdrawalHistory" | "consumeRateLimit"> };
type Authenticate = () => Promise<Context | Response>;
const bodySchema = z.object({ cursor: withdrawalHistoryCursorSchema.optional() }).strict();
const sessionId = z.string().regex(/^[a-f0-9]{64}$/);
function privateResponse(response: Response) {
  response.headers.set("Cache-Control", "no-store"); response.headers.set("Vary", "Cookie, Origin");
  response.headers.set("Referrer-Policy", "no-referrer"); return response;
}
const json = (body: unknown, status = 200) => privateResponse(Response.json(body, { status }));

/** Bind to live revocable account sessions. No signing or settlement capability.
 * Caller identity and private keyset cursor are never accepted in a request URL. */
export function createWithdrawalHistoryHandler(authenticate: Authenticate) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return privateResponse(new Response(null, { status: 405, headers: { Allow: "POST" } }));
    if (request.signal.aborted) return json({ error: "History request was cancelled." }, 408);
    try {
      if (new URL(request.url).search) return json({ error: "Put the history cursor in the request body." }, 400);
      const value = request.headers.get("origin"), origin = value && new URL(value);
      if (!origin || !["http:", "https:"].includes(origin.protocol) || origin.origin !== value
        || origin.host !== request.headers.get("host")) return json({ error: "Same-origin request required." }, 403);
    } catch { return json({ error: "Invalid request origin." }, 403); }
    try {
      const context = await authenticate();
      if (context instanceof Response) return privateResponse(context);
      const wallet = withdrawalOwnerSchema.parse(context.wallet), originalSession = sessionId.parse(context.currentId);
      const limited = await checkWithdrawalRateLimit(context.db, wallet, "history");
      if (limited) return privateResponse(limited);
      let body: z.infer<typeof bodySchema>;
      try {
        if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new Error();
        body = bodySchema.parse(await readBoundedRequestJson(request, 1024));
      } catch { return json({ error: "Invalid history request." }, 400); }
      if (request.signal.aborted) return json({ error: "History request was cancelled." }, 408);
      const page = withdrawalHistoryPageSchema.parse(await context.db.listCreatorWithdrawalHistory(wallet, body.cursor, 25));
      if (page.requests.some(row => row.owner !== wallet) || new Set(page.requests.map(row => row.id)).size !== page.requests.length) throw new Error();
      const last = page.requests.at(-1);
      if (page.nextCursor && (!last || page.nextCursor.id !== last.id || page.nextCursor.createdAt !== last.createdAt)) throw new Error();
      const fresh = await authenticate();
      if (fresh instanceof Response) return privateResponse(fresh);
      if (withdrawalOwnerSchema.parse(fresh.wallet) !== wallet || sessionId.parse(fresh.currentId) !== originalSession)
        return json({ error: "Sign in again to read withdrawal history." }, 401);
      if (request.signal.aborted) return json({ error: "History request was cancelled." }, 408);
      return json({ wallet, ...page });
    } catch { return json({ error: "Withdrawal history is temporarily unavailable." }, 503); }
  };
}
