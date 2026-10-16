import { createMessages } from "@/lib/i18n/messages";

import type { readWithdrawalHistoryStatus } from "@/lib/gateway/withdrawal-history-status";
import { recordedArcLabel,recordedArcTransactionUrl } from "@/lib/arc-network-display";
import { UiMessage, UiRichMessage } from "@/lib/i18n/ui-copy";



const uiCopy = createMessages("en");


export type HistoryProgress = Awaited<ReturnType<typeof readWithdrawalHistoryStatus>> | { state: "read-failed" };

export function WithdrawalHistoryProgress({ result }: { result?: HistoryProgress }) {
  if (!result) return <p><UiMessage messageKey={"withdrawalProgress.unchecked"} /></p>;
  if (result.state === "read-failed") return <p role="status"><UiMessage messageKey={"withdrawalProgress.readFailed"} /></p>;
  if (result.state === "unavailable") return <p role="status"><UiMessage messageKey={"withdrawalProgress.unavailable"} /></p>;
  if (result.state === "authentication-required") return <p role="status"><UiMessage messageKey={"withdrawalProgress.signIn"} /></p>;
  const progress = result.progress;
  const network="network" in progress&&typeof progress.network==="string"?progress.network:undefined;
  if (progress.chainFinalityVerified) return <div className="space-y-1" role="status">
    <p><UiMessage messageKey={"withdrawalProgress.observedMint"} values={{ network: recordedArcLabel(network) }} /></p>
    <p><UiMessage messageKey={"withdrawalProgress.rpcBoundary"} /></p>
    <p><UiRichMessage messageKey={"withdrawalProgress.observedAt"} values={{ time: <time dateTime={progress.observedAt}>{progress.observedAt}</time> }} /></p>
    <a className="break-all underline" href={recordedArcTransactionUrl(network,progress.transactionHash)}
      target="_blank" rel="noopener noreferrer"><UiMessage messageKey={"withdrawalProgress.transaction"} /></a>
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
  return <div className="space-y-1" role="status"><p><UiMessage messageKey={"withdrawalProgress.title"} /></p><p>{transfer}</p><p>{mint}</p></div>;
}
