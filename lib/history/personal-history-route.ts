import { ZodError } from "zod";
import { authJson } from "../auth-challenge";
import { parseScopes } from "../api-key-scopes";
import type { KeryxDB } from "../db/keryx-db";
import { HistoryError, historyWallet, parseHistoryQuery, requirePersonalHistory } from "./personal-history";
import { readPersonalHistory } from "./personal-history-reader";

interface Dependencies {
  session(): Promise<{ db: KeryxDB; wallet: string } | Response>;
  key(raw: string): Promise<{ walletAddress: string; scopes: string | null } | null>;
  db(): Promise<KeryxDB>; network: string;
}
/** Presence of a bearer selects key authority exclusively; the owner is never a URL selector. */
export function createHistoryRoute(deps: Dependencies) {
  return async (req: Request) => {
    try {
      const input = parseHistoryQuery(new URL(req.url).searchParams);
      const expected = req.headers.get("x-keryx-expected-wallet");
      if (expected !== null && !/^0x[0-9a-fA-F]{40}$/.test(expected)) return authJson({ error: "invalid_owner_precondition" }, 400);
      const header = req.headers.get("authorization");
      let context;
      if (header !== null) {
        if (!/^Bearer kx_live_[0-9a-f]{96}$/.test(header)) return authJson({ error: "unauthenticated" }, 401);
        const key = await deps.key(header.slice(7));
        if (!key) return authJson({ error: "unauthenticated" }, 401);
        if (!parseScopes(key.scopes).includes("history:read")) return authJson({ error: "insufficient_scope" }, 403);
        context = { wallet: key.walletAddress, db: await deps.db() };
      } else context = await deps.session();
      if (context instanceof Response) return context;
      if (expected !== null && expected.toLowerCase() !== historyWallet(context.wallet)) return authJson({ error: "history_owner_changed" }, 409);
      return authJson(await readPersonalHistory(requirePersonalHistory(context.db), context.wallet, deps.network, input));
    } catch (error) {
      if (error instanceof ZodError || error instanceof HistoryError && error.code === "invalid_history_query") return authJson({ error: "invalid_history_query" }, 400);
      return authJson({ error: "history_unavailable", message: "Personal history is unavailable on this storage deployment." }, 503);
    }
  };
}
