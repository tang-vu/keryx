import type { KeryxDB } from "../db/keryx-db";
import { parseScopes } from "../api-key-scopes";
import { privateRunResponse } from "../run-claims/private-response";
import { type RunClaimBinding } from "../run-claims/contracts";
import { HistoryError, historyIdSchema, historyWallet, requirePersonalHistory } from "./personal-history";
import { historyReceiptSchema, parseOwnedQuery } from "./owned-history";
import { readOwnedDetail, readOwnedHistory } from "./owned-history-reader";
import { exportOwnedHistory, historyCsv } from "./owned-history-export";
import { buildCitationExport, type CitationExportFormat } from "../research-citation-export";
import { AccountError, type AccountHistoryObservation } from "../accounts/contracts";
import { accountOwnedHistory, walletOwnedHistoryDb } from "./account-owned-history";

interface Dependencies {
  session(): Promise<{ db: KeryxDB; wallet: string; currentId: string } | Response>;
  key(raw: string): Promise<{ walletAddress: string; scopes: string | null } | null>;
  db(): Promise<KeryxDB>; binding: RunClaimBinding;
}
const json = (body: unknown, status = 200) => privateRunResponse(Response.json(body, { status }));
export function createOwnedHistoryRoute(deps: Dependencies, action: "list" | "export" | "detail" = "list") {
  return async (req: Request, rawId?: string) => {
    try {
      const params = new URL(req.url).searchParams;
      const contracts = params.getAll("contract");
      if (contracts.length > 1 || contracts.length && contracts[0] !== "owned") return json({ error: "invalid_history_query" }, 400);
      params.delete("contract");
      const formats = params.getAll("format"); if (formats.length > 1) return json({ error: "invalid_history_query" }, 400);
      const format = formats[0] ?? (action === "detail" ? "report" : "json"); params.delete("format");
      if (!((action === "detail" ? ["report", "receipts", "bibtex", "ris", "csl-json"] : action === "export" ? ["json", "csv"] : ["json"]).includes(format))) return json({ error: "invalid_history_query" }, 400);
      let input;
      try { input = parseOwnedQuery(params); } catch { return json({ error: "invalid_history_query" }, 400); }
      if (action === "detail" && params.size) return json({ error: "invalid_history_query" }, 400);
      const expected = req.headers.get("x-keryx-expected-wallet");
      if (expected !== null && !/^0x[0-9a-fA-F]{40}$/.test(expected)) return json({ error: "invalid_owner_precondition" }, 400);
      const header = req.headers.get("authorization"); let context, sessionId: string | undefined;
      if (header !== null) {
        if (!/^Bearer kx_live_[0-9a-f]{96}$/.test(header)) return json({ error: "unauthenticated" }, 401);
        const key = await deps.key(header.slice(7));
        if (!key) return json({ error: "unauthenticated" }, 401);
        if (!parseScopes(key.scopes).includes("history:read")) return json({ error: "insufficient_scope" }, 403);
        context = { wallet: key.walletAddress, db: await deps.db() };
      } else {
        context = await deps.session();
        if (!(context instanceof Response)) {
          if (!/^[a-f0-9]{64}$/.test(context.currentId)) throw new HistoryError("history_unavailable");
          sessionId = context.currentId;
        }
      }
      if (context instanceof Response) return privateRunResponse(context);
      const wallet = historyWallet(context.wallet);
      if (expected !== null && expected.toLowerCase() !== wallet) return json({ error: "history_owner_changed" }, 409);
      // Only this exact interactive session may resolve explicit account consent.
      // A bearer key never consults an account port or inherits shared membership.
      const history = header !== null ? { db: walletOwnedHistoryDb(context.db), account: null }
        : await accountOwnedHistory({ db: context.db, wallet, currentId: sessionId! }, deps.binding, req.signal);
      const account = history.account;
      const finish = async (response: Response) => {
        // Fence the exact credential after private IO; another session for this wallet is not a renewal.
        if (req.signal.aborted) throw new HistoryError("history_unavailable");
        if (header !== null) {
          const current = await deps.key(header.slice(7));
          if (!current) return json({ error: "unauthenticated" }, 401);
          if (!parseScopes(current.scopes).includes("history:read")) return json({ error: "insufficient_scope" }, 403);
          if (historyWallet(current.walletAddress) !== wallet) return json({ error: "history_owner_changed" }, 409);
        } else {
          const current = await deps.session();
          if (current instanceof Response) return privateRunResponse(current);
          if (current.currentId !== sessionId || historyWallet(current.wallet) !== wallet) {
            return json({ error: "history_owner_changed" }, 409);
          }
        }
        if (req.signal.aborted) throw new HistoryError("history_unavailable");
        return response;
      };
      let response: Response, selected: AccountHistoryObservation[] = [];
      if (action === "list") {
        const value = await readOwnedHistory(history.db, wallet, deps.binding, input, req.signal);
        selected = account?.selectRows(value.rows) ?? []; response = json(value);
      } else if (action === "export") {
        const value = await exportOwnedHistory(history.db, wallet, deps.binding, input, req.signal);
        selected = account?.selectRows(value.rows) ?? [];
        response = format === "json" ? json(value) : privateRunResponse(new Response(historyCsv(value), {
          headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="keryx-personal-history.csv"',
            "X-Keryx-History-Truncated": String(value.truncated) } }));
      } else {
        const parsedId = historyIdSchema.safeParse(rawId); if (!parsedId.success) return json({ error: "invalid_history_query" }, 400);
        const id = parsedId.data, item = await readOwnedDetail(history.db, wallet, deps.binding, id, req.signal);
        if (!item) response = json({ error: "not_found" }, 404);
        else {
          if (format === "report") response = json(item);
          else if (format === "receipts") {
            const port = requirePersonalHistory(history.db); if (!port.receipts) throw new HistoryError("history_unavailable");
            const payments = (await port.receipts(id, 201)).map(p => historyReceiptSchema.parse(p));
            if (payments.length > 201 || payments.some(p => p.queryId !== id)) throw new HistoryError("history_unavailable");
            response = !await readOwnedDetail(history.db, wallet, deps.binding, id, req.signal) ? json({ error: "not_found" }, 404)
              : json({ version: 2, wallet, id, payments: payments.slice(0, 200), truncated: payments.length > 200, bound: 200 });
          } else {
            const references = buildCitationExport(item.run.citations, format as CitationExportFormat);
            response = privateRunResponse(new Response(references.content, { headers: {
              "Content-Type": format === "csl-json" ? "application/json" : "text/plain; charset=utf-8",
              "Content-Disposition": `attachment; filename="keryx-${id}.${format === "bibtex" ? "bib" : format === "csl-json" ? "json" : "ris"}"`,
              "X-Keryx-References-Omitted": String(references.omitted) } }));
          }
          if (response.status === 200) selected = account?.selectDetail(item) ?? [];
        }
      }
      // Every body is fully serialized before the final awaited checks. Empty
      // results still seal the exact consent/session. No streaming authority.
      const seal = account ? await account.prepare(selected) : null;
      if (account) await account.privacyFence(selected);
      const finished = await finish(response);
      if (finished !== response) return finished;
      if (account && seal) account.seal(seal);
      return response; // Deliberately NO await or asynchronous work after seal.
    } catch (error) {
      if (error instanceof HistoryError && error.code === "invalid_history_query") return json({ error: "invalid_history_query" }, 400);
      if (error instanceof AccountError && error.code === "account_unauthenticated") return json({ error: "unauthenticated" }, 401);
      if (error instanceof AccountError && error.code === "account_changed") return json({ error: "history_owner_changed" }, 409);
      return json({ error: "history_unavailable" }, 503);
    }
  };
}
