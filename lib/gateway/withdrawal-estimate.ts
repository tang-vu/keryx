import { maxUint256 } from "viem";
import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { readBoundedJson } from "../read-bounded-json";
import { validateWithdrawIntent, withdrawRequestSchema, type WithdrawPolicy } from "./withdraw-protocol";

const uint = z.string().regex(/^(0|[1-9][0-9]{0,77})$/).refine(value => BigInt(value) < maxUint256);
const windowSchema = z.object({ minimumBlockHeight: uint, maximumBlockHeight: uint }).strict()
  .refine(value => BigInt(value.minimumBlockHeight) <= BigInt(value.maximumBlockHeight));
type Window = z.infer<typeof windowSchema>;
const estimateIntent = z.preprocess(value => {
  if (!value || typeof value !== "object" || !("spec" in value) || !value.spec || typeof value.spec !== "object") return value;
  const copied = structuredClone(value) as { spec: Record<string, unknown> };
  for (const field of ["sourceContract", "destinationContract", "sourceToken", "destinationToken", "sourceDepositor",
    "destinationRecipient", "sourceSigner", "destinationCaller"]) {
    const address = copied.spec[field];
    if (typeof address === "string" && /^0x[a-fA-F0-9]{40}$/.test(address)) copied.spec[field] = `0x${"0".repeat(24)}${address.slice(2)}`;
  }
  return copied;
}, withdrawRequestSchema.shape.burnIntent);
const estimateList = z.array(z.object({ burnIntent: estimateIntent }).strict()).length(1);
// Live testnet currently returns the array directly; the reference also documents
// an envelope. Both representations pass the identical single-intent validation.
const responseSchema = z.union([estimateList, z.object({ body: estimateList }).transform(value => value.body)]);

/** Before local draft reservation/signing only. The caller supplies a fresh server-owned
 * source-chain height window; an estimate is not a quote reservation or payment proof. */
export function matchWithdrawalEstimate(value: unknown, selected: unknown, policy: WithdrawPolicy, window: Window) {
  const original = validateWithdrawIntent(selected, policy), bounds = windowSchema.parse(window);
  const estimated = validateWithdrawIntent(responseSchema.parse(value)[0].burnIntent, policy);
  const height = BigInt(estimated.burnIntent.maxBlockHeight);
  if (policy.domain !== 26 || canonicalJson(original.burnIntent.spec) !== canonicalJson(estimated.burnIntent.spec)
    || height < BigInt(bounds.minimumBlockHeight) || height > BigInt(bounds.maximumBlockHeight))
    throw new Error("Withdrawal estimate does not match reviewed terms");
  return estimated.burnIntent;
}

/** Unsigned testnet estimation only. Sends no signature and never invokes /transfer.
 * Fixed URL, no redirects/retries; deadline and size cap cover the response body. */
export async function estimateWithdrawalIntent(selected: unknown, selectedPolicy: WithdrawPolicy, selectedWindow: Window, signal: AbortSignal) {
  const policy = structuredClone(selectedPolicy), window = windowSchema.parse(structuredClone(selectedWindow));
  const original = validateWithdrawIntent(structuredClone(selected), policy);
  if (policy.domain !== 26) throw new Error("Withdrawal estimate network unavailable");
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), 10000);
  const combined = AbortSignal.any([signal, stop.signal]);
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = () => reject(new Error("Estimate aborted")); });
  combined.addEventListener("abort", rejectAbort, { once: true });
  try {
    combined.throwIfAborted();
    return await Promise.race([aborted, (async () => {
      const response = await fetch("https://gateway-api-testnet.circle.com/v1/estimate", { method: "POST", redirect: "error",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify([{ spec: original.burnIntent.spec }]), signal: combined });
      combined.throwIfAborted();
      const body = await readBoundedJson(response, 8192); combined.throwIfAborted();
      if (!response.ok) throw new Error();
      return matchWithdrawalEstimate(body, original.burnIntent, policy, window);
    })()]);
  } catch { throw new Error("Withdrawal estimate unavailable; do not sign an unreviewed request"); }
  finally { clearTimeout(timer); combined.removeEventListener("abort", rejectAbort); }
}
