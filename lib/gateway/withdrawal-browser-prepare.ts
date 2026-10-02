import { z } from "zod";
import { maxUint256 } from "viem";
import { canonicalJson } from "../canonical-json";
import { readBoundedJson } from "../read-bounded-json";
import { withdrawPolicySchema, type WithdrawPolicy } from "./withdraw-protocol";
import { withdrawalOwnerSchema } from "./withdrawal-request";
import { createWithdrawalBrowserDraft, reserveWithdrawalBrowserJournal } from "./withdrawal-browser-journal";

const responseSchema = z.object({ wallet: withdrawalOwnerSchema, draft: z.unknown(),
  preparedAt: z.string().datetime() }).strict();

function selectedPolicy(value: WithdrawPolicy) {
  const policy = withdrawPolicySchema.parse(value);
  if (policy.domain !== 26 || policy.owner !== policy.recipient || BigInt(policy.maxValueMicros) === BigInt(0))
    throw new Error("Withdrawal selection unavailable");
  return policy;
}

/** The caller supplies locally reviewed contracts and exact amount/fee caps. The
 * server response cannot select its own validation authority. Freshness here is
 * request age only; the server must still recheck chain expiry during submission.
 * preparedAt is validated metadata, not authority over the browser's wall clock. */
export function matchWithdrawalBrowserPreparation(selected: WithdrawPolicy, value: unknown, elapsedMs: number) {
  const policy = selectedPolicy(selected), response = responseSchema.parse(value);
  const envelope = z.object({ id: z.string(), owner: withdrawalOwnerSchema, policy: withdrawPolicySchema,
    burnIntent: z.unknown() }).strict().parse(response.draft);
  const draft = createWithdrawalBrowserDraft(envelope.burnIntent, policy);
  const height = BigInt(draft.burnIntent.maxBlockHeight);
  if (response.wallet !== policy.owner || canonicalJson(envelope) !== canonicalJson(draft)
    || draft.burnIntent.spec.value !== policy.maxValueMicros || height === BigInt(0) || height === maxUint256
    || !Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > 60000) throw new Error("Withdrawal preparation mismatch");
  return draft;
}

/** Prepare and durably reserve an unsigned original. Never signs, sends a payment,
 * retries, or replaces a previously stored original. An interrupted storage write
 * may remain saved; failure is not permission to overwrite it. */
export async function prepareWithdrawalBrowserDraft(selected: WithdrawPolicy, activeOwner: () => string | null, signal: AbortSignal) {
  const policy = selectedPolicy(selected);
  const monotonicNow = performance.now.bind(performance);
  let started: number | undefined;
  const age = () => started === undefined ? 0 : monotonicNow() - started;
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), 40000);
  const combined = AbortSignal.any([signal, stop.signal]);
  const live = () => {
    combined.throwIfAborted();
    const elapsed = age();
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 60000) throw new Error();
    if (withdrawalOwnerSchema.parse(activeOwner()) !== policy.owner) throw new Error();
  };
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = () => reject(new Error("Withdrawal preparation interrupted")); });
  combined.addEventListener("abort", rejectAbort, { once: true });
  try {
    live();
    return await Promise.race([aborted, (async () => {
      started = monotonicNow(); live();
      const response = await fetch("/api/me/withdrawals/prepare", { method: "POST", credentials: "same-origin",
        cache: "no-store", redirect: "error", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountMicros: policy.maxValueMicros }), signal: combined });
      live();
      const body = await readBoundedJson(response, 8192); live();
      if (response.status !== 200) throw new Error();
      const draft = matchWithdrawalBrowserPreparation(policy, body, age()); live();
      const saved = await reserveWithdrawalBrowserJournal(draft, policy.owner); live();
      return saved;
    })()]);
  } catch { throw new Error("Withdrawal preparation unavailable. Check saved drafts before preparing again."); }
  finally { clearTimeout(timer); combined.removeEventListener("abort", rejectAbort); }
}
