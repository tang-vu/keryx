import type { PrivateJobHistoryDB } from "./private-job-history";
import { readPrivateJobHistory, readPrivateJobHistoryDetail, exportPrivateJobHistory, privateJobHistoryCsv } from "./private-job-history";
import { PRIVATE_JOB_HISTORY_BOUNDS as B, parsePrivateJobHistoryInput, privateJobHistoryDetailInputSchema } from "./private-job-history-contract";
import { parseScopes } from "../api-key-scopes";
import { privateRunResponse } from "../run-claims/private-response";
import { HistoryError, historyWallet } from "./personal-history";

export interface PrivateJobHistoryRouteDependencies {
  /** Established verified-JWT + exact durable-session callback, as in createOwnedHistoryRoute. */
  session(): Promise<{ db: PrivateJobHistoryDB; wallet: string; currentId: string } | Response>;
  /** Established verified, unrevoked API-key lookup. Raw key stays in this request closure. */
  key(raw: string): Promise<{ walletAddress: string; scopes: string | null } | null>;
  db(): Promise<PrivateJobHistoryDB>;
}
const json = (body: unknown, status = 200) => privateRunResponse(Response.json(body, { status }));
const unavailable = () => new HistoryError("history_unavailable");

async function body(request: Request, signal: AbortSignal): Promise<Record<string, unknown>> {
  if (!request.body) throw new HistoryError("invalid_history_query");
  if (signal.aborted) throw unavailable();
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, 5000);
  const bodyDeadline = Date.now() + 5000;
  try {
    for (;;) {
      const part = await reader.read();
      if (signal.aborted || Date.now() >= bodyDeadline) throw unavailable();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > B.requestBytes) throw new HistoryError("invalid_history_query");
      chunks.push(part.value);
    }
    const data = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new HistoryError("invalid_history_query");
    return value as Record<string, unknown>;
  } finally {
    clearTimeout(timer); signal.removeEventListener("abort", cancel);
    void reader.cancel().catch(() => undefined); reader.releaseLock();
  }
}

/** Unmounted POST-only factory. Private IDs/cursors are body selectors, never public report URLs.
 * Parent must review the exact existing caller partition before any production mounting.
 * Auth callbacks are trusted existing dependencies; this helper creates no new auth authority. */
export function createPrivateJobHistoryRoute(deps: PrivateJobHistoryRouteDependencies,
  action: "list" | "detail" | "export" = "list") {
  return async (req: Request): Promise<Response> => {
    const deadline = Date.now() + (action === "export" ? B.exportMs : B.readMs);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    req.signal.addEventListener("abort", cancel, { once: true });
    if (req.signal.aborted) cancel();
    let rejectStop!: (error: Error) => void;
    const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
    void stopped.catch(() => undefined);
    const stop = () => rejectStop(unavailable());
    controller.signal.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(cancel, Math.max(0, deadline - Date.now()));
    const check = () => { if (controller.signal.aborted || Date.now() >= deadline) throw unavailable(); };
    const read = async <T>(fn: () => Promise<T>): Promise<T> => {
      check(); const value = await Promise.race([Promise.resolve().then(fn), stopped]); check(); return value;
    };
    try {
      check();
      if (req.method !== "POST") return privateRunResponse(new Response(null, { status: 405, headers: { Allow: "POST" } }));
      if (new URL(req.url).searchParams.size) return json({ error: "invalid_history_query" }, 400);
      const expected = req.headers.get("x-keryx-expected-wallet");
      if (expected !== null && !/^0x[0-9a-fA-F]{40}$/.test(expected)) return json({ error: "invalid_owner_precondition" }, 400);
      const header = req.headers.get("authorization");
      let context: { db: PrivateJobHistoryDB; wallet: string; currentId?: string } | Response;
      let sessionId: string | undefined;
      if (header !== null) {
        if (!/^Bearer kx_live_[0-9a-f]{96}$/.test(header)) return json({ error: "unauthenticated" }, 401);
        const key = await read(() => deps.key(header.slice(7)));
        if (!key) return json({ error: "unauthenticated" }, 401);
        if (!parseScopes(key.scopes).includes("history:read")) return json({ error: "insufficient_scope" }, 403);
        context = { wallet: key.walletAddress, db: await read(() => deps.db()) };
      } else {
        context = await read(() => deps.session());
        if (!(context instanceof Response)) {
          if (!/^[a-f0-9]{64}$/.test(context.currentId ?? "")) throw unavailable();
          sessionId = context.currentId;
        }
      }
      if (context instanceof Response) return privateRunResponse(context);
      const wallet = historyWallet(context.wallet);
      const db = context.db;
      if (expected !== null && expected.toLowerCase() !== wallet) return json({ error: "history_owner_changed" }, 409);
      let raw;
      try { raw = await read(() => body(req, controller.signal)); }
      catch (error) { if (error instanceof HistoryError) throw error; return json({ error: "invalid_history_query" }, 400); }
      const format = raw.format ?? (action === "detail" ? "report" : "json");
      delete raw.format;
      if (typeof format !== "string" || !(action === "export" ? ["json", "csv"] : action === "detail" ? ["report"] : ["json"]).includes(format)) {
        return json({ error: "invalid_history_query" }, 400);
      }
      const finish = async (response: Response) => {
        check();
        if (header !== null) {
          const current = await read(() => deps.key(header.slice(7)));
          if (!current) return json({ error: "unauthenticated" }, 401);
          if (!parseScopes(current.scopes).includes("history:read")) return json({ error: "insufficient_scope" }, 403);
          if (historyWallet(current.walletAddress) !== wallet) return json({ error: "history_owner_changed" }, 409);
        } else {
          const current = await read(() => deps.session());
          if (current instanceof Response) return privateRunResponse(current);
          if (current.currentId !== sessionId || historyWallet(current.wallet) !== wallet) return json({ error: "history_owner_changed" }, 409);
        }
        check(); return privateRunResponse(response);
      };
      const options = { signal: controller.signal, deadline };
      if (action === "detail") {
        let input;
        try { input = privateJobHistoryDetailInputSchema.parse(raw); } catch { return json({ error: "invalid_history_query" }, 400); }
        const value = await read(() => readPrivateJobHistoryDetail(db, wallet, input.id, options));
        return await finish(value ? json(value) : json({ error: "not_found" }, 404));
      }
      let input;
      try { input = parsePrivateJobHistoryInput(raw); } catch { return json({ error: "invalid_history_query" }, 400); }
      if (action === "list") return await finish(json(await read(() => readPrivateJobHistory(db, wallet, input, options))));
      const value = await read(() => exportPrivateJobHistory(db, wallet, input, options));
      if (format === "json") return await finish(json(value));
      return await finish(privateRunResponse(new Response(privateJobHistoryCsv(value), { headers: {
        "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="keryx-private-job-history.csv"',
        "X-Keryx-History-Truncated": String(value.truncated),
      } })));
    } catch (error) {
      return json({ error: error instanceof HistoryError && error.code === "invalid_history_query" ? "invalid_history_query" : "history_unavailable" },
        error instanceof HistoryError && error.code === "invalid_history_query" ? 400 : 503);
    } finally {
      clearTimeout(timer); req.signal.removeEventListener("abort", cancel);
      controller.signal.removeEventListener("abort", stop);
    }
  };
}
