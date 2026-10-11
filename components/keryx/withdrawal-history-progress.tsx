import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import type { readWithdrawalHistoryStatus } from "@/lib/gateway/withdrawal-history-status";
import { recordedArcLabel,recordedArcTransactionUrl } from "@/lib/arc-network-display";

const uiCopy = createMessages("en");
const uiRichCopy = createRichMessages("en");

export type HistoryProgress = Awaited<ReturnType<typeof readWithdrawalHistoryStatus>> | { state: "read-failed" };

export function WithdrawalHistoryProgress({ result }: { result?: HistoryProgress }) {
  if (!result) return <p>{uiCopy("withdrawalProgress.unchecked")}</p>;
  if (result.state === "read-failed") return <p role="status">{uiCopy("withdrawalProgress.readFailed")}</p>;
  if (result.state === "unavailable") return <p role="status">{uiCopy("withdrawalProgress.unavailable")}</p>;
  if (result.state === "authentication-required") return <p role="status">{uiCopy("withdrawalProgress.signIn")}</p>;
  const progress = result.progress;
  const network="network" in progress&&typeof progress.network==="string"?progress.network:undefined;
  if (progress.chainFinalityVerified) return <div className="space-y-1" role="status">
    <p>{uiCopy("withdrawalProgress.observedMint", { network: recordedArcLabel(network) })}</p>
    <p>{uiCopy("withdrawalProgress.rpcBoundary")}</p>
    <p>{uiRichCopy("withdrawalProgress.observedAt", { time: <time dateTime={progress.observedAt}>{progress.observedAt}</time> })}</p>
    <a className="break-all underline" href={recordedArcTransactionUrl(network,progress.transactionHash)}
      target="_blank" rel="noopener noreferrer">{uiCopy("withdrawalProgress.transaction")}</a>
  </div>;
  const transfer = {
    "request-stored": uiCopy("withdrawalProgress.requestSaved"),
    "awaiting-transfer-evidence": uiCopy("withdrawalProgress.transferPending"),
    "attestation-stored": uiCopy("withdrawalProgress.attestationSaved"),
  }[progress.status];
  const mint = {
    "not-checked": uiCopy("withdrawalProgress.mintUnchecked"),
    "not-queued": uiCopy("withdrawalProgress.notQueued"),
    "queued": uiCopy("withdrawalProgress.queued"),
    "prepared": uiCopy("withdrawalProgress.prepared"),
  }[progress.mintStatus];
  return <div className="space-y-1" role="status"><p>{uiCopy("withdrawalProgress.title")}</p><p>{transfer}</p><p>{mint}</p></div>;
}
