import { withdrawalHistoryEntrySchema, type WithdrawalHistoryEntry } from "./withdrawal-history-types";
import { withdrawalOwnerSchema } from "./withdrawal-request";
import { withdrawalServerProgressSchema } from "./withdrawal-browser-status";
import { readBoundedJson } from "../read-bounded-json";
import { browserPaymentProfile } from "../browser-payment-profile";
import { matchCreatorOwnerBrowserStatus } from "./creator-owner-browser-status";
import { validateWithdrawalRequest } from "./withdrawal-request";
import { createWithdrawalBrowserDraft } from "./withdrawal-browser-journal";

/** Match the complete original mainnet owner packet without granting a retry or
 * claiming that this read-only history view independently checked RPC finality. */
async function matchMainnetHistoryStatus(row:WithdrawalHistoryEntry,value:unknown){
  const record=await validateWithdrawalRequest((value as {record?:unknown})?.record);
  if(record.network!==browserPaymentProfile().networkId||record.id!==row.id||record.owner!==row.owner||
    record.policy.recipient!==row.recipient||record.request.burnIntent.spec.value!==row.amountMicros||record.request.burnIntent.maxFee!==row.maxFeeMicros)
    throw new Error("Original history withdrawal differs");
  const status=await matchCreatorOwnerBrowserStatus(createWithdrawalBrowserDraft(record.request.burnIntent,record.policy),value);
  const base={wallet:row.owner,requestId:row.id,recipient:row.recipient,amountMicros:row.amountMicros,network:record.network};
  return status.completion?{...base,status:"attestation-stored" as const,chainFinalityVerified:true as const,mintStatus:"finalized-observed" as const,
    transactionHash:status.completion.observation.transactionHash,blockHash:status.completion.observation.blockHash,
    blockNumber:status.completion.observation.blockNumber,observedAt:status.completion.observation.observedAt,finalityBasis:"operator-selected-rpc" as const}:
    {...base,status:status.progress.status as "request-stored"|"awaiting-transfer-evidence"|"attestation-stored",chainFinalityVerified:false as const,mintStatus:"not-checked" as const};
}

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
      const body = await readBoundedJson(response, browserPaymentProfile().testnet?2048:65536); assertOwner();
      if (response.status === 401) return { state: "authentication-required" as const };
      if (response.status === 404) return { state: "unavailable" as const };
      if (!response.ok) throw new Error();
      const progress=browserPaymentProfile().testnet?matchWithdrawalHistoryStatus(row,body):await matchMainnetHistoryStatus(row,body);assertOwner();
      return { state: "server-reported-progress" as const, progress };
    })()]);
  } catch { throw new Error("Withdrawal progress unavailable. No new request has been created."); }
  finally { clearTimeout(timer); combined.removeEventListener("abort", rejectAbort); }
}
