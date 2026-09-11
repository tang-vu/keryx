import { withdrawalOwnerSchema } from "./withdrawal-request";
import { withdrawalHistoryCursorSchema, withdrawalHistoryPageSchema, type WithdrawalHistoryCursor } from "./withdrawal-history-types";
import { readBoundedJson } from "../read-bounded-json";

const responseSchema = withdrawalHistoryPageSchema.extend({ wallet: withdrawalOwnerSchema }).strict();

/** Server-reported request metadata only. Never reconstructs a signing draft or
 * infers settlement; no browser storage or wallet capability is required. */
export async function readWithdrawalBrowserHistory(owner: string, currentOwner: () => string | null,
  signal: AbortSignal, cursor?: WithdrawalHistoryCursor) {
  const selected = withdrawalOwnerSchema.parse(owner);
  const after = cursor === undefined ? undefined : withdrawalHistoryCursorSchema.parse(structuredClone(cursor));
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), 5000);
  const combined = AbortSignal.any([signal, stop.signal]);
  const assertOwner = () => {
    combined.throwIfAborted();
    if (withdrawalOwnerSchema.parse(currentOwner()) !== selected) throw new Error();
  };
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = () => reject(new Error("Withdrawal history unavailable.")); });
  combined.addEventListener("abort", rejectAbort, { once: true });
  try {
    assertOwner();
    return await Promise.race([aborted, (async () => {
      const response = await fetch("/api/me/withdrawals/history", { method: "POST", redirect: "error",
        credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(after ? { cursor: after } : {}), signal: combined });
      assertOwner();
      // 25 maximum-sized metadata rows fit within this bound. Error bodies are bounded too.
      const value = await readBoundedJson(response, 16384); assertOwner();
      if (response.status === 401) return { state: "authentication-required" as const };
      if (!response.ok) throw new Error();
      const page = responseSchema.parse(value);
      if (page.wallet !== selected || page.requests.some(row => row.owner !== selected || row.id === after?.id)
        || new Set(page.requests.map(row => row.id)).size !== page.requests.length) throw new Error();
      const last = page.requests.at(-1);
      if (page.nextCursor && (!last || page.nextCursor.id !== last.id || page.nextCursor.createdAt !== last.createdAt)) throw new Error();
      assertOwner();
      return { state: "server-history" as const, page };
    })()]);
  } catch { throw new Error("Withdrawal history unavailable. Your saved requests have not been changed."); }
  finally { clearTimeout(timer); combined.removeEventListener("abort", rejectAbort); }
}
