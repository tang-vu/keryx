import type { readWithdrawalHistoryStatus } from "@/lib/gateway/withdrawal-history-status";

export type HistoryProgress = Awaited<ReturnType<typeof readWithdrawalHistoryStatus>> | { state: "read-failed" };

export function WithdrawalHistoryProgress({ result }: { result?: HistoryProgress }) {
  if (!result) return <p>Server record · Settlement not checked</p>;
  if (result.state === "read-failed") return <p role="status">Progress could not be read. This does not mean the withdrawal failed.</p>;
  if (result.state === "unavailable") return <p role="status">The server could not find this request. Keep its ID and any recovery file; do not treat it as cancelled.</p>;
  if (result.state === "authentication-required") return <p role="status">Sign in again to check progress.</p>;
  const progress = result.progress;
  if (progress.chainFinalityVerified) return <div className="space-y-1" role="status">
    <p>Server reports an observed mint on Arc Testnet.</p>
    <p>Observation uses the operator&apos;s RPC; this browser has not independently verified settlement.</p>
    <p>Observed: <time dateTime={progress.observedAt}>{progress.observedAt}</time></p>
    <a className="break-all underline" href={`https://testnet.arcscan.app/tx/${progress.transactionHash}`}
      target="_blank" rel="noopener noreferrer">View reported mint transaction</a>
  </div>;
  const transfer = {
    "request-stored": "Request saved. No transfer attempt is recorded.",
    "awaiting-transfer-evidence": "Transfer evidence is still pending. Do not create a replacement request to retry it.",
    "attestation-stored": "Transfer attestation saved. This alone does not confirm receipt in your wallet.",
  }[progress.status];
  const mint = {
    "not-checked": "Mint settlement has not been checked.",
    "not-queued": "No mint queue entry is reported.",
    "queued": "Mint is queued; settlement is not confirmed.",
    "prepared": "Mint transaction is prepared; settlement is not confirmed.",
  }[progress.mintStatus];
  return <div className="space-y-1" role="status"><p>Server-reported progress</p><p>{transfer}</p><p>{mint}</p></div>;
}
