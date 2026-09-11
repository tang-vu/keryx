import { readBoundedJson } from "../read-bounded-json";
import { validateWithdrawalRequest, type WithdrawalRequestRecord } from "./withdrawal-request";
import { createWithdrawalBrowserDraft } from "./withdrawal-browser-journal";
import { matchWithdrawalBrowserStatus } from "./withdrawal-browser-status";

/** App-owned transport for a committed one-attempt browser claim only. This function
 * cannot establish that claim itself. Its response is transfer progress, not finality. */
export async function sendWithdrawalBrowserOriginal(value: WithdrawalRequestRecord, signal: AbortSignal, beforeSend: () => void) {
  const record = await validateWithdrawalRequest(structuredClone(value));
  const draft = createWithdrawalBrowserDraft(record.request.burnIntent, record.policy);
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), 30000);
  const combined = AbortSignal.any([signal, stop.signal]);
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = () => reject(new Error("Withdrawal submission unavailable")); });
  combined.addEventListener("abort", rejectAbort, { once: true });
  try {
    combined.throwIfAborted();
    // Signature verification above can outlive the active wallet/session selection.
    beforeSend(); combined.throwIfAborted();
    return await Promise.race([aborted, (async () => {
      const response = await fetch("/api/me/withdrawals/submit", { method: "POST", redirect: "error",
        credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record.request), signal: combined });
      combined.throwIfAborted();
      const body = await readBoundedJson(response, 2048); combined.throwIfAborted();
      if (response.status !== 202) throw new Error();
      return matchWithdrawalBrowserStatus(draft, body);
    })()]);
  } catch { throw new Error("Withdrawal submission unavailable; recover the original request"); }
  finally { clearTimeout(timer); combined.removeEventListener("abort", rejectAbort); }
}
