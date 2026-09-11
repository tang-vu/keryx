import { z } from "zod";
import { createWithdrawalBrowserDraft } from "./withdrawal-browser-journal";
import { withdrawalIdSchema, withdrawalOwnerSchema } from "./withdrawal-request";
import { readBoundedJson } from "../read-bounded-json";

type Draft = ReturnType<typeof createWithdrawalBrowserDraft>;
const progressBase = z.object({ wallet: withdrawalOwnerSchema, requestId: withdrawalIdSchema,
  recipient: withdrawalOwnerSchema, amountMicros: z.string().regex(/^[1-9][0-9]*$/),
  status: z.enum(["request-stored", "awaiting-transfer-evidence", "attestation-stored"]) });
const progressSchema = z.union([
  progressBase.extend({ chainFinalityVerified: z.literal(false),
    mintStatus: z.enum(["not-checked", "not-queued", "queued", "prepared"]) }).strict(),
  progressBase.extend({ chainFinalityVerified: z.literal(true), mintStatus: z.literal("finalized-observed"),
    transactionHash: withdrawalIdSchema, blockHash: withdrawalIdSchema,
    blockNumber: z.string().regex(/^(0|[1-9][0-9]{0,77})$/), observedAt: z.string().datetime(),
    finalityBasis: z.literal("operator-selected-rpc") }).strict(),
]);

export function matchWithdrawalBrowserStatus(selected: Draft, value: unknown) {
  const copied = structuredClone(selected), draft = createWithdrawalBrowserDraft(copied.burnIntent, copied.policy);
  const progress = progressSchema.parse(value);
  if (copied.id !== draft.id || copied.owner.toLowerCase() !== draft.owner || progress.requestId !== draft.id
    || progress.wallet !== draft.owner || progress.recipient !== draft.policy.recipient
    || progress.amountMicros !== draft.burnIntent.spec.value) throw new Error("Withdrawal status does not match the original");
  return progress;
}

/** Fixed same-origin read-only endpoint. Only the selector enters the body; signatures,
 * policy and account identifiers stay out of URLs. Never retries or follows redirects.
 * The public route is not enabled until the complete recovery integration is ready. */
export async function readWithdrawalBrowserStatus(selected: Draft, signal: AbortSignal) {
  const copied = structuredClone(selected), draft = createWithdrawalBrowserDraft(copied.burnIntent, copied.policy);
  if (copied.id !== draft.id || copied.owner.toLowerCase() !== draft.owner) throw new Error("Withdrawal draft unavailable");
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), 5000);
  const combined = AbortSignal.any([signal, stop.signal]);
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = () => reject(new Error("Withdrawal status unavailable")); });
  combined.addEventListener("abort", rejectAbort, { once: true });
  try {
    combined.throwIfAborted();
    return await Promise.race([aborted, (async () => {
      const response = await fetch("/api/me/withdrawals/status", { method: "POST", redirect: "error", credentials: "same-origin",
        cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: draft.id }), signal: combined });
      combined.throwIfAborted();
      // Consume a bounded response even for errors; no raw server messages are exposed.
      const body = await readBoundedJson(response, 2048); combined.throwIfAborted();
      if (response.status === 401) return { state: "authentication-required" as const };
      if (response.status === 404) return { state: "unavailable" as const };
      if (!response.ok) throw new Error();
      return { state: "observed-transfer" as const, progress: matchWithdrawalBrowserStatus(draft, body) };
    })()]);
  } catch { throw new Error("Withdrawal status unavailable; retain the original request"); }
  finally { clearTimeout(timer); combined.removeEventListener("abort", rejectAbort); }
}
