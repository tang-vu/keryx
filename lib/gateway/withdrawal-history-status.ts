import { withdrawalHistoryEntrySchema, type WithdrawalHistoryEntry } from "./withdrawal-history-types";
import { withdrawalOwnerSchema } from "./withdrawal-request";
import { withdrawalServerProgressSchema } from "./withdrawal-browser-status";
import { readBoundedJson } from "../read-bounded-json";

/** Match two server reports. This does not replace the local-original verifier or
 * independently verify chain finality; callers must retain the server-reported label. */
export function matchWithdrawalHistoryStatus(selected: WithdrawalHistoryEntry, value: unknown) {
  const row = withdrawalHistoryEntrySchema.parse(selected), progress = withdrawalServerProgressSchema.parse(value);
  if (progress.wallet !== row.owner || progress.requestId !== row.id || progress.recipient !== row.recipient
    || progress.amountMicros !== row.amountMicros) throw new Error("Withdrawal progress does not match the history record");
  return progress;
}

/** Read-only recovery by server history ID, without a wallet or locally retained signature. */
export async function readWithdrawalHistoryStatus(selected: WithdrawalHistoryEntry, currentOwner: () => string | null, signal: AbortSignal) {
  const row = withdrawalHistoryEntrySchema.parse(structuredClone(selected));
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), 5000);
  const combined = AbortSignal.any([signal, stop.signal]);
  const assertOwner = () => {
    combined.throwIfAborted();
    if (withdrawalOwnerSchema.parse(currentOwner()) !== row.owner) throw new Error();
  };
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = () => reject(new Error("Withdrawal progress unavailable")); });
  combined.addEventListener("abort", rejectAbort, { once: true });
  try {
    assertOwner();
    return await Promise.race([aborted, (async () => {
      const response = await fetch("/api/me/withdrawals/status", { method: "POST", redirect: "error", credentials: "same-origin",
        cache: "no-store", referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id }), signal: combined });
      assertOwner();
      const body = await readBoundedJson(response, 2048); assertOwner();
      if (response.status === 401) return { state: "authentication-required" as const };
      if (response.status === 404) return { state: "unavailable" as const };
      if (!response.ok) throw new Error();
      return { state: "server-reported-progress" as const, progress: matchWithdrawalHistoryStatus(row, body) };
    })()]);
  } catch { throw new Error("Withdrawal progress unavailable. No new request has been created."); }
  finally { clearTimeout(timer); combined.removeEventListener("abort", rejectAbort); }
}
